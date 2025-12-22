import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of, switchMap, takeUntil, firstValueFrom, combineLatest } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService, PayrollData, DependentData } from '../app/services/shaho-employees.service';
import { AuthService } from '../auth/auth.service';
import { RoleKey } from '../models/roles';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { ApprovalRequest, ApprovalHistory, ApprovalRequestStatus, ApprovalFlow, ApprovalEmployeeDiff, ApprovalAttachmentMetadata, ApprovalNotification } from '../models/approvals';
import { UserDirectoryService, AppUser } from '../auth/user-directory.service';
import { ApprovalAttachmentService } from '../approvals/approval-attachment.service';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { FlowSelectorComponent } from '../approvals/flow-selector/flow-selector.component';

interface AuditInfo {
  registeredAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  approvedBy: string;
}

interface SocialInsuranceInfo {
  healthStandardMonthly: number | null;
  welfareStandardMonthly: number | null;
  standardBonusAnnualTotal: number | null;
  healthInsuredNumber: string;
  pensionInsuredNumber: string;
  careSecondInsured: boolean;
  healthAcquisition: string;
  pensionAcquisition: string;
  currentLeaveStatus: string;
  currentLeaveStartDate: string;
  currentLeaveEndDate: string;
  exemption: boolean;
}

interface DependentInfo {
  relationship: string;
  nameKanji: string;
  nameKana: string;
  birthDate: string;
  gender: string;
  personalNumber: string;
  basicPensionNumber: string;
  cohabitationType: string;
  address: string;
  occupation: string;
  annualIncome: number | null;
  dependentStartDate: string;
  thirdCategoryFlag: boolean;
}


interface HistoryRecord {
  id: string;
  changedAt: string;
  field: string;
  oldValue: string;
  newValue: string;
  actor: string;
  approver: string;
  groupId: string;
}

type ApprovalHistoryEntry = {
  requestId: string;
  requestTitle: string;
  category: string;
  actionLabel: string;
  statusLabel: string;
  actor: string;
  comment: string;
  createdAt: Date;
};

interface SocialInsuranceHistoryData {
  monthlySalary?: number;
  workedDays?: number;
  healthStandardMonthly?: number;
  welfareStandardMonthly?: number;
  healthInsuranceMonthly?: number;
  careInsuranceMonthly?: number;
  pensionMonthly?: number;
  bonusPaidOn?: string;
  bonusTotal?: number;
  standardBonus?: number; // 後方互換性のため残す
  standardHealthBonus?: number; // 標準賞与額（健・介）
  standardWelfareBonus?: number; // 標準賞与額（厚生年金）
  healthInsuranceBonus?: number;
  careInsuranceBonus?: number;
  pensionBonus?: number;
}

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIf, NgFor, DatePipe, FlowSelectorComponent],
  templateUrl: './employee-detail.component.html',
  styleUrl: './employee-detail.component.scss',
})
export class EmployeeDetailComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private employeesService = inject(ShahoEmployeesService);
    private authService = inject(AuthService);
    private workflowService = inject(ApprovalWorkflowService);
    private userDirectory = inject(UserDirectoryService);
    readonly attachmentService = inject(ApprovalAttachmentService);
    private notificationService = inject(ApprovalNotificationService);
    private destroy$ = new Subject<void>();
  deleteSubscription: any;
  tabs = [
    { key: 'basic', label: '基本情報' },
    { key: 'insurance', label: '社会保険情報' },
    { key: 'insurance-history', label: '給与/賞与/社会保険料履歴' },
    { key: 'dependent', label: '扶養情報' },
    { key: 'history', label: '変更履歴' },
  ];

  selectedTab = 'basic';
  showApprovalHistory = false;
  canDelete = true;
  applicantId = '';
  applicantName = '';
  approvalHistoryEntries: ApprovalHistoryEntry[] = [];
  private cachedApprovalRequests: ApprovalRequest[] = [];
  private cachedUsers: AppUser[] = [];
  approvalFlows: ApprovalFlow[] = [];
  selectedDeleteFlow: ApprovalFlow | null = null;
  selectedDeleteFlowId: string | null = null;
  showDeletePanel = false;
  deleteComment = '';
  selectedFiles: File[] = [];
  validationErrors: string[] = [];
  deleteMessage = '';
  isDeleting = false;

  isLoading = true;
  notFound = false;

  employee: ShahoEmployee | null = null;

  basicInfo = {
    gender: '',
    birthDate: '',
    postalCode: '',
    address: '',
    currentAddress: '',
    workPrefecture: '',
    personalNumber: '',
    basicPensionNumber: '',
    hasDependent: false,
  };

  auditInfo: AuditInfo = {
    registeredAt: '2024-01-12 09:18',
    updatedAt: '2025-02-03 15:24',
    createdBy: 'admin01',
    updatedBy: 'approver02',
    approvedBy: 'manager03',
  };

  socialInsurance: SocialInsuranceInfo = {
    healthStandardMonthly: null,
    welfareStandardMonthly: null,
    standardBonusAnnualTotal: null,
    healthInsuredNumber: '',
    pensionInsuredNumber: '',
    careSecondInsured: false,
    healthAcquisition: '',
    pensionAcquisition: '',
    currentLeaveStatus: '',
    currentLeaveStartDate: '',
    currentLeaveEndDate: '',
    exemption: false,
  };

  dependentInfos: DependentInfo[] = [];

  insuranceHistoryFilter = {
    start: this.formatMonthForInput(this.addMonths(new Date(), -12)),
    end: this.formatMonthForInput(new Date()),
    mode: 'all' as 'all' | 'without-bonus' | 'bonus-only',
  };

  displayedMonths: Date[] = [];
  socialInsuranceHistory: Record<string, SocialInsuranceHistoryData> = {};
  allPayrolls: PayrollData[] = [];
  historyRowDefinitions: {
    key: keyof SocialInsuranceHistoryData;
    label: string;
    category: 'monthly' | 'bonus';
  }[] = [
    { key: 'monthlySalary', label: '月給支払額', category: 'monthly' },
    { key: 'workedDays', label: '支払基礎日数', category: 'monthly' },
    { key: 'healthInsuranceMonthly', label: '健康保険（月給）', category: 'monthly' },
    { key: 'careInsuranceMonthly', label: '介護保険（月給）', category: 'monthly' },
    { key: 'pensionMonthly', label: '厚生年金（月給）', category: 'monthly' },
    { key: 'bonusPaidOn', label: '賞与支給日', category: 'bonus' },
    { key: 'bonusTotal', label: '賞与総支給額', category: 'bonus' },
    { key: 'standardHealthBonus', label: '標準賞与額（健・介）', category: 'bonus' },
    { key: 'standardWelfareBonus', label: '標準賞与額（厚生年金）', category: 'bonus' },
    { key: 'healthInsuranceBonus', label: '健康保険（賞与）', category: 'bonus' },
    { key: 'careInsuranceBonus', label: '介護保険（賞与）', category: 'bonus' },
    { key: 'pensionBonus', label: '厚生年金（賞与）', category: 'bonus' },
  ];


  historyFilters = {
    from: '',
    to: '',
    field: '',
    actor: '',
  };

  historyFields = [
    '所属部署',
    '標準報酬月額',
    '標準賞与額',
    '健康保険加入区分',
    '介護保険第2号被保険者',
  ];

  changeHistoryRecords: HistoryRecord[] = [];
  groupedHistory: HistoryRecord[] = [];

  readonly canManage$ = this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Approver, RoleKey.Operator]);

  ngOnInit(): void {
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.applicantId = user?.email?.toLowerCase() || '';
      this.applicantName = user?.displayName || this.applicantId;
    });
    this.workflowService.flows$.pipe(takeUntil(this.destroy$)).subscribe((flows) => {
      this.approvalFlows = flows || [];
      this.selectedDeleteFlow = this.approvalFlows[0] ?? null;
      this.selectedDeleteFlowId = this.selectedDeleteFlow?.id ?? null;
    });
    this.refreshDisplayedMonths();
    combineLatest([this.workflowService.requests$, this.userDirectory.getUsers()])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([requests, users]) => {
        this.cachedApprovalRequests = requests;
        this.cachedUsers = users;
        this.rebuildApprovalHistory();
        this.rebuildChangeHistory();
        // ユーザー情報が更新されたら、監査情報の表示名も更新
        if (this.employee) {
          this.updateAuditInfoDisplayNames();
        }
      });

    this.route.paramMap
      .pipe(
        takeUntil(this.destroy$),
        switchMap((params) => {
          const id = params.get('id');
          if (!id) {
            this.isLoading = false;
            this.notFound = true;
            return of(null);
          }
          this.isLoading = true;
          return this.employeesService.getEmployeeById(id);
        }),
      )
      .subscribe((employee) => {
        this.isLoading = false;
        if (employee) {
          this.notFound = false;
          this.applyEmployeeData(employee);
          if (employee.id) {
            this.loadPayrollHistory(employee.id);
          }
          this.rebuildApprovalHistory();
          this.rebuildChangeHistory();
        } else {
          this.employee = null;
          this.notFound = true;
          this.approvalHistoryEntries = [];
          this.changeHistoryRecords = [];
        }
      });
  }

  ngOnDestroy(): void {
    if (this.deleteSubscription) {
      this.deleteSubscription.unsubscribe();
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  changeTab(key: string) {
    this.selectedTab = key;
  }

  navigateToEdit() {
    if (this.employee?.id) {
      this.router.navigate(['/employees', this.employee.id, 'edit']);
    }
  }

  get formattedAddress(): string {
    const postal = this.basicInfo.postalCode?.trim();
    const address = this.basicInfo.address?.trim();

    if (postal && address) return `〒${postal} ${address}`;
    if (postal) return `〒${postal}`;
    if (address) return address;
    return '';
  }

  get formattedCurrentAddress(): string {
    const currentAddress = this.basicInfo.currentAddress?.trim();
    return currentAddress || '';
  }

  displayAmount(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `${value.toLocaleString()} 円`;
  }

  updateInsuranceHistoryRange(field: 'start' | 'end', value: string) {
    this.insuranceHistoryFilter = { ...this.insuranceHistoryFilter, [field]: value };
    this.refreshDisplayedMonths();
  }

  changeDisplayMode(mode: 'all' | 'without-bonus' | 'bonus-only') {
    this.insuranceHistoryFilter = { ...this.insuranceHistoryFilter, mode };
  }

  get visibleHistoryRows() {
    if (this.insuranceHistoryFilter.mode === 'bonus-only') {
      return this.historyRowDefinitions.filter((row) => row.category === 'bonus');
    }
    if (this.insuranceHistoryFilter.mode === 'without-bonus') {
      return this.historyRowDefinitions.filter((row) => row.category === 'monthly');
    }
    return this.historyRowDefinitions;
  }

  getHistoryValue(month: Date, key: keyof SocialInsuranceHistoryData) {
    const record = this.socialInsuranceHistory[this.getMonthKey(month)];
    const value = record?.[key];
    if (value === undefined || value === null || value === '') {
      return '—';
    }
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    // 賞与支給日の場合は YYYY/MM/DD 形式にフォーマット
    if (key === 'bonusPaidOn' && typeof value === 'string') {
      return this.formatDateForDisplay(value);
    }
    return value;
  }

  private refreshDisplayedMonths() {
    const start = this.parseMonthInput(this.insuranceHistoryFilter.start);
    const end = this.parseMonthInput(this.insuranceHistoryFilter.end);

    if (!start || !end) {
      this.displayedMonths = [];
      return;
    }

    let [effectiveStart, effectiveEnd] = start <= end ? [start, end] : [end, start];

    const threeYearsAgo = this.addMonths(effectiveEnd, -35);
    if (effectiveStart < threeYearsAgo) {
      effectiveStart = threeYearsAgo;
    }

    const months: Date[] = [];
    let cursor = new Date(effectiveStart);
    while (cursor <= effectiveEnd) {
      months.push(new Date(cursor));
      cursor = this.addMonths(cursor, 1);
    }
    this.displayedMonths = months;
  }


  get filteredHistory() {
    return this.changeHistoryRecords.filter((record) => {
      const date = record.changedAt.slice(0, 10);
      if (this.historyFilters.from && date < this.historyFilters.from) return false;
      if (this.historyFilters.to && date > this.historyFilters.to) return false;
      if (this.historyFilters.field && !record.field.includes(this.historyFilters.field))
        return false;
      if (
        this.historyFilters.actor &&
        !record.actor.includes(this.historyFilters.actor)
      ) {
        return false;
      }
      return true;
    });
  }

  openHistoryGroup(groupId: string) {
    this.groupedHistory = this.changeHistoryRecords.filter(
      (item) => item.groupId === groupId,
    );
  }

  closeHistoryGroup() {
    this.groupedHistory = [];
  }

  requestDelete() {
    console.log('requestDelete called', { employee: this.employee, canDelete: this.canDelete });
    if (!this.employee?.id || !this.employee.employeeNo) {
      alert('社員情報が読み込まれていません。');
      return;
    }
    console.log('Opening delete panel');
    this.showDeletePanel = true;
    this.deleteComment = '';
    this.selectedFiles = [];
    this.validationErrors = [];
  }

  cancelDelete() {
    this.showDeletePanel = false;
    this.deleteComment = '';
    this.selectedFiles = [];
    this.validationErrors = [];
  }

  onDeleteFlowSelected(flow: ApprovalFlow | undefined) {
    this.selectedDeleteFlow = flow ?? null;
    this.selectedDeleteFlowId = flow?.id ?? null;
  }

  onDeleteFlowsUpdated(flows: ApprovalFlow[]) {
    this.approvalFlows = flows;
    if (!this.selectedDeleteFlowId && flows[0]?.id) {
      this.selectedDeleteFlowId = flows[0].id;
      this.selectedDeleteFlow = flows[0];
    }
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

  async submitDeleteApproval(): Promise<void> {
    if (!this.employee?.id || !this.employee.employeeNo) {
      alert('社員情報が読み込まれていません。');
      return;
    }
    if (!this.selectedDeleteFlow || !this.selectedDeleteFlowId) {
      alert('承認ルートを選択してください。');
      return;
    }

    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;

    if (!validation.valid && this.selectedFiles.length) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
      return;
    }

    this.isDeleting = true;
    this.deleteMessage = '';

    try {
      const steps = this.selectedDeleteFlow.steps.map((step) => ({
        stepOrder: step.order,
        status: 'waiting' as const,
      }));

      const employeeDiffs: ApprovalEmployeeDiff[] = [
        {
          employeeNo: this.employee.employeeNo,
          name: this.employee.name ?? '',
          status: 'ok',
          existingEmployeeId: this.employee.id,
          changes: [
            {
              field: '社員削除',
              oldValue: '登録済み',
              newValue: '削除予定',
            },
          ],
        },
      ];

      const createdAt = new Date();
      const dueDate = new Date(createdAt);
      dueDate.setDate(dueDate.getDate() + 14);

      const request: ApprovalRequest = {
        title: `社員削除（${this.employee.name ?? this.employee.employeeNo}）`,
        category: '社員削除',
        targetCount: 1,
        applicantId: this.applicantId,
        applicantName: this.applicantName || this.applicantId,
        flowId: this.selectedDeleteFlow.id ?? 'employee-delete-flow',
        flowSnapshot: this.selectedDeleteFlow,
        status: 'pending',
        currentStep: this.selectedDeleteFlow.steps[0]?.order,
        comment: this.deleteComment || '社員削除の承認をお願いします。',
        steps,
        histories: [],
        attachments: [],
        employeeDiffs,
        createdAt: Timestamp.fromDate(createdAt),
        dueDate: Timestamp.fromDate(dueDate),
      };

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
        comment: this.deleteComment || undefined,
        attachments: uploaded,
        createdAt: Timestamp.fromDate(new Date()),
      };

      const completeRequest: ApprovalRequest = {
        ...savedBase,
        attachments: uploaded,
        histories: [applyHistory],
        employeeDiffs: savedBase.employeeDiffs || employeeDiffs,
      };

      const result = await this.workflowService.startApprovalProcess({
        request: completeRequest,
        onApproved: async () => {
          await this.employeesService.deleteEmployee(this.employee!.id!);
          this.deleteMessage = '承認完了により社員を削除しました。';
          this.showDeletePanel = false;
          await this.router.navigate(['/employees']);
        },
        onFailed: () => {
          this.deleteMessage = '承認が完了しませんでした。内容を確認してください。';
        },
        setMessage: (message) => (this.deleteMessage = message),
        setLoading: (loading) => (this.isDeleting = loading),
      });

      if (result) {
        this.deleteMessage = '削除申請を送信しました。承認完了後に削除されます。';
        if (this.deleteSubscription) {
          this.deleteSubscription.unsubscribe();
        }
        this.deleteSubscription = result.subscription;
        // 承認者に通知を送信
        if (completeRequest.id) {
          this.pushApprovalNotifications(completeRequest, completeRequest.id);
        }
        this.showDeletePanel = false;
        this.selectedFiles = [];
        this.validationErrors = [];
        this.deleteComment = '';
      }
    } catch (error) {
      console.error('削除申請の起票に失敗しました', error);
      alert('削除申請の起票に失敗しました。時間をおいて再度お試しください。');
    } finally {
      this.isDeleting = false;
    }
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private loadPayrollHistory(employeeId: string) {
    this.employeesService
      .getPayrolls(employeeId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((payrolls) => {
        // 給与データを保存（年度累計計算用）
        this.allPayrolls = payrolls;
        
        const history: Record<string, SocialInsuranceHistoryData> = {};

        payrolls.forEach((payroll) => {
          const monthKey = this.formatYearMonthKey(payroll.yearMonth);
          if (!monthKey) return;

          // 月給データをyearMonthの月に格納
          const monthlyData: SocialInsuranceHistoryData = {
            monthlySalary: payroll.amount,
            workedDays: payroll.workedDays,
            ...(payroll.healthStandardMonthly !== undefined && payroll.healthStandardMonthly !== null
              ? { healthStandardMonthly: payroll.healthStandardMonthly }
              : {}),
            ...(payroll.welfareStandardMonthly !== undefined && payroll.welfareStandardMonthly !== null
              ? { welfareStandardMonthly: payroll.welfareStandardMonthly }
              : {}),
            healthInsuranceMonthly: payroll.healthInsuranceMonthly,
            careInsuranceMonthly: payroll.careInsuranceMonthly,
            pensionMonthly: payroll.pensionMonthly,
          };

          // 既存のデータとマージ
          if (history[monthKey]) {
            history[monthKey] = { ...history[monthKey], ...monthlyData };
          } else {
            history[monthKey] = monthlyData;
          }

          // 賞与データがある場合、賞与支給日の月に格納
          if (payroll.bonusPaidOn) {
            const bonusDate = new Date(payroll.bonusPaidOn.replace(/\//g, '-'));
            if (!isNaN(bonusDate.getTime())) {
              const bonusYear = bonusDate.getFullYear();
              const bonusMonthNum = bonusDate.getMonth() + 1; // 1-12
              const bonusMonth = String(bonusMonthNum).padStart(2, '0');
              const bonusMonthKey = `${bonusYear}-${bonusMonth}`;

              const standardBonusValue = payroll.standardHealthBonus || payroll.standardWelfareBonus || payroll.standardBonus;
              const bonusData: SocialInsuranceHistoryData = {
                bonusPaidOn: this.formatDateForInput(payroll.bonusPaidOn),
                bonusTotal: payroll.bonusTotal,
                ...(payroll.standardHealthBonus !== undefined && payroll.standardHealthBonus !== null
                  ? { standardHealthBonus: payroll.standardHealthBonus }
                  : {}),
                ...(payroll.standardWelfareBonus !== undefined && payroll.standardWelfareBonus !== null
                  ? { standardWelfareBonus: payroll.standardWelfareBonus }
                  : {}),
                // 後方互換性のため、standardBonusも設定（standardHealthBonusまたはstandardWelfareBonusのいずれか）
                ...(standardBonusValue !== undefined && standardBonusValue !== null
                  ? { standardBonus: standardBonusValue }
                  : {}),
                healthInsuranceBonus: payroll.healthInsuranceBonus,
                careInsuranceBonus: payroll.careInsuranceBonus,
                pensionBonus: payroll.pensionBonus,
              };

              // 既存のデータとマージ
              if (history[bonusMonthKey]) {
                history[bonusMonthKey] = { ...history[bonusMonthKey], ...bonusData };
              } else {
                history[bonusMonthKey] = bonusData;
              }
            }
          }
        });

        this.socialInsuranceHistory = history;
      });
  }

  private formatYearMonthKey(yearMonth: string | undefined): string | null {
    if (!yearMonth) return null;

    const parsed = this.parseMonthInput(yearMonth);
    return parsed ? this.formatMonthForInput(parsed) : null;
  }


  private parseMonthInput(value: string): Date | null {
    if (!/^\d{4}-\d{2}$/.test(value)) {
      return null;
    }
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1, 1);
  }

  private formatMonthForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private getMonthKey(date: Date): string {
    return this.formatMonthForInput(date);
  }

  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * 日付をYYYY-MM-DD形式に変換（input type="date"用）
   */
  private formatDateForInput(date: string | Date | undefined): string {
    if (!date) return '';
    
    // 既にYYYY-MM-DD形式の文字列の場合はそのまま返す
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    
    // Dateオブジェクトまたは日付文字列を変換
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 日付をYYYY/MM/DD形式に変換（表示用）
   */
  formatDateForDisplay(date: string | Date | undefined): string {
    if (!date) return '';
    
    // YYYY-MM-DD または YYYY/MM/DD 形式を YYYY/MM/DD に統一
    const normalized = typeof date === 'string' ? date.replace(/\//g, '-') : '';
    const d = typeof date === 'string' ? new Date(normalized) : date;
    if (isNaN(d.getTime())) return typeof date === 'string' ? date : '';
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  /**
   * 日付文字列をDateオブジェクトに変換（calculation-data.service.tsと同じロジック）
   */
  private toBonusDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * 基準日から年度範囲を計算（年月日のみで比較するため、ローカル時間を使用）
   */
  private getFiscalYearRange(baseDate: Date) {
    const month = baseDate.getMonth() + 1; // ローカル時間を使用
    const baseYear = baseDate.getFullYear();
    const fiscalYearStartYear = month >= 4 ? baseYear : baseYear - 1;

    // ローカル時間で日付を作成（時刻部分は0時0分0秒と23時59分59秒に設定）
    const start = new Date(fiscalYearStartYear, 3, 1, 0, 0, 0, 0); // 4月1日 00:00:00
    const end = new Date(fiscalYearStartYear + 1, 2, 31, 23, 59, 59, 999); // 3月31日 23:59:59.999
    return { start, end };
  }

  /**
   * 年度内の賞与データを取得
   */
  private getFiscalYearBonuses(payrolls: PayrollData[], bonusDate?: Date) {
    if (!bonusDate) return [] as PayrollData[];
    const { start, end } = this.getFiscalYearRange(bonusDate);

    return payrolls.filter((payroll) => {
      const paidOn = this.toBonusDate(payroll.bonusPaidOn);
      if (!paidOn) return false;
      
      // 年月日のみで比較（時刻部分を無視）
      const paidOnDate = new Date(paidOn.getFullYear(), paidOn.getMonth(), paidOn.getDate());
      const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      
      return paidOnDate >= startDate && paidOnDate <= endDate;
    });
  }

  /**
   * 賞与支給日が属する年度を計算
   */
  private getFiscalYearForDate(date: Date): { start: Date; end: Date } {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const fiscalYearStartYear = month >= 4 ? year : year - 1;

    const start = new Date(fiscalYearStartYear, 3, 1, 0, 0, 0, 0); // 4月1日 00:00:00
    const end = new Date(fiscalYearStartYear + 1, 2, 31, 23, 59, 59, 999); // 3月31日 23:59:59.999
    return { start, end };
  }

  /**
   * 標準賞与額年度累計を計算
   * 各賞与の支給日（bonusPaidOn）を基準に年度を計算して集計する
   */
  private calculateStandardBonusAnnualTotal(): number {
    if (!this.allPayrolls || this.allPayrolls.length === 0) {
      return 0;
    }

    // 各賞与の支給日を基準に年度を計算して合計
    return this.allPayrolls
      .filter((payroll) => {
        if (!payroll.bonusPaidOn || payroll.standardBonus === undefined) {
          return false;
        }

        const paidOn = this.toBonusDate(payroll.bonusPaidOn);
        if (!paidOn) return false;

        return true;
      })
      .reduce((sum, record) => {
        const paidOn = this.toBonusDate(record.bonusPaidOn!);
        if (!paidOn) return sum;

        // 各賞与の支給日（bonusPaidOn）を基準に年度を計算
        const fiscalYear = this.getFiscalYearForDate(paidOn);
        const startDate = new Date(fiscalYear.start.getFullYear(), fiscalYear.start.getMonth(), fiscalYear.start.getDate());
        const endDate = new Date(fiscalYear.end.getFullYear(), fiscalYear.end.getMonth(), fiscalYear.end.getDate());
        
        // 支給日がその年度の範囲内かチェック
        const paidOnDate = new Date(paidOn.getFullYear(), paidOn.getMonth(), paidOn.getDate());
        
        if (paidOnDate >= startDate && paidOnDate <= endDate) {
          return sum + (record.standardBonus ?? 0);
        }
        
        return sum;
      }, 0);
  }

  /**
   * 標準賞与額年度累計の表示値（手動入力値があれば優先、なければ計算値）
   */
  get displayedStandardBonusAnnualTotal(): number | null {
    // 手動入力値がある場合はそれを優先
    if (this.socialInsurance.standardBonusAnnualTotal !== null && 
        this.socialInsurance.standardBonusAnnualTotal !== undefined) {
      return this.socialInsurance.standardBonusAnnualTotal;
    }
    
    // 手動入力値がない場合は計算値を返す
    return this.calculateStandardBonusAnnualTotal();
  }

  private loadDependentInfo(employeeId: string) {
    this.employeesService
      .getDependents(employeeId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((dependents) => {
        this.dependentInfos = dependents.map((dependent) => ({
          relationship: dependent.relationship ?? '',
          nameKanji: dependent.nameKanji ?? '',
          nameKana: dependent.nameKana ?? '',
          birthDate: this.formatDateForInput(dependent.birthDate),
          gender: dependent.gender ?? '',
          personalNumber: dependent.personalNumber ?? '',
          basicPensionNumber: dependent.basicPensionNumber ?? '',
          cohabitationType: dependent.cohabitationType ?? '',
          address: dependent.address ?? '',
          occupation: dependent.occupation ?? '',
          annualIncome: dependent.annualIncome ?? null,
          dependentStartDate: this.formatDateForInput(dependent.dependentStartDate),
          thirdCategoryFlag: dependent.thirdCategoryFlag ?? false,
        }));
      });
  }

  private applyEmployeeData(employee: ShahoEmployee) {
    this.employee = employee;
    this.basicInfo = {
      gender: employee.gender ?? '',
      birthDate: employee.birthDate ?? '',
      postalCode: employee.postalCode ?? '',
      address: employee.address ?? '',
      currentAddress: employee.currentAddress ?? '',
      workPrefecture: employee.workPrefecture ?? '',
      personalNumber: employee.personalNumber ?? '',
      basicPensionNumber: employee.basicPensionNumber ?? '',
      hasDependent: employee.hasDependent ?? false,
    };

    this.socialInsurance = {
      ...this.socialInsurance,
      healthStandardMonthly: employee.healthStandardMonthly ?? null,
      welfareStandardMonthly: employee.welfareStandardMonthly ?? null,
      standardBonusAnnualTotal: employee.standardBonusAnnualTotal ?? null,
      healthInsuredNumber: employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
      pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
      healthAcquisition: this.formatDateForInput(employee.healthAcquisition),
      pensionAcquisition: this.formatDateForInput(employee.pensionAcquisition),
      currentLeaveStatus: employee.currentLeaveStatus ?? '',
      currentLeaveStartDate: this.formatDateForInput(employee.currentLeaveStartDate),
      currentLeaveEndDate: this.formatDateForInput(employee.currentLeaveEndDate),
      careSecondInsured: employee.careSecondInsured ?? this.socialInsurance.careSecondInsured,
      exemption: employee.exemption ?? this.socialInsurance.exemption,
    };

    // 扶養情報をdependentsサブコレクションから読み込む
    if (employee.id) {
      this.loadDependentInfo(employee.id);
    } else {
      // employee.idがない場合は空の配列を設定
      this.dependentInfos = [];
    }

    // 監査情報を反映
    if (employee.createdAt || employee.updatedAt || employee.createdBy || employee.updatedBy || employee.approvedBy) {
      const formatDate = (date: string | Date | undefined): string => {
        if (!date) return '';
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return '';
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
      };

      // app_usersコレクションからdisplayNameを取得するためのマップを作成
      const userMap = new Map<string, string>();
      this.cachedUsers.forEach((u) => {
        const emailKey = u.email.toLowerCase();
        // app_usersのdisplayNameを優先的に使用（なければメールアドレス）
        const displayName = u.displayName || u.email;
        const localKey = u.email.includes('@') ? u.email.split('@')[0].toLowerCase() : '';
        
        // メールアドレスをキーに登録（app_usersのdisplayNameを値として）
        userMap.set(emailKey, displayName);
        // displayNameがある場合、それもキーとして登録
        if (u.displayName) {
          userMap.set(u.displayName.toLowerCase(), displayName);
        }
        // メールのローカル部分もキーとして登録
        if (localKey) {
          userMap.set(localKey, displayName);
        }
      });

      const getDisplayName = (userId: string | undefined): string => {
        if (!userId) return '—';
        const normalizedId = userId.toLowerCase();
        
        // app_usersからdisplayNameを取得
        const displayName = userMap.get(normalizedId);
        if (displayName) return displayName;
        
        // マップにない場合、app_usersを直接検索（メールアドレスで）
        if (userId.includes('@')) {
          const user = this.cachedUsers.find(u => u.email.toLowerCase() === normalizedId);
          if (user?.displayName) {
            return user.displayName;
          }
          // displayNameがない場合、メールアドレスのローカル部分を返す
          return userId.split('@')[0];
        }
        
        // メールアドレスでない場合、そのまま返す
        return userId;
      };

      // 承認履歴から最新の承認者を取得
      const latestApprover = this.getLatestApproverDisplayName(employee);

      this.auditInfo = {
        registeredAt: formatDate(employee.createdAt) || this.auditInfo.registeredAt,
        updatedAt: formatDate(employee.updatedAt) || this.auditInfo.updatedAt,
        createdBy: getDisplayName(employee.createdBy) || this.auditInfo.createdBy,
        updatedBy: getDisplayName(employee.updatedBy) || this.auditInfo.updatedBy,
        approvedBy: latestApprover || getDisplayName(employee.approvedBy) || this.auditInfo.approvedBy,
      };
    }

    this.rebuildApprovalHistory();
    this.rebuildChangeHistory();
  }

  private rebuildApprovalHistory() {
    if (!this.employee) {
      this.approvalHistoryEntries = [];
      return;
    }
    this.approvalHistoryEntries = this.buildApprovalHistoryEntries(
      this.employee,
      this.cachedApprovalRequests,
      this.cachedUsers,
    );
  }

  private buildApprovalHistoryEntries(
    employee: ShahoEmployee,
    requests: ApprovalRequest[],
    users: AppUser[],
  ): ApprovalHistoryEntry[] {
    const userMap = new Map(
      users.map((u) => [u.email.toLowerCase(), u.displayName || u.email]),
    );

    const entries: ApprovalHistoryEntry[] = [];

    requests
      .filter((req) => this.matchesEmployee(req, employee))
      .forEach((req) => {
        (req.histories ?? []).forEach((history) => {
          const createdAt =
            typeof history.createdAt?.toDate === 'function'
              ? history.createdAt.toDate()
              : new Date(history.createdAt as unknown as string);
          const actor =
            userMap.get(history.actorId.toLowerCase()) ||
            history.actorName ||
            history.actorId;
          entries.push({
            requestId: req.id ?? req.title,
            requestTitle: req.title,
            category: req.category,
            actionLabel: this.actionLabel(history),
            statusLabel: this.requestStatusLabel(req.status),
            actor,
            comment: history.comment || '',
            createdAt,
          });
        });
      });

    return entries.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  private matchesEmployee(request: ApprovalRequest, employee: ShahoEmployee) {
    const diffs = request.employeeDiffs || [];
    return diffs.some((diff) => {
      const matchesId =
        employee.id && diff.existingEmployeeId === employee.id;
      const matchesEmployeeNo =
        employee.employeeNo &&
        diff.employeeNo &&
        diff.employeeNo === employee.employeeNo;
      return matchesId || matchesEmployeeNo;
    });
  }

  private rebuildChangeHistory() {
    if (!this.employee) {
      this.changeHistoryRecords = [];
      return;
    }

    const userMap = new Map(
      this.cachedUsers.map((u) => [u.email.toLowerCase(), u.displayName || u.email]),
    );

    const records: HistoryRecord[] = [];

    this.cachedApprovalRequests
      .filter((req) => this.matchesEmployee(req, this.employee!))
      .forEach((req) => {
        const targetHistories = (req.histories ?? []).slice().sort((a, b) => {
          const aDate =
            typeof a.createdAt?.toDate === 'function'
              ? a.createdAt.toDate().getTime()
              : new Date(a.createdAt as unknown as string).getTime();
          const bDate =
            typeof b.createdAt?.toDate === 'function'
              ? b.createdAt.toDate().getTime()
              : new Date(b.createdAt as unknown as string).getTime();
          return bDate - aDate;
        });

        // 申請履歴を取得（操作者を決定するため）
        const applyHistory = targetHistories.find((h) => h.action === 'apply');
        // 承認履歴を取得（承認者を決定するため）
        const approveHistory = targetHistories.find((h) => h.action === 'approve');
        // 日付を決定するためのprimaryHistory（承認履歴を優先、なければ申請履歴）
        const primaryHistory = approveHistory || applyHistory || targetHistories[0];
        if (!primaryHistory) return;

        const primaryDate =
          typeof primaryHistory.createdAt?.toDate === 'function'
            ? primaryHistory.createdAt.toDate()
            : new Date(primaryHistory.createdAt as unknown as string);

        // 操作者（申請者）を取得
        const actor = applyHistory
          ? this.resolveUserDisplayName(
              applyHistory.actorId,
              applyHistory.actorName,
              userMap,
            )
          : this.resolveUserDisplayName(
          primaryHistory.actorId,
          primaryHistory.actorName,
          userMap,
        );

        // 承認者を取得
        const approver = approveHistory
          ? this.resolveUserDisplayName(
              approveHistory.actorId,
              approveHistory.actorName,
                  userMap,
            )
          : '';

        const targetDiffs =
          req.employeeDiffs?.filter((diff) =>
            diff.existingEmployeeId
              ? diff.existingEmployeeId === this.employee!.id
              : diff.employeeNo === this.employee!.employeeNo,
          ) ?? [];

        targetDiffs.forEach((diff) => {
          diff.changes
            .filter((change) => {
              // 変更のある項目のみを表示（oldValueとnewValueが異なる場合）
              const oldVal = change.oldValue ?? '';
              const newVal = change.newValue ?? '';
              return oldVal !== newVal;
            })
            .forEach((change, index) => {
            records.push({
              id: `${req.id ?? req.title}-hist-${primaryHistory.id}-${index}`,
              groupId: `${req.id ?? req.title}-group-${primaryHistory.id}`,
              changedAt: this.formatDateTime(primaryDate),
              field: change.field,
              oldValue: change.oldValue ?? '',
              newValue: change.newValue ?? '',
              actor,
              approver,
            });
          });
        });
      });

    this.changeHistoryRecords = records.sort((a, b) =>
      b.changedAt.localeCompare(a.changedAt),
    );
  }

  private formatDateTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private resolveUserDisplayName(
    userId: string,
    fallbackName: string | undefined,
    userMap: Map<string, string>,
  ): string {
    const key = userId?.toLowerCase();
    if (key && userMap.has(key)) {
      return userMap.get(key) as string;
    }
    return fallbackName || userId || '';
  }

  /** キャッシュ済みユーザーで監査情報の表示名を更新 */
  private updateAuditInfoDisplayNames(): void {
    if (!this.employee) return;

    // app_usersコレクションからdisplayNameを取得するためのマップを作成
    const userMap = new Map<string, string>();
    this.cachedUsers.forEach((u) => {
      const emailKey = u.email.toLowerCase();
      // app_usersのdisplayNameを優先的に使用（なければメールアドレス）
      const displayName = u.displayName || u.email;
      const localKey = u.email.includes('@') ? u.email.split('@')[0].toLowerCase() : '';
      
      // メールアドレスをキーに登録（app_usersのdisplayNameを値として）
      userMap.set(emailKey, displayName);
      // displayNameがある場合、それもキーとして登録
      if (u.displayName) {
        userMap.set(u.displayName.toLowerCase(), displayName);
      }
      // メールのローカル部分もキーとして登録
      if (localKey) {
        userMap.set(localKey, displayName);
      }
    });

    const getDisplayName = (userId: string | undefined): string => {
      if (!userId) return '—';
      const normalizedId = userId.toLowerCase();
      
      // app_usersからdisplayNameを取得
      const displayName = userMap.get(normalizedId);
      if (displayName) return displayName;
      
      // マップにない場合、app_usersを直接検索（メールアドレスで）
      if (userId.includes('@')) {
        const user = this.cachedUsers.find(u => u.email.toLowerCase() === normalizedId);
        if (user?.displayName) {
          return user.displayName;
        }
        // displayNameがない場合、メールアドレスのローカル部分を返す
        return userId.split('@')[0];
      }
      
      // メールアドレスでない場合、そのまま返す
      return userId;
    };

    const latestApprover = this.getLatestApproverDisplayName(this.employee);

    this.auditInfo = {
      ...this.auditInfo,
      createdBy: getDisplayName(this.employee.createdBy) || this.auditInfo.createdBy,
      updatedBy: getDisplayName(this.employee.updatedBy) || this.auditInfo.updatedBy,
      approvedBy: latestApprover || getDisplayName(this.employee.approvedBy) || this.auditInfo.approvedBy,
    };
  }

  /** 承認履歴から最新の承認者の表示名を取得 */
  private getLatestApproverDisplayName(employee: ShahoEmployee): string | null {
    // app_usersコレクションからdisplayNameを取得するためのマップを作成
    const userMap = new Map<string, string>();
    this.cachedUsers.forEach((u) => {
      const emailKey = u.email.toLowerCase();
      // app_usersのdisplayNameを優先的に使用（なければメールアドレス）
      const displayName = u.displayName || u.email;
      const localKey = u.email.includes('@') ? u.email.split('@')[0].toLowerCase() : '';
      
      // メールアドレスをキーに登録（app_usersのdisplayNameを値として）
      userMap.set(emailKey, displayName);
      // displayNameがある場合、それもキーとして登録
      if (u.displayName) {
        userMap.set(u.displayName.toLowerCase(), displayName);
      }
      // メールのローカル部分もキーとして登録
      if (localKey) {
        userMap.set(localKey, displayName);
      }
    });

    // この社員に関連する承認依頼を取得
    const relatedRequests = this.cachedApprovalRequests.filter((req) =>
      this.matchesEmployee(req, employee),
    );

    // 承認済みの依頼から、最新の承認履歴を取得
    const approvedRequests = relatedRequests.filter((req) => req.status === 'approved');
    
    if (approvedRequests.length === 0) {
      return null;
    }

    // 最新の承認依頼を取得（作成日時でソート）
    const latestRequest = approvedRequests.sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
      return bTime - aTime;
    })[0];

    // 承認履歴から最新の承認者を取得
    const approvalHistories = (latestRequest.histories || []).filter(
      (h) => h.action === 'approve',
    );

    if (approvalHistories.length === 0) {
      return null;
    }

    // 最新の承認履歴を取得
    const latestHistory = approvalHistories.sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
      return bTime - aTime;
    })[0];

    const actorId = latestHistory.actorId?.toLowerCase() || '';
    
    // app_usersからdisplayNameを取得
    const displayName = userMap.get(actorId);
    if (displayName) return displayName;
    
    // マップにない場合、app_usersを直接検索（メールアドレスで）
    if (latestHistory.actorId && latestHistory.actorId.includes('@')) {
      const user = this.cachedUsers.find(u => u.email.toLowerCase() === actorId);
      if (user?.displayName) {
        return user.displayName;
      }
      // displayNameがない場合、メールアドレスのローカル部分を返す
      return latestHistory.actorId.split('@')[0];
    }
    
    return latestHistory.actorName || latestHistory.actorId || null;
  }

  private requestStatusLabel(status: ApprovalRequestStatus | undefined) {
    switch (status) {
      case 'approved':
        return '承認済';
      case 'remanded':
        return '差戻し';
      case 'expired':
        return '失効';
      case 'pending':
        return '承認待ち';
      default:
        return '—';
    }
  }

  private actionLabel(history: ApprovalHistory): string {
    switch (history.action) {
      case 'apply':
        return '申請';
      case 'approve':
        return '承認';
      case 'remand':
        return '差戻し';
      case 'expired':
        return '失効';
      default:
        return history.action;
    }
  }

  private pushApprovalNotifications(request: ApprovalRequest, requestId: string): void {
    const notifications: ApprovalNotification[] = [];

    const applicantNotification: ApprovalNotification = {
      id: `ntf-${Date.now()}`,
      requestId: requestId,
      recipientId: request.applicantId,
      message: `${request.title} を起票しました（${request.targetCount}件）。`,
      unread: true,
      createdAt: new Date(),
      type: 'info',
    };
    notifications.push(applicantNotification);

    const currentStep = request.steps.find((step) => step.stepOrder === request.currentStep);
    const candidates = currentStep
      ? request.flowSnapshot?.steps.find((step) => step.order === currentStep.stepOrder)?.candidates ?? []
      : [];

    candidates.forEach((candidate) => {
      notifications.push({
        id: `ntf-${Date.now()}-${candidate.id}`,
        requestId: requestId,
        recipientId: candidate.id,
        message: `${request.title} の承認依頼が届いています。`,
        unread: true,
        createdAt: new Date(),
        type: 'info',
      });
    });

    if (notifications.length) {
      this.notificationService.pushBatch(notifications);
    }
  }
  }