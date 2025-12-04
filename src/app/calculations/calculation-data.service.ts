import { Injectable, inject } from '@angular/core';
import { combineLatest, map, switchMap } from 'rxjs';
import { CorporateInfoService } from '../app/services/corporate-info.service';
import {
  InsuranceRateRecord,
  InsuranceRatesService,
  StandardCompensationGrade,
} from '../app/services/insurance-rates.service';
import {
  PayrollData,
  ShahoEmployee,
  ShahoEmployeesService,
} from '../app/services/shaho-employees.service';
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
import {
  CalculationType,
  StandardCalculationMethod,
} from '../calculations/calculation-types';

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
  healthEmployeeBonus: number;
  healthEmployerBonus: number;
  nursingEmployeeBonus: number;
  nursingEmployerBonus: number;
  welfareEmployeeBonus: number;
  welfareEmployerBonus: number;
  standardHealthBonus: number;
  standardWelfareBonus: number;
  error?: string;
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
    const { type, targetMonth, bonusMonth, insurances, standardMethod } =
      params;
    const activeInsurances = this.resolveActiveInsurances(insurances);

    return this.corporateInfoService.getCorporateInfo().pipe(
      switchMap((info) =>
        combineLatest([
          this.employeesService.getEmployees(),
          this.insuranceRatesService.getRateHistory(
            info?.healthInsuranceType ?? '協会けんぽ',
          ),
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

  private filterEmployees(
    employees: ShahoEmployee[],
    params: CalculationQueryParams,
  ) {
    return employees.filter((employee) => {
      const matchesDepartment = params.department
        ? employee.department === params.department
        : true;
      const matchesLocation = params.location
        ? employee.workPrefecture === params.location ||
          employee.department === params.location
        : true;
      const matchesEmployeeNo = params.employeeNo
        ? employee.employeeNo
            .toLowerCase()
            .includes(params.employeeNo.toLowerCase())
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

    // エラーチェック
    const errors: string[] = [];
    if (standard.error) {
      errors.push(standard.error);
    }

    const location = employee.workPrefecture || employee.department || '未設定';
    const healthRate = findPrefectureRate(
      rateRecord.healthInsuranceRates,
      location,
    );
    const nursingRate = findPrefectureRate(
      rateRecord.nursingCareRates,
      location,
    );

    // 保険料率のチェック
    if (context.activeInsurances.includes('health') && !healthRate) {
      errors.push(`健康保険料率が設定されていません（勤務地: ${location}）。`);
    }
    if (
      context.activeInsurances.includes('nursing') &&
      employee.careSecondInsured &&
      !nursingRate
    ) {
      errors.push(`介護保険料率が設定されていません（勤務地: ${location}）。`);
    }
    if (
      context.activeInsurances.includes('welfare') &&
      !rateRecord.pensionRate
    ) {
      errors.push('厚生年金保険料率が設定されていません。');
    }

    // エラーがある場合は計算をスキップ
    if (errors.length > 0) {
      return {
        employeeNo: employee.employeeNo,
        name: employee.name,
        department: employee.department ?? '未設定',
        location,
        month: context.targetMonth,
        monthlySalary: 0,
        standardMonthly: 0,
        healthEmployeeMonthly: 0,
        healthEmployerMonthly: 0,
        nursingEmployeeMonthly: 0,
        nursingEmployerMonthly: 0,
        welfareEmployeeMonthly: 0,
        welfareEmployerMonthly: 0,
        bonusPaymentDate: '',
        bonusTotalPay: 0,
        standardHealthBonus: 0,
        standardWelfareBonus: 0,
        healthEmployeeBonus: 0,
        healthEmployerBonus: 0,
        nursingEmployeeBonus: 0,
        nursingEmployerBonus: 0,
        welfareEmployeeBonus: 0,
        welfareEmployerBonus: 0,
        error: errors.join(' '),
      };
    }

    const monthlySalary =
      payrolls.find((p) => p.yearMonth === context.targetMonth)?.amount ?? 0;
    const bonusRecord = this.findBonus(
      payrolls,
      context.bonusMonth,
      fallbackBonusDate,
    );
    const bonusDate = this.resolveBonusDate(
      bonusRecord,
      context.bonusMonth,
      fallbackBonusDate,
    );
    const healthBonusCap = extractBonusCap(rateRecord, '健康保険', 'yearly');
    const welfareBonusCap = extractBonusCap(rateRecord, '厚生年金');
    const healthBonusCumulative = this.calculateHealthBonusCumulative(
      payrolls,
      bonusDate,
      bonusRecord,
    );
    const welfareBonusCumulative = this.calculateWelfareBonusCumulative(
      payrolls,
      bonusDate,
      bonusRecord,
    );
    const standardHealthBonus = this.calculateStandardBonusWithCumulative(
      bonusRecord?.bonusTotal ?? 0,
      healthBonusCap,
      healthBonusCumulative,
    );
    const standardWelfareBonus = this.calculateStandardBonusWithCumulative(
      bonusRecord?.bonusTotal ?? 0,
      welfareBonusCap,
      welfareBonusCumulative,
    );

    const healthMonthly = context.activeInsurances.includes('health')
      ? calculateInsurancePremium(standard.standardMonthly, healthRate)
      : { employee: 0, employer: 0, total: 0 };
    const nursingMonthly =
      context.activeInsurances.includes('nursing') && employee.careSecondInsured
        ? calculateInsurancePremium(standard.standardMonthly, nursingRate)
        : { employee: 0, employer: 0, total: 0 };
    const welfareMonthly = context.activeInsurances.includes('welfare')
      ? calculatePensionPremium(
          standard.standardMonthly,
          rateRecord.pensionRate,
        )
      : { employee: 0, employer: 0, total: 0 };

    const healthBonus =
      context.activeInsurances.includes('health') &&
      (context.includeBonusInMonth ?? true)
        ? calculateInsurancePremium(standardHealthBonus, healthRate)
        : { employee: 0, employer: 0, total: 0 };
    const nursingBonus =
      context.activeInsurances.includes('nursing') &&
      employee.careSecondInsured &&
      (context.includeBonusInMonth ?? true)
        ? calculateInsurancePremium(standardHealthBonus, nursingRate)
        : { employee: 0, employer: 0, total: 0 };
    const welfareBonus =
      context.activeInsurances.includes('welfare') &&
      (context.includeBonusInMonth ?? true)
        ? calculatePensionPremium(standardWelfareBonus, rateRecord.pensionRate)
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
      standardHealthBonus,
      standardWelfareBonus,
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
      (payroll) =>
        payroll.bonusPaidOn && payroll.bonusPaidOn.startsWith(bonusMonth),
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

  private resolveBonusDate(
    bonusRecord: PayrollData | undefined,
    bonusMonth: string,
    fallbackBonusDate?: string,
  ): Date | undefined {
    const paidOn = bonusRecord?.bonusPaidOn ?? fallbackBonusDate;
    if (paidOn) {
      const parsed = new Date(paidOn);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    const [year, month] = bonusMonth.split('-').map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      return new Date(Date.UTC(year, month - 1, 1));
    }

    return undefined;
  }

  private toBonusDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private getFiscalYearRange(baseDate: Date) {
    const month = baseDate.getUTCMonth() + 1;
    const baseYear = baseDate.getUTCFullYear();
    const fiscalYearStartYear = month >= 4 ? baseYear : baseYear - 1;

    const start = new Date(Date.UTC(fiscalYearStartYear, 3, 1));
    const end = new Date(
      Date.UTC(fiscalYearStartYear + 1, 2, 31, 23, 59, 59, 999),
    );
    return { start, end };
  }

  private getFiscalYearBonuses(payrolls: PayrollData[], bonusDate?: Date) {
    if (!bonusDate) return [] as PayrollData[];
    const { start, end } = this.getFiscalYearRange(bonusDate);

    return payrolls.filter((payroll) => {
      const paidOn = this.toBonusDate(payroll.bonusPaidOn);
      return paidOn ? paidOn >= start && paidOn <= end : false;
    });
  }

  private getMonthlyBonuses(payrolls: PayrollData[], bonusDate?: Date) {
    if (!bonusDate) return [] as PayrollData[];
    const targetMonth = bonusDate.getUTCMonth();
    const targetYear = bonusDate.getUTCFullYear();

    return payrolls.filter((payroll) => {
      const paidOn = this.toBonusDate(payroll.bonusPaidOn);
      return paidOn
        ? paidOn.getUTCFullYear() === targetYear &&
            paidOn.getUTCMonth() === targetMonth
        : false;
    });
  }

  private calculateHealthBonusCumulative(
    payrolls: PayrollData[],
    bonusDate: Date | undefined,
    currentBonus?: PayrollData,
  ) {
    return this.getFiscalYearBonuses(payrolls, bonusDate)
      .filter((record) => record !== currentBonus)
      .reduce((sum, record) => sum + (record.bonusTotal ?? 0), 0);
  }

  private calculateWelfareBonusCumulative(
    payrolls: PayrollData[],
    bonusDate: Date | undefined,
    currentBonus?: PayrollData,
  ) {
    return this.getMonthlyBonuses(payrolls, bonusDate)
      .filter((record) => record !== currentBonus)
      .reduce((sum, record) => sum + (record.bonusTotal ?? 0), 0);
  }

  private calculateStandardBonusWithCumulative(
    currentBonusTotal: number,
    cap: number | undefined,
    cumulative: number,
  ) {
    if (!cap) return calculateStandardBonus(currentBonusTotal);
    const remaining = Math.max(cap - cumulative, 0);
    if (remaining <= 0) return 0;
    return calculateStandardBonus(Math.min(currentBonusTotal, remaining));
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
        {
          prefecture: '東京',
          totalRate: '9.00',
          employeeRate: '4.50',
          effectiveFrom: nowIso,
        },
      ],
      nursingCareRates: [
        {
          prefecture: '東京',
          totalRate: '1.80',
          employeeRate: '0.90',
          effectiveFrom: nowIso,
        },
      ],
      pensionRate: {
        totalRate: '18.30',
        employeeRate: '9.15',
        effectiveFrom: nowIso,
      },
      bonusCaps: [
        {
          insuranceType: '健康保険',
          monthlyCap: '573000',
          yearlyCap: '573000',
          yearlyCapEffectiveFrom: nowIso,
        },
        {
          insuranceType: '厚生年金',
          monthlyCap: '1500000',
          yearlyCap: '1500000',
          yearlyCapEffectiveFrom: nowIso,
        },
      ],
      standardCompensations: grades,
      createdAt: nowIso,
      updatedAt: nowIso,
      healthType: '協会けんぽ',
      insurerName: 'デモレート',
    } as InsuranceRateRecord;
  }
}
