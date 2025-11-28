import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, switchMap, takeUntil, combineLatest } from 'rxjs';
import {
  PayrollData,
  ShahoEmployee,
  ShahoEmployeesService,
} from '../app/services/shaho-employees.service';

interface AuditInfo {
  registeredAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  approvedBy: string;
}

interface SocialInsuranceInfo {
  standardMonthly: number;
  insuredNumber: string;
  careSecondInsured: boolean;
  healthAcquisition: string;
  pensionAcquisition: string;
  exemption: boolean;
}

interface SalaryMonth {
  amount: number;
  days: number;
}

interface SalaryCalculationYear {
  year: number;
  periodStart: string;
  periodEnd: string;
  april: SalaryMonth;
  may: SalaryMonth;
  june: SalaryMonth;
  average: number;
  newStandard: number;
  oldStandard: number;
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
    { key: 'standard-pay', label: '標準報酬月額算定' },
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
    departmentCode: '',
    workPrefectureCode: '',
    workPrefecture: '',
  };

  auditInfo: AuditInfo = {
    registeredAt: '2024-01-12 09:18',
    updatedAt: '2025-02-03 15:24',
    createdBy: 'admin01',
    updatedBy: 'approver02',
    approvedBy: 'manager03',
  };

  socialInsurance: SocialInsuranceInfo = {
    standardMonthly: 0,
    insuredNumber: '',
    careSecondInsured: false,
    healthAcquisition: '',
    pensionAcquisition: '',
    exemption: false,
  };

  salaryCalculations: SalaryCalculationYear[] = [];
  selectedSalaryYear: SalaryCalculationYear | null = null;

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
    this.route.paramMap
      .pipe(
        takeUntil(this.destroy$),
        switchMap((params) => {
          const id = params.get('id');
          if (!id) {
            this.isLoading = false;
            this.notFound = true;
            return of({ employee: null, payrolls: [] });
          }
          this.isLoading = true;
          return combineLatest({
            employee: this.employeesService.getEmployeeById(id),
            payrolls: this.employeesService.getPayrolls(id),
          });
        }),
      )
      .subscribe(({ employee, payrolls }) => {
        this.isLoading = false;
        if (employee) {
          this.notFound = false;
          this.applyEmployeeData(employee);
          this.loadPayrolls(payrolls);
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

  recalcCareFlag() {
    const birthDate = new Date(this.basicInfo.birthDate);
    const age = this.calculateAge(birthDate);
    this.socialInsurance.careSecondInsured = age >= 40 && age < 65;
  }

  recalcAverage(year: SalaryCalculationYear) {
    const total = year.april.amount + year.may.amount + year.june.amount;
    year.average = Math.round(total / 3);
    year.newStandard = Math.round(year.average / 1000) * 1000;
  }

  addNewYear() {
    const latestYear = this.salaryCalculations[0]?.year ?? new Date().getFullYear();
    const nextYear = latestYear + 1;
    const newYear: SalaryCalculationYear = {
      year: nextYear,
      periodStart: `${nextYear}-04`,
      periodEnd: `${nextYear}-06`,
      april: { amount: 0, days: 0 },
      may: { amount: 0, days: 0 },
      june: { amount: 0, days: 0 },
      average: 0,
      newStandard: 0,
      oldStandard: this.selectedSalaryYear?.newStandard ?? 0,
    };
    this.salaryCalculations = [newYear, ...this.salaryCalculations];
    this.selectedSalaryYear = newYear;
  }

  selectSalaryYear(year: number) {
    const target = this.salaryCalculations.find((item) => item.year === year);
    if (target) {
      this.selectedSalaryYear = target;
    } else {
      this.selectedSalaryYear = null;
    }
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

  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }
  private applyEmployeeData(employee: ShahoEmployee) {
    this.employee = employee;
    this.basicInfo = {
      gender: employee.gender ?? '',
      birthDate: employee.birthDate ?? '',
      departmentCode: employee.departmentCode ?? '',
      workPrefectureCode: employee.workPrefectureCode ?? '',
      workPrefecture: employee.workPrefecture ?? '',
    };

    this.socialInsurance = {
      ...this.socialInsurance,
      standardMonthly: employee.standardMonthly ?? 0,
      insuredNumber: employee.insuredNumber ?? '',
      healthAcquisition: employee.healthAcquisition ?? '',
      pensionAcquisition: employee.pensionAcquisition ?? '',
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

  private loadPayrolls(payrolls: PayrollData[]): void {
    // 給与データを年度ごとにグループ化
    const payrollMap = new Map<number, PayrollData[]>();
    
    payrolls.forEach((payroll) => {
      const [year] = payroll.yearMonth.split('-').map(Number);
      if (!payrollMap.has(year)) {
        payrollMap.set(year, []);
      }
      payrollMap.get(year)!.push(payroll);
    });

    // 年度ごとにSalaryCalculationYear形式に変換
    this.salaryCalculations = Array.from(payrollMap.entries())
      .map(([year, yearPayrolls]) => {
        const april = yearPayrolls.find((p) => p.yearMonth === `${year}-04`);
        const may = yearPayrolls.find((p) => p.yearMonth === `${year}-05`);
        const june = yearPayrolls.find((p) => p.yearMonth === `${year}-06`);

        const aprilData: SalaryMonth = {
          amount: april?.amount ?? 0,
          days: april?.workedDays ?? 0,
        };
        const mayData: SalaryMonth = {
          amount: may?.amount ?? 0,
          days: may?.workedDays ?? 0,
        };
        const juneData: SalaryMonth = {
          amount: june?.amount ?? 0,
          days: june?.workedDays ?? 0,
        };

        const total = aprilData.amount + mayData.amount + juneData.amount;
        const average = total > 0 ? Math.round(total / 3) : 0;
        const newStandard = Math.round(average / 1000) * 1000;

        // 前年度の標準報酬月額を取得（前年度のデータがある場合）
        const prevYear = year - 1;
        const prevYearData = this.salaryCalculations.find((sc) => sc.year === prevYear);
        const oldStandard = prevYearData?.newStandard ?? this.employee?.standardMonthly ?? 0;

        return {
          year,
          periodStart: `${year}-04`,
          periodEnd: `${year}-06`,
          april: aprilData,
          may: mayData,
          june: juneData,
          average,
          newStandard,
          oldStandard,
        };
      })
      .sort((a, b) => b.year - a.year); // 年度の降順でソート

    // 最初の年度を選択
    if (this.salaryCalculations.length > 0) {
      this.selectedSalaryYear = this.salaryCalculations[0];
    } else {
      this.selectedSalaryYear = null;
    }
  }
}