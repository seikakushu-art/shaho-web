import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

type CalculationType = 'standard' | 'bonus' | 'insurance';

interface EmployeeCandidate {
  employeeNo: string;
  name: string;
  department: string;
  location: string;
  method: string;
}

@Component({
  selector: 'app-calculation-target',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calculation-target.component.html',
  styleUrl: './calculation-target.component.scss',
})
export class CalculationTargetComponent implements OnInit {
  calculationType: CalculationType = 'standard';
  targetMonth = '2025-02';
  bonusMonth = '2025-03';
  calculationMethod: '自動算出' | '個別入力' = '自動算出';
  department = '';
  location = '';
  employeeNo = '';
  insuranceSelections: Record<string, boolean> = {
    health: true,
    welfare: true,
    employment: false,
    nursing: false,
  };

  readonly departments = ['管理部', '営業部', '開発部', 'サポート'];
  readonly locations = ['東京', '大阪', '名古屋', 'リモート'];
  readonly calculationMethods = ['自動算出', '個別入力'] as const;
  readonly calculationTypes: Record<CalculationType, string> = {
    standard: '標準報酬月額計算（2.4.1）',
    bonus: '賞与額計算（2.4.2）',
    insurance: '社会保険料計算（2.4.2拡張）',
  };

  candidates: EmployeeCandidate[] = [
    {
      employeeNo: 'E202501',
      name: '佐藤 花子',
      department: '管理部',
      location: '東京',
      method: '自動算出',
    },
    {
      employeeNo: 'E202502',
      name: '鈴木 太郎',
      department: '営業部',
      location: '大阪',
      method: '個別入力',
    },
    {
      employeeNo: 'E202503',
      name: '高橋 未来',
      department: '開発部',
      location: 'リモート',
      method: '自動算出',
    },
    {
      employeeNo: 'E202504',
      name: '田中 直樹',
      department: 'サポート',
      location: '名古屋',
      method: '自動算出',
    },
  ];

  constructor(private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const type = this.route.snapshot.queryParamMap.get('type') as CalculationType | null;
    if (type) {
      this.calculationType = type;
    }
  }

  get filteredCandidates() {
    return this.candidates.filter((candidate) => {
      const byDept = this.department ? candidate.department === this.department : true;
      const byLocation = this.location ? candidate.location === this.location : true;
      const byEmployeeNo = this.employeeNo
        ? candidate.employeeNo.toLowerCase().includes(this.employeeNo.toLowerCase())
        : true;
      const byMethod = this.calculationMethod ? candidate.method === this.calculationMethod : true;
      return byDept && byLocation && byEmployeeNo && byMethod;
    });
  }

  toggleInsurance(key: keyof typeof this.insuranceSelections) {
    this.insuranceSelections[key] = !this.insuranceSelections[key];
  }

  onSubmit() {
    this.router.navigate(['/calculations/results'], {
      queryParams: {
        type: this.calculationType,
        targetMonth: this.targetMonth,
        bonusMonth: this.bonusMonth,
        method: this.calculationMethod,
        insurances: Object.keys(this.insuranceSelections)
          .filter((k) => this.insuranceSelections[k])
          .join(','),
      },
    });
  }
}