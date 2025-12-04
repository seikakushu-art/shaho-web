import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { CalculationType, StandardCalculationMethod } from '../calculation-types';
import {
  CalculationDataService,
  CalculationQueryParams,
  CalculationRow,
} from '../calculation-data.service';

type ColumnKey =
  | 'employeeNo'
  | 'name'
  | 'department'
  | 'location'
  | 'month'
  | 'monthlySalary'
  | 'standardMonthly'
  | 'healthEmployeeMonthly'
  | 'healthEmployerMonthly'
  | 'healthTotalMonthly'
  | 'nursingEmployeeMonthly'
  | 'nursingEmployerMonthly'
  | 'nursingTotalMonthly'
  | 'welfareEmployeeMonthly'
  | 'welfareEmployerMonthly'
  | 'welfareTotalMonthly'
  | 'bonusPaymentDate'
  | 'bonusTotalPay'
  | 'standardBonus'
  | 'healthEmployeeBonus'
  | 'healthEmployerBonus'
  | 'healthTotalBonus'
  | 'nursingEmployeeBonus'
  | 'nursingEmployerBonus'
  | 'nursingTotalBonus'
  | 'welfareEmployeeBonus'
  | 'welfareEmployerBonus'
  | 'welfareTotalBonus'
  | 'totalContribution';

type ColumnCategory = 'monthly' | 'bonus' | 'shared';
type ColumnFormat = 'text' | 'money' | 'date' | 'month';

interface ColumnSetting {
  key: ColumnKey;
  label: string;
  visible: boolean;
  sortable?: boolean;
  category: ColumnCategory;
  format: ColumnFormat;
}

@Component({
  selector: 'app-calculation-result',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calculation-result.component.html',
  styleUrl: './calculation-result.component.scss',
})
export class CalculationResultComponent implements OnInit, OnDestroy {
  private calculationDataService = inject(CalculationDataService);
  private destroy$ = new Subject<void>();

  calculationType: CalculationType = 'standard';
  targetMonth = '';
  bonusMonth = '';
  method = '';
  standardMethod: StandardCalculationMethod = '定時決定';
  activeInsurances: string[] = [];
  includeBonusInMonth = true;
  departmentFilter = '';
  locationFilter = '';
  employeeNoFilter = '';
  bonusPaidOnFilter = '';

  columns: ColumnSetting[] = [
    {
      key: 'employeeNo',
      label: '社員番号',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    { key: 'name', label: '氏名', visible: true, sortable: true, category: 'shared', format: 'text' },
    {
      key: 'department',
      label: '部署',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'location',
      label: '勤務地',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'month',
      label: '対象年月',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'month',
    },
    {
      key: 'monthlySalary',
      label: '月給支払額',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'standardMonthly',
      label: '標準報酬月額',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthEmployeeMonthly',
      label: '健康保険（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthEmployerMonthly',
      label: '健康保険（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthTotalMonthly',
      label: '健康保険（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingEmployeeMonthly',
      label: '介護保険（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingEmployerMonthly',
      label: '介護保険（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingTotalMonthly',
      label: '介護保険（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareEmployeeMonthly',
      label: '厚生年金（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareEmployerMonthly',
      label: '厚生年金（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareTotalMonthly',
      label: '厚生年金（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'bonusPaymentDate',
      label: '賞与支給日',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'date',
    },
    {
      key: 'bonusTotalPay',
      label: '賞与総支給額',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'standardBonus',
      label: '標準賞与額',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthEmployeeBonus',
      label: '健康保険（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthEmployerBonus',
      label: '健康保険（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthTotalBonus',
      label: '健康保険（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingEmployeeBonus',
      label: '介護保険（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingEmployerBonus',
      label: '介護保険（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingTotalBonus',
      label: '介護保険（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareEmployeeBonus',
      label: '厚生年金（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareEmployerBonus',
      label: '厚生年金（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareTotalBonus',
      label: '厚生年金（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'totalContribution',
      label: '個人＋会社 保険料合計',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'money',
    },
  ];

  rows: CalculationRow[] = [];

  sortKey: ColumnKey = 'employeeNo';
  sortDirection: 'asc' | 'desc' = 'asc';

  departmentSummaries: DepartmentSummary[] = [];
  insuranceSummaries: InsuranceSummary[] = [];

  constructor(private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const type = params.get('type') as CalculationType | null;
    this.calculationType = type ?? 'standard';
    this.targetMonth = params.get('targetMonth') ?? '2025-02';
    this.bonusMonth = params.get('bonusMonth') ?? '2025-03';
    this.method = params.get('method') ?? '自動算出';
    this.standardMethod =
    (params.get('standardMethod') as StandardCalculationMethod | null) ?? '定時決定';
  this.activeInsurances = (params.get('insurances') ?? '健康,厚生年金,介護')
    .split(',')
    .filter(Boolean);
  this.includeBonusInMonth = params.get('includeBonusInMonth') === 'false' ? false : true;
  this.departmentFilter = params.get('department') ?? '';
  this.locationFilter = params.get('location') ?? '';
  this.employeeNoFilter = params.get('employeeNo') ?? '';
  this.bonusPaidOnFilter = params.get('bonusPaidOn') ?? '';

  this.loadRows();
}

ngOnDestroy(): void {
  this.destroy$.next();
  this.destroy$.complete();
  }

  get visibleColumns() {
    return this.columns.filter((c) => c.visible && this.isRelevantForType(c));
  }

  isColumnVisible(key: ColumnKey): boolean {
    const column = this.columns.find((c) => c.key === key);
    return !!column && column.visible && this.isRelevantForType(column);
  }

  toggleColumn(key: ColumnKey) {
    const target = this.columns.find((c) => c.key === key);
    if (target) {
      target.visible = !target.visible;
    }
  }

  autoHideIrrelevant() {
    this.refreshVisibility(true);
  }
  private loadRows() {
    const query: CalculationQueryParams = {
      type: this.calculationType,
      targetMonth: this.targetMonth,
      bonusMonth: this.bonusMonth,
      method: this.method,
      standardMethod: this.standardMethod,
      insurances: this.activeInsurances,
      department: this.departmentFilter || undefined,
      location: this.locationFilter || undefined,
      employeeNo: this.employeeNoFilter || undefined,
      includeBonusInMonth: this.includeBonusInMonth,
      bonusPaidOn: this.bonusPaidOnFilter || undefined,
    };

    this.calculationDataService
      .getCalculationRows(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe((rows) => {
        this.rows = rows;
        this.refreshVisibility(true);
        this.calculateSummaries();
      });
  }

  sortBy(key: ColumnKey) {
    const column = this.columns.find((c) => c.key === key && c.sortable);
    if (!column) return;
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDirection = 'asc';
    }
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    this.rows = [...this.rows].sort((a, b) => {
      const valA = this.getRawValue(a, key);
      const valB = this.getRawValue(b, key);
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * direction;
      }
      return String(valA).localeCompare(String(valB), 'ja') * direction;
    });
  }

  getRawValue(row: CalculationRow, key: ColumnKey) {
    switch (key) {
      case 'month':
        return row.month;
      case 'healthTotalMonthly':
        return row.healthEmployeeMonthly + row.healthEmployerMonthly;
      case 'nursingTotalMonthly':
        return row.nursingEmployeeMonthly + row.nursingEmployerMonthly;
      case 'welfareTotalMonthly':
        return row.welfareEmployeeMonthly + row.welfareEmployerMonthly;
      case 'healthTotalBonus':
        return row.healthEmployeeBonus + row.healthEmployerBonus;
      case 'nursingTotalBonus':
        return row.nursingEmployeeBonus + row.nursingEmployerBonus;
      case 'welfareTotalBonus':
        return row.welfareEmployeeBonus + row.welfareEmployerBonus;
      case 'totalContribution': {
        const monthly =
          row.healthEmployeeMonthly +
          row.healthEmployerMonthly +
          row.nursingEmployeeMonthly +
          row.nursingEmployerMonthly +
          row.welfareEmployeeMonthly +
          row.welfareEmployerMonthly;
        const bonus =
          row.healthEmployeeBonus +
          row.healthEmployerBonus +
          row.nursingEmployeeBonus +
          row.nursingEmployerBonus +
          row.welfareEmployeeBonus +
          row.welfareEmployerBonus;
        return monthly + bonus;
      }
      default:
        return (row as unknown as Record<string, string | number>)[key];
    }
  }

  getDisplayValue(row: CalculationRow, column: ColumnSetting) {
    const value = this.getRawValue(row, column.key);
    if (value === undefined || value === null) return '-';
    if (typeof value === 'number' && column.format === 'money') {
      return value.toLocaleString('ja-JP');
    }
    return value;
  }

  private refreshVisibility(autoHide = false) {
    const hasRows = this.rows.length > 0;
    this.columns.forEach((column) => {
      const relevant = this.isRelevantForType(column);
      if (!relevant) {
        column.visible = false;
        return;
      }

      if (autoHide && hasRows) {
        const hasValue = this.rows.some((row) => {
          const value = this.getRawValue(row, column.key);
          if (typeof value === 'number') return value !== 0;
          return !!value;
        });
        column.visible = hasValue;
      } else if (autoHide) {
        column.visible = true;
      }
    });
  }

  private isRelevantForType(column: ColumnSetting) {
    if (column.category === 'monthly' && this.calculationType === 'bonus') {
      return false;
    }
    if (column.category === 'bonus' && this.calculationType === 'standard') {
      return false;
    }
    return true;
  }

  private calculateSummaries() {
    this.departmentSummaries = this.buildDepartmentSummaries();
    this.insuranceSummaries = this.buildInsuranceSummaries();
  }

  private buildDepartmentSummaries(): DepartmentSummary[] {
    const summaryMap = new Map<string, DepartmentSummary>();

    this.rows.forEach((row) => {
      const key = `${row.month}-${row.department}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          month: row.month,
          department: row.department,
          headcount: 0,
          monthlyPay: 0,
          bonusPay: 0,
          employeeShare: 0,
          employerShare: 0,
        });
      }
      const target = summaryMap.get(key)!;
      target.headcount += 1;
      target.monthlyPay += row.monthlySalary;
      target.bonusPay += row.bonusTotalPay;

      const monthlyEmployee =
        row.healthEmployeeMonthly + row.nursingEmployeeMonthly + row.welfareEmployeeMonthly;
      const monthlyEmployer =
        row.healthEmployerMonthly + row.nursingEmployerMonthly + row.welfareEmployerMonthly;
      const bonusEmployee =
        row.healthEmployeeBonus + row.nursingEmployeeBonus + row.welfareEmployeeBonus;
      const bonusEmployer =
        row.healthEmployerBonus + row.nursingEmployerBonus + row.welfareEmployerBonus;

      target.employeeShare += monthlyEmployee + bonusEmployee;
      target.employerShare += monthlyEmployer + bonusEmployer;
    });

    return Array.from(summaryMap.values()).map((entry) => ({
      ...entry,
      total: entry.employeeShare + entry.employerShare,
    }));
  }

  private buildInsuranceSummaries(): InsuranceSummary[] {
    const summaries: InsuranceSummary[] = [
      { type: '健康保険', employee: 0, employer: 0 },
      { type: '介護保険', employee: 0, employer: 0 },
      { type: '厚生年金', employee: 0, employer: 0 },
    ];

    this.rows.forEach((row) => {
      summaries[0].employee += row.healthEmployeeMonthly + row.healthEmployeeBonus;
      summaries[0].employer += row.healthEmployerMonthly + row.healthEmployerBonus;
      summaries[1].employee += row.nursingEmployeeMonthly + row.nursingEmployeeBonus;
      summaries[1].employer += row.nursingEmployerMonthly + row.nursingEmployerBonus;
      summaries[2].employee += row.welfareEmployeeMonthly + row.welfareEmployeeBonus;
      summaries[2].employer += row.welfareEmployerMonthly + row.welfareEmployerBonus;
    });

    return summaries.map((row) => ({ ...row, total: row.employee + row.employer }));
  }

  goToApprovalFlow() {
    this.router.navigate(['/approvals'], {
      queryParams: {
        source: 'calculations',
        type: this.calculationType,
        month: this.targetMonth,
      },
    });
  }
}

interface DepartmentSummary {
  month: string;
  department: string;
  headcount: number;
  monthlyPay: number;
  bonusPay: number;
  employeeShare: number;
  employerShare: number;
  total?: number;
}

interface InsuranceSummary {
  type: string;
  employee: number;
  employer: number;
  total?: number;
}