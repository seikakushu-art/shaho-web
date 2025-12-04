import { Injectable, inject } from '@angular/core';
import { combineLatest, map, switchMap } from 'rxjs';
import { CorporateInfoService } from '../app/services/corporate-info.service';
import {
  InsuranceRateRecord,
  InsuranceRatesService,
  StandardCompensationGrade,
} from '../app/services/insurance-rates.service';
import { PayrollData, ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';
import {
  CalculationContext,
  InsuranceKey,
  calculateInsurancePremium,
  calculatePensionPremium,
  calculateStandardBonus,
  extractBonusCap,
  findPrefectureRate,
  resolveStandardMonthly,
} from '../calculations/calculation-utils';
import { CalculationType, StandardCalculationMethod } from '../calculations/calculation-types';

export interface CalculationRow {
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

export interface CalculationQueryParams {
  type: CalculationType;
  targetMonth: string;
  bonusMonth: string;
  method: string;
  standardMethod: StandardCalculationMethod;
  insurances: string[];
  department?: string;
  location?: string;
  employeeNo?: string;
  includeBonusInMonth?: boolean;
  bonusPaidOn?: string;
}

@Injectable({ providedIn: 'root' })
export class CalculationDataService {
  private employeesService = inject(ShahoEmployeesService);
  private insuranceRatesService = inject(InsuranceRatesService);
  private corporateInfoService = inject(CorporateInfoService);

  getCalculationRows(params: CalculationQueryParams) {
    const { type, targetMonth, bonusMonth, insurances, standardMethod } = params;
    const activeInsurances = this.resolveActiveInsurances(insurances);

    return this.corporateInfoService.getCorporateInfo().pipe(
      switchMap((info) =>
        combineLatest([
          this.employeesService.getEmployees(),
          this.insuranceRatesService.getRateHistory(info?.healthInsuranceType ?? '協会けんぽ'),
        ]).pipe(
          map(([employees, rateHistory]) => {
            const rateRecord = rateHistory?.[0] ?? this.buildFallbackRate();
            const context: CalculationContext = {
              targetMonth,
              bonusMonth,
              calculationType: type,
              standardCalculationMethod: standardMethod,
              activeInsurances,
              includeBonusInMonth: params.includeBonusInMonth,
            };

            const filtered = this.filterEmployees(employees, params);
            return filtered.map((employee) =>
              this.buildRow(employee, rateRecord, context, params.bonusPaidOn),
            );
          }),
        ),
      ),
    );
  }

  private filterEmployees(employees: ShahoEmployee[], params: CalculationQueryParams) {
    return employees.filter((employee) => {
      const matchesDepartment = params.department
        ? employee.department === params.department
        : true;
      const matchesLocation = params.location
        ? employee.workPrefecture === params.location || employee.department === params.location
        : true;
      const matchesEmployeeNo = params.employeeNo
        ? employee.employeeNo.toLowerCase().includes(params.employeeNo.toLowerCase())
        : true;

      return matchesDepartment && matchesLocation && matchesEmployeeNo;
    });
  }

  private buildRow(
    employee: ShahoEmployee,
    rateRecord: InsuranceRateRecord,
    context: CalculationContext,
    fallbackBonusDate?: string,
  ): CalculationRow {
    const payrolls = this.extractPayrolls(employee);
    const standard = resolveStandardMonthly(
      employee,
      payrolls,
      context.standardCalculationMethod,
      context.targetMonth,
      rateRecord.standardCompensations ?? [],
      employee.previousStandardMonthly,
    );

    const monthlySalary = payrolls.find((p) => p.yearMonth === context.targetMonth)?.amount ?? 0;
    const bonusRecord = this.findBonus(payrolls, context.bonusMonth, fallbackBonusDate);
    const bonusCap = extractBonusCap(rateRecord, '健康保険');
    const standardBonus = calculateStandardBonus(bonusRecord?.bonusTotal ?? 0, bonusCap);

    const location = employee.workPrefecture || employee.department || '未設定';
    const healthRate = findPrefectureRate(rateRecord.healthInsuranceRates, location);
    const nursingRate = findPrefectureRate(rateRecord.nursingCareRates, location);

    const healthMonthly = context.activeInsurances.includes('health')
      ? calculateInsurancePremium(standard.standardMonthly, healthRate)
      : { employee: 0, employer: 0, total: 0 };
    const nursingMonthly =
      context.activeInsurances.includes('nursing') && employee.careSecondInsured
        ? calculateInsurancePremium(standard.standardMonthly, nursingRate)
        : { employee: 0, employer: 0, total: 0 };
    const welfareMonthly = context.activeInsurances.includes('welfare')
      ? calculatePensionPremium(standard.standardMonthly, rateRecord.pensionRate)
      : { employee: 0, employer: 0, total: 0 };

    const healthBonus =
      context.activeInsurances.includes('health') && (context.includeBonusInMonth ?? true)
        ? calculateInsurancePremium(standardBonus, healthRate)
        : { employee: 0, employer: 0, total: 0 };
    const nursingBonus =
      context.activeInsurances.includes('nursing') && employee.careSecondInsured
        ? calculateInsurancePremium(standardBonus, nursingRate)
        : { employee: 0, employer: 0, total: 0 };
    const welfareBonus = context.activeInsurances.includes('welfare')
      ? calculatePensionPremium(standardBonus, rateRecord.pensionRate)
      : { employee: 0, employer: 0, total: 0 };

    return {
      employeeNo: employee.employeeNo,
      name: employee.name,
      department: employee.department ?? '未設定',
      location,
      month: context.targetMonth,
      monthlySalary,
      standardMonthly: standard.standardMonthly,
      healthEmployeeMonthly: healthMonthly.employee,
      healthEmployerMonthly: healthMonthly.employer,
      nursingEmployeeMonthly: nursingMonthly.employee,
      nursingEmployerMonthly: nursingMonthly.employer,
      welfareEmployeeMonthly: welfareMonthly.employee,
      welfareEmployerMonthly: welfareMonthly.employer,
      bonusPaymentDate: bonusRecord?.bonusPaidOn ?? '',
      bonusTotalPay: bonusRecord?.bonusTotal ?? 0,
      standardBonus,
      healthEmployeeBonus: healthBonus.employee,
      healthEmployerBonus: healthBonus.employer,
      nursingEmployeeBonus: nursingBonus.employee,
      nursingEmployerBonus: nursingBonus.employer,
      welfareEmployeeBonus: welfareBonus.employee,
      welfareEmployerBonus: welfareBonus.employer,
    };
  }

  private extractPayrolls(employee: ShahoEmployee): PayrollData[] {
    const payrolls = (employee as any).payrolls as PayrollData[] | undefined;
    return payrolls ?? [];
  }

  private findBonus(
    payrolls: PayrollData[],
    bonusMonth: string,
    fallbackBonusDate?: string,
  ): PayrollData | undefined {
    const byMonth = payrolls.find(
      (payroll) => payroll.bonusPaidOn && payroll.bonusPaidOn.startsWith(bonusMonth),
    );
    if (byMonth) return byMonth;
    const fallback = fallbackBonusDate
      ? payrolls.find((p) => p.bonusPaidOn === fallbackBonusDate)
      : undefined;
    return fallback;
  }

  private resolveActiveInsurances(insurances: string[]): InsuranceKey[] {
    const map: Record<string, InsuranceKey> = {
      健康: 'health',
      介護: 'nursing',
      厚生年金: 'welfare',
    };
    return insurances
      .map((label) => map[label])
      .filter((value): value is InsuranceKey => !!value);
  }

  private buildFallbackRate(): InsuranceRateRecord {
    const nowIso = new Date().toISOString();
    const grades: StandardCompensationGrade[] = [
      {
        insuranceType: '健康保険',
        grade: '1',
        lowerLimit: '0',
        upperLimit: '9999999',
        standardMonthlyCompensation: '300000',
      },
      {
        insuranceType: '厚生年金',
        grade: '1',
        lowerLimit: '0',
        upperLimit: '9999999',
        standardMonthlyCompensation: '300000',
      },
    ];

    return {
      healthInsuranceRates: [
        { prefecture: '東京', totalRate: '9.00', employeeRate: '4.50', effectiveFrom: nowIso },
      ],
      nursingCareRates: [
        { prefecture: '東京', totalRate: '1.80', employeeRate: '0.90', effectiveFrom: nowIso },
      ],
      pensionRate: { totalRate: '18.30', employeeRate: '9.15', effectiveFrom: nowIso },
      bonusCaps: [
        { insuranceType: '健康保険', monthlyCap: '573000', yearlyCap: '573000', yearlyCapEffectiveFrom: nowIso },
        { insuranceType: '厚生年金', monthlyCap: '1500000', yearlyCap: '1500000', yearlyCapEffectiveFrom: nowIso },
      ],
      standardCompensations: grades,
      createdAt: nowIso,
      updatedAt: nowIso,
      healthType: '協会けんぽ',
      insurerName: 'デモレート',
    } as InsuranceRateRecord;
  }
}