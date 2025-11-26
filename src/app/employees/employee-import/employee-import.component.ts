import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type ImportStatus = 'ok' | 'warning' | 'error';

type DifferenceRow = {
  id: number;
  status: ImportStatus;
  employeeNo: string;
  name: string;
  summary: string;
  changes: { field: string; oldValue: string; newValue: string }[];
  selected: boolean;
};

@Component({
  selector: 'app-employee-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './employee-import.component.html',
  styleUrl: './employee-import.component.scss',
})
export class EmployeeImportComponent {
  steps = [
    { number: 1, title: 'テンプレートダウンロード' },
    { number: 2, title: 'CSVファイル選択' },
    { number: 3, title: '取込結果の検証' },
    { number: 4, title: '差分確認' },
    { number: 5, title: '承認依頼/即時反映' },
  ];

  currentStep = 1;
  maxStep = 1;

  fileName = '';
  hasUploadedFile = false;
  requestComment = '';
  approvalRoute = '標準ルート';
  canApplyImmediately = true;

  summary = {
    totalRecords: 0,
    newCount: 0,
    updateCount: 0,
    errorCount: 0,
  };

  errors = [
    {
      line: 12,
      employeeNo: 'EMP-1022',
      name: '佐藤 花子',
      message: '標準報酬月額が数値ではありません',
    },
    {
      line: 27,
      employeeNo: '',
      name: '',
      message: '社員番号が必須です',
    },
  ];

  differences: DifferenceRow[] = [
    {
      id: 1,
      status: 'ok',
      employeeNo: 'EMP-1001',
      name: '山田 太郎',
      summary: '住所と標準報酬月額を更新',
      changes: [
        { field: '住所', oldValue: '東京都渋谷区', newValue: '神奈川県横浜市' },
        { field: '標準報酬月額', oldValue: '320,000', newValue: '340,000' },
      ],
      selected: true,
    },
    {
      id: 2,
      status: 'warning',
      employeeNo: 'EMP-1010',
      name: '田中 花',
      summary: '勤務地都道府県のみ更新',
      changes: [
        { field: '勤務地都道府県', oldValue: '大阪府', newValue: '京都府' },
      ],
      selected: true,
    },
    {
      id: 3,
      status: 'error',
      employeeNo: 'EMP-1022',
      name: '佐藤 花子',
      summary: '社員番号未指定のため除外',
      changes: [
        { field: '社員番号', oldValue: '空欄', newValue: '空欄' },
      ],
      selected: false,
    },
  ];

  statusFilter: 'all' | ImportStatus = 'all';
  selectedChangeId: number | null = this.differences.find((item) => item.status !== 'error')?.id ?? null;

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    this.fileName = file.name;
    this.hasUploadedFile = true;

    // 仮の集計結果
    this.summary = {
      totalRecords: 45,
      newCount: 10,
      updateCount: 30,
      errorCount: this.errors.length,
    };

    this.unlockStep(3);
  }

  unlockStep(step: number): void {
    this.maxStep = Math.max(this.maxStep, step);
  }

  goToStep(step: number): void {
    if (step <= this.maxStep) {
      this.currentStep = step;
    }
  }

  nextStep(): void {
    if (this.currentStep === 2 && !this.hasUploadedFile) {
      return;
    }
    if (this.currentStep < this.steps.length) {
      this.currentStep += 1;
      this.unlockStep(this.currentStep);
    }
  }

  prevStep(): void {
    if (this.currentStep > 1) {
      this.currentStep -= 1;
    }
  }

  setFilter(status: 'all' | ImportStatus): void {
    this.statusFilter = status;
    const firstSelectable = this.filteredDifferences.find((item) => item.status !== 'error');
    if (firstSelectable) {
      this.selectedChangeId = firstSelectable.id;
    }
  }

  toggleSelection(row: DifferenceRow, event: Event): void {
    event.stopPropagation();
    if (row.status === 'error') {
      return;
    }
    row.selected = (event.target as HTMLInputElement).checked;
  }

  selectRow(row: DifferenceRow): void {
    this.selectedChangeId = row.id;
  }

  toggleAll(select: boolean): void {
    this.filteredDifferences.forEach((row) => {
      if (row.status !== 'error') {
        row.selected = select;
      }
    });
  }

  get filteredDifferences(): DifferenceRow[] {
    if (this.statusFilter === 'all') {
      return this.differences;
    }
    return this.differences.filter((row) => row.status === this.statusFilter);
  }

  get selectedDifferences(): DifferenceRow[] {
    return this.differences.filter((row) => row.selected && row.status !== 'error');
  }

  get selectedCount(): number {
    return this.selectedDifferences.length;
  }

  get warningCount(): number {
    return this.differences.filter((row) => row.status === 'warning').length;
  }

  get okCount(): number {
    return this.differences.filter((row) => row.status === 'ok').length;
  }

  get approvalSummary(): string {
    return `${this.selectedCount}件の社員に対する更新を申請します。`;
  }

  statusLabel(status: ImportStatus): string {
    switch (status) {
      case 'ok':
        return 'OK';
      case 'warning':
        return '警告';
      default:
        return 'エラー';
    }
  }

  statusClass(status: ImportStatus): string {
    return `status-pill ${status}`;
  }

  changeDetail(id: number): DifferenceRow | null {
    return this.differences.find((row) => row.id === id) ?? null;
  }
}
