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
  | 'target'
  | 'method'
  | 'month'
  | 'insurance'
  | 'base'
  | 'bonus'
  | 'health'
  | 'welfare'
  | 'employment'
  | 'nursing'
  | 'total';

interface CalculationRow {
  employeeNo: string;
  name: string;
  department: string;
  location: string;
  target: string;
  method: string;
  month: string;
  insurance: string[];
  base: number;
  bonus: number;
  health: number;
  welfare: number;
  employment: number;
  nursing: number;
  total: number;
}

interface ColumnSetting {
  key: ColumnKey;
  label: string;
  visible: boolean;
  sortable?: boolean;
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
    { key: 'employeeNo', label: '社員番号', visible: true, sortable: true },
    { key: 'name', label: '氏名', visible: true, sortable: true },
    { key: 'department', label: '部署', visible: true, sortable: true },
    { key: 'location', label: '勤務地', visible: true, sortable: true },
    { key: 'target', label: '対象区分', visible: true },
    { key: 'method', label: '計算方法', visible: true },
    { key: 'month', label: '対象年月', visible: true },
    { key: 'insurance', label: '保険種別', visible: true },
    { key: 'base', label: '標準報酬月額', visible: true, sortable: true },
    { key: 'bonus', label: '賞与額', visible: true, sortable: true },
    { key: 'health', label: '健康保険料', visible: true, sortable: true },
    { key: 'welfare', label: '厚生年金保険料', visible: true, sortable: true },
    { key: 'employment', label: '雇用保険料', visible: true, sortable: true },
    { key: 'nursing', label: '介護保険料', visible: true, sortable: true },
    { key: 'total', label: '総額', visible: true, sortable: true },
  ];

  rows: CalculationRow[] = [
    {
      employeeNo: 'E202501',
      name: '佐藤 花子',
      department: '管理部',
      location: '東京',
      target: '標準報酬',
      method: '自動算出',
      month: '2025-02',
      insurance: ['健康', '厚生年金'],
      base: 420000,
      bonus: 0,
      health: 20500,
      welfare: 38400,
      employment: 0,
      nursing: 0,
      total: 58900,
    },
    {
      employeeNo: 'E202502',
      name: '鈴木 太郎',
      department: '営業部',
      location: '大阪',
      target: '賞与',
      method: '個別入力',
      month: '2025-03',
      insurance: ['健康', '厚生年金', '雇用'],
      base: 380000,
      bonus: 250000,
      health: 18600,
      welfare: 34700,
      employment: 7500,
      nursing: 0,
      total: 60800,
    },
    {
      employeeNo: 'E202503',
      name: '高橋 未来',
      department: '開発部',
      location: 'リモート',
      target: '標準報酬',
      method: '自動算出',
      month: '2025-02',
      insurance: ['健康', '厚生年金', '雇用', '介護'],
      base: 460000,
      bonus: 0,
      health: 22400,
      welfare: 42200,
      employment: 9200,
      nursing: 4200,
      total: 78000,
    },
  ];

  sortKey: ColumnKey = 'employeeNo';
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const type = params.get('type') as CalculationType | null;
    this.calculationType = type ?? 'standard';
    this.targetMonth = params.get('targetMonth') ?? '2025-02';
    this.bonusMonth = params.get('bonusMonth') ?? '2025-03';
    this.method = params.get('method') ?? '自動算出';
    this.activeInsurances = (params.get('insurances') ?? '健康,厚生年金').split(',');
  }

  get visibleColumns() {
    return this.columns.filter((c) => c.visible);
  }

  isColumnVisible(key: ColumnKey): boolean {
    const column = this.columns.find((c) => c.key === key);
    return column?.visible ?? false;
  }

  toggleColumn(key: ColumnKey) {
    const target = this.columns.find((c) => c.key === key);
    if (target) {
      target.visible = !target.visible;
    }
  }

  autoHideIrrelevant() {
    const numericKeys: ColumnKey[] = ['bonus', 'employment', 'nursing'];
    numericKeys.forEach((key) => {
      const hasValue = this.rows.some((row) => row[key] !== 0);
      const target = this.columns.find((c) => c.key === key);
      if (target) {
        target.visible = hasValue;
      }
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
      const valA = a[key];
      const valB = b[key];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * direction;
      }
      return String(valA).localeCompare(String(valB), 'ja') * direction;
    });
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