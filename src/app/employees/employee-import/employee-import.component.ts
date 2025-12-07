import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { ApprovalNotificationService } from '../../approvals/approval-notification.service';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { ApprovalFlow, ApprovalNotification, ApprovalRequest } from '../../models/approvals';
import { RoleKey } from '../../models/roles';
import { PayrollData, ShahoEmployee, ShahoEmployeesService } from '../../app/services/shaho-employees.service';
import {
    ChangeField,
    ImportStatus,
    ParsedRow,
    TemplateType,
    ValidationError,
  } from './csv-import.types';
  import {
    calculateDifferences,
    calculateSummary,
    convertToRecordArray,
    detectTemplateType,
    ExistingEmployee,
    normalizeHeaders,
    organizeErrors,
    parseCSV,
    validateAllRows,
  } from './csv-import.utils';
  import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';

type DifferenceRow = {
  id: number;
  status: ImportStatus;
  employeeNo: string;
  name: string;
  summary: string;
  changes: { field: string; oldValue: string; newValue: string }[];
  selected: boolean;
  parsedRow?: ParsedRow; // 元のCSVデータへの参照
  isNew?: boolean; // 新規登録かどうか
  existingEmployeeId?: string; // 既存社員のID（更新の場合）
};

@Component({
  selector: 'app-employee-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, FlowSelectorComponent],
  templateUrl: './employee-import.component.html',
  styleUrl: './employee-import.component.scss',
})
export class EmployeeImportComponent implements OnInit, OnDestroy {
  private employeesService = inject(ShahoEmployeesService);
  private workflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private authService = inject(AuthService);
  private existingEmployees: ExistingEmployee[] = [];
  private applicantId = 'demo-applicant';
  private applicantName = 'デモ申請者';
  private approvalSubscription?: Subscription;
  private activeApprovalRequestId?: string;
  private userCanDirectApply = false;

  approvalFlows: ApprovalFlow[] = [];
  selectedFlow?: ApprovalFlow;
  selectedFlowId: string | null = null;

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

  async ngOnInit(): Promise<void> {
    const [employees, flows, user, canDirectApply] = await Promise.all([
      firstValueFrom(this.employeesService.getEmployees()),
      firstValueFrom(this.workflowService.flows$.pipe(take(1))),
      firstValueFrom(this.authService.user$.pipe(take(1))),
      firstValueFrom(this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Approver])),
    ]);
    this.existingEmployees = employees.map((emp) => ({
      id: emp.id,
      employeeNo: emp.employeeNo,
      name: emp.name,
      kana: emp.kana,
      gender: emp.gender,
      birthDate: emp.birthDate,
      postalCode: emp.postalCode,
      address: emp.address,
      department: emp.department,
      workPrefecture: emp.workPrefecture,
      personalNumber: emp.personalNumber,
      basicPensionNumber: emp.basicPensionNumber,
      standardMonthly: emp.standardMonthly,
      standardBonusAnnualTotal: emp.standardBonusAnnualTotal,
      healthInsuredNumber: emp.healthInsuredNumber,
      pensionInsuredNumber: emp.pensionInsuredNumber,
      insuredNumber: emp.insuredNumber,
      careSecondInsured: emp.careSecondInsured,
      healthAcquisition: emp.healthAcquisition,
      pensionAcquisition: emp.pensionAcquisition,
      childcareLeaveStart: emp.childcareLeaveStart,
      childcareLeaveEnd: emp.childcareLeaveEnd,
      maternityLeaveStart: emp.maternityLeaveStart,
      maternityLeaveEnd: emp.maternityLeaveEnd,
      exemption: emp.exemption,
    }));
    this.approvalFlows = flows;
    this.selectedFlowId = flows[0]?.id ?? null;
    this.selectedFlow = flows.find((flow) => flow.id === this.selectedFlowId);
    this.userCanDirectApply = canDirectApply;
    if (user?.email) {
      this.applicantId = user.email;
      this.applicantName = user.displayName ?? user.email;
    }
  }

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

    const validatedRows = validateAllRows(this.parsedRows, this.templateType, this.existingEmployees);
    const rowErrors = validatedRows.flatMap((row) => row.errors);
    const allErrors = organizeErrors([...validationErrors, ...rowErrors]);
    this.errors = this.attachRowContext(allErrors);

    // 差分計算を実行（エラーがない行のみ）
    await this.calculateDifferences(validatedRows);

    const summary = calculateSummary(validatedRows, this.differences);
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

  onFlowSelected(flow: ApprovalFlow | undefined) {
    this.selectedFlow = flow ?? undefined;
    this.selectedFlowId = flow?.id ?? null;
  }

  onFlowsUpdated(flows: ApprovalFlow[]) {
    this.approvalFlows = flows;
    if (!this.selectedFlowId && flows[0]?.id) {
      this.selectedFlowId = flows[0].id;
    }
    this.selectedFlow = flows.find((f) => f.id === this.selectedFlowId);
  }

  get canApplyImmediately(): boolean {
    return !!this.selectedFlow && (this.selectedFlow.allowDirectApply ?? false) && this.userCanDirectApply;
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

  async submitForApproval(): Promise<void> {
    const selectedRows = this.selectedDifferences;
    if (selectedRows.length === 0) {
      alert('更新対象を選択してください。');
      return;
    }

    if (!this.selectedFlowId || !this.selectedFlow) {
      alert('承認ルートを選択してください。');
      return;
    }

    this.isLoading = true;

    try {
      const request = this.buildApprovalRequest(this.selectedFlow);
      const saved = await this.workflowService.saveRequest(request);
      this.activeApprovalRequestId = saved.id;
      this.subscribeApprovalResult(saved.id!);
      this.pushApprovalNotifications(saved);
      alert('承認依頼を送信しました。承認完了後に反映します。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '承認依頼の送信に失敗しました。';
      console.error(message, error);
      alert(message);
    } finally {
      this.isLoading = false;
    }
  }

  private buildApprovalRequest(flow: ApprovalFlow): ApprovalRequest {
    const firstStepOrder = flow.steps[0]?.order;
    return {
      title: `社員インポート（${this.selectedCount}件）`,
      category: '一括更新',
      targetCount: this.selectedCount,
      applicantId: this.applicantId,
      applicantName: this.applicantName,
      flowId: flow.id ?? 'default-flow',
      flowSnapshot: flow,
      status: 'pending',
      currentStep: firstStepOrder,
      comment: this.requestComment || undefined,
      diffSummary: this.createDifferenceSummary(),
      steps: flow.steps.map((step) => ({ stepOrder: step.order, status: 'waiting' })),
      attachments: [],
      histories: [],
    };
  }

  private createDifferenceSummary(): string {
    const newCount = this.selectedDifferences.filter((row) => row.isNew).length;
    const updateCount = this.selectedDifferences.length - newCount;
    const warningCount = this.warningCount;
    return `新規${newCount}件／更新${updateCount}件（警告${warningCount}件、エラー除外${this.summary.errorCount}件）`;
  }

  private subscribeApprovalResult(requestId: string): void {
    this.approvalSubscription?.unsubscribe();
    this.activeApprovalRequestId = requestId;
    this.approvalSubscription = this.workflowService.requests$.subscribe((requests) => {
      const matched = requests.find((req) => req.id === requestId);
      if (!matched || this.activeApprovalRequestId !== requestId) return;

      if (matched.status === 'approved') {
        this.updateData(true);
        this.pushApprovalResultNotification(matched, 'success');
        this.activeApprovalRequestId = undefined;
        this.approvalSubscription?.unsubscribe();
      }

      if (matched.status === 'remanded' || matched.status === 'expired') {
        this.pushApprovalResultNotification(matched, 'warning');
        this.activeApprovalRequestId = undefined;
        this.approvalSubscription?.unsubscribe();
      }
    });
  }

  private pushApprovalNotifications(request: ApprovalRequest): void {
    const notifications: ApprovalNotification[] = [];

    const applicantNotification = {
      id: this.generateNotificationId(),
      requestId: request.id ?? request.title,
      recipientId: request.applicantId,
      message: `${request.title} を起票しました（${request.targetCount}件）。`,
      unread: true,
      createdAt: new Date(),
      type: 'info' as const,
    };
    notifications.push(applicantNotification);

    const currentStep = request.steps.find((step) => step.stepOrder === request.currentStep);
    const candidates = currentStep
      ? request.flowSnapshot?.steps.find((step) => step.order === currentStep.stepOrder)?.candidates ?? []
      : [];

    candidates.forEach((candidate) => {
      notifications.push({
        id: this.generateNotificationId(),
        requestId: request.id ?? request.title,
        recipientId: candidate.id,
        message: `${request.title} の承認依頼が届いています。`,
        unread: true,
        createdAt: new Date(),
        type: 'info' as const,
      });
    });

    if (notifications.length) {
      this.notificationService.pushBatch(notifications);
    }
  }

  private pushApprovalResultNotification(request: ApprovalRequest, type: 'success' | 'warning'): void {
    const statusLabel = type === 'success' ? '承認' : '差戻し/失効';
    this.notificationService.push({
      id: this.generateNotificationId(),
      requestId: request.id ?? request.title,
      recipientId: request.applicantId,
      message: `${request.title} が${statusLabel}されました。`,
      unread: true,
      createdAt: new Date(),
      type,
    });
  }

  private generateNotificationId(): string {
    return `ntf-${Math.random().toString(36).slice(2, 10)}`;
  }

  async updateData(skipConfirmation = false): Promise<void> {
    const selectedRows = this.selectedDifferences;
    if (selectedRows.length === 0) {
      alert('更新対象を選択してください。');
      return;
    }

    if (!skipConfirmation && !confirm(`${selectedRows.length}件の社員データを更新しますか？`)) {
      return;
    }

    this.isLoading = true;

    // undefinedのフィールドを除外するヘルパー関数（Firestoreはundefinedを許可しない）
    const removeUndefinedFields = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
      const cleaned: Partial<T> = {};
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        // undefined と空文字列を除外
        if (value !== undefined && value !== '') {
          cleaned[key as keyof T] = value as T[keyof T];
        }
      });
      return cleaned;
    };

    try {
      const results = await Promise.allSettled(
        selectedRows.map(async (row) => {
          if (!row.parsedRow) {
            throw new Error(`行 ${row.id} のデータが見つかりません`);
          }

          const csvData = row.parsedRow.data;
          
          // employeeIdを取得（テンプレートタイプによって異なる）
          let employeeId: string;
          
          if (this.templateType === 'payroll') {
            // payrollテンプレートの場合は既存社員のIDを取得
            const employeeNo = csvData['社員番号'] || '';
            const existingEmployee = this.existingEmployees.find((emp) => emp.employeeNo === employeeNo);
            
            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }
            
            employeeId = existingEmployee.id;
          } else {
            // その他のテンプレートの場合は社員情報を更新
            // 数値変換ヘルパー関数
            const toNumber = (value: string | undefined): number | undefined => {
              if (!value) return undefined;
              const num = Number(value.replace(/,/g, ''));
              return isNaN(num) ? undefined : num;
            };
            
            // ブール値変換ヘルパー関数（1/0, true/false, on/off などを変換）
            const toBoolean = (value: string | undefined): boolean | undefined => {
              if (!value) return undefined;
              const normalized = value.toLowerCase().trim();
              if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
                return true;
              }
              if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
                return false;
              }
              return undefined;
            };
            
            const employeeDataRaw: Partial<ShahoEmployee> = {
              employeeNo: csvData['社員番号'] || '',
              name: csvData['氏名(漢字)'] || csvData['氏名漢字'] || '',
              kana: csvData['氏名(カナ)'] || undefined,
              gender: csvData['性別'] || undefined,
              birthDate: csvData['生年月日'] || undefined,
              postalCode: csvData['郵便番号'] || undefined,
              address: csvData['住所'] || undefined,
              department: csvData['所属部署名'] || undefined,
              workPrefecture: csvData['勤務地都道府県名'] || undefined,
              personalNumber: csvData['個人番号'] || undefined,
              basicPensionNumber: csvData['基礎年金番号'] || undefined,
            standardMonthly: toNumber(csvData['標準報酬月額']),
            healthInsuredNumber: csvData['被保険者番号（健康保険)'] || undefined,
            pensionInsuredNumber: csvData['被保険者番号（厚生年金）'] || undefined,
              healthAcquisition: csvData['健康保険 資格取得日'] || csvData['健康保険資格取得日'] || undefined,
              pensionAcquisition: csvData['厚生年金 資格取得日'] || csvData['厚生年金資格取得日'] || undefined,
              childcareLeaveStart: csvData['育休開始日'] || undefined,
              childcareLeaveEnd: csvData['育休終了日'] || undefined,
              maternityLeaveStart: csvData['産休開始日'] || undefined,
              maternityLeaveEnd: csvData['産休終了日'] || undefined,
            };
            
            // undefinedのフィールドを除外
            const employeeData = removeUndefinedFields(employeeDataRaw);

            if (row.isNew) {
              // 新規登録
              const result = await this.employeesService.addEmployee(employeeData as ShahoEmployee);
              employeeId = result.id;
            } else if (row.existingEmployeeId) {
              // 更新
              await this.employeesService.updateEmployee(row.existingEmployeeId, employeeData);
              employeeId = row.existingEmployeeId;
            } else {
              throw new Error(`既存社員のIDが見つかりません: ${row.employeeNo}`);
            }
          }

          // 月給/賞与支払額同期用テンプレート（payrollテンプレート）の処理
          if (this.templateType === 'payroll') {
            const employeeNo = csvData['社員番号'] || '';
            const existingEmployee = this.existingEmployees.find((emp) => emp.employeeNo === employeeNo);
            
            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }
            
            const employeeId = existingEmployee.id;
            const payrollPromises: Promise<void>[] = [];

            // 月給支払月から年月を抽出（YYYY/MM形式をYYYY-MM形式に変換）
            const monthlyPayMonth = csvData['月給支払月'];
            const monthlyPayAmount = csvData['月給支払額'];
            const workedDays = csvData['支払基礎日数'];
            const bonusPaidOn = csvData['賞与支給日'];
            const bonusTotal = csvData['賞与総支給額'];

            // 月給データの処理
            if (monthlyPayMonth) {
              // YYYY/MM形式をYYYY-MM形式に変換
              const yearMonth = monthlyPayMonth.replace(/\//g, '-');
              // 月が1桁の場合は0埋め（例: 2025-4 → 2025-04）
              const [year, month] = yearMonth.split('-');
              const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

              // 既存の給与データを取得（マージするため）
              let existingPayroll: PayrollData | undefined;
              try {
                existingPayroll = await firstValueFrom(
                  this.employeesService.getPayroll(employeeId, normalizedYearMonth),
                );
              } catch {
                // データが存在しない場合はundefinedのまま
              }

              const payrollDataRaw: Partial<PayrollData> = {
                ...existingPayroll,
                yearMonth: normalizedYearMonth,
                workedDays: workedDays ? Number(workedDays.replace(/,/g, '')) : (existingPayroll?.workedDays || 0),
                amount: monthlyPayAmount
                  ? Number(monthlyPayAmount.replace(/,/g, ''))
                  : existingPayroll?.amount,
                // 賞与データも同じ月に含まれる場合は追加
                bonusPaidOn: bonusPaidOn?.trim() || existingPayroll?.bonusPaidOn || undefined,
                bonusTotal: bonusTotal
                  ? Number(bonusTotal.replace(/,/g, ''))
                  : existingPayroll?.bonusTotal,
              };

              // undefined と空文字列のフィールドを除外
              const payrollData = removeUndefinedFields(payrollDataRaw) as PayrollData;

              payrollPromises.push(
                this.employeesService.addOrUpdatePayroll(employeeId, normalizedYearMonth, payrollData),
              );
            } else if (bonusPaidOn) {
              // 月給データがなく、賞与データのみの場合
              // 賞与支給日から年月を抽出
              const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
              if (!isNaN(bonusDate.getTime())) {
                const year = bonusDate.getFullYear();
                const month = String(bonusDate.getMonth() + 1).padStart(2, '0');
                const normalizedYearMonth = `${year}-${month}`;

                // 既存の給与データを取得（マージするため）
                let existingPayroll: PayrollData | undefined;
                try {
                  existingPayroll = await firstValueFrom(
                    this.employeesService.getPayroll(employeeId, normalizedYearMonth),
                  );
                } catch {
                  // データが存在しない場合はundefinedのまま
                }

                const payrollDataRaw: Partial<PayrollData> = {
                  ...existingPayroll,
                  yearMonth: normalizedYearMonth,
                  workedDays: existingPayroll?.workedDays || 0,
                  amount: existingPayroll?.amount,
                  bonusPaidOn: bonusPaidOn?.trim() || undefined,
                  bonusTotal: bonusTotal ? Number(bonusTotal.replace(/,/g, '')) : undefined,
                };

                // undefined と空文字列のフィールドを除外
                const payrollData = removeUndefinedFields(payrollDataRaw) as PayrollData;

                payrollPromises.push(
                  this.employeesService.addOrUpdatePayroll(employeeId, normalizedYearMonth, payrollData),
                );
              }
            }

            // すべての給与データを保存
            if (payrollPromises.length > 0) {
              await Promise.all(payrollPromises);
            }
          }

          return { success: true, employeeNo: row.employeeNo, action: row.isNew ? '新規登録' : '更新' };
        }),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.filter((r) => r.status === 'rejected').length;

      if (failureCount === 0) {
        alert(`${successCount}件の社員データを正常に更新しました。`);
        // 既存社員データを再取得（差分計算に必要なすべてのフィールドを含める）
        const employees = await firstValueFrom(this.employeesService.getEmployees());
        this.existingEmployees = employees.map((emp) => ({
          id: emp.id,
          employeeNo: emp.employeeNo,
          insuredNumber: emp.insuredNumber,
          name: emp.name,
          kana: emp.kana,
          gender: emp.gender,
          birthDate: emp.birthDate,
          department: emp.department,
          workPrefecture: emp.workPrefecture,
          standardMonthly: emp.standardMonthly,
          healthAcquisition: emp.healthAcquisition,
          pensionAcquisition: emp.pensionAcquisition,
        }));
        // 差分を再計算
        const validatedRows = validateAllRows(this.parsedRows, this.templateType, this.existingEmployees);
        this.calculateDifferences(validatedRows);
      } else {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map((r) => (r as PromiseRejectedResult).reason?.message || '不明なエラー')
          .join('\n');
        alert(`${successCount}件成功、${failureCount}件失敗しました。\n\nエラー:\n${errors}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新処理中にエラーが発生しました';
      alert(`エラー: ${message}`);
    } finally {
      this.isLoading = false;
    }
  }

  private async calculateDifferences(validatedRows: ReturnType<typeof validateAllRows>): Promise<void> {
    this.differences = [];
    let idCounter = 1;

    // 各バリデーション済み行を処理
    for (const validatedRow of validatedRows) {
      const parsedRow = validatedRow.parsedRow;
      const rowErrors = validatedRow.errors.filter((e) => e.severity === 'error');

      // エラーがある行はスキップ
      if (rowErrors.length > 0) {
        continue;
      }

      // 差分計算を実行
      let diffResult = calculateDifferences(parsedRow, this.existingEmployees, this.templateType);

      // payrollテンプレートの場合は給与データの差分も計算
      if (this.templateType === 'payroll' && diffResult.existingEmployee) {
        const employeeNo = parsedRow.data['社員番号'] || '';
        const existingEmployee = this.existingEmployees.find((emp) => emp.employeeNo === employeeNo);
        if (existingEmployee?.id) {
          const payrollChanges = await this.calculatePayrollDifferences(parsedRow, existingEmployee.id);
          diffResult = {
            ...diffResult,
            changes: [...diffResult.changes, ...payrollChanges],
          };
        }
      }

      // 差分計算でエラーが見つかった場合は、エラーリストに追加
      if (diffResult.errors.length > 0) {
        const errorWithContext = this.attachRowContext(diffResult.errors);
        this.errors.push(...errorWithContext);
        continue;
      }

      // 差分行を作成
      const employeeNo = parsedRow.data['社員番号'] || '';
      const name = parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';
      
      // 変更サマリを作成
      const changeCount = diffResult.changes.length;
      const summary = diffResult.isNew
        ? `新規登録（${changeCount}項目）`
        : changeCount > 0
        ? `${changeCount}項目変更`
        : '変更なし';

      // ステータスを決定
      let status: ImportStatus = 'ok';
      if (diffResult.isNew) {
        status = 'ok';
      } else if (changeCount === 0) {
        status = 'warning'; // 変更なしの場合は警告
      } else {
        status = 'ok';
      }

      // 既存社員のIDを取得
          const existingEmployeeId = diffResult.existingEmployee
            ? this.existingEmployees.find(
                (emp) => emp.employeeNo === diffResult.existingEmployee?.employeeNo,
              )?.['id'] as string | undefined
            : undefined;

      this.differences.push({
        id: idCounter++,
        status,
        employeeNo,
        name,
        summary,
        changes: diffResult.changes.map((change) => ({
          field: change.fieldName,
          oldValue: change.oldValue || '（新規）',
          newValue: change.newValue || '',
        })),
        selected: true, // エラーがない行のみここに来るので、常にtrue
        parsedRow, // 元のCSVデータへの参照
        isNew: diffResult.isNew,
        existingEmployeeId, // 既存社員のID（更新の場合）
      });
    }
  }

  private async calculatePayrollDifferences(parsedRow: ParsedRow, employeeId: string): Promise<ChangeField[]> {
    const changes: ChangeField[] = [];
    const csvData = parsedRow.data;

    // 月給データの処理
    const monthlyPayMonth = csvData['月給支払月'];
    const monthlyPayAmount = csvData['月給支払額'];
    const workedDays = csvData['支払基礎日数'];
    const bonusPaidOn = csvData['賞与支給日'];
    const bonusTotal = csvData['賞与総支給額'];

    if (monthlyPayMonth) {
      // YYYY/MM形式をYYYY-MM形式に変換
      const yearMonth = monthlyPayMonth.replace(/\//g, '-');
      const [year, month] = yearMonth.split('-');
      const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

      // 既存の給与データを取得
      let existingPayroll: PayrollData | undefined;
      try {
        existingPayroll = await firstValueFrom(
          this.employeesService.getPayroll(employeeId, normalizedYearMonth),
        );
      } catch {
        // データが存在しない場合はundefinedのまま
      }

      // 月給支払額の差分
      if (monthlyPayAmount) {
        const csvAmount = Number(monthlyPayAmount.replace(/,/g, ''));
        const existingAmount = existingPayroll?.amount;
        if (existingAmount === undefined || existingAmount !== csvAmount) {
          changes.push({
            fieldName: '月給支払額',
            oldValue: existingAmount !== undefined ? String(existingAmount) : null,
            newValue: String(csvAmount),
          });
        }
      }

      // 支払基礎日数の差分
      if (workedDays) {
        const csvDays = Number(workedDays.replace(/,/g, ''));
        const existingDays = existingPayroll?.workedDays;
        if (existingDays === undefined || existingDays !== csvDays) {
          changes.push({
            fieldName: '支払基礎日数',
            oldValue: existingDays !== undefined ? String(existingDays) : null,
            newValue: String(csvDays),
          });
        }
      }

      // 賞与総支給額の差分
      if (bonusTotal) {
        const csvBonus = Number(bonusTotal.replace(/,/g, ''));
        const existingBonus = existingPayroll?.bonusTotal;
        if (existingBonus === undefined || existingBonus !== csvBonus) {
          changes.push({
            fieldName: '賞与総支給額',
            oldValue: existingBonus !== undefined ? String(existingBonus) : null,
            newValue: String(csvBonus),
          });
        }
      }

      // 賞与支給日の差分
      if (bonusPaidOn) {
        const normalizedBonusDate = bonusPaidOn.replace(/\//g, '-');
        const existingBonusDate = existingPayroll?.bonusPaidOn;
        if (existingBonusDate !== normalizedBonusDate) {
          changes.push({
            fieldName: '賞与支給日',
            oldValue: existingBonusDate || null,
            newValue: normalizedBonusDate,
          });
        }
      }
    } else if (bonusPaidOn) {
      // 月給データがなく、賞与データのみの場合
      const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
      if (!isNaN(bonusDate.getTime())) {
        const year = bonusDate.getFullYear();
        const month = String(bonusDate.getMonth() + 1).padStart(2, '0');
        const normalizedYearMonth = `${year}-${month}`;

        // 既存の給与データを取得
        let existingPayroll: PayrollData | undefined;
        try {
          existingPayroll = await firstValueFrom(
            this.employeesService.getPayroll(employeeId, normalizedYearMonth),
          );
        } catch {
          // データが存在しない場合はundefinedのまま
        }

        // 賞与総支給額の差分
        if (bonusTotal) {
          const csvBonus = Number(bonusTotal.replace(/,/g, ''));
          const existingBonus = existingPayroll?.bonusTotal;
          if (existingBonus === undefined || existingBonus !== csvBonus) {
            changes.push({
              fieldName: '賞与総支給額',
              oldValue: existingBonus !== undefined ? String(existingBonus) : null,
              newValue: String(csvBonus),
            });
          }
        }

        // 賞与支給日の差分
        const normalizedBonusDate = bonusPaidOn.replace(/\//g, '-');
        const existingBonusDate = existingPayroll?.bonusPaidOn;
        if (existingBonusDate !== normalizedBonusDate) {
          changes.push({
            fieldName: '賞与支給日',
            oldValue: existingBonusDate || null,
            newValue: normalizedBonusDate,
          });
        }
      }
    }

    return changes;
  }

  downloadNewEmployeeTemplate(): void {
    const headers = [
      '社員番号',
      '氏名(漢字)',
      '氏名(カナ)',
      '性別',
      '生年月日',
      '郵便番号',
      '住所',
      '所属部署名',
      '勤務地都道府県名',
      '個人番号',
      '基礎年金番号',
      '標準報酬月額',
      '被保険者番号（健康保険)',
      '被保険者番号（厚生年金）',
      '健康保険 資格取得日',
      '厚生年金 資格取得日',
      '育休開始日',
      '育休終了日',
      '産休開始日',
      '産休終了日',
    ];

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = [
      '(必須)',
      '(必須)',
      '',
      '男/女',
      'YYYY/MM/DD',
      '例：123-4567',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
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

  downloadPayrollTemplate(): void {
    const headers = [
      '社員番号',
      '氏名(漢字)',
      '月給支払月',
      '月給支払額',
      '支払基礎日数',
      '賞与支給日',
      '賞与総支給額',
    ];

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = [
      '(必須)',
      '(必須)',
      '',
      '',
      '',
      '',
      '',
    ];
    
    // CSVコンテンツを作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent = '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';

    // Blobオブジェクトを作成（UTF-8、LF改行）
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // ダウンロードリンクを作成
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '月給/賞与支払額同期用テンプレート.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  ngOnDestroy(): void {
    this.approvalSubscription?.unsubscribe();
  }

}
