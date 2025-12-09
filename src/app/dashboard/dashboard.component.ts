import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth/auth.service';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, combineLatest, firstValueFrom, map, of, switchMap, take } from 'rxjs';
import { ShahoEmployeesService, ShahoEmployee } from '../app/services/shaho-employees.service';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { ApprovalNotification, ApprovalRequest, ApprovalRequestStatus } from '../models/approvals';
import { UserDirectoryService } from '../auth/user-directory.service';

type StatusSummary = { status: ApprovalRequestStatus; label: string; count: number };
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NgIf, NgFor, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private authService = inject(AuthService);
  private employeesService = inject(ShahoEmployeesService);
  private workflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private userDirectoryService = inject(UserDirectoryService);

  readonly user$ = this.authService.user$;
  readonly appUser$ = this.user$.pipe(
    switchMap((user) => {
      if (!user?.email) return of(null);
      return this.userDirectoryService.getUserByEmail(user.email);
    }),
  );
  readonly roleDefinitions$ = this.authService.roleDefinitions$;
  readonly role$ = this.authService.roleDefinition$;
  readonly allRoles: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly employees$: Observable<ShahoEmployee[]> = this.employeesService.getEmployees();

  readonly currentUserId$ = this.user$.pipe(map((user) => user?.email?.toLowerCase() ?? 'demo-approver'));
  readonly isApprover$ = this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Approver]);
  readonly isSystemAdmin$ = this.authService.hasAnyRole([RoleKey.SystemAdmin]);
  readonly isGuest$ = this.authService.hasAnyRole([RoleKey.Guest]);
  readonly statusOrder: StatusSummary[] = [
    { status: 'pending', label: '承認待ち', count: 0 },
    { status: 'approved', label: '承認済', count: 0 },
    { status: 'remanded', label: '差戻し', count: 0 },
    { status: 'expired', label: '失効', count: 0 },
    { status: 'draft', label: '下書き', count: 0 },
  ];

  private recipientId$ = this.authService.user$.pipe(map((user) => user?.email ?? 'demo-approver'));
  readonly allNotifications$: Observable<ApprovalNotification[]> = combineLatest([
    this.notificationService.notifications$,
    this.recipientId$,
  ]).pipe(
    map(([notifications, recipientId]) =>
      [...notifications]
        .filter((notification) => notification.recipientId?.toLowerCase() === recipientId.toLowerCase())
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
    ),
  );
  readonly notifications$: Observable<ApprovalNotification[]> = this.allNotifications$.pipe(
    map((notifications) => notifications.slice(0, 5)),
  );
  readonly unreadCount$ = this.recipientId$.pipe(
    switchMap((recipientId) => this.notificationService.unreadCountFor(recipientId)),
  );
  
  notificationsExpanded = false;

  readonly myRequests$: Observable<ApprovalRequest[]> = combineLatest([
    this.workflowService.requests$,
    this.currentUserId$,
  ]).pipe(
    map(([requests, userId]) =>
      [...requests]
        .filter((request) => request.applicantId?.toLowerCase() === userId)
        .sort((a, b) => (a.createdAt?.toMillis() ?? 0) < (b.createdAt?.toMillis() ?? 0) ? 1 : -1),
    ),
  );

  readonly myAssignments$: Observable<ApprovalRequest[]> = combineLatest([
    this.workflowService.requests$,
    this.currentUserId$,
  ]).pipe(
    map(([requests, userId]) =>
      requests
        .filter((request) => this.isCurrentAssignee(request, userId))
        .sort((a, b) => (a.dueDate?.toMillis() ?? 0) - (b.dueDate?.toMillis() ?? 0)),
    ),
  );

  readonly myRequestSummary$: Observable<StatusSummary[]> = this.myRequests$.pipe(
    map((requests) => this.buildStatusSummary(requests)),
  );

  readonly myAssignmentSummary$: Observable<StatusSummary[]> = this.myAssignments$.pipe(
    map((requests) => this.buildStatusSummary(requests)),
  );

  actionMessages: Record<string, string> = {};
  readonly initialDisplayCount = 3;
  myRequestsExpanded = false;
  myAssignmentsExpanded = false;

  constructor() {
    this.recipientId$
      .pipe(
        switchMap((recipientId) => this.workflowService.getNotificationsFor(recipientId)),
        take(1),
      )
      .subscribe((seed) => this.notificationService.pushBatch(seed));
  }

  readonly RoleKey = RoleKey;

  getRoleNames(roleDefinitions: readonly RoleDefinition[] | null | undefined): string {
    if (!roleDefinitions?.length) return '';
    return roleDefinitions.map((role) => role.name).join(' / ');
  }

  totalCount(summary: { count: number }[] | null | undefined): number {
    if (!summary?.length) return 0;
    return summary.reduce((sum, item) => sum + (item?.count ?? 0), 0);
  }
  statusLabel(status: ApprovalRequestStatus) {
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

  statusClass(status: ApprovalRequestStatus) {
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

  async quickAction(request: ApprovalRequest, action: 'approve' | 'remand') {
    if (!request.id || !request.currentStep) return;

    const user = await firstValueFrom(this.authService.user$);
    const approverId = user?.email ?? 'demo-approver';
    const approverName = user?.displayName ?? user?.email ?? 'デモ承認者';

    this.actionMessages[request.id] = '処理中...';
    try {
      if (action === 'approve') {
        await this.workflowService.approve(request.id, approverId, approverName, 'ダッシュボードからのクイック承認');
      } else {
        await this.workflowService.remand(request.id, approverId, approverName, 'ダッシュボードから差戻し');
      }
      this.actionMessages[request.id] = action === 'approve' ? '承認しました' : '差戻しました';
    } catch (error) {
      console.error('quickAction failed', error);
      this.actionMessages[request.id] = '操作に失敗しました。もう一度お試しください。';
    }
  }

  actionMessageFor(id: string | undefined) {
    if (!id) return '';
    return this.actionMessages[id];
  }

  private buildStatusSummary(requests: ApprovalRequest[]): StatusSummary[] {
    const counts: Record<ApprovalRequestStatus, number> = {
      draft: 0,
      pending: 0,
      approved: 0,
      remanded: 0,
      expired: 0,
    };
    requests.forEach((request) => {
      counts[request.status] = (counts[request.status] ?? 0) + 1;
    });

    return this.statusOrder.map((definition) => ({
      ...definition,
      count: counts[definition.status] ?? 0,
    }));
  }

  private isCurrentAssignee(request: ApprovalRequest, userId: string): boolean {
    if (request.status !== 'pending' || !request.currentStep) return false;

    const normalizedUserId = userId.toLowerCase();
    const currentStep = request.steps.find((step) => step.stepOrder === request.currentStep);
    if (currentStep?.approverId?.toLowerCase() === normalizedUserId) return true;

    const candidates = request.flowSnapshot?.steps.find((step) => step.order === request.currentStep)?.candidates ?? [];
    return candidates.some((candidate) => candidate.id.toLowerCase() === normalizedUserId);
  }

  markNotificationAsRead(notificationId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.notificationService.markAsRead(notificationId);
  }

  toggleNotificationsExpanded() {
    this.notificationsExpanded = !this.notificationsExpanded;
  }

  trackByNotificationId(index: number, notification: ApprovalNotification): string {
    return notification.id;
  }

}