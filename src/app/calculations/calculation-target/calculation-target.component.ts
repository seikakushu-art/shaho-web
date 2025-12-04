import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PayrollData, ShahoEmployeesService } from '../../app/services/shaho-employees.service';

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
  bonusPaymentDate = '2025-03-15';
  includeBonusInMonth = true;
  calculationMethod: '自動算出' | '個別入力' = '自動算出';
  standardCalculationMethod: StandardCalculationMethod = '定時決定';
  department = '';
  location = '';
  employeeNo = '';
  insuranceSelections: Record<InsuranceKey, boolean> = {
    health: true,
    welfare: true,
    nursing: false,
  };

  departments: string[] = [];
  locations: string[] = [];
  readonly calculationMethods = ['自動算出', '個別入力'] as const;
  readonly calculationTypes: Record<CalculationType, string> = {
    standard: '標準報酬月額計算（2.4.1）',
    bonus: '賞与額計算（2.4.2）',
    insurance: '社会保険料計算（2.4.2拡張）',
  };
  readonly standardCalculationMethods: StandardCalculationMethod[] = [
    '定時決定',
    '随時決定',
    '年間平均',
    '資格取得時',
    '育休復帰時',
  ];
  readonly insuranceLabels: Record<InsuranceKey, string> = {
    health: '健康',
    welfare: '厚生年金',
    nursing: '介護',
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
    this.bonusMonth = params.get('bonusMonth') ?? this.bonusMonth;
    this.bonusPaymentDate = params.get('bonusPaidOn') ?? this.bonusPaymentDate;
    this.calculationMethod = (params.get('method') as typeof this.calculationMethod | null) ?? this.calculationMethod;
    this.standardCalculationMethod =
      (params.get('standardMethod') as StandardCalculationMethod | null) ?? this.standardCalculationMethod;
    this.department = params.get('department') ?? this.department;
    this.location = params.get('location') ?? this.location;
    this.employeeNo = params.get('employeeNo') ?? this.employeeNo;
    this.includeBonusInMonth = params.get('includeBonusInMonth') === 'false' ? false : this.includeBonusInMonth;

    this.restoreInsuranceSelections(params.get('insurances'));
    this.loadEmployeeMetadata();
  }

  get filteredCandidates() {
    return this.candidates.filter((candidate) => {
      const byDept = this.department ? candidate.department === this.department : true;
      const resolvedLocation = this.getCandidateLocation(candidate);
      const byLocation = this.location ? resolvedLocation === this.location : true;
      const byEmployeeNo = this.employeeNo
        ? candidate.employeeNo.toLowerCase().includes(this.employeeNo.toLowerCase())
        : true;
      const byMethod = this.calculationMethod ? candidate.method === this.calculationMethod : true;
      return byDept && byLocation && byEmployeeNo && byMethod;
    });
  }

  toggleInsurance(key: InsuranceKey) {
    this.insuranceSelections[key] = !this.insuranceSelections[key];
  }

  getCandidateLocation(candidate: EmployeeCandidate): string {
    return this.employeeLocations[candidate.employeeNo] ?? candidate.location;
  }

  getCandidateBonusDate(candidate: EmployeeCandidate): string | undefined {
    return this.employeeBonusDates[candidate.employeeNo] ?? candidate.bonusPaidOn;
  }

  get isStandardCalculation() {
    return this.calculationType === 'standard';
  }

  get isBonusCalculation() {
    return this.calculationType === 'bonus';
  }

  onCalculationTypeChange(type: string) {
    this.calculationType = type as CalculationType;
  }

  private restoreInsuranceSelections(queryInsurances: string | null) {
    if (!queryInsurances) return;

    const activeLabels = new Set(queryInsurances.split(','));
    (Object.keys(this.insuranceSelections) as InsuranceKey[]).forEach((key) => {
      this.insuranceSelections[key] = activeLabels.has(this.insuranceLabels[key]);
    });
  }

  private loadEmployeeMetadata() {
    this.employeesService.getEmployees().subscribe((employees) => {
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

  onSubmit() {
    const insurances = Object.keys(this.insuranceSelections)
      .filter((k) => this.insuranceSelections[k as InsuranceKey])
      .map((key) => this.insuranceLabels[key as InsuranceKey])
      .join(',');

    this.router.navigate(['/calculations/results'], {
      queryParams: {
        type: this.calculationType,
        targetMonth: this.targetMonth,
        bonusMonth: this.bonusMonth,
        method: this.calculationMethod,
        standardMethod: this.standardCalculationMethod,
        bonusPaidOn: this.bonusPaymentDate,
        includeBonusInMonth: this.includeBonusInMonth,
        department: this.department || undefined,
        location: this.location || undefined,
        employeeNo: this.employeeNo || undefined,
        insurances,
      },
    });
  }
}