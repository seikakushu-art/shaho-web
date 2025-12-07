import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { map, Observable } from 'rxjs';
import { ApprovalRequest, ApprovalRequestStatus } from '../../models/approvals';
import { ApprovalWorkflowService } from '../approval-workflow.service';

@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, DatePipe],
  templateUrl: './approval-list.component.html',
  styleUrl: './approval-list.component.scss',
})
export class ApprovalListComponent {
  private router = inject(Router);
  private workflowService = inject(ApprovalWorkflowService);

  readonly approvals$: Observable<ApprovalRequest[]> = this.workflowService.requests$.pipe(
    map((approvals) => approvals.sort((a, b) => (a.createdAt?.toMillis() ?? 0) < (b.createdAt?.toMillis() ?? 0) ? 1 : -1)),
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
}