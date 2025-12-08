import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, Subscription, firstValueFrom, interval, map, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  ApprovalNotification,
  ApprovalRequest,
  ApprovalStepState,
  ApprovalStepStatus,
  ApprovalRequestStatus,
  ApprovalAttachmentMetadata,
  ApprovalHistory,
} from '../models/approvals';
import { ApprovalNotificationService } from './approval-notification.service';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { RoleKey } from '../models/roles';
import { UserDirectoryService } from '../auth/user-directory.service';

type EmployeeStatus = 'OK' | '警告' | 'エラー';

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
  private userDirectory = inject(UserDirectoryService);

  approval?: ApprovalRequest;
  private subscription: Subscription;

  employees: ApprovalDetailEmployee[] = [];

  selectedEmployee?: ApprovalDetailEmployee;
  showDiffModal = false;
  approvalComment = '';

  toasts: { message: string; type: 'info' | 'success' | 'warning' }[] = [];

  readonly approval$ = combineLatest([
    this.route.paramMap.pipe(
      map((params) => params.get('id')),
      switchMap((id) => this.workflowService.getRequest(id)),
    ),
    this.userDirectory.getUsers(),
  ]).pipe(
    map(([approval, users]) => {
      if (!approval) return null;
      const userMap = new Map(users.map(u => [u.email.toLowerCase(), u.displayName || u.email]));
      return {
        ...approval,
        applicantDisplayName: userMap.get(approval.applicantId.toLowerCase()) || approval.applicantName || approval.applicantId,
        stepsWithDisplayNames: approval.steps.map(step => ({
          ...step,
          approverDisplayName: step.approverId 
            ? (userMap.get(step.approverId.toLowerCase()) || step.approverName || step.approverId)
            : step.approverName,
        })),
        attachmentsWithDisplayNames: (approval.attachments || []).map(attachment => ({
          ...attachment,
          uploaderDisplayName: attachment.uploaderId
            ? (userMap.get(attachment.uploaderId.toLowerCase()) || attachment.uploaderName || attachment.uploaderId)
            : attachment.uploaderName || attachment.uploaderId,
        })),
        historiesWithDisplayNames: [...(approval.histories || [])]
          .map(history => ({
            ...history,
            actorDisplayName: userMap.get(history.actorId.toLowerCase()) || history.actorName || history.actorId,
          }))
          .sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime()),
      };
    }),
    tap((approval) => {
      this.approval = approval || undefined;
      if (approval?.employeeDiffs) {
        this.employees = approval.employeeDiffs.map((diff) => ({
          employeeNo: diff.employeeNo,
          name: diff.name,
          status: diff.status === 'warning' ? '警告' : diff.status === 'error' ? 'エラー' : 'OK',
          diffs: diff.changes.map((change) => ({
            field: change.field,
            oldValue: change.oldValue ?? '',
            newValue: change.newValue ?? '',
          })),
        }));
      } else {
        this.employees = [];
      }
    }),
  );

  readonly canApprove$ = combineLatest([
    this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Approver]),
    this.authService.user$,
    this.approval$,
  ]).pipe(
    map(([roleAllowed, user, approval]) => {
      if (!roleAllowed || !approval?.currentStep) return false;
      const email = user?.email?.toLowerCase();
      if (!email) return false;

      const flowStep = approval.flowSnapshot?.steps.find((s) => s.order === approval.currentStep);
      const candidateIds = flowStep?.candidates?.map((c) => c.id.toLowerCase()) ?? [];
      const currentStepState = approval.steps.find((s) => s.stepOrder === approval.currentStep);
      const assignedApprover = currentStepState?.approverId?.toLowerCase();

      return candidateIds.includes(email) || assignedApprover === email;
    }),
  );
  readonly isOperator$ = this.authService.hasAnyRole([RoleKey.Operator]);

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

  isOverdue(approval: ApprovalRequest | undefined): boolean {
    if (!approval?.dueDate) return false;
    return approval.status === 'pending' && approval.dueDate.toDate().getTime() < Date.now();
  }

  formatFileSize(size: number): string {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
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
    const canApprove = await firstValueFrom(this.canApprove$);
    if (!canApprove) {
      this.addToast('承認候補者ではないため操作できません。', 'warning');
      return;
    }

    try {
      const result =
        action === 'approve'
          ? await this.workflowService.approve(
              this.approval.id,
              approverId,
              approverName,
              this.approvalComment,
              [],
            )
          : await this.workflowService.remand(
              this.approval.id,
              approverId,
              approverName,
              this.approvalComment,
              [],
            );

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
    } catch (error) {
      console.error('approval action failed', error);
      this.addToast('承認処理中にエラーが発生しました。', 'warning');
    }
  }
}