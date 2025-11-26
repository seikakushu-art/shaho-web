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

  downloadNewEmployeeTemplate(): void {
    const headers = [
      '社員番号',
      '氏名漢字',
      '氏名カナ',
      '性別',
      '所属部署コード',
      '所属部署名',
      '生年月日',
      '勤務地都道府県コード',
      '勤務地都道府県名',
      '現在標準報酬月額',
      '被保険者番号',
      '介護保険第2号フラグ',
      '健康保険資格取得日',
      '厚生年金資格取得日',
      '一時免除フラグ（健康保険料・厚生年金一時免除）',
    ];

    // CSVヘッダー行を作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent = '\uFEFF' + headers.join(',') + '\n';

    // Blobオブジェクトを作成（UTF-8、LF改行）
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // ダウンロードリンクを作成
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '新規登録/一括更新用テンプレート.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  downloadSalaryCalculationTemplate(): void {
    const headers = [
      // 新規登録/一括更新用の項目
      '社員番号',
      '氏名漢字',
      '氏名カナ',
      '性別',
      '所属部署コード',
      '所属部署名',
      '生年月日',
      '勤務地都道府県コード',
      '勤務地都道府県名',
      '現在標準報酬月額',
      '被保険者番号',
      '介護保険第2号フラグ',
      '健康保険資格取得日',
      '厚生年金資格取得日',
      '一時免除フラグ（健康保険料・厚生年金一時免除）',
      // 標準報酬月額算定用の項目
      '算定年度',
      '算定対象期間開始年月',
      '算定対象期間終了年月',
      '4月報酬額',
      '4月支払基礎日数',
      '5月報酬額',
      '5月支払基礎日数',
      '6月報酬額',
      '6月支払基礎日数',
    ];

    const csvContent = '\uFEFF' + headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '標準報酬月額算定機能付きテンプレート.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  downloadBonusCalculationTemplate(): void {
    const headers = [
      '社員番号',
      '賞与支給日',
      '賞与支給年度',
      '賞与総支給額',
    ];

    const csvContent = '\uFEFF' + headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '標準賞与額算定用テンプレート.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
