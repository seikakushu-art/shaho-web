import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PayrollData, ShahoEmployeesService } from '../../app/services/shaho-employees.service';
import { normalizeToYearMonth } from '../calculation-utils';

type CalculationType = 'standard' | 'bonus' | 'insurance';
type StandardCalculationMethod = '定時決定' | '随時決定' | '年間平均' | '資格取得時' | '育休復帰時';
type InsuranceKey = 'health' | 'welfare' | 'nursing';

interface EmployeeCandidate {
  employeeNo: string;
  name: string;
  department: string;
  location: string;
  method: string;
  bonusPaidOn?: string;
  healthStandardMonthly?: number;
  welfareStandardMonthly?: number;
  careSecondInsured?: boolean;
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
  targetMonth = '';
  bonusPaymentDate = '';
  includeBonusInMonth = false;
  bonusOnly = false;
  standardCalculationMethod: StandardCalculationMethod = '定時決定';
  department = '';
  location = '';
  employeeNo = '';
  insuranceSelections: Record<InsuranceKey, boolean> = {
    health: true,
    welfare: true,
    nursing: true,
  };

  departments: string[] = [];
  locations: string[] = [];
  readonly calculationTypes: Record<CalculationType, string> = {
    standard: '標準報酬月額計算',
    bonus: '標準賞与額計算',
    insurance: '社会保険料計算',
  };
  readonly calculationTypeOrder: CalculationType[] = ['standard', 'bonus', 'insurance'];
  readonly standardCalculationMethods: StandardCalculationMethod[] = [
    '定時決定',
    '随時決定',
    '年間平均',
    '資格取得時',
    '育休復帰時',
  ];
  readonly insuranceLabels: Record<InsuranceKey, string> = {
    health: '健康保険',
    welfare: '厚生年金',
    nursing: '介護保険',
  };

  employeeBonusDates: Record<string, string> = {};
  employeeLocations: Record<string, string> = {};

  candidates: EmployeeCandidate[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private employeesService: ShahoEmployeesService,
  ) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const type = params.get('type') as CalculationType | null;
    this.calculationType = type ?? 'standard';
    this.targetMonth = params.get('targetMonth') ?? this.targetMonth;
    this.bonusPaymentDate = params.get('bonusPaidOn') ?? this.bonusPaymentDate;
    this.standardCalculationMethod =
      (params.get('standardMethod') as StandardCalculationMethod | null) ?? this.standardCalculationMethod;
    this.department = params.get('department') ?? this.department;
    this.location = params.get('location') ?? this.location;
    this.employeeNo = params.get('employeeNo') ?? this.employeeNo;
    this.includeBonusInMonth = params.get('includeBonusInMonth') === 'true' ? true : (params.get('includeBonusInMonth') === 'false' ? false : this.includeBonusInMonth);
    this.bonusOnly = params.get('bonusOnly') === 'true' ? true : false;
    // 相互排他チェック: 両方がtrueの場合はincludeBonusInMonthを優先
    if (this.bonusOnly && this.includeBonusInMonth) {
      this.bonusOnly = false;
    }

    // 標準報酬月額計算または標準賞与額計算の場合は保険種別の選択をクリア
    if (this.calculationType === 'standard' || this.calculationType === 'bonus') {
      this.insuranceSelections = {
        health: false,
        welfare: false,
        nursing: false,
      };
    } else {
      // 社会保険料計算の場合は、URLパラメータから復元、なければデフォルトで全チェック
      const queryInsurances = params.get('insurances');
      if (queryInsurances) {
        this.restoreInsuranceSelections(queryInsurances);
      }
      // URLパラメータがない場合は、初期値（すべてtrue）が維持される
    }
    this.loadEmployeeMetadata();
  }

  get filteredCandidates() {
    return this.candidates.filter((candidate) => {
      const byDept = this.department ? candidate.department === this.department : true;
      const resolvedLocation = this.getCandidateLocation(candidate);
      const byLocation = this.location ? resolvedLocation === this.location : true;
      const byEmployeeNo = this.employeeNo
        ? this.employeeNo
            .split(',')
            .map((no) => no.trim())
            .filter((no) => no.length > 0)
            .some((no) => candidate.employeeNo.toLowerCase().includes(no.toLowerCase()))
        : true;
      return byDept && byLocation && byEmployeeNo;
    });
  }

  toggleInsurance(key: InsuranceKey) {
    this.insuranceSelections[key] = !this.insuranceSelections[key];
  }

  getCandidateLocation(candidate: EmployeeCandidate): string {
    return this.employeeLocations[candidate.employeeNo] ?? candidate.location;
  }

  getCandidateBonusDate(candidate: EmployeeCandidate): string | undefined {
    const dateStr = this.employeeBonusDates[candidate.employeeNo] ?? candidate.bonusPaidOn;
    if (!dateStr) return undefined;
    return this.formatDate(dateStr);
  }

  private formatDate(dateStr: string): string {
    // YYYY-MM-DD または YYYY/MM/DD 形式を YYYY/MM/DD に統一
    const normalized = dateStr.replace(/\//g, '-');
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  get isStandardCalculation() {
    return this.calculationType === 'standard';
  }

  get isBonusCalculation() {
    return this.calculationType === 'bonus';
  }

  get isRegularDecision() {
    return this.isStandardCalculation && this.standardCalculationMethod === '定時決定';
  }

  get isAdHocDecision() {
    return this.isStandardCalculation && (this.standardCalculationMethod === '随時決定' || this.standardCalculationMethod === '育休復帰時');
  }

  get isAnnualAverage() {
    return this.isStandardCalculation && this.standardCalculationMethod === '年間平均';
  }

  get isAcquisitionDecision() {
    return this.isStandardCalculation && this.standardCalculationMethod === '資格取得時';
  }

  get targetYear(): number {
    if (!this.targetMonth || this.targetMonth.trim() === '') {
      return new Date().getFullYear();
    }
    const year = parseInt(this.targetMonth.split('-')[0], 10);
    return isNaN(year) ? new Date().getFullYear() : year;
  }

  set targetYear(year: number) {
    // 定時決定では年だけ使用されるので、月は01に固定
    if (year && !isNaN(year)) {
      this.targetMonth = `${year}-01`;
    }
  }

  get availableYears(): number[] {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    // 過去5年から未来2年まで
    for (let i = currentYear - 5; i <= currentYear + 2; i++) {
      years.push(i);
    }
    return years;
  }

  onCalculationTypeChange(type: string) {
    this.calculationType = type as CalculationType;
    // 標準報酬月額計算または標準賞与額計算の場合は保険種別の選択をクリア
    if (this.calculationType === 'standard' || this.calculationType === 'bonus') {
      this.insuranceSelections = {
        health: false,
        welfare: false,
        nursing: false,
      };
    } else if (this.calculationType === 'insurance') {
      // 社会保険料計算の場合は、すべての保険種別をデフォルトでチェック
      this.insuranceSelections = {
        health: true,
        welfare: true,
        nursing: true,
      };
    }
  }

  private restoreInsuranceSelections(queryInsurances: string) {
    if (!queryInsurances || queryInsurances.trim() === '') return;

    const activeLabels = new Set(queryInsurances.split(',').map(s => s.trim()).filter(s => s.length > 0));
    (Object.keys(this.insuranceSelections) as InsuranceKey[]).forEach((key) => {
      this.insuranceSelections[key] = activeLabels.has(this.insuranceLabels[key]);
    });
  }

  private loadEmployeeMetadata() {
    this.employeesService.getEmployeesWithPayrolls().subscribe((employees) => {
      if (!employees?.length) return;

      const enriched = employees
        .filter((emp) => !!emp.employeeNo)
        .map((emp) => ({
          employeeNo: emp.employeeNo,
          name: emp.name,
          department: emp.department ?? '未設定',
          location: emp.workPrefecture ?? emp.department ?? '未設定',
          method: '自動算出',
          bonusPaidOn: this.extractLatestBonusPaidOn((emp as any).payrolls ?? []),
          healthStandardMonthly: emp.healthStandardMonthly,
          welfareStandardMonthly: emp.welfareStandardMonthly,
          careSecondInsured: emp.careSecondInsured,
        } as EmployeeCandidate));

      this.mergeCandidates(enriched);
      this.refreshOptions();
    });
  }

  private mergeCandidates(fromService: EmployeeCandidate[]) {
    const mergedMap = new Map<string, EmployeeCandidate>();

    [...this.candidates, ...fromService].forEach((candidate) => {
      mergedMap.set(candidate.employeeNo, { ...mergedMap.get(candidate.employeeNo), ...candidate });
      if (candidate.location) {
        this.employeeLocations[candidate.employeeNo] = candidate.location;
      }
      const bonusDate = candidate.bonusPaidOn;
      if (bonusDate) {
        this.employeeBonusDates[candidate.employeeNo] = bonusDate;
      }
    });

    this.candidates = Array.from(mergedMap.values());
  }

  private refreshOptions() {
    const departments = new Set(this.departments);
    const locations = new Set(this.locations);

    this.candidates.forEach((candidate) => {
      if (candidate.department) {
        departments.add(candidate.department);
      }
      const resolvedLocation = this.getCandidateLocation(candidate);
      if (resolvedLocation) {
        locations.add(resolvedLocation);
      }
    });

    this.departments = Array.from(departments);
    this.locations = Array.from(locations);
  }

  private extractLatestBonusPaidOn(payrolls: PayrollData[]): string | undefined {
    return payrolls
      .filter((payroll) => payroll.bonusPaidOn)
      .sort((a, b) => (a.bonusPaidOn ?? '').localeCompare(b.bonusPaidOn ?? ''))
      .slice(-1)[0]?.bonusPaidOn;
  }

  onIncludeBonusInMonthChange() {
    if (this.includeBonusInMonth && this.bonusOnly) {
      this.bonusOnly = false;
    }
  }

  onBonusOnlyChange() {
    if (this.bonusOnly && this.includeBonusInMonth) {
      this.includeBonusInMonth = false;
    }
  }

  onSubmit() {
    const insurances = Object.keys(this.insuranceSelections)
      .filter((k) => this.insuranceSelections[k as InsuranceKey])
      .map((key) => this.insuranceLabels[key as InsuranceKey])
      .join(',');

    // 標準賞与額計算の場合は、bonusPaymentDateから年月を抽出
    let targetMonth = this.targetMonth;
    if (this.calculationType === 'bonus' && this.bonusPaymentDate) {
      const normalized = normalizeToYearMonth(this.bonusPaymentDate);
      if (normalized) {
        targetMonth = normalized;
      }
    }
    
    // targetMonthが空の場合は、定時決定の場合は現在の年-01、それ以外は現在の年月を設定
    if (!targetMonth || targetMonth.trim() === '') {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      if (this.isRegularDecision) {
        targetMonth = `${year}-01`;
      } else {
        targetMonth = `${year}-${month}`;
      }
    }

    const bonusPaidOnParam =
      this.calculationType === 'insurance' ? undefined : this.bonusPaymentDate;

    this.router.navigate(['/calculations/results'], {
      queryParams: {
        type: this.calculationType,
        targetMonth: targetMonth,
        standardMethod: this.standardCalculationMethod,
        bonusPaidOn: bonusPaidOnParam,
        includeBonusInMonth: this.includeBonusInMonth,
        bonusOnly: this.bonusOnly || undefined,
        department: this.department || undefined,
        location: this.location || undefined,
        employeeNo: this.employeeNo || undefined,
        insurances,
      },
    });
  }
}