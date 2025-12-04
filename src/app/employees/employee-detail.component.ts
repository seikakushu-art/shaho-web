import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of, switchMap, takeUntil, firstValueFrom } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService, PayrollData } from '../app/services/shaho-employees.service';

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

interface BonusRecord {
  id: string;
  paidOn: string;
  fiscalYear: number;
  total: number;
  standardHealth: number;
  standardPension: number;
  healthCumulative: number;
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

  bonusRecords: BonusRecord[] = [
    {
      id: 'b1',
      paidOn: '2024-12-10',
      fiscalYear: 2024,
      total: 800000,
      standardHealth: 760000,
      standardPension: 750000,
      healthCumulative: 1300000,
    },
    {
      id: 'b2',
      paidOn: '2024-06-10',
      fiscalYear: 2024,
      total: 600000,
      standardHealth: 590000,
      standardPension: 580000,
      healthCumulative: 540000,
    },
  ];

  selectedBonus: BonusRecord = this.bonusRecords[0];

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

  selectBonus(id: string) {
    const record = this.bonusRecords.find((item) => item.id === id);
    if (record) {
      this.selectedBonus = { ...record };
      // 選択中の賞与レコードの累計を社会保険関連基本情報に反映
      this.socialInsurance.standardBonusAnnualTotal = record.healthCumulative;
    }
  }

  recalcBonus(record: BonusRecord) {
    const base = record.total;
    // 標準賞与額（健・介）は賞与総額を1,000円未満切り捨てた額
    record.standardHealth = Math.max(0, Math.floor(base / 1000) * 1000);
    record.standardPension = Math.max(0, Math.round(base * 0.93));
    
    // 標準賞与額年度累計（健）を計算
    if (record.paidOn && this.employee?.id) {
      this.calculateHealthCumulative(record);
    } else {
      // 社員IDまたは支給日がない場合は、今回の標準賞与額のみ
      record.healthCumulative = record.standardHealth;
    }
    
    // 社会保険関連基本情報の標準賞与額年度累計も更新
    // 最新の賞与レコードの累計を表示（または選択中のレコードの累計）
    if (record === this.selectedBonus) {
      this.socialInsurance.standardBonusAnnualTotal = record.healthCumulative;
    }
  }

  /**
   * 標準賞与額年度累計（健）を計算
   * 年度（4/1〜翌3/31）内の過去の賞与支給の標準賞与額（健・介）を累積
   */
  private calculateHealthCumulative(record: BonusRecord) {
    if (!record.paidOn || !this.employee?.id) {
      record.healthCumulative = record.standardHealth;
      return;
    }

    // 賞与支給日から年度を計算（4/1〜翌3/31）
    const bonusDate = new Date(record.paidOn.replace(/\//g, '-'));
    if (isNaN(bonusDate.getTime())) {
      record.healthCumulative = record.standardHealth;
      return;
    }

    const bonusYear = bonusDate.getFullYear();
    const bonusMonth = bonusDate.getMonth() + 1; // 1-12

    // 年度の開始日（4/1）と終了日（翌3/31）を計算
    let fiscalYearStart: Date;
    let fiscalYearEnd: Date;
    
    if (bonusMonth >= 4) {
      // 4月以降は当年4/1〜翌年3/31
      fiscalYearStart = new Date(bonusYear, 3, 1); // 4月1日
      fiscalYearEnd = new Date(bonusYear + 1, 2, 31); // 翌年3月31日
    } else {
      // 1-3月は前年4/1〜当年3/31
      fiscalYearStart = new Date(bonusYear - 1, 3, 1); // 前年4月1日
      fiscalYearEnd = new Date(bonusYear, 2, 31); // 当年3月31日
    }

    // 過去の給与データから、その年度内の賞与データをフィルタリング
    let cumulativeAmount = 0;
    
        this.allPayrolls.forEach((payroll) => {
          if (!payroll.bonusPaidOn) return;
          
          const payrollBonusDate = new Date(payroll.bonusPaidOn.replace(/\//g, '-'));
          if (isNaN(payrollBonusDate.getTime())) return;

          // 今回の賞与支給日より前の賞与のみを対象
          if (payrollBonusDate >= bonusDate) return;

          // 年度内かどうかをチェック
          if (payrollBonusDate >= fiscalYearStart && payrollBonusDate <= fiscalYearEnd) {
            // 標準賞与額（健・介）を累積
            // standardBonusが標準賞与額（健・介）として保存されていると仮定
            // standardBonusがない場合はhealthInsuranceBonusを使用
            const standardHealthAmount = payroll.standardBonus || payroll.healthInsuranceBonus || 0;
            cumulativeAmount += standardHealthAmount;
          }
        });

    // 今回の標準賞与額（健・介）を加算
    record.healthCumulative = cumulativeAmount + record.standardHealth;
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
        
        // 賞与レコードを構築
        const bonusRecordsList: BonusRecord[] = [];

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
              
              // 年度を計算（4/1〜翌3/31）
              const fiscalYear = bonusMonthNum >= 4 ? bonusYear : bonusYear - 1;

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
              
              // 賞与レコードを追加
              const standardHealth = payroll.standardBonus || payroll.healthInsuranceBonus || 0;
              bonusRecordsList.push({
                id: `bonus-${bonusDate.getTime()}`,
                paidOn: this.formatDateForInput(payroll.bonusPaidOn) || '',
                fiscalYear,
                total: payroll.bonusTotal || 0,
                standardHealth,
                standardPension: payroll.pensionBonus || 0,
                healthCumulative: 0, // 後で計算
              });
            }
          }
        });

        // 賞与レコードを支給日でソート（新しい順）
        bonusRecordsList.sort((a, b) => {
          const dateA = new Date(a.paidOn.replace(/\//g, '-'));
          const dateB = new Date(b.paidOn.replace(/\//g, '-'));
          return dateB.getTime() - dateA.getTime();
        });

        // 各賞与レコードの年度累計を計算
        bonusRecordsList.forEach((record) => {
          this.recalcBonus(record);
        });

        this.bonusRecords = bonusRecordsList;
        if (bonusRecordsList.length > 0) {
          this.selectedBonus = { ...bonusRecordsList[0] };
          // 最新の賞与レコードの累計を社会保険関連基本情報に反映
          this.socialInsurance.standardBonusAnnualTotal = bonusRecordsList[0].healthCumulative;
        }

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