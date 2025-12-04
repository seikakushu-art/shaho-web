import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

type CalculationType = 'standard' | 'bonus' | 'insurance';

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

interface CalculationRow {
  employeeNo: string;
  name: string;
  department: string;
  location: string;
  month: string;
  monthlySalary: number;
  standardMonthly: number;
  healthEmployeeMonthly: number;
  healthEmployerMonthly: number;
  nursingEmployeeMonthly: number;
  nursingEmployerMonthly: number;
  welfareEmployeeMonthly: number;
  welfareEmployerMonthly: number;
  bonusPaymentDate: string;
  bonusTotalPay: number;
  standardBonus: number;
  healthEmployeeBonus: number;
  healthEmployerBonus: number;
  nursingEmployeeBonus: number;
  nursingEmployerBonus: number;
  welfareEmployeeBonus: number;
  welfareEmployerBonus: number;
}
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
export class CalculationResultComponent implements OnInit {
  calculationType: CalculationType = 'standard';
  targetMonth = '';
  bonusMonth = '';
  method = '';
  activeInsurances: string[] = [];

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

  rows: CalculationRow[] = [
    {
      employeeNo: 'E202501',
      name: '佐藤 花子',
      department: '管理部',
      location: '東京',
      month: '2025-02',
      monthlySalary: 420000,
      standardMonthly: 420000,
      healthEmployeeMonthly: 20500,
      healthEmployerMonthly: 20500,
      nursingEmployeeMonthly: 0,
      nursingEmployerMonthly: 0,
      welfareEmployeeMonthly: 38400,
      welfareEmployerMonthly: 38400,
      bonusPaymentDate: '2025-03-25',
      bonusTotalPay: 0,
      standardBonus: 0,
      healthEmployeeBonus: 0,
      healthEmployerBonus: 0,
      nursingEmployeeBonus: 0,
      nursingEmployerBonus: 0,
      welfareEmployeeBonus: 0,
      welfareEmployerBonus: 0,
    },
    {
      employeeNo: 'E202502',
      name: '鈴木 太郎',
      department: '営業部',
      location: '大阪',
      month: '2025-03',
      monthlySalary: 380000,
      standardMonthly: 380000,
      healthEmployeeMonthly: 18600,
      healthEmployerMonthly: 18600,
      nursingEmployeeMonthly: 0,
      nursingEmployerMonthly: 0,
      welfareEmployeeMonthly: 34700,
      welfareEmployerMonthly: 34700,
      bonusPaymentDate: '2025-03-10',
      bonusTotalPay: 250000,
      standardBonus: 250000,
      healthEmployeeBonus: 11000,
      healthEmployerBonus: 11000,
      nursingEmployeeBonus: 0,
      nursingEmployerBonus: 0,
      welfareEmployeeBonus: 22800,
      welfareEmployerBonus: 22800,
    },
    {
      employeeNo: 'E202503',
      name: '高橋 未来',
      department: '開発部',
      location: 'リモート',
      month: '2025-02',
      monthlySalary: 460000,
      standardMonthly: 460000,
      healthEmployeeMonthly: 22400,
      healthEmployerMonthly: 22400,
      nursingEmployeeMonthly: 4200,
      nursingEmployerMonthly: 4200,
      welfareEmployeeMonthly: 42200,
      welfareEmployerMonthly: 42200,
      bonusPaymentDate: '2025-04-05',
      bonusTotalPay: 180000,
      standardBonus: 180000,
      healthEmployeeBonus: 8200,
      healthEmployerBonus: 8200,
      nursingEmployeeBonus: 1800,
      nursingEmployerBonus: 1800,
      welfareEmployeeBonus: 16400,
      welfareEmployerBonus: 16400,
    },
  ];

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
    this.activeInsurances = (params.get('insurances') ?? '健康,厚生年金,介護').split(',');
    this.refreshVisibility(true);
    this.calculateSummaries();
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
    this.columns.forEach((column) => {
      const relevant = this.isRelevantForType(column);
      if (!relevant) {
        column.visible = false;
        return;
      }

      if (autoHide) {
        const hasValue = this.rows.some((row) => {
          const value = this.getRawValue(row, column.key);
          if (typeof value === 'number') return value !== 0;
          return !!value;
        });
        column.visible = hasValue;
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