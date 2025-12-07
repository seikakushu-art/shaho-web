import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth/auth.service';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, map, switchMap, take } from 'rxjs';
import { ShahoEmployeesService, ShahoEmployee } from '../app/services/shaho-employees.service';
import { HasRoleDirective } from '../auth/has-role.directive';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { ApprovalNotification } from '../models/approvals';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NgIf, NgFor, RouterLink, HasRoleDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private authService = inject(AuthService);
  private employeesService = inject(ShahoEmployeesService);
  private workflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);

  readonly user$ = this.authService.user$;
  readonly roleDefinitions$ = this.authService.roleDefinitions$;
  readonly role$ = this.authService.roleDefinition$;
  readonly allRoles: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly employees$: Observable<ShahoEmployee[]> = this.employeesService.getEmployees();

  private recipientId$ = this.authService.user$.pipe(map((user) => user?.email ?? 'demo-approver'));
  readonly notifications$: Observable<ApprovalNotification[]> = this.notificationService.notifications$;
  readonly unreadCount$ = this.recipientId$.pipe(
    switchMap((recipientId) => this.notificationService.unreadCountFor(recipientId)),
  );

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
}