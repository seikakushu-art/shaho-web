import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';

interface ApprovalListItem {
  id: string;
  category: '新規' | '個別更新' | '一括更新';
  targetCount: number;
  applicant: string;
  appliedAt: string;
  step: number;
  status: '未承認' | '承認済' | '差戻し';
}

@Component({
  selector: 'app-approval-list',
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, DatePipe],
  templateUrl: './approval-list.component.html',
  styleUrl: './approval-list.component.scss',
})
export class ApprovalListComponent {
  constructor(private router: Router) {}

  approvals: ApprovalListItem[] = [
    {
      id: 'APL-20250201-001',
      category: '新規',
      targetCount: 3,
      applicant: '佐藤 花子',
      appliedAt: '2025-02-01T09:30:00',
      step: 1,
      status: '未承認',
    },
    {
      id: 'APL-20250130-002',
      category: '個別更新',
      targetCount: 1,
      applicant: '田中 一郎',
      appliedAt: '2025-01-30T15:20:00',
      step: 2,
      status: '承認済',
    },
    {
      id: 'APL-20250128-003',
      category: '一括更新',
      targetCount: 18,
      applicant: '管理部 担当',
      appliedAt: '2025-01-28T11:05:00',
      step: 1,
      status: '差戻し',
    },
    {
      id: 'APL-20250125-004',
      category: '個別更新',
      targetCount: 2,
      applicant: '山本 美咲',
      appliedAt: '2025-01-25T17:15:00',
      step: 3,
      status: '未承認',
    },
  ];

  onRowClick(approval: ApprovalListItem) {
    this.router.navigate(['/approvals', approval.id]);
  }

  statusClass(status: ApprovalListItem['status']) {
    switch (status) {
      case '承認済':
        return 'status-approved';
      case '差戻し':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  categoryClass(category: ApprovalListItem['category']) {
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