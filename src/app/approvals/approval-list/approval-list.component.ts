import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { BehaviorSubject, combineLatest, map, Observable, of } from 'rxjs';
import { ApprovalRequest, ApprovalRequestStatus } from '../../models/approvals';
import { ApprovalWorkflowService } from '../approval-workflow.service';
import { UserDirectoryService } from '../../auth/user-directory.service';

@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, DatePipe, FormsModule],
  templateUrl: './approval-list.component.html',
  styleUrl: './approval-list.component.scss',
})
export class ApprovalListComponent {
  private router = inject(Router);
  private workflowService = inject(ApprovalWorkflowService);
  private userDirectory = inject(UserDirectoryService);

  private selectedFlowId$ = new BehaviorSubject<string | null>(null);
  private selectedCategory$ = new BehaviorSubject<string | null>(null);
  private selectedApplicantId$ = new BehaviorSubject<string | null>(null);

  get selectedFlowId(): string | null {
    return this.selectedFlowId$.value;
  }
  set selectedFlowId(value: string | null) {
    this.selectedFlowId$.next(value);
  }

  get selectedCategory(): string | null {
    return this.selectedCategory$.value;
  }
  set selectedCategory(value: string | null) {
    this.selectedCategory$.next(value);
  }

  get selectedApplicantId(): string | null {
    return this.selectedApplicantId$.value;
  }
  set selectedApplicantId(value: string | null) {
    this.selectedApplicantId$.next(value);
  }

  private getTimestampMillis(timestamp: Timestamp | undefined): number {
    if (!timestamp) return 0;
    if (timestamp instanceof Timestamp) {
      return timestamp.toMillis();
    }
    // Firestoreから取得したデータがプレーンオブジェクトの場合
    const ts = timestamp as unknown as { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (ts.toMillis && typeof ts.toMillis === 'function') {
      return ts.toMillis();
    }
    if (ts.toDate && typeof ts.toDate === 'function') {
      return ts.toDate().getTime();
    }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1_000_000;
    }
    return 0;
  }

  readonly allApprovals$: Observable<(ApprovalRequest & { applicantDisplayName: string })[]> = 
    combineLatest([
      this.workflowService.requests$,
      this.userDirectory.getUsers(),
    ]).pipe(
      map(([approvals, users]) => {
        const userMap = new Map(users.map(u => [u.email.toLowerCase(), u.displayName || u.email]));
        return approvals
          .map(approval => ({
            ...approval,
            applicantDisplayName: userMap.get(approval.applicantId.toLowerCase()) || approval.applicantName || approval.applicantId,
          }))
          .sort(
            (a, b) => this.getTimestampMillis(b.createdAt) - this.getTimestampMillis(a.createdAt),
          );
      }),
    );

  readonly approvals$ = combineLatest([
    this.allApprovals$,
    this.selectedFlowId$,
    this.selectedCategory$,
    this.selectedApplicantId$,
  ]).pipe(
    map(([approvals, flowId, category, applicantId]) => {
      return approvals.filter(approval => {
        if (flowId && approval.flowId !== flowId) {
          return false;
        }
        if (category && approval.category !== category) {
          return false;
        }
        if (applicantId && approval.applicantId.toLowerCase() !== applicantId.toLowerCase()) {
          return false;
        }
        return true;
      });
    }),
  );

  readonly flows$ = this.workflowService.flows$;
  readonly categories: ApprovalRequest['category'][] = ['新規', '個別更新', '一括更新'];
  
  readonly applicants$ = this.allApprovals$.pipe(
    map(approvals => {
      const applicantMap = new Map<string, { id: string; displayName: string }>();
      approvals.forEach(approval => {
        if (!applicantMap.has(approval.applicantId.toLowerCase())) {
          applicantMap.set(approval.applicantId.toLowerCase(), {
            id: approval.applicantId,
            displayName: approval.applicantDisplayName,
          });
        }
      });
      return Array.from(applicantMap.values()).sort((a, b) => 
        a.displayName.localeCompare(b.displayName, 'ja')
      );
    }),
  );

  onRowClick(approval: ApprovalRequest) {
    this.router.navigate(['/approvals', approval.id]);
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

  categoryClass(category: ApprovalRequest['category']) {
    switch (category) {
      case '新規':
        return 'badge-new';
      case '個別更新':
        return 'badge-individual';
      default:
        return 'badge-bulk';
    }
  }

  clearFilters() {
    this.selectedFlowId$.next(null);
    this.selectedCategory$.next(null);
    this.selectedApplicantId$.next(null);
  }
}