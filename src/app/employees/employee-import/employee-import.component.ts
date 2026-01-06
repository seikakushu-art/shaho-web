import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { ApprovalAttachmentService } from '../../approvals/approval-attachment.service';
import { ApprovalNotificationService } from '../../approvals/approval-notification.service';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import {
  ApprovalAttachmentMetadata,
  ApprovalFlow,
  ApprovalHistory,
  ApprovalNotification,
  ApprovalRequest,
} from '../../models/approvals';
import { RoleKey } from '../../models/roles';
import {
  PayrollData,
  BonusPayment,
  ShahoEmployee,
  ShahoEmployeesService,
  DependentData,
} from '../../app/services/shaho-employees.service';
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
  normalizeEmployeeNoForComparison,
  normalizeNameForComparison,
  normalizeHeaders,
  organizeErrors,
  parseCSV,
  validateAllRows,
} from './csv-import.utils';
import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';
import { calculateCareSecondInsured } from '../../app/services/care-insurance.utils';

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
  private router = inject(Router);
  readonly attachmentService = inject(ApprovalAttachmentService);
  private existingEmployees: ExistingEmployee[] = [];
  private applicantId = 'demo-applicant';
  private applicantName = 'デモ申請者';
  private approvalSubscription?: Subscription;
  private activeApprovalRequestId?: string;

  private readonly MAX_CSV_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
  selectedFiles: File[] = [];
  validationErrors: string[] = [];

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
    const [flows, user] = await Promise.all([
      firstValueFrom(this.workflowService.flows$.pipe(take(1))),
      firstValueFrom(this.authService.user$.pipe(take(1))),
    ]);

    // 既存社員データを取得
    await this.loadExistingEmployees();

    this.approvalFlows = flows;
    this.selectedFlowId = flows[0]?.id ?? null;
    this.selectedFlow = flows.find((flow) => flow.id === this.selectedFlowId);
    if (user?.email) {
      this.applicantId = user.email;
      this.applicantName = user.displayName ?? user.email;
    }
  }

  /**
   * Firestoreから既存社員データを取得して更新する
   * CSVアップロード時やデータ更新後に最新データで比較するために使用
   */
  private async loadExistingEmployees(): Promise<void> {
    const employees = await firstValueFrom(
      this.employeesService.getEmployees(),
    );

    // 各社員の扶養家族情報を取得
    const employeesWithDependents = await Promise.all(
      employees.map(async (emp) => {
        if (!emp.id) return { emp, dependents: [] };
        const dependents = await firstValueFrom(
          this.employeesService.getDependents(emp.id).pipe(take(1)),
        );
        return { emp, dependents };
      }),
    );

    this.existingEmployees = employeesWithDependents.map(
      ({ emp, dependents }) => {
        // 最初の扶養家族情報を取得（CSVの1行目に含まれる扶養家族情報と比較するため）
        const firstDependent = dependents.length > 0 ? dependents[0] : null;

        // 全ての扶養家族情報をExistingDependent形式に変換
        const existingDependents = dependents.map((dep) => ({
          id: dep.id,
          relationship: dep.relationship,
          nameKanji: dep.nameKanji,
          nameKana: dep.nameKana,
          birthDate: dep.birthDate,
          gender: dep.gender,
          personalNumber: dep.personalNumber,
          basicPensionNumber: dep.basicPensionNumber,
          cohabitationType: dep.cohabitationType,
          address: dep.address,
          occupation: dep.occupation,
          annualIncome: dep.annualIncome ?? null,
          dependentStartDate: dep.dependentStartDate,
          thirdCategoryFlag: dep.thirdCategoryFlag,
        }));

        return {
          id: emp.id,
          employeeNo: normalizeEmployeeNoForComparison(emp.employeeNo || ''),
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
          hasDependent: emp.hasDependent,
          dependentRelationship: firstDependent?.relationship,
          dependentNameKanji: firstDependent?.nameKanji,
          dependentNameKana: firstDependent?.nameKana,
          dependentBirthDate: firstDependent?.birthDate,
          dependentGender: firstDependent?.gender,
          dependentPersonalNumber: firstDependent?.personalNumber,
          dependentBasicPensionNumber: firstDependent?.basicPensionNumber,
          dependentCohabitationType: firstDependent?.cohabitationType,
          dependentAddress: firstDependent?.address,
          dependentOccupation: firstDependent?.occupation,
          dependentAnnualIncome: firstDependent?.annualIncome ?? undefined,
          dependentStartDate: firstDependent?.dependentStartDate,
          dependentThirdCategoryFlag: firstDependent?.thirdCategoryFlag,
          dependents: existingDependents, // 全ての扶養家族情報
          standardBonusAnnualTotal: emp.standardBonusAnnualTotal,
          healthStandardMonthly: emp.healthStandardMonthly,
          welfareStandardMonthly: emp.welfareStandardMonthly,
          healthInsuredNumber: emp.healthInsuredNumber,
          pensionInsuredNumber: emp.pensionInsuredNumber,
          insuredNumber: emp.insuredNumber,
          careSecondInsured: emp.careSecondInsured,
          healthAcquisition: emp.healthAcquisition,
          pensionAcquisition: emp.pensionAcquisition,
          currentLeaveStatus: emp.currentLeaveStatus,
          currentLeaveStartDate: emp.currentLeaveStartDate,
          currentLeaveEndDate: emp.currentLeaveEndDate,
        };
      },
    );
  }

  async onFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    
    // ファイルサイズのチェック
    if (file.size > this.MAX_CSV_FILE_SIZE) {
      this.handleParseFailure('CSVファイルのサイズは10MB以内にしてください。');
      input.value = ''; // 入力値をリセット
      return;
    }
    
    this.fileName = file.name;
    this.isLoading = true;

    try {
      // CSVファイルを読み込む前に、最新の既存社員データを取得
      await this.loadExistingEmployees();

      const csvText = await this.readFileAsText(file);
      const parsedMatrix = parseCSV(csvText);
      if (parsedMatrix.length === 0) {
        this.handleParseFailure('CSVにデータがありません');
        return;
      }

      // すべてのテンプレートで1行目が入力制限、2行目がヘッダー行の形式
      // 2行目をヘッダー行として扱う
      if (parsedMatrix.length < 2) {
        this.handleParseFailure(
          'CSVファイルは1行目が入力制限、2行目がヘッダー行の形式である必要があります',
        );
        return;
      }

      const headerRowIndex = 1;
      const rawHeaders = parsedMatrix[headerRowIndex];
      const headers = normalizeHeaders(rawHeaders);
      this.templateType = detectTemplateType(headers);
      const dataRows = parsedMatrix.slice(headerRowIndex + 1);
      // 行番号オフセット：1行目が入力制限、2行目がヘッダー、3行目からデータが始まるため、3行目が行番号3
      const parsedRows = convertToRecordArray(dataRows, headers, 3);
      this.parsedRows = parsedRows;

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

      const validatedRows = validateAllRows(
        parsedRows,
        this.templateType,
        this.existingEmployees,
      );
      const rowErrors = validatedRows.flatMap((row) => row.errors);
      const allErrors = organizeErrors([...validationErrors, ...rowErrors]);
      this.errors = this.attachRowContext(allErrors);

      // 差分計算を実行（エラーがない行のみ）
      await this.calculateDifferences(validatedRows);

      const summary = calculateSummary(validatedRows, this.differences);
      this.summary = {
        ...summary,
        errorCount: this.errors.filter((error) => error.severity === 'error')
          .length,
      };
      this.hasUploadedFile = true;
      this.unlockStep(3);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'CSVの読み込みに失敗しました';
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
    this.summary = {
      totalRecords: 0,
      newCount: 0,
      updateCount: 0,
      errorCount: 1,
    };
    this.hasUploadedFile = true;
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () =>
        reject(new Error('ファイルの読み込みに失敗しました'));
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
    const firstSelectable = this.filteredDifferences.find(
      (item) => item.status !== 'error',
    );
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
    return this.differences.filter(
      (row) => row.selected && row.status !== 'error',
    );
  }

  get selectedCount(): number {
    return this.selectedDifferences.length;
  }

  get warningCount(): number {
    return this.differences.filter((row) => row.status === 'warning').length;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) {
      input.value = '';
      return;
    }

    const merged = [...this.selectedFiles, ...files];
    const validation = this.attachmentService.validateFiles(merged);
    this.validationErrors = validation.errors;
    this.selectedFiles = validation.files;

    if (!validation.valid) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
    }

    input.value = '';
  }

  removeFile(index: number): void {
    this.selectedFiles.splice(index, 1);
    this.selectedFiles = [...this.selectedFiles];
    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;
  }

  totalSelectedSize(): number {
    return this.selectedFiles.reduce((sum, file) => sum + file.size, 0);
  }

  formatFileSize(size: number): string {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
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

    // 選択された社員のうち、承認待ちリクエストが既に存在する社員をチェック
    const employeesWithPendingRequests: Array<{ employeeNo: string; name: string; requestTitle: string }> = [];
    
    // 承認待ちのリクエストを取得
    const requests = await firstValueFrom(
      this.workflowService.requests$.pipe(take(1)),
    );
    
    for (const row of selectedRows) {
      const employeeNo = row.employeeNo || null;
      if (!employeeNo) continue;

      if (row.isNew) {
        // 新規登録の場合：承認待ちの新規社員登録申請の社員番号をチェック
        const pendingNewEmployeeRequest = requests.find((request) => {
          // 承認待ち状態でない場合はスキップ
          if (request.status !== 'pending') {
            return false;
          }

          // 新規社員登録のカテゴリのみチェック
          if (request.category !== '新規社員登録') {
            return false;
          }

          // employeeDiffsの社員番号をチェック（正規化して比較）
          const diffs = request.employeeDiffs || [];
          const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
          const hasDuplicateInDiffs = diffs.some(
            (diff) => normalizeEmployeeNoForComparison(diff.employeeNo || '') === normalizedEmployeeNo,
          );

          if (hasDuplicateInDiffs) {
            return true;
          }

          // employeeDataの社員番号もチェック（念のため）
          const requestEmployeeNo =
            request.employeeData?.basicInfo?.employeeNo;
          if (requestEmployeeNo && normalizeEmployeeNoForComparison(requestEmployeeNo) === normalizedEmployeeNo) {
            return true;
          }

          return false;
        });

        if (pendingNewEmployeeRequest) {
          employeesWithPendingRequests.push({
            employeeNo: row.employeeNo,
            name: row.name,
            requestTitle: pendingNewEmployeeRequest.title || '承認待ちの新規社員登録申請',
          });
        }
      } else {
        // 更新の場合：既存の承認待ちリクエストをチェック
        const employeeId = row.existingEmployeeId || null;
        const existingPendingRequest = this.workflowService.getPendingRequestForEmployee(
          employeeId,
          employeeNo,
        );

        if (existingPendingRequest) {
          employeesWithPendingRequests.push({
            employeeNo: row.employeeNo,
            name: row.name,
            requestTitle: existingPendingRequest.title || '承認待ちの申請',
          });
        }
      }
    }

    if (employeesWithPendingRequests.length > 0) {
      const employeeList = employeesWithPendingRequests
        .map((e) => `${e.name}（${e.employeeNo}）`)
        .join('、');
      alert(
        `以下の社員には既に承認待ちの申請が存在します。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。\n\n${employeeList}`,
      );
      return;
    }

    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;

    if (!validation.valid && this.selectedFiles.length) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
      return;
    }

    this.isLoading = true;

    try {
      const request = this.buildApprovalRequest(this.selectedFlow);
      const savedBase = await this.workflowService.saveRequest(request);

      let uploaded: ApprovalAttachmentMetadata[] = [];

      if (validation.files.length && savedBase.id) {
        uploaded = await this.attachmentService.upload(
          savedBase.id,
          validation.files,
          this.applicantId,
          this.applicantName,
        );
      }

      const applyHistory: ApprovalHistory = {
        id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        statusAfter: 'pending',
        action: 'apply',
        actorId: this.applicantId,
        actorName: this.applicantName,
        comment: this.requestComment || undefined,
        attachments: uploaded,
        createdAt: Timestamp.fromDate(new Date()),
      };

      const saved = await this.workflowService.saveRequest({
        ...savedBase,
        attachments: uploaded,
        histories: [applyHistory],
      });

      this.selectedFiles = [];
      this.validationErrors = [];

      // 承認プロセスを開始
      // 注意: 反映処理は承認側（approval-detail.component.ts）で実行されるため、
      // ここでは反映処理を行わない（二重実行を防ぐため）
      const result = await this.workflowService.startApprovalProcess({
        request: { ...saved, id: saved.id },
        onApproved: async () => {
          // 承認完了時の通知のみ（反映処理は承認側で実行）
          console.log('承認が完了しました。反映処理は承認側で実行されます。');
        },
        onFailed: () => {
          // 承認が失敗した場合の処理
        },
        setMessage: (message) => {
          // メッセージを表示（必要に応じて）
        },
        setLoading: (loading) => {
          this.isLoading = loading;
        },
      });

      if (result) {
        this.activeApprovalRequestId = result.requestId;
        this.approvalSubscription?.unsubscribe();
        this.approvalSubscription = result.subscription;
        this.pushApprovalNotifications(saved);
        alert('承認依頼を送信しました。承認完了後に反映します。');
        this.router.navigate(['/employees']);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '承認依頼の送信に失敗しました。';
      console.error(message, error);
      alert(message);
    } finally {
      this.isLoading = false;
    }
  }

  private buildApprovalRequest(flow: ApprovalFlow): ApprovalRequest {
    const firstStepOrder = flow.steps[0]?.order;
    const createdAt = new Date();
    const dueDate = new Date(createdAt);
    dueDate.setDate(dueDate.getDate() + 14);

    return {
      title: `社員インポート（${this.selectedCount}件）`,
      category: '社員情報一括更新',
      targetCount: this.selectedCount,
      applicantId: this.applicantId,
      applicantName: this.applicantName,
      flowId: flow.id ?? 'default-flow',
      flowSnapshot: flow,
      status: 'pending',
      currentStep: firstStepOrder,
      comment: this.requestComment || undefined,
      diffSummary: this.createDifferenceSummary(),
      employeeDiffs: this.selectedDifferences.map((diff) => ({
        employeeNo: diff.employeeNo,
        name: diff.name,
        status: diff.status,
        changes: diff.changes.map((change) => ({
          field: change.field,
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        })),
        isNew: diff.isNew,
        existingEmployeeId: diff.existingEmployeeId,
      })),
      importEmployeeData: this.selectedDifferences
        .filter((diff) => diff.parsedRow)
        .map((diff) => ({
          employeeNo: diff.employeeNo,
          csvData: diff.parsedRow!.data,
          isNew: diff.isNew ?? false,
          existingEmployeeId: diff.existingEmployeeId,
          templateType: this.templateType,
        })),
      steps: flow.steps.map((step) => ({
        stepOrder: step.order,
        status: 'waiting',
      })),
      attachments: [],
      histories: [],
      createdAt: Timestamp.fromDate(createdAt),
      dueDate: Timestamp.fromDate(dueDate),
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
    this.approvalSubscription = this.workflowService.requests$.subscribe(
      (requests) => {
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
      },
    );
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

    const currentStep = request.steps.find(
      (step) => step.stepOrder === request.currentStep,
    );
    const candidates = currentStep
      ? (request.flowSnapshot?.steps.find(
          (step) => step.order === currentStep.stepOrder,
        )?.candidates ?? [])
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

  private pushApprovalResultNotification(
    request: ApprovalRequest,
    type: 'success' | 'warning',
  ): void {
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

    if (
      !skipConfirmation &&
      !confirm(`${selectedRows.length}件の社員データを更新しますか？`)
    ) {
      return;
    }

    this.isLoading = true;

    // undefinedのフィールドを除外するヘルパー関数（Firestoreはundefinedを許可しない）
    // currentAddressは空文字列でない限り保存する（CSVインポート時）
    const removeUndefinedFields = <T extends Record<string, unknown>>(
      obj: T,
    ): Partial<T> => {
      const cleaned: Partial<T> = {};
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        // currentAddressの場合は空文字列でない限り保存（undefinedやnull、空文字列は除外）
        if (key === 'currentAddress') {
          if (
            value !== undefined &&
            value !== null &&
            value !== 'undefined' &&
            String(value).trim() !== ''
          ) {
            cleaned[key as keyof T] = value as T[keyof T];
          }
        } else if (
          value !== undefined &&
          value !== '' &&
          value !== 'undefined'
        ) {
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
            // 念のため、existingEmployeesのemployeeNoも正規化して比較する
            const normalizedEmployeeNo =
              normalizeEmployeeNoForComparison(employeeNo);
            const existingEmployee = this.existingEmployees.find(
              (emp) =>
                normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
                normalizedEmployeeNo,
            );

            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }

            employeeId = existingEmployee.id;
          } else {
            // その他のテンプレートの場合は社員情報を更新
            // 数値変換ヘルパー関数
            const toNumber = (
              value: string | undefined,
            ): number | undefined => {
              if (!value) return undefined;
              const num = Number(value.replace(/,/g, ''));
              return isNaN(num) ? undefined : num;
            };

            // ブール値変換ヘルパー関数（1/0, true/false, on/off などを変換）
            const toBoolean = (
              value: string | undefined,
              treatUndefinedAsNoChange = false,
            ): boolean | undefined => {
              if (value === undefined || value === null) {
                return treatUndefinedAsNoChange ? undefined : undefined;
              }
              const normalized = value.toLowerCase().trim();
              if (normalized === '') {
                return treatUndefinedAsNoChange ? undefined : undefined;
              }
              if (
                normalized === '1' ||
                normalized === 'true' ||
                normalized === 'on' ||
                normalized === 'yes' ||
                normalized === '有'
              ) {
                return true;
              }
              if (
                normalized === '0' ||
                normalized === 'false' ||
                normalized === 'off' ||
                normalized === 'no' ||
                normalized === '無'
              ) {
                return false;
              }
              return undefined;
            };

            const employeeDataRaw: Partial<ShahoEmployee> = {
              employeeNo: normalizeEmployeeNoForComparison(
                csvData['社員番号'] || '',
              ),
              name: csvData['氏名(漢字)'] || csvData['氏名漢字'] || '',
              kana: csvData['氏名(カナ)'] || undefined,
              gender: csvData['性別'] || undefined,
              birthDate: csvData['生年月日'] || undefined,
              postalCode: csvData['郵便番号'] || undefined,
              address: csvData['住民票住所'] || undefined,
              // CSVインポート時は、現住所に値が入っていればそのまま保存（チェックボックスのロジックは適用しない）
              currentAddress: csvData['現住所']?.trim() || undefined,
              department: csvData['所属部署名'] || undefined,
              workPrefecture: csvData['勤務地都道府県名'] || undefined,
              personalNumber: csvData['個人番号'] || undefined,
              basicPensionNumber: csvData['基礎年金番号'] || undefined,
              healthStandardMonthly: toNumber(csvData['健保標準報酬月額']),
              welfareStandardMonthly:
                toNumber(csvData['厚年標準報酬月額']) ||
                toNumber(csvData['健保標準報酬月額']),
              healthInsuredNumber:
                csvData['被保険者番号（健康保険)'] || undefined,
              pensionInsuredNumber:
                csvData['被保険者番号（厚生年金）'] || undefined,
              healthAcquisition:
                csvData['健康保険 資格取得日'] ||
                csvData['健康保険資格取得日'] ||
                undefined,
              pensionAcquisition:
                csvData['厚生年金 資格取得日'] ||
                csvData['厚生年金資格取得日'] ||
                undefined,
              // 介護保険第2号被保険者フラグは、CSVに値があれば優先的に使用
              // 値がない場合のみ生年月日から自動判定
              careSecondInsured: (() => {
                const csvValue = toBoolean(
                  csvData['介護保険第2号被保険者フラグ'] ||
                    csvData['介護保険第2号フラグ'] ||
                    undefined,
                );
                if (csvValue !== undefined) {
                  return csvValue;
                }
                // CSVに値がない場合のみ、生年月日から自動判定
                return csvData['生年月日']
                  ? calculateCareSecondInsured(csvData['生年月日'])
                  : false;
              })(),
              currentLeaveStatus: csvData['現在の休業状態'] || undefined,
              // 現在の休業状態が空文字列または「なし」の場合は、日付フィールドをクリア
              currentLeaveStartDate: (() => {
                const status = csvData['現在の休業状態'];
                if (!status || status.trim() === '' || status.trim() === 'なし') {
                  return undefined;
                }
                return csvData['現在の休業開始日'] || undefined;
              })(),
              currentLeaveEndDate: (() => {
                const status = csvData['現在の休業状態'];
                if (!status || status.trim() === '' || status.trim() === 'なし') {
                  return undefined;
                }
                return csvData['現在の休業予定終了日'] || undefined;
              })(),
              // 扶養情報（hasDependentのみ）
              hasDependent: toBoolean(csvData['扶養の有無'], true),
            };

            // undefinedのフィールドを除外
            const employeeData = removeUndefinedFields(employeeDataRaw);
            if (row.isNew) {
              // 新規登録
              const result = await this.employeesService.addEmployee(
                employeeData as ShahoEmployee,
              );
              employeeId = result.id;
            } else if (row.existingEmployeeId) {
              // 更新
              await this.employeesService.updateEmployee(
                row.existingEmployeeId,
                employeeData,
              );
              employeeId = row.existingEmployeeId;
            } else {
              throw new Error(
                `既存社員のIDが見つかりません: ${row.employeeNo}`,
              );
            }

            // 扶養情報をdependentsサブコレクションに保存
            if (employeeId) {
              const hasDependentColumn = '扶養の有無' in csvData;
              const hasDependent = toBoolean(csvData['扶養の有無'], true);

              if (hasDependentColumn) {
                const dependentCandidates: DependentData[] = [];
                if (hasDependent === true) {
                  const dependentData: DependentData = {
                    relationship: csvData['扶養 続柄'] || undefined,
                    nameKanji: csvData['扶養 氏名(漢字)'] || undefined,
                    nameKana: csvData['扶養 氏名(カナ)'] || undefined,
                    birthDate: csvData['扶養 生年月日'] || undefined,
                    gender: csvData['扶養 性別'] || undefined,
                    personalNumber: csvData['扶養 個人番号'] || undefined,
                    basicPensionNumber:
                      csvData['扶養 基礎年金番号'] || undefined,
                    cohabitationType:
                      csvData['扶養 同居区分'] || undefined,
                    address:
                      csvData['扶養 住所（別居の場合のみ入力）'] ||
                      undefined,
                    occupation: csvData['扶養 職業'] || undefined,
                    annualIncome: toNumber(
                      csvData['扶養 年収（見込みでも可）'],
                    ),
                    dependentStartDate:
                      csvData['扶養 被扶養者になった日'] || undefined,
                    thirdCategoryFlag: toBoolean(
                      csvData['扶養 国民年金第3号被保険者該当フラグ'],
                    ),
                  };
                  if (this.hasDependentData(dependentData)) {
                    dependentCandidates.push(dependentData);
                  }
                }

                await this.syncDependents(
                  employeeId,
                  hasDependent,
                  dependentCandidates,
                );
              }
            }
          }

          // 月給/賞与支払額同期用テンプレート（payrollテンプレート）の処理
          if (this.templateType === 'payroll') {
            // 念のため、existingEmployeesのemployeeNoも正規化して比較する
            const employeeNo = normalizeEmployeeNoForComparison(
              csvData['社員番号'] || '',
            );
            const existingEmployee = this.existingEmployees.find(
              (emp) =>
                normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
                employeeNo,
            );

            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }

            const employeeId = existingEmployee.id;
            const payrollPromises: Promise<void>[] = [];

            // ブール値変換ヘルパー関数（1/0, true/false, on/off などを変換）
            const toBoolean = (
              value: string | undefined,
            ): boolean | undefined => {
              if (value === undefined || value === null) {
                return undefined;
              }
              const normalized = value.toLowerCase().trim();
              if (normalized === '') {
                return undefined;
              }
              if (
                normalized === '1' ||
                normalized === 'true' ||
                normalized === 'on' ||
                normalized === 'yes' ||
                normalized === '有'
              ) {
                return true;
              }
              if (
                normalized === '0' ||
                normalized === 'false' ||
                normalized === 'off' ||
                normalized === 'no' ||
                normalized === '無'
              ) {
                return false;
              }
              return undefined;
            };

            // 月給支払月から年月を抽出（YYYY/MM形式をYYYY-MM形式に変換）
            const monthlyPayMonth = csvData['月給支払月'];
            const monthlyPayAmount = csvData['月給支払額'];
            const workedDays = csvData['支払基礎日数'];
            const bonusPaidOn = csvData['賞与支給日'];
            const bonusTotal = csvData['賞与総支給額'];

            // 月給データの処理
            if (monthlyPayMonth) {
              const exemptionFlag = toBoolean(
                csvData['健康保険・厚生年金一時免除フラグ'],
              ) ?? false;
              // YYYY/MM形式をYYYY-MM形式に変換
              const yearMonth = monthlyPayMonth.replace(/\//g, '-');
              // 月が1桁の場合は0埋め（例: 2025-4 → 2025-04）
              const [year, month] = yearMonth.split('-');
              const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

              // 月次データを準備
              const payrollMonthData: any = {
                workedDays: workedDays
                  ? Number(workedDays.replace(/,/g, ''))
                  : undefined,
                amount: monthlyPayAmount
                  ? Number(monthlyPayAmount.replace(/,/g, ''))
                  : undefined,
                  exemption: exemptionFlag,
              };

              // undefinedのフィールドを除外
              Object.keys(payrollMonthData).forEach((key) => {
                if (payrollMonthData[key] === undefined) {
                  delete payrollMonthData[key];
                }
              });

              // 賞与データがある場合は賞与明細として追加
              let bonusPaymentData: any | undefined;
              if (bonusPaidOn?.trim() && bonusTotal) {
                bonusPaymentData = {
                  bonusPaidOn: bonusPaidOn.trim(),
                  bonusTotal: Number(bonusTotal.replace(/,/g, '')),
                };
              }

              payrollPromises.push(
                this.employeesService.addOrUpdatePayrollMonth(
                  employeeId,
                  normalizedYearMonth,
                  payrollMonthData,
                  bonusPaymentData,
                ),
              );
            } else if (bonusPaidOn) {
              // 月給データがなく、賞与データのみの場合
              // 賞与支給日から年月を抽出
              const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
              if (!isNaN(bonusDate.getTime())) {
                const year = bonusDate.getFullYear();
                const month = String(bonusDate.getMonth() + 1).padStart(2, '0');
                const normalizedYearMonth = `${year}-${month}`;

                // 賞与明細データを準備
                const bonusPaymentData: any = {
                  bonusPaidOn: bonusPaidOn.trim(),
                  bonusTotal: bonusTotal
                    ? Number(bonusTotal.replace(/,/g, ''))
                    : undefined,
                };

                // undefinedのフィールドを除外
                Object.keys(bonusPaymentData).forEach((key) => {
                  if (bonusPaymentData[key] === undefined) {
                    delete bonusPaymentData[key];
                  }
                });

                payrollPromises.push(
                  this.employeesService.addOrUpdatePayrollMonth(
                    employeeId,
                    normalizedYearMonth,
                    {}, // 月次データなし
                    bonusPaymentData,
                  ),
                );
              }
            }

            // すべての給与データを保存
            if (payrollPromises.length > 0) {
              await Promise.all(payrollPromises);
            }
          }

          return {
            success: true,
            employeeNo: row.employeeNo,
            action: row.isNew ? '新規登録' : '更新',
          };
        }),
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failureCount = results.filter(
        (r) => r.status === 'rejected',
      ).length;

      if (failureCount === 0) {
        alert(`${successCount}件の社員データを正常に更新しました。`);
        // 既存社員データを再取得（差分計算に必要なすべてのフィールドを含める）
        await this.loadExistingEmployees();
        // 差分を再計算
        const validatedRows = validateAllRows(
          this.parsedRows,
          this.templateType,
          this.existingEmployees,
        );
        await this.calculateDifferences(validatedRows);
      } else {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map(
            (r) =>
              (r as PromiseRejectedResult).reason?.message || '不明なエラー',
          )
          .join('\n');
        alert(
          `${successCount}件成功、${failureCount}件失敗しました。\n\nエラー:\n${errors}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '更新処理中にエラーが発生しました';
      alert(`エラー: ${message}`);
    } finally {
      this.isLoading = false;
    }
  }

  private async saveApprovedImportData(
    importData: Array<{
      employeeNo: string;
      csvData: Record<string, string>;
      isNew: boolean;
      existingEmployeeId?: string;
      templateType: string;
    }>,
  ): Promise<void> {
    console.log('========================================');
    console.log('【saveApprovedImportDataメソッドが呼ばれました】');
    console.log('========================================');
    console.log(`importDataの件数: ${importData.length}`);

    // undefinedのフィールドを除外するヘルパー関数
    // currentAddressは空文字列でない限り保存する（CSVインポート時）
    const removeUndefinedFields = <T extends Record<string, unknown>>(
      obj: T,
    ): Partial<T> => {
      const cleaned: Partial<T> = {};
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        // currentAddressの場合は空文字列でない限り保存（undefinedやnull、空文字列は除外）
        if (key === 'currentAddress') {
          if (
            value !== undefined &&
            value !== null &&
            value !== 'undefined' &&
            String(value).trim() !== ''
          ) {
            cleaned[key as keyof T] = value as T[keyof T];
          }
        } else if (
          value !== undefined &&
          value !== '' &&
          value !== 'undefined'
        ) {
          cleaned[key as keyof T] = value as T[keyof T];
        }
      });
      return cleaned;
    };

    // 数値変換ヘルパー関数
    const toNumber = (value: string | undefined): number | undefined => {
      if (!value) return undefined;
      const num = Number(value.replace(/,/g, ''));
      return isNaN(num) ? undefined : num;
    };

    // ブール値変換ヘルパー関数（1/0, true/false, on/off などを変換）
    const toBoolean = (
      value: string | undefined,
      treatUndefinedAsNoChange = false,
    ): boolean | undefined => {
      if (value === undefined || value === null) {
        return treatUndefinedAsNoChange ? undefined : undefined;
      }
      const normalized = value.toLowerCase().trim();
      if (normalized === '') {
        return treatUndefinedAsNoChange ? undefined : undefined;
      }
      if (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'on' ||
        normalized === 'yes' ||
        normalized === '有'
      ) {
        return true;
      }
      if (
        normalized === '0' ||
        normalized === 'false' ||
        normalized === 'off' ||
        normalized === 'no' ||
        normalized === '無'
      ) {
        return false;
      }
      return undefined;
    };

    try {
      // 同じ社員番号の行をグループ化（複数の扶養家族をサポート）
      const groupedByEmployeeNo = new Map<
        string,
        Array<{
          employeeNo: string;
          csvData: Record<string, string>;
          isNew: boolean;
          existingEmployeeId?: string;
          templateType: string;
        }>
      >();

      importData.forEach((item) => {
        const employeeNo = item.employeeNo;
        if (!groupedByEmployeeNo.has(employeeNo)) {
          groupedByEmployeeNo.set(employeeNo, []);
        }
        groupedByEmployeeNo.get(employeeNo)!.push(item);
      });

      const results = await Promise.allSettled(
        Array.from(groupedByEmployeeNo.entries()).map(
          async ([employeeNo, items]) => {
            // 最初の行で従業員情報を登録/更新
            const firstItem = items[0];
            const csvData = firstItem.csvData;
            const templateType = firstItem.templateType as TemplateType;

            // employeeIdを取得（テンプレートタイプによって異なる）
            let employeeId: string;

            if (templateType === 'payroll') {
              // payrollテンプレートの場合は既存社員のIDを取得
              const employeeNo = normalizeEmployeeNoForComparison(
                csvData['社員番号'] || '',
              );
              // 既存社員データを再取得
              const employees = await firstValueFrom(
                this.employeesService.getEmployees(),
              );
              const existingEmployee = employees.find(
                (emp) =>
                  normalizeEmployeeNoForComparison(emp.employeeNo) ===
                  employeeNo,
              );

              if (!existingEmployee || !existingEmployee.id) {
                throw new Error(
                  `社員番号 ${employeeNo} の社員が見つかりません`,
                );
              }

              employeeId = existingEmployee.id;
            } else {
              // その他のテンプレートの場合は社員情報を更新
              const employeeDataRaw: Partial<ShahoEmployee> = {
                employeeNo: normalizeEmployeeNoForComparison(
                  csvData['社員番号'] || '',
                ),
                name: csvData['氏名(漢字)'] || csvData['氏名漢字'] || '',
                kana: csvData['氏名(カナ)'] || undefined,
                gender: csvData['性別'] || undefined,
                birthDate: csvData['生年月日'] || undefined,
                postalCode: csvData['郵便番号'] || undefined,
                address: csvData['住民票住所'] || undefined,
                // CSVインポート時は、現住所に値が入っていればそのまま保存（チェックボックスのロジックは適用しない）
                currentAddress: csvData['現住所']?.trim() || undefined,
                department: csvData['所属部署名'] || undefined,
                workPrefecture: csvData['勤務地都道府県名'] || undefined,
                personalNumber: csvData['個人番号'] || undefined,
                basicPensionNumber: csvData['基礎年金番号'] || undefined,
                healthStandardMonthly: toNumber(csvData['健保標準報酬月額']),
                welfareStandardMonthly:
                  toNumber(csvData['厚年標準報酬月額']) ||
                  toNumber(csvData['健保標準報酬月額']),
                healthInsuredNumber:
                  csvData['被保険者番号（健康保険)'] || undefined,
                pensionInsuredNumber:
                  csvData['被保険者番号（厚生年金）'] || undefined,
                healthAcquisition:
                  csvData['健康保険 資格取得日'] ||
                  csvData['健康保険資格取得日'] ||
                  undefined,
                pensionAcquisition:
                  csvData['厚生年金 資格取得日'] ||
                  csvData['厚生年金資格取得日'] ||
                  undefined,
                // 介護保険第2号被保険者フラグは、CSVに値があれば優先的に使用
                // 値がない場合のみ生年月日から自動判定
                careSecondInsured: (() => {
                  const csvValue = toBoolean(
                    csvData['介護保険第2号被保険者フラグ'] ||
                      csvData['介護保険第2号フラグ'] ||
                      undefined,
                  );
                  if (csvValue !== undefined) {
                    return csvValue;
                  }
                  // CSVに値がない場合のみ、生年月日から自動判定
                  return csvData['生年月日']
                    ? calculateCareSecondInsured(csvData['生年月日'])
                    : false;
                })(),
                currentLeaveStatus: csvData['現在の休業状態'] || undefined,
                // 現在の休業状態が空文字列または「なし」の場合は、日付フィールドをクリア
                currentLeaveStartDate: (() => {
                  const status = csvData['現在の休業状態'];
                  if (!status || status.trim() === '' || status.trim() === 'なし') {
                    return undefined;
                  }
                  return csvData['現在の休業開始日'] || undefined;
                })(),
                currentLeaveEndDate: (() => {
                  const status = csvData['現在の休業状態'];
                  if (!status || status.trim() === '' || status.trim() === 'なし') {
                    return undefined;
                  }
                  return csvData['現在の休業予定終了日'] || undefined;
                })(),
                // 扶養情報（hasDependentのみ）
                hasDependent: toBoolean(csvData['扶養の有無'], true),
              };

              // undefinedのフィールドを除外
              const employeeData = removeUndefinedFields(employeeDataRaw);

              if (firstItem.isNew) {
                // 新規登録
                const result = await this.employeesService.addEmployee(
                  employeeData as ShahoEmployee,
                );
                employeeId = result.id;
              } else if (firstItem.existingEmployeeId) {
                // 更新
                await this.employeesService.updateEmployee(
                  firstItem.existingEmployeeId,
                  employeeData,
                );
                employeeId = firstItem.existingEmployeeId;
              } else {
                throw new Error(
                  `既存社員のIDが見つかりません: ${firstItem.employeeNo}`,
                );
              }

              // 扶養情報をdependentsサブコレクションに保存（複数件対応）
              if (employeeId) {
                const hasDependentColumn = '扶養の有無' in csvData;
                const hasDependent = toBoolean(csvData['扶養の有無'], true);

                if (hasDependentColumn) {
                  const dependentDataList: DependentData[] = [];

                  if (hasDependent === true) {
                    for (const item of items) {
                      const itemCsvData = item.csvData;
                      const dependentData: DependentData = {
                        relationship: itemCsvData['扶養 続柄'] || undefined,
                        nameKanji: itemCsvData['扶養 氏名(漢字)'] || undefined,
                        nameKana: itemCsvData['扶養 氏名(カナ)'] || undefined,
                        birthDate: itemCsvData['扶養 生年月日'] || undefined,
                        gender: itemCsvData['扶養 性別'] || undefined,
                        personalNumber:
                          itemCsvData['扶養 個人番号'] || undefined,
                        basicPensionNumber:
                          itemCsvData['扶養 基礎年金番号'] || undefined,
                        cohabitationType:
                          itemCsvData['扶養 同居区分'] || undefined,
                        address:
                          itemCsvData['扶養 住所（別居の場合のみ入力）'] ||
                          undefined,
                        occupation: itemCsvData['扶養 職業'] || undefined,
                        annualIncome: toNumber(
                          itemCsvData['扶養 年収（見込みでも可）'],
                        ),
                        dependentStartDate:
                          itemCsvData['扶養 被扶養者になった日'] || undefined,
                        thirdCategoryFlag: toBoolean(
                          itemCsvData['扶養 国民年金第3号被保険者該当フラグ'],
                        ),
                      };

                      if (this.hasDependentData(dependentData)) {
                        dependentDataList.push(dependentData);
                      }
                    }
                  }

                  await this.syncDependents(
                    employeeId,
                    hasDependent,
                    dependentDataList,
                  );
                }
              }
            }

            // 月給/賞与支払額同期用テンプレート（payrollテンプレート）の処理
            if (templateType === 'payroll') {
              const employeeNo = normalizeEmployeeNoForComparison(
                csvData['社員番号'] || '',
              );
              const employees = await firstValueFrom(
                this.employeesService.getEmployees(),
              );
              const existingEmployee = employees.find(
                (emp) =>
                  normalizeEmployeeNoForComparison(emp.employeeNo) ===
                  employeeNo,
              );

              if (!existingEmployee || !existingEmployee.id) {
                throw new Error(
                  `社員番号 ${employeeNo} の社員が見つかりません`,
                );
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
                const exemptionFlag = toBoolean(
                  csvData['健康保険・厚生年金一時免除フラグ'],
                ) ?? false;
                // YYYY/MM形式をYYYY-MM形式に変換
                const yearMonth = monthlyPayMonth.replace(/\//g, '-');
                // 月が1桁の場合は0埋め（例: 2025-4 → 2025-04）
                const [year, month] = yearMonth.split('-');
                const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

                // 既存の給与データを取得（マージするため）
                let existingPayroll: PayrollData | undefined;
                try {
                  existingPayroll = await firstValueFrom(
                    this.employeesService.getPayroll(
                      employeeId,
                      normalizedYearMonth,
                    ),
                  );
                } catch {
                  // データが存在しない場合はundefinedのまま
                }

                const payrollDataRaw: Partial<PayrollData> = {
                  ...existingPayroll,
                  yearMonth: normalizedYearMonth,
                  workedDays: workedDays
                    ? Number(workedDays.replace(/,/g, ''))
                    : existingPayroll?.workedDays || 0,
                  amount: monthlyPayAmount
                    ? Number(monthlyPayAmount.replace(/,/g, ''))
                    : existingPayroll?.amount,
                  // 賞与データも同じ月に含まれる場合は追加
                  bonusPaidOn:
                    bonusPaidOn?.trim() ||
                    existingPayroll?.bonusPaidOn ||
                    undefined,
                  bonusTotal: bonusTotal
                    ? Number(bonusTotal.replace(/,/g, ''))
                    : existingPayroll?.bonusTotal,
                    exemption: exemptionFlag,
                };

                // undefined と空文字列のフィールドを除外
                const payrollData = removeUndefinedFields(
                  payrollDataRaw,
                ) as PayrollData;

                payrollPromises.push(
                  this.employeesService.addOrUpdatePayroll(
                    employeeId,
                    normalizedYearMonth,
                    payrollData,
                  ),
                );
              } else if (bonusPaidOn) {
                // 月給データがなく、賞与データのみの場合
                // 賞与支給日から年月を抽出
                const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
                if (!isNaN(bonusDate.getTime())) {
                  const year = bonusDate.getFullYear();
                  const month = String(bonusDate.getMonth() + 1).padStart(
                    2,
                    '0',
                  );
                  const normalizedYearMonth = `${year}-${month}`;

                  // 既存の給与データを取得（マージするため）
                  let existingPayroll: PayrollData | undefined;
                  try {
                    existingPayroll = await firstValueFrom(
                      this.employeesService.getPayroll(
                        employeeId,
                        normalizedYearMonth,
                      ),
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
                    bonusTotal: bonusTotal
                      ? Number(bonusTotal.replace(/,/g, ''))
                      : undefined,
                  };

                  // undefined と空文字列のフィールドを除外
                  const payrollData = removeUndefinedFields(
                    payrollDataRaw,
                  ) as PayrollData;

                  payrollPromises.push(
                    this.employeesService.addOrUpdatePayroll(
                      employeeId,
                      normalizedYearMonth,
                      payrollData,
                    ),
                  );
                }
              }

              // すべての給与データを保存
              if (payrollPromises.length > 0) {
                await Promise.all(payrollPromises);
              }
            }

            return {
              success: true,
              employeeNo: employeeNo,
              action: firstItem.isNew ? '新規登録' : '更新',
            };
          },
        ),
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failureCount = results.filter(
        (r) => r.status === 'rejected',
      ).length;

      if (failureCount === 0) {
        console.log(`${successCount}件の社員データを正常に保存しました。`);
      } else {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map(
            (r) =>
              (r as PromiseRejectedResult).reason?.message || '不明なエラー',
          )
          .join('\n');
        console.error(
          `${successCount}件成功、${failureCount}件失敗しました。\n\nエラー:\n${errors}`,
        );
        throw new Error(`一部のデータの保存に失敗しました: ${errors}`);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '承認後のデータ保存中にエラーが発生しました';
      console.error(`エラー: ${message}`, error);
      throw error;
    }
  }

  private async calculateDifferences(
    validatedRows: ReturnType<typeof validateAllRows>,
  ): Promise<void> {
    this.differences = [];
    let idCounter = 1;

    // 承認待ちのリクエストを取得（承認待ちチェック用）
    const requests = await firstValueFrom(
      this.workflowService.requests$.pipe(take(1)),
    );

    // 各バリデーション済み行を処理
    for (const validatedRow of validatedRows) {
      const parsedRow = validatedRow.parsedRow;
      const rowErrors = validatedRow.errors.filter(
        (e) => e.severity === 'error',
      );

      // エラーがある行はスキップ
      if (rowErrors.length > 0) {
        continue;
      }

      // 差分計算を実行
      let diffResult = calculateDifferences(
        parsedRow,
        this.existingEmployees,
        this.templateType,
      );

      // payrollテンプレートの場合は給与データの差分も計算
      if (this.templateType === 'payroll' && diffResult.existingEmployee) {
        const employeeNo = parsedRow.data['社員番号'] || '';
        // 念のため、existingEmployeesのemployeeNoも正規化して比較する
        const normalizedEmployeeNo =
          normalizeEmployeeNoForComparison(employeeNo);
        const existingEmployee = this.existingEmployees.find(
          (emp) =>
            normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
            normalizedEmployeeNo,
        );
        if (existingEmployee?.id) {
          const payrollChanges = await this.calculatePayrollDifferences(
            parsedRow,
            existingEmployee.id,
          );
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
      const name =
        parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';

      // 2行目以降（扶養家族追加行）かどうかを判定
      const hasEmployeeInfo = !!(
        parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字']
      );
      const hasDependentInfo = !!(
        parsedRow.data['扶養 続柄'] ||
        parsedRow.data['扶養 氏名(漢字)'] ||
        parsedRow.data['扶養 氏名(カナ)']
      );
      const isDependentOnlyRow =
        !hasEmployeeInfo && hasDependentInfo && !!employeeNo;

      // 既存社員のIDを取得（正規化された社員番号で比較）
      // existingEmployeesのemployeeNoは既に正規化されているため、直接比較する
      const existingEmployeeId = diffResult.existingEmployee
        ? (this.existingEmployees.find(
            (emp) =>
              (emp.employeeNo || '') ===
              (diffResult.existingEmployee?.employeeNo || ''),
          )?.['id'] as string | undefined)
        : undefined;

      // 承認待ちリクエストのチェック（既存社員の場合のみ）
      let pendingRequestTitle: string | null = null;
      if (!diffResult.isNew && existingEmployeeId && employeeNo) {
        const pendingRequest = this.workflowService.getPendingRequestForEmployee(
          existingEmployeeId,
          employeeNo,
        );
        if (pendingRequest) {
          pendingRequestTitle = pendingRequest.title || '承認待ちの申請';
          // 承認待ちがある場合は警告エラーを追加
          const warningError: ValidationError = {
            rowIndex: parsedRow.rowIndex,
            fieldName: '承認待ち',
            message: `この社員には既に承認待ちの申請が存在します（${pendingRequestTitle}）。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。`,
            severity: 'warning',
            templateType: this.templateType,
            employeeNo,
            name,
          };
          this.errors.push(warningError);
        }
      }

      // 新規登録の場合も承認待ちチェック（社員番号でチェック）
      if (diffResult.isNew && employeeNo) {
        const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
        const pendingNewEmployeeRequest = requests.find((request) => {
          // 承認待ち状態でない場合はスキップ
          if (request.status !== 'pending') {
            return false;
          }

          // 新規社員登録のカテゴリのみチェック
          if (request.category !== '新規社員登録') {
            return false;
          }

          // employeeDiffsの社員番号をチェック（正規化して比較）
          const diffs = request.employeeDiffs || [];
          const hasDuplicateInDiffs = diffs.some(
            (diff) => normalizeEmployeeNoForComparison(diff.employeeNo || '') === normalizedEmployeeNo,
          );

          if (hasDuplicateInDiffs) {
            return true;
          }

          // employeeDataの社員番号もチェック（念のため）
          const requestEmployeeNo =
            request.employeeData?.basicInfo?.employeeNo;
          if (requestEmployeeNo && normalizeEmployeeNoForComparison(requestEmployeeNo) === normalizedEmployeeNo) {
            return true;
          }

          return false;
        });

        if (pendingNewEmployeeRequest) {
          pendingRequestTitle = pendingNewEmployeeRequest.title || '承認待ちの新規社員登録申請';
          // 承認待ちがある場合は警告エラーを追加
          const warningError: ValidationError = {
            rowIndex: parsedRow.rowIndex,
            fieldName: '承認待ち',
            message: `この社員番号は承認待ちの新規社員登録申請で既に使用されています（${pendingRequestTitle}）。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。`,
            severity: 'warning',
            templateType: this.templateType,
            employeeNo,
            name,
          };
          this.errors.push(warningError);
        }
      }

      // 変更サマリを作成
      const changeCount = diffResult.changes.length;
      let summary: string;
      if (isDependentOnlyRow) {
        // 2行目以降（扶養家族追加行）の場合は「扶養家族追加」と表示
        summary = '扶養家族追加';
      } else {
        summary = diffResult.isNew
          ? `新規登録（${changeCount}項目）`
          : changeCount > 0
            ? `${changeCount}項目変更`
            : '変更なし';
      }

      // ステータスを決定
      let status: ImportStatus = 'ok';
      if (isDependentOnlyRow) {
        // 扶養家族追加行は常にOK
        status = 'ok';
      } else if (diffResult.isNew) {
        // 新規登録の場合、承認待ちがある場合は警告
        status = pendingRequestTitle ? 'warning' : 'ok';
      } else if (changeCount === 0) {
        status = 'warning'; // 変更なしの場合は警告
      } else {
        // 更新の場合、承認待ちがある場合は警告
        status = pendingRequestTitle ? 'warning' : 'ok';
      }

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

  private async calculatePayrollDifferences(
    parsedRow: ParsedRow,
    employeeId: string,
  ): Promise<ChangeField[]> {
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

      let existingBonusPayments: BonusPayment[] = [];
      try {
        existingBonusPayments = await firstValueFrom(
          this.employeesService
            .getBonusPayments(employeeId, normalizedYearMonth)
            .pipe(take(1)),
        );
      } catch {
        existingBonusPayments = [];
      }
      const findExistingBonusByDate = (
        paidOn: string | undefined,
      ): BonusPayment | undefined => {
        if (!paidOn) return undefined;
        const normalizedTarget = paidOn.replace(/\//g, '-').split('T')[0];
        return existingBonusPayments.find((bonus) => {
          const normalizedExisting = (bonus.bonusPaidOn ?? '')
            .replace(/\//g, '-')
            .split('T')[0];
          return normalizedExisting === normalizedTarget;
        });
      };

      // 月給支払月の差分
      const existingYearMonth = existingPayroll?.yearMonth;
      const csvYearMonthDisplay = monthlyPayMonth; // YYYY/MM形式のまま表示
      const existingYearMonthDisplay = existingYearMonth
        ? existingYearMonth.replace(/-/g, '/')
        : null;
      if (existingYearMonth !== normalizedYearMonth) {
        changes.push({
          fieldName: '月給支払月',
          oldValue: existingYearMonthDisplay,
          newValue: csvYearMonthDisplay,
        });
      }

      // 月給支払額の差分（月の情報を含める）
      if (monthlyPayAmount) {
        const csvAmount = Number(monthlyPayAmount.replace(/,/g, ''));
        const existingAmount = existingPayroll?.amount;
        if (existingAmount === undefined || existingAmount !== csvAmount) {
          changes.push({
            fieldName: `月給支払額（${csvYearMonthDisplay}）`,
            oldValue:
              existingAmount !== undefined ? String(existingAmount) : null,
            newValue: String(csvAmount),
          });
        }
      }

      // 支払基礎日数の差分（月の情報を含める）
      if (workedDays) {
        const csvDays = Number(workedDays.replace(/,/g, ''));
        const existingDays = existingPayroll?.workedDays;
        if (existingDays === undefined || existingDays !== csvDays) {
          changes.push({
            fieldName: `支払基礎日数（${csvYearMonthDisplay}）`,
            oldValue: existingDays !== undefined ? String(existingDays) : null,
            newValue: String(csvDays),
          });
        }
      }

      // 賞与総支給額の差分（月の情報を含める）
      if (bonusTotal) {
        const csvBonus = Number(bonusTotal.replace(/,/g, ''));
        // 支給日一致のBonusPaymentのみを参照（existingPayrollのフォールバックは使用しない）
        const existingBonus = findExistingBonusByDate(bonusPaidOn)?.bonusTotal;
        if (existingBonus === undefined || existingBonus !== csvBonus) {
          changes.push({
            fieldName: `賞与総支給額（${csvYearMonthDisplay}）`,
            oldValue:
              existingBonus !== undefined ? String(existingBonus) : null,
            newValue: String(csvBonus),
          });
        }
      }

      // 賞与支給日の差分（月の情報を含める）
      if (bonusPaidOn) {
        const normalizedBonusDate = bonusPaidOn.replace(/\//g, '-');
        // 支給日一致のBonusPaymentのみを参照（existingPayrollのフォールバックは使用しない）
        const existingBonusDate = findExistingBonusByDate(bonusPaidOn)?.bonusPaidOn;
        if (existingBonusDate !== normalizedBonusDate) {
          changes.push({
            fieldName: `賞与支給日（${csvYearMonthDisplay}）`,
            oldValue: existingBonusDate || null,
            newValue: normalizedBonusDate,
          });
        }
      }

      // 健康保険・厚生年金一時免除フラグの差分（月の情報を含める）
      const exemptionFlagRaw = csvData['健康保険・厚生年金一時免除フラグ'];
      if (exemptionFlagRaw !== undefined && exemptionFlagRaw !== null && exemptionFlagRaw !== '') {
        const csvExemptionFlag = (() => {
          const normalized = String(exemptionFlagRaw).trim().toLowerCase();
          return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '有';
        })();
        const existingExemptionFlag = existingPayroll?.exemption ?? false;
        if (existingExemptionFlag !== csvExemptionFlag) {
          changes.push({
            fieldName: `健康保険・厚生年金一時免除フラグ（${csvYearMonthDisplay}）`,
            oldValue: existingExemptionFlag ? '1' : '0',
            newValue: csvExemptionFlag ? '1' : '0',
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
        const bonusYearMonthDisplay = `${year}/${month}`; // YYYY/MM形式で表示

        // 既存の給与データを取得
        let existingPayroll: PayrollData | undefined;
        try {
          existingPayroll = await firstValueFrom(
            this.employeesService.getPayroll(employeeId, normalizedYearMonth),
          );
        } catch {
          // データが存在しない場合はundefinedのまま
        }
        let existingBonusPayments: BonusPayment[] = [];
        try {
          existingBonusPayments = await firstValueFrom(
            this.employeesService
              .getBonusPayments(employeeId, normalizedYearMonth)
              .pipe(take(1)),
          );
        } catch {
          existingBonusPayments = [];
        }
        const findExistingBonusByDate = (
          paidOn: string | undefined,
        ): BonusPayment | undefined => {
          if (!paidOn) return undefined;
          const normalizedTarget = paidOn.replace(/\//g, '-').split('T')[0];
          return existingBonusPayments.find((bonus) => {
            const normalizedExisting = (bonus.bonusPaidOn ?? '')
              .replace(/\//g, '-')
              .split('T')[0];
            return normalizedExisting === normalizedTarget;
          });
        };

        // 賞与総支給額の差分（月の情報を含める）
        if (bonusTotal) {
          const csvBonus = Number(bonusTotal.replace(/,/g, ''));
          // 支給日一致のBonusPaymentのみを参照（existingPayrollのフォールバックは使用しない）
          const existingBonus = findExistingBonusByDate(bonusPaidOn)?.bonusTotal;
          if (existingBonus === undefined || existingBonus !== csvBonus) {
            changes.push({
              fieldName: `賞与総支給額（${bonusYearMonthDisplay}）`,
              oldValue:
                existingBonus !== undefined ? String(existingBonus) : null,
              newValue: String(csvBonus),
            });
          }
        }

        // 賞与支給日の差分（月の情報を含める）
        const normalizedBonusDate = bonusPaidOn.replace(/\//g, '-');
        // 支給日一致のBonusPaymentのみを参照（existingPayrollのフォールバックは使用しない）
        const existingBonusDate = findExistingBonusByDate(bonusPaidOn)?.bonusPaidOn;
        if (existingBonusDate !== normalizedBonusDate) {
          changes.push({
            fieldName: `賞与支給日（${bonusYearMonthDisplay}）`,
            oldValue: existingBonusDate || null,
            newValue: normalizedBonusDate,
          });
        }
      }
    }

    return changes;
  }

  downloadNewEmployeeTemplate(): void {
    // 複数の扶養家族がある場合は、同じ社員番号で複数行に分けて記入する形式
    const headers = [
      '社員番号',
      '氏名(漢字)',
      '氏名(カナ)',
      '性別',
      '生年月日',
      '郵便番号',
      '住民票住所',
      '現住所',
      '所属部署名',
      '勤務地都道府県名',
      '個人番号',
      '基礎年金番号',
      '健保標準報酬月額',
      '厚年標準報酬月額',
      '被保険者番号（健康保険)',
      '被保険者番号（厚生年金）',
      '健康保険 資格取得日',
      '厚生年金 資格取得日',
      '介護保険第2号被保険者フラグ',
      '現在の休業状態',
      '現在の休業開始日',
      '現在の休業予定終了日',
      '扶養の有無',
      '扶養 続柄',
      '扶養 氏名(漢字)',
      '扶養 氏名(カナ)',
      '扶養 生年月日',
      '扶養 性別',
      '扶養 個人番号',
      '扶養 基礎年金番号',
      '扶養 同居区分',
      '扶養 住所（別居の場合のみ入力）',
      '扶養 職業',
      '扶養 年収（見込みでも可）',
      '扶養 被扶養者になった日',
      '扶養 国民年金第3号被保険者該当フラグ',
    ];

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
      '',
      '',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
      '0/1/true/false',
      'なし/産前産後/育児',
      'YYYY/MM/DD',
      'YYYY/MM/DD',
      '有/無/0/1/true/false',
      '',
      '',
      '',
      'YYYY/MM/DD',
      '男/女',
      '',
      '',
      '同居/別居',
      '別居の場合のみ入力',
      '',
      '数値',
      'YYYY/MM/DD',
      '0/1/true/false',
    ];

    // CSVコンテンツを作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent =
      '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';

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
      '健康保険・厚生年金一時免除フラグ',
    ];

    // 1行目：各項目の入力制限（カラムごとに対応）
    const restrictions = ['(必須)', '(必須)', '', '', '', '', '', ''];

    // CSVコンテンツを作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent =
      '\uFEFF' + restrictions.join(',') + '\n' + headers.join(',') + '\n';

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

  downloadErrorReport(): void {
    if (this.errors.length === 0) {
      alert('エラーがありません。');
      return;
    }

    // CSVヘッダー
    const headers = ['行番号', '社員番号', '氏名', '項目名', 'エラー内容'];

    // CSVエスケープ関数
    const escapeForCsv = (value: string | null | undefined): string => {
      if (value === null || value === undefined) {
        return '';
      }
      const str = String(value);
      // カンマ、ダブルクォート、改行を含む場合はダブルクォートで囲む
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // エラーデータを行に変換
    const rows = this.errors.map((error) => [
      escapeForCsv(String(error.rowIndex || '')),
      escapeForCsv(error.employeeNo || ''),
      escapeForCsv(error.name || ''),
      escapeForCsv(error.fieldName || ''),
      escapeForCsv(error.message || ''),
    ]);

    // CSVコンテンツを作成（UTF-8 BOM付きでExcel互換性を確保）
    const csvContent =
      '\uFEFF' +
      headers.join(',') +
      '\n' +
      rows.map((row) => row.join(',')).join('\n');

    // Blobオブジェクトを作成（UTF-8、LF改行）
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // ダウンロードリンクを作成
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    link.setAttribute('href', url);
    link.setAttribute('download', `エラーレポート_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  private hasDependentData(dep: Partial<DependentData>): boolean {
    return Object.values(dep).some(
      (value) =>
        value !== '' &&
        value !== null &&
        value !== false &&
        value !== undefined,
    );
  }

  private async syncDependents(
    employeeId: string,
    hasDependent: boolean | undefined,
    dependents: DependentData[],
  ): Promise<void> {
    const filteredDependents = dependents.filter((dep) =>
      this.hasDependentData(dep),
    );
    const shouldSkip =
      hasDependent === undefined && filteredDependents.length === 0;

    if (shouldSkip) {
      return;
    }

    // 「扶養の有無」がfalseの場合は既存の扶養情報をすべて削除
    if (hasDependent === false) {
      const existingDependents = await firstValueFrom(
        this.employeesService.getDependents(employeeId).pipe(take(1)),
      );
      for (const existing of existingDependents) {
        if (existing.id) {
          await this.employeesService.deleteDependent(employeeId, existing.id);
        }
      }
      return;
    }

    // CSVに扶養情報がある場合、既存の扶養情報を取得して比較
    const existingDependents = await firstValueFrom(
      this.employeesService.getDependents(employeeId).pipe(take(1)),
    );

    // CSVの扶養情報を処理（既存のものは更新、新しいものは追加）
    for (const dependentData of filteredDependents) {
      // 氏名(漢字)で既存の扶養情報を検索
      const csvNameKanji = dependentData.nameKanji?.trim() || '';
      let matchedExisting: DependentData | undefined;

      if (csvNameKanji) {
        const normalizedCsvName = normalizeNameForComparison(csvNameKanji);
        matchedExisting = existingDependents.find((existing) => {
          if (!existing.nameKanji) return false;
          const normalizedExistingName = normalizeNameForComparison(
            existing.nameKanji,
          );
          return normalizedExistingName === normalizedCsvName;
        });
      }

      if (matchedExisting && matchedExisting.id) {
        // 既存の扶養情報を更新
        await this.employeesService.addOrUpdateDependent(
          employeeId,
          dependentData,
          matchedExisting.id,
        );
      } else {
        // 新しい扶養情報を追加
        await this.employeesService.addOrUpdateDependent(
          employeeId,
          dependentData,
        );
      }
    }
  }
  ngOnDestroy(): void {
    this.approvalSubscription?.unsubscribe();
  }
}
