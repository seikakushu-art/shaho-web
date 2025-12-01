import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, switchMap, takeUntil } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';

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
    private employeesService = inject(ShahoEmployeesService);
    private destroy$ = new Subject<void>();
  tabs = [
    { key: 'basic', label: '基本情報' },
    { key: 'insurance', label: '社会保険情報' },
    { key: 'insurance-history', label: '社会保険データ履歴' },
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
    start: this.formatMonthForInput(this.addMonths(new Date(), -2)),
    end: this.formatMonthForInput(new Date()),
    mode: 'all' as 'all' | 'without-bonus' | 'bonus-only',
  };

  displayedMonths: Date[] = [];
  socialInsuranceHistory: Record<string, SocialInsuranceHistoryData> = {};
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
    }
  }

  recalcBonus(record: BonusRecord) {
    const base = record.total;
    record.standardHealth = Math.max(0, Math.round(base * 0.95));
    record.standardPension = Math.max(0, Math.round(base * 0.93));
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