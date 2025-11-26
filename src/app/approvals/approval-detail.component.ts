import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

type EmployeeStatus = 'OK' | '警告';

type ApprovalCategory = '新規' | '個別更新' | '一括更新';

type ApprovalStatus = '未承認' | '承認済' | '差戻し';

interface ApprovalDetail {
  id: string;
  category: ApprovalCategory;
  targetCount: number;
  applicant: string;
  appliedAt: string;
  comment: string;
  status: ApprovalStatus;
}

interface EmployeeDiff {
  field: string;
  oldValue: string;
  newValue: string;
}

interface ApprovalEmployee {
  employeeNo: string;
  name: string;
  status: EmployeeStatus;
  diffs: EmployeeDiff[];
}

@Component({
  selector: 'app-approval-detail',
  standalone: true,
  imports: [CommonModule, NgIf, NgFor, FormsModule, DatePipe, RouterLink],
  templateUrl: './approval-detail.component.html',
  styleUrl: './approval-detail.component.scss',
})
export class ApprovalDetailComponent {
  approvals: ApprovalDetail[] = [
    {
      id: 'APL-20250201-001',
      category: '新規',
      targetCount: 3,
      applicant: '佐藤 花子',
      appliedAt: '2025-02-01T09:30:00',
      comment: '新入社員3名の一括登録です。標準報酬月額と健康保険区分を確認してください。',
      status: '未承認',
    },
    {
      id: 'APL-20250130-002',
      category: '個別更新',
      targetCount: 1,
      applicant: '田中 一郎',
      appliedAt: '2025-01-30T15:20:00',
      comment: '扶養情報の更新のみです。',
      status: '承認済',
    },
    {
      id: 'APL-20250128-003',
      category: '一括更新',
      targetCount: 18,
      applicant: '管理部 担当',
      appliedAt: '2025-01-28T11:05:00',
      comment: '住所変更の一括反映。差戻し理由は修正済みです。',
      status: '差戻し',
    },
    {
      id: 'APL-20250125-004',
      category: '個別更新',
      targetCount: 2,
      applicant: '山本 美咲',
      appliedAt: '2025-01-25T17:15:00',
      comment: '標準報酬月額のみ見直し。',
      status: '未承認',
    },
  ];

  approval?: ApprovalDetail;
  employees: ApprovalEmployee[] = [
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

  selectedEmployee?: ApprovalEmployee;
  showDiffModal = false;
  approvalComment = '';

  toasts: { message: string; type: 'info' | 'success' | 'warning' }[] = [];

  constructor(route: ActivatedRoute) {
    const id = route.snapshot.paramMap.get('id');
    this.approval = this.approvals.find((item) => item.id === id) ?? this.approvals[0];
  }

  statusClass(status: ApprovalStatus) {
    switch (status) {
      case '承認済':
        return 'status-approved';
      case '差戻し':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  openDiffModal(employee: ApprovalEmployee) {
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

  saveApproval(action: 'approve' | 'remand') {
    const actionText = action === 'approve' ? '承認しました' : '差戻しました';
    this.addToast(`申請を${actionText}（コメント: ${this.approvalComment || 'なし'}）`, 'success');
  }
}