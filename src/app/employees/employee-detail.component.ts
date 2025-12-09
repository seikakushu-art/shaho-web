import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of, switchMap, takeUntil, firstValueFrom } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService, PayrollData } from '../app/services/shaho-employees.service';
import { AuthService } from '../auth/auth.service';
import { RoleKey } from '../models/roles';

interface AuditInfo {
  registeredAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  approvedBy: string;
}

interface SocialInsuranceInfo {
  standardMonthly: number | null;
  standardBonusAnnualTotal: number | null;
  healthInsuredNumber: string;
  pensionInsuredNumber: string;
  careSecondInsured: boolean;
  healthAcquisition: string;
  pensionAcquisition: string;
  childcareLeaveStart: string;
  childcareLeaveEnd: string;
  maternityLeaveStart: string;
  maternityLeaveEnd: string;
  exemption: boolean;
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

interface SocialInsuranceHistoryData {
  monthlySalary?: number;
  workedDays?: number;
  healthInsuranceMonthly?: number;
  careInsuranceMonthly?: number;
  pensionMonthly?: number;
  bonusPaidOn?: string;
  bonusTotal?: number;
  standardBonus?: number;
  healthInsuranceBonus?: number;
  careInsuranceBonus?: number;
  pensionBonus?: number;
}

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIf, NgFor, DatePipe],
  templateUrl: './employee-detail.component.html',
  styleUrl: './employee-detail.component.scss',
})
export class EmployeeDetailComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private employeesService = inject(ShahoEmployeesService);
    private authService = inject(AuthService);
    private destroy$ = new Subject<void>();
  tabs = [
    { key: 'basic', label: '基本情報' },
    { key: 'insurance', label: '社会保険情報' },
    { key: 'insurance-history', label: '給与/賞与/社会保険料履歴' },
    { key: 'bonus', label: '標準賞与額算定' },
    { key: 'history', label: '変更履歴' },
  ];

  selectedTab = 'basic';
  showApprovalHistory = false;
  canDelete = true;

  isLoading = true;
  notFound = false;

  employee: ShahoEmployee | null = null;

  basicInfo = {
    gender: '',
    birthDate: '',
    postalCode: '',
    address: '',
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
    standardMonthly: null,
    standardBonusAnnualTotal: null,
    healthInsuredNumber: '',
    pensionInsuredNumber: '',
    careSecondInsured: false,
    healthAcquisition: '',
    pensionAcquisition: '',
    childcareLeaveStart: '',
    childcareLeaveEnd: '',
    maternityLeaveStart: '',
    maternityLeaveEnd: '',
    exemption: false,
  };

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
    { key: 'standardBonus', label: '標準賞与額', category: 'bonus' },
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

  historyRecords: HistoryRecord[] = [
    {
      id: 'h1',
      groupId: 'g1',
      changedAt: '2025-02-03 15:24',
      field: '標準報酬月額',
      oldValue: '410,000',
      newValue: '420,000',
      actor: 'approver02',
      approver: 'manager03',
    },
    {
      id: 'h2',
      groupId: 'g1',
      changedAt: '2025-02-03 15:24',
      field: '標準賞与額',
      oldValue: '730,000',
      newValue: '760,000',
      actor: 'approver02',
      approver: 'manager03',
    },
    {
      id: 'h3',
      groupId: 'g2',
      changedAt: '2024-12-01 10:12',
      field: '所属部署',
      oldValue: '営業部',
      newValue: '営業企画部',
      actor: 'admin01',
      approver: 'manager02',
    },
  ];

  groupedHistory: HistoryRecord[] = [];

  readonly canManage$ = this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Operator]);

  ngOnInit(): void {
    this.refreshDisplayedMonths();
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
        } else {
          this.employee = null;
          this.notFound = true;
        }
      });
  }

  ngOnDestroy(): void {
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

  displayAmount(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `${value.toLocaleString()} 円`;
  }


  recalcCareFlag() {
    const birthDate = new Date(this.basicInfo.birthDate);
    const age = this.calculateAge(birthDate);
    this.socialInsurance.careSecondInsured = age >= 40 && age < 65;
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
    return this.historyRecords.filter((record) => {
      const date = record.changedAt.slice(0, 10);
      if (this.historyFilters.from && date < this.historyFilters.from) return false;
      if (this.historyFilters.to && date > this.historyFilters.to) return false;
      if (this.historyFilters.field && record.field !== this.historyFilters.field)
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
    this.groupedHistory = this.historyRecords.filter(
      (item) => item.groupId === groupId,
    );
  }

  closeHistoryGroup() {
    this.groupedHistory = [];
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

              const bonusData: SocialInsuranceHistoryData = {
                bonusPaidOn: this.formatDateForInput(payroll.bonusPaidOn),
                bonusTotal: payroll.bonusTotal,
                standardBonus: payroll.standardBonus,
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
   * 現在の年度に属する賞与をすべて集計する
   */
  private calculateStandardBonusAnnualTotal(): number {
    if (!this.allPayrolls || this.allPayrolls.length === 0) {
      return 0;
    }

    // 現在日時を基準に現在の年度を計算
    const now = new Date();
    const currentFiscalYear = this.getFiscalYearForDate(now);
    const startDate = new Date(currentFiscalYear.start.getFullYear(), currentFiscalYear.start.getMonth(), currentFiscalYear.start.getDate());
    const endDate = new Date(currentFiscalYear.end.getFullYear(), currentFiscalYear.end.getMonth(), currentFiscalYear.end.getDate());

    // 現在の年度に属する賞与をフィルタリングして合計
    return this.allPayrolls
      .filter((payroll) => {
        if (!payroll.bonusPaidOn || payroll.standardBonus === undefined) {
          return false;
        }

        const paidOn = this.toBonusDate(payroll.bonusPaidOn);
        if (!paidOn) return false;

        // 各賞与の支給日が属する年度を計算
        const paidOnDate = new Date(paidOn.getFullYear(), paidOn.getMonth(), paidOn.getDate());
        
        // 現在の年度の範囲内かチェック
        return paidOnDate >= startDate && paidOnDate <= endDate;
      })
      .reduce((sum, record) => sum + (record.standardBonus ?? 0), 0);
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

  private applyEmployeeData(employee: ShahoEmployee) {
    this.employee = employee;
    this.basicInfo = {
      gender: employee.gender ?? '',
      birthDate: employee.birthDate ?? '',
      postalCode: employee.postalCode ?? '',
      address: employee.address ?? '',
      workPrefecture: employee.workPrefecture ?? '',
      personalNumber: employee.personalNumber ?? '',
      basicPensionNumber: employee.basicPensionNumber ?? '',
      hasDependent: employee.hasDependent ?? false,
    };

    this.socialInsurance = {
      ...this.socialInsurance,
      standardMonthly: employee.standardMonthly ?? null,
      standardBonusAnnualTotal: employee.standardBonusAnnualTotal ?? null,
      healthInsuredNumber: employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
      pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
      healthAcquisition: this.formatDateForInput(employee.healthAcquisition),
      pensionAcquisition: this.formatDateForInput(employee.pensionAcquisition),
      childcareLeaveStart: this.formatDateForInput(employee.childcareLeaveStart),
      childcareLeaveEnd: this.formatDateForInput(employee.childcareLeaveEnd),
      maternityLeaveStart: this.formatDateForInput(employee.maternityLeaveStart),
      maternityLeaveEnd: this.formatDateForInput(employee.maternityLeaveEnd),
      careSecondInsured: employee.careSecondInsured ?? this.socialInsurance.careSecondInsured,
      exemption: employee.exemption ?? this.socialInsurance.exemption,
    };

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

      this.auditInfo = {
        registeredAt: formatDate(employee.createdAt) || this.auditInfo.registeredAt,
        updatedAt: formatDate(employee.updatedAt) || this.auditInfo.updatedAt,
        createdBy: employee.createdBy || this.auditInfo.createdBy,
        updatedBy: employee.updatedBy || this.auditInfo.updatedBy,
        approvedBy: employee.approvedBy || this.auditInfo.approvedBy,
      };
    }

    if (employee.birthDate) {
      this.recalcCareFlag();
    }
  }
  }