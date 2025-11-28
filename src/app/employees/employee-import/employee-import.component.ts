import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
    ImportStatus,
    ParsedRow,
    TemplateType,
    ValidationError,
  } from './csv-import.types';
  import {
    calculateSummary,
    convertToRecordArray,
    detectTemplateType,
    normalizeHeaders,
    organizeErrors,
    parseCSV,
    validateAllRows,
  } from './csv-import.utils';

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
  isLoading = false;
  templateType: TemplateType = 'unknown';
  parsedRows: ParsedRow[] = [];
  requestComment = '';
  approvalRoute = '標準ルート';
  canApplyImmediately = true;

  summary = {
    totalRecords: 0,
    newCount: 0,
    updateCount: 0,
    errorCount: 0,
  };

  errors: ValidationError[] = [];

  differences: DifferenceRow[] = [];

  statusFilter: 'all' | ImportStatus = 'all';
  selectedChangeId: number | null = null;

  async onFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    this.fileName = file.name;
    this.isLoading = true;

    try {
      const csvText = await this.readFileAsText(file);
      const parsedMatrix = parseCSV(csvText);
      if (parsedMatrix.length === 0) {
        this.handleParseFailure('CSVにデータがありません');
        return;
      }

    // すべてのテンプレートで1行目が入力制限、2行目がヘッダー行の形式
    // 2行目がヘッダー行かどうかを判定
    let headerRowIndex = 0;
    if (parsedMatrix.length > 1) {
      const secondRow = parsedMatrix[1] || [];
      const secondRowNormalized = normalizeHeaders(secondRow);
      const secondRowHeaders = new Set(secondRowNormalized.map((h) => h.toLowerCase()));
      
      // 2行目がヘッダー行かどうかを判定（特定のヘッダー名が含まれる）
      if (
        secondRowHeaders.has('社員番号') ||
        secondRowHeaders.has('氏名(漢字)') ||
        secondRowHeaders.has('氏名漢字') ||
        secondRowHeaders.has('生年月日') ||
        secondRowHeaders.has('賞与支給日') ||
        secondRowHeaders.has('算定年度')
      ) {
        headerRowIndex = 1;
      }
    }
    
    const rawHeaders = parsedMatrix[headerRowIndex];
    const headers = normalizeHeaders(rawHeaders);
    this.templateType = detectTemplateType(headers);
    const dataRows = parsedMatrix.slice(headerRowIndex + 1);
    // 行番号オフセット：ヘッダー行の次の行からデータが始まるため、headerRowIndex + 2（1行目が1、2行目が2...）
    this.parsedRows = convertToRecordArray(dataRows, headers, headerRowIndex + 2);

    const validationErrors: ValidationError[] = [];
    if (this.templateType === 'unknown') {
      validationErrors.push({
        rowIndex: 0,
        fieldName: 'ヘッダー',
        message: 'テンプレート形式を判定できません',
        severity: 'error',
        templateType: this.templateType,
      });
    }

    const validatedRows = validateAllRows(this.parsedRows, this.templateType);
    const rowErrors = validatedRows.flatMap((row) => row.errors);
    const allErrors = organizeErrors([...validationErrors, ...rowErrors]);
    this.errors = this.attachRowContext(allErrors);
    const summary = calculateSummary(validatedRows, null);
    this.summary = {
      ...summary,
      errorCount: this.errors.filter((error) => error.severity === 'error').length,
    };
    this.hasUploadedFile = true;
    this.unlockStep(3);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CSVの読み込みに失敗しました';
    this.handleParseFailure(message);
  } finally {
    this.isLoading = false;
  }
}

private attachRowContext(errors: ValidationError[]): ValidationError[] {
  const rowMap = new Map<number, ParsedRow>();
  this.parsedRows.forEach((row) => rowMap.set(row.rowIndex, row));

  return errors.map((error) => {
    const row = rowMap.get(error.rowIndex);
    const employeeNo = row?.data['社員番号'] ?? null;
    // 新形式（氏名(漢字)）と旧形式（氏名漢字）の両方に対応
    const name = row?.data['氏名(漢字)'] ?? row?.data['氏名漢字'] ?? null;
    return { ...error, employeeNo, name };
  });
}

private handleParseFailure(message: string): void {
  const parseError: ValidationError = {
    rowIndex: 0,
    fieldName: 'ファイル',
    message,
    severity: 'error',
    templateType: 'unknown',
  };
  this.errors = [parseError];
  this.summary = { totalRecords: 0, newCount: 0, updateCount: 0, errorCount: 1 };
  this.hasUploadedFile = true;
}

private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
      reader.readAsText(file, 'utf-8');
    });
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
      '氏名(漢字)',
      '氏名(カナ)',
      '性別',
      '生年月日',
      '所属部署名',
      '勤務地都道府県名',
      '現在標準報酬月額',
      '被保険者番号',
      '健康保険資格取得日',
      '厚生年金資格取得日',
    ];

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = [
      '',
      '',
      '',
      '男/女',
      'YYYY/MM/DD',
      '',
      '',
      '数値のみ',
      '数値のみ',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
    ];
    
    // CSVコンテンツを作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent = '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';

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
      '社員番号',
      '氏名(漢字)',
      '氏名(カナ)',
      '性別',
      '生年月日',
      '所属部署名',
      '勤務地都道府県名',
      '被保険者番号',
      '健康保険資格取得日',
      '厚生年金資格取得日',
      '算定年度',
      '4月報酬額',
      '4月支払基礎日数',
      '5月報酬額',
      '5月支払基礎日数',
      '6月報酬額',
      '6月支払基礎日数',
    ];

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = [
      '', // 社員番号
      '', // 氏名(漢字)
      '', // 氏名(カナ)
      '男/女', // 性別
      'YYYY/MM/DD', // 生年月日
      '', // 所属部署名
      '', // 勤務地都道府県名
      '数値のみ', // 被保険者番号
      'YYYY/MM/DD', // 健康保険資格取得日
      'YYYY/MM/DD', // 厚生年金資格取得日
      'YYYY', // 算定年度
      '数値のみ', // 4月報酬額
      '数値２桁', // 4月支払基礎日数
      '数値のみ', // 5月報酬額
      '数値２桁', // 5月支払基礎日数
      '数値のみ', // 6月報酬額
      '数値２桁', // 6月支払基礎日数
    ];

    const csvContent = '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';
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

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = [
      '', // 社員番号
      'YYYY/MM/DD', // 賞与支給日
      'YYYY', // 賞与支給年度
      '数値のみ', // 賞与総支給額
    ];

    const csvContent = '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';
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
