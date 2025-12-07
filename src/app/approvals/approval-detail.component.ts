import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom, interval, map, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  ApprovalNotification,
  ApprovalRequest,
  ApprovalStepState,
  ApprovalStepStatus,
  ApprovalRequestStatus,
} from '../models/approvals';
import { ApprovalNotificationService } from './approval-notification.service';
import { ApprovalWorkflowService } from './approval-workflow.service';

type EmployeeStatus = 'OK' | '警告';

interface ApprovalDetailEmployee {
  employeeNo: string;
  name: string;
  status: EmployeeStatus;
  diffs: { field: string; oldValue: string; newValue: string }[];
}

@Component({
  selector: 'app-approval-detail',
  standalone: true,
  imports: [CommonModule, NgIf, NgFor, FormsModule, DatePipe, RouterLink],
  templateUrl: './approval-detail.component.html',
  styleUrl: './approval-detail.component.scss',
})
export class ApprovalDetailComponent implements OnDestroy {
  private workflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);

  approval?: ApprovalRequest;
  private subscription: Subscription;

  employees: ApprovalDetailEmployee[] = [
    {
      employeeNo: 'E202501',
      name: '佐藤 花子',
      status: 'OK',
      diffs: [
        { field: '標準報酬月額', oldValue: '420,000円', newValue: '430,000円' },
        { field: '健康保険区分', oldValue: '一般', newValue: '一般' },
      ],
    },
    {
      employeeNo: 'E202507',
      name: '加藤 真由',
      status: '警告',
      diffs: [
        { field: '住所', oldValue: '東京都渋谷区', newValue: '東京都渋谷区代々木' },
        { field: '標準報酬月額', oldValue: '410,000円', newValue: '380,000円（要確認）' },
      ],
    },
    {
      employeeNo: 'E202512',
      name: '渡辺 光',
      status: 'OK',
      diffs: [
        { field: '生年月日', oldValue: '1984/04/03', newValue: '1984/04/03' },
        { field: '扶養区分', oldValue: '配偶者あり', newValue: '配偶者あり' },
      ],
    },
  ];

  selectedEmployee?: ApprovalDetailEmployee;
  showDiffModal = false;
  approvalComment = '';

  toasts: { message: string; type: 'info' | 'success' | 'warning' }[] = [];

  readonly approval$ = this.route.paramMap.pipe(
    map((params) => params.get('id')),
    switchMap((id) => this.workflowService.getRequest(id)),
    tap((approval) => {
      this.approval = approval;
    }),
  );

  private expiryWatcher = interval(30_000)
    .pipe(
      tap(() => {
        if (this.approval && this.isOverdue(this.approval)) {
          this.workflowService.expire(this.approval);
        }
      }),
    )
    .subscribe();

  constructor() {
    this.subscription = this.approval$.subscribe();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.expiryWatcher.unsubscribe();
  }

  statusClass(status: ApprovalStepStatus) {
    switch (status) {
      case 'approved':
        return 'status-approved';
      case 'remanded':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  requestStatusClass(status: ApprovalRequestStatus) {
    switch (status) {
      case 'approved':
        return 'status-approved';
      case 'remanded':
      case 'expired':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  requestStatusLabel(status: ApprovalRequestStatus) {
    switch (status) {
      case 'approved':
        return '承認済';
      case 'remanded':
        return '差戻し';
      case 'expired':
        return '失効';
      case 'draft':
        return '下書き';
      default:
        return '承認待ち';
    }
  }

  openDiffModal(employee: ApprovalDetailEmployee) {
    this.selectedEmployee = employee;
    this.showDiffModal = true;
  }

  closeDiffModal() {
    this.showDiffModal = false;
    this.selectedEmployee = undefined;
  }

  addToast(message: string, type: 'info' | 'success' | 'warning' = 'info') {
    const toast = { message, type };
    this.toasts.push(toast);
    setTimeout(() => {
      const index = this.toasts.indexOf(toast);
      if (index !== -1) {
        this.toasts.splice(index, 1);
      }
    }, 3800);
  }

  isOverdue(approval: ApprovalRequest): boolean {
    if (!approval.dueDate) return false;
    return approval.status === 'pending' && approval.dueDate.toDate().getTime() < Date.now();
  }

  stepLabel(step: ApprovalStepState): string {
    switch (step.status) {
      case 'approved':
        return '承認済';
      case 'remanded':
        return '差戻し';
      case 'skipped':
        return '自動スキップ';
      default:
        return '承認待ち';
    }
  }

  candidateNames(stepOrder: number): string {
    const candidateStep = this.approval?.flowSnapshot?.steps.find((s) => s.order === stepOrder);
    if (!candidateStep) return '未設定';
    return candidateStep.candidates.map((candidate) => candidate.displayName).join(' / ');
  }

  async saveApproval(action: 'approve' | 'remand') {
    if (!this.approval?.id || !this.approval.currentStep) return;

    const user = await firstValueFrom(this.authService.user$);
    const approverId = user?.email ?? 'demo-approver';
    const approverName = user?.displayName ?? user?.email ?? 'デモ承認者';

    const result =
      action === 'approve'
        ? await this.workflowService.approve(this.approval.id, approverId, approverName, this.approvalComment)
        : await this.workflowService.remand(this.approval.id, approverId, approverName, this.approvalComment);

    if (!result) return;
    const actionText = action === 'approve' ? '承認しました' : '差戻しました';
    this.addToast(`申請を${actionText}（コメント: ${this.approvalComment || 'なし'}）`, 'success');
    this.approvalComment = '';

    const applicantNotification: ApprovalNotification = {
      id: `ntf-${Date.now()}`,
      requestId: result.request.id!,
      recipientId: this.approval.applicantId,
      message:
        action === 'approve'
          ? `${result.request.id} が承認ステップ ${this.approval.currentStep} を通過しました`
          : `${result.request.id} が差戻しされました`,
      unread: true,
      createdAt: new Date(),
      type: action === 'approve' ? 'success' : 'warning',
    };

    const nextStepNotifications: ApprovalNotification[] = result.nextAssignees.map((assignee) => ({
      id: `ntf-${Date.now()}-${assignee}`,
      requestId: result.request.id!,
      recipientId: assignee,
      message:
        action === 'approve'
          ? `${result.request.id} のステップ${result.request.currentStep}を承認してください`
          : `${result.request.id} が差戻しされました。申請者と調整してください。`,
      unread: true,
      createdAt: new Date(),
      type: action === 'approve' ? 'info' : 'warning',
    }));

    this.notificationService.pushBatch([applicantNotification, ...nextStepNotifications]);
  }
}