import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  getDoc,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
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
  normalizeToYearMonth,
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
  method: string;
  standardMethod: StandardCalculationMethod;
  insurances: string[];
  department?: string;
  location?: string;
  employeeNo?: string;
  includeBonusInMonth?: boolean;
  bonusPaidOn?: string;
}

export interface CalculationResultHistory {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  query: CalculationQueryParams;
  rows: CalculationRow[];
  meta?: {
    rowCount: number;
    activeInsurances: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class CalculationDataService {
  private employeesService = inject(ShahoEmployeesService);
  private insuranceRatesService = inject(InsuranceRatesService);
  private corporateInfoService = inject(CorporateInfoService);
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private historyCollection = collection(
    this.firestore,
    'calculation_result_history',
  );

  getCalculationRows(params: CalculationQueryParams) {
    const { type, targetMonth, insurances, standardMethod } =
      params;
    const activeInsurances = this.resolveActiveInsurances(insurances);

    // 標準賞与額計算の場合は、bonusPaidOnから年月を抽出してtargetMonthを設定
    let effectiveTargetMonth = targetMonth;
    if (type === 'bonus' && params.bonusPaidOn) {
      const normalized = normalizeToYearMonth(params.bonusPaidOn);
      if (normalized) {
        effectiveTargetMonth = normalized;
      }
    }

    return this.corporateInfoService.getCorporateInfo().pipe(
      switchMap((info) =>
        combineLatest([
          this.employeesService.getEmployeesWithPayrolls(),
          this.insuranceRatesService.getRateHistory(
            info?.healthInsuranceType ?? '協会けんぽ',
          ),
        ]).pipe(
          map(([employees, rateHistory]) => {
            const rateRecord = rateHistory?.[0] ?? this.buildFallbackRate();
            const context: CalculationContext = {
              targetMonth: effectiveTargetMonth,
              bonusPaymentDate: params.bonusPaidOn,
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

  getCalculationHistory(): Observable<CalculationResultHistory[]> {
    const q = query(this.historyCollection, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<
      CalculationResultHistory[]
    >;
  }

  async getHistoryById(id: string) {
    const docRef = doc(this.historyCollection, id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return undefined;
    const data = snapshot.data() as CalculationResultHistory;
    return { ...data, id: snapshot.id };
  }

  async saveCalculationHistory(
    query: CalculationQueryParams,
    rows: CalculationRow[],
    options?: { title?: string; id?: string },
  ) {
    const now = new Date().toISOString();
    const currentUser = this.getUserDisplayName();
    const history: CalculationResultHistory = {
      id: options?.id ?? `calc-${Date.now()}`,
      title: options?.title ?? `${query.type.toUpperCase()}`,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser,
      updatedBy: currentUser,
      query,
      rows,
      meta: {
        rowCount: rows.length,
        activeInsurances: query.insurances,
      },
    };

    const { id, ...dataWithoutId } = history;
    const docRef = doc(this.historyCollection, id);
    const snapshot = await getDoc(docRef);
    const existing = snapshot.exists()
      ? (snapshot.data() as CalculationResultHistory)
      : undefined;
    const { id: existingId, ...existingWithoutId } = existing || {};

    const docData = this.removeUndefined({
      ...existingWithoutId,
      ...dataWithoutId,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? currentUser,
      updatedAt: now,
      updatedBy: currentUser,
    });

    await setDoc(docRef, docData);
    return docRef.id;
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
        ? params.employeeNo
            .split(',')
            .map((no) => no.trim())
            .filter((no) => no.length > 0)
            .some((no) => employee.employeeNo.toLowerCase().includes(no.toLowerCase()))
        : true;

      const matchesBonusDate =
        params.type === 'bonus' && params.bonusPaidOn
          ? this.hasBonusOnDate(employee, params.bonusPaidOn)
          : true;

      return matchesDepartment && matchesLocation && matchesEmployeeNo && matchesBonusDate;
    });
  }

  private hasBonusOnDate(employee: ShahoEmployee, bonusPaidOn: string) {
    const payrolls = this.extractPayrolls(employee);
    const normalizedTarget = bonusPaidOn.replace(/\//g, '-');
    const isExactDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedTarget);

    // 日付指定（YYYY-MM-DD）の場合は完全一致のみ許容
    if (isExactDate) {
      return payrolls.some(
        (p) =>
          (p.bonusPaidOn ?? '').replace(/\//g, '-') === normalizedTarget,
      );
    }

    // 月指定の場合のみ前方一致で許容
    const bonusMonth = normalizeToYearMonth(normalizedTarget);
    if (!bonusMonth) return false;

    return payrolls.some((p) =>
      (p.bonusPaidOn ?? '').replace(/\//g, '-').startsWith(bonusMonth),
    );
  }

  private buildRow(
    employee: ShahoEmployee,
    rateRecord: InsuranceRateRecord,
    context: CalculationContext,
    fallbackBonusDate?: string,
  ): CalculationRow {
    const payrolls = this.extractPayrolls(employee);
    // 社会保険料計算と標準賞与額計算ではDBに保存された標準報酬月額をそのまま利用する
    // 標準報酬月額計算の場合のみ、標準報酬月額を計算する
    const standard =
      context.calculationType === 'insurance' || context.calculationType === 'bonus'
        ? {
            standardMonthly: employee.standardMonthly ?? 0,
            source: 'master' as const,
          }
        : resolveStandardMonthly(
            employee,
            payrolls,
            context.standardCalculationMethod,
            context.targetMonth,
            rateRecord.standardCompensations ?? [],
            employee.previousStandardMonthly,
          );

    // エラーチェック
    const errors: string[] = [];
    const withEmployeeInfo = (message: string) =>
      message.includes(employee.employeeNo) || message.includes(employee.name)
        ? message
        : `${message}（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;

    // 標準報酬月額計算の場合のみ、標準報酬月額の計算エラーをチェック
    if (context.calculationType === 'standard' && standard.error) {
      errors.push(withEmployeeInfo(standard.error));
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
      errors.push(
        withEmployeeInfo(
          `健康保険料率が設定されていません（勤務地: ${location}）。`,
        ),
      );
    }
    if (
      context.activeInsurances.includes('nursing') &&
      employee.careSecondInsured &&
      !nursingRate
    ) {
      errors.push(
        withEmployeeInfo(
          `介護保険料率が設定されていません（勤務地: ${location}）。`,
        ),
      );
    }
    if (
      context.activeInsurances.includes('welfare') &&
      !rateRecord.pensionRate
    ) {
      errors.push(
        withEmployeeInfo('厚生年金保険料率が設定されていません。'),
      );
    }

    // 社会保険料計算の場合、標準報酬月額が未設定の場合はエラー
    if (context.calculationType === 'insurance') {
      if (!employee.standardMonthly || employee.standardMonthly <= 0) {
        errors.push(
          withEmployeeInfo(`標準報酬月額を計算してください。`),
        );
      }
    }

    // 標準報酬月額計算の場合は、計算対象の月の給与データの平均を計算
    const monthlySalaryResult = context.calculationType === 'standard'
      ? this.calculateAverageMonthlySalary(
          payrolls,
          context.standardCalculationMethod,
          context.targetMonth,
          employee,
        )
      : payrolls.find((p) => p.yearMonth === context.targetMonth)?.amount ?? 0;

    const monthlySalary = monthlySalaryResult ?? 0;
    const bonusRecord =
      context.calculationType === 'insurance'
        ? this.findBonusByMonth(payrolls, context.targetMonth)
        : this.findBonus(
            payrolls,
            context.bonusPaymentDate ?? fallbackBonusDate,
          );

    // 標準賞与額計算の場合、標準賞与額が未設定の場合はエラー
    if (context.calculationType === 'bonus') {
      if (!bonusRecord) {
        errors.push(
          withEmployeeInfo(
            '指定の賞与支給日に該当する賞与データが見つかりません。',
          ),
        );
      } else if (!bonusRecord.bonusTotal || bonusRecord.bonusTotal <= 0) {
        errors.push(
          withEmployeeInfo('賞与総額が未設定または0です。'),
        );
      }
    }

    // エラーがある場合は計算をスキップ（標準賞与額のチェック後）
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
    
    const bonusDate = this.resolveBonusDate(
      bonusRecord,
      context.bonusPaymentDate ?? fallbackBonusDate,
    );
    const healthBonusCap = extractBonusCap(rateRecord, '健康保険', 'yearly');
    const welfareBonusCap = extractBonusCap(rateRecord, '厚生年金');
    const healthBonusCumulative = this.calculateHealthBonusCumulative(
      payrolls,
      bonusDate,
      bonusRecord,
      rateRecord,
    );
    const welfareBonusCumulative = this.calculateWelfareBonusCumulative(
      payrolls,
      bonusDate,
      bonusRecord,
      rateRecord,
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
      bonusPaymentDate:
        context.calculationType === 'insurance' ? '' : bonusRecord?.bonusPaidOn ?? '',
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

  private calculateAverageMonthlySalary(
    payrolls: PayrollData[],
    method: StandardCalculationMethod,
    targetMonth: string,
    employee?: ShahoEmployee,
  ): number | undefined {
    const eligiblePayrolls = payrolls.filter(
      (p) =>
        p.amount !== undefined && (p.workedDays ?? 0) >= 17,
    );

    switch (method) {
      case '定時決定': {
        const parsed = this.toYearMonthParts(targetMonth);
        if (!parsed) return 0;
        const months = [4, 5, 6].map((month) =>
          this.buildYearMonth(parsed.year, month),
        );
        const targetMonths = eligiblePayrolls.filter((p) =>
          months.includes(p.yearMonth),
        );
        if (targetMonths.length === 0) return 0;
        const total = targetMonths.reduce((sum, p) => sum + (p.amount ?? 0), 0);
        return Math.floor(total / targetMonths.length);
      }
      case '随時決定': {
        const parsed = this.toYearMonthParts(targetMonth);
        if (!parsed) return 0;
        
        // 対象月から連続した3ヶ月を生成
        const targetMonths: string[] = [];
        for (let i = 0; i < 3; i++) {
          let year = parsed.year;
          let month = parsed.month + i;
          while (month > 12) {
            month -= 12;
            year += 1;
          }
          targetMonths.push(this.buildYearMonth(year, month));
        }
        
        // 連続した3ヶ月のデータを取得（3ヶ月分揃っていなくても良い）
        const targetOrAfter = eligiblePayrolls.filter((p) =>
          targetMonths.includes(p.yearMonth),
        );
        
        // データが0件の場合は0を返す（エラーとして扱われる）、1件以上あれば利用可能なデータで計算
        if (targetOrAfter.length === 0) return 0;
        const total = targetOrAfter.reduce((sum, p) => sum + (p.amount ?? 0), 0);
        return Math.floor(total / targetOrAfter.length);
      }
      case '年間平均': {
        // 対象月が1～5月の場合はエラー
        const parsed = this.toYearMonthParts(targetMonth);
        if (!parsed) return undefined;
        if (parsed.month >= 1 && parsed.month <= 5) {
          return undefined;
        }
        
        // 前年7月～当年6月の12か月を生成
        const startYear = parsed.year - 1;
        const startMonth = 7;
        const endYear = parsed.year;
        const endMonth = 6;
        
        const targetMonths: string[] = [];
        // 前年7月～12月
        for (let month = startMonth; month <= 12; month++) {
          targetMonths.push(this.buildYearMonth(startYear, month));
        }
        // 当年1月～6月
        for (let month = 1; month <= endMonth; month++) {
          targetMonths.push(this.buildYearMonth(endYear, month));
        }
        
        const targetPayrolls = eligiblePayrolls.filter((p) =>
          targetMonths.includes(p.yearMonth),
        );
        if (targetPayrolls.length === 0) {
          return undefined;
        }
        const total = targetPayrolls.reduce((sum, p) => sum + (p.amount ?? 0), 0);
        return Math.floor(total / targetPayrolls.length);
      }
      case '資格取得時': {
        if (!employee) return 0;
        // 健康保険と厚生年金の資格取得日のうち、古い方を取得
        const healthAcq = employee.healthAcquisition;
        const pensionAcq = employee.pensionAcquisition;
        
        if (!healthAcq && !pensionAcq) return 0;
        
        // 古い方の資格取得日を特定
        const earliestAcquisition: string | undefined = healthAcq && pensionAcq
          ? (healthAcq < pensionAcq ? healthAcq : pensionAcq)
          : (healthAcq || pensionAcq);
        
        if (!earliestAcquisition || earliestAcquisition.length < 7) return 0;
        
        // 資格取得日の年月を取得（YYYY-MM形式に正規化）
        const acquisitionYearMonth = normalizeToYearMonth(earliestAcquisition);
        if (!acquisitionYearMonth) return 0;
        
        // 該当月の給与データを取得
        const acquisitionPayroll = eligiblePayrolls.find(
          (p) => p.yearMonth === acquisitionYearMonth,
        );
        
        return acquisitionPayroll?.amount ?? 0;
      }
      case '育休復帰時': {
        const sorted = eligiblePayrolls
          .filter((p) => p.yearMonth >= targetMonth)
          .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
          .slice(0, 3);
        if (sorted.length === 0) return 0;
        const total = sorted.reduce((sum, p) => sum + (p.amount ?? 0), 0);
        return Math.floor(total / sorted.length);
      }
      default:
        return 0;
    }
  }

  private toYearMonthParts(
    yearMonth: string,
  ): { year: number; month: number } | undefined {
    const [year, month] = yearMonth.split('-').map(Number);
    if (Number.isNaN(year) || Number.isNaN(month)) return undefined;
    return { year, month };
  }

  private buildYearMonth(year: number, month: number): string {
    const normalizedMonth = String(month).padStart(2, '0');
    return `${year}-${normalizedMonth}`;
  }

  private findBonus(
    payrolls: PayrollData[],
    bonusPaymentDate?: string,
  ): PayrollData | undefined {
    if (!bonusPaymentDate) return undefined;

    const normalizedTarget = bonusPaymentDate.replace(/\//g, '-');

    // まず完全一致で検索
    const exactMatch = payrolls.find(
      (payroll) =>
        payroll.bonusPaidOn &&
        payroll.bonusPaidOn.replace(/\//g, '-') === normalizedTarget,
    );
    if (exactMatch) return exactMatch;

    // 日まで指定されている場合は月単位のあいまい一致は行わない
    const isExactDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedTarget);
    if (isExactDate) return undefined;

    // 完全一致がない場合、月単位で検索（bonusPaymentDateから月を抽出）
    const bonusMonth = normalizeToYearMonth(normalizedTarget);
    if (bonusMonth) {
      const byMonth = payrolls.find(
        (payroll) => {
          const normalized = (payroll.bonusPaidOn ?? '').replace(/\//g, '-');
          return normalized.startsWith(bonusMonth);
        },
      );
      if (byMonth) return byMonth;
    }

    return undefined;
  }

  private findBonusByMonth(
    payrolls: PayrollData[],
    targetMonth: string,
  ): PayrollData | undefined {
    if (!targetMonth) return undefined;
    return payrolls.find((payroll) => {
      const normalized = (payroll.bonusPaidOn ?? '').replace(/\//g, '-');
      return normalized.startsWith(targetMonth);
    });
  }

  private resolveActiveInsurances(insurances: string[]): InsuranceKey[] {
    const map: Record<string, InsuranceKey> = {
      健康保険: 'health',
      介護保険: 'nursing',
      厚生年金: 'welfare',
    };
    return insurances
      .map((label) => map[label])
      .filter((value): value is InsuranceKey => !!value);
  }

  private resolveBonusDate(
    bonusRecord: PayrollData | undefined,
    bonusPaymentDate?: string,
  ): Date | undefined {
    // まずbonusRecordの支給日を優先
    const paidOn = bonusRecord?.bonusPaidOn ?? bonusPaymentDate;
    if (paidOn) {
      const parsed = new Date(paidOn);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // bonusPaymentDateから月を抽出して日付を作成（フォールバック）
    if (bonusPaymentDate) {
      const bonusMonth = normalizeToYearMonth(bonusPaymentDate);
      if (bonusMonth) {
        const [year, month] = bonusMonth.split('-').map(Number);
        if (!Number.isNaN(year) && !Number.isNaN(month)) {
          return new Date(Date.UTC(year, month - 1, 1));
        }
      }
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
    rateRecord?: InsuranceRateRecord,
  ) {
    const healthBonusCap = rateRecord
      ? extractBonusCap(rateRecord, '健康保険', 'yearly')
      : undefined;
    // 現在のボーナスのbonusPaidOnを正規化して比較用に取得
    const currentBonusPaidOn = currentBonus?.bonusPaidOn
      ? currentBonus.bonusPaidOn.replace(/\//g, '-')
      : undefined;
    return this.getFiscalYearBonuses(payrolls, bonusDate)
      .filter((record) => {
        // currentBonusが未設定の場合はすべて含める
        if (!currentBonusPaidOn) return true;
        // bonusPaidOnで比較（参照比較ではなく日付で比較）
        const recordBonusPaidOn = record.bonusPaidOn
          ? record.bonusPaidOn.replace(/\//g, '-')
          : undefined;
        return recordBonusPaidOn !== currentBonusPaidOn;
      })
      .reduce((sum, record) => {
        // 過去の標準賞与額（健・介）が設定されている場合はそれを使用
        if (record.standardHealthBonus !== undefined && record.standardHealthBonus > 0) {
          return sum + record.standardHealthBonus;
        }
        // 後方互換性: standardBonusが設定されている場合はそれを使用
        if (record.standardBonus !== undefined && record.standardBonus > 0) {
          return sum + record.standardBonus;
        }
        // 標準賞与額が未設定の場合は、賞与総支給額から標準賞与額を計算
        if (record.bonusTotal !== undefined && record.bonusTotal > 0) {
          return sum + calculateStandardBonus(record.bonusTotal, healthBonusCap);
        }
        return sum;
      }, 0);
  }

  private calculateWelfareBonusCumulative(
    payrolls: PayrollData[],
    bonusDate: Date | undefined,
    currentBonus?: PayrollData,
    rateRecord?: InsuranceRateRecord,
  ) {
    const welfareBonusCap = rateRecord
      ? extractBonusCap(rateRecord, '厚生年金')
      : undefined;
    // 現在のボーナスのbonusPaidOnを正規化して比較用に取得
    const currentBonusPaidOn = currentBonus?.bonusPaidOn
      ? currentBonus.bonusPaidOn.replace(/\//g, '-')
      : undefined;
    return this.getMonthlyBonuses(payrolls, bonusDate)
      .filter((record) => {
        // currentBonusが未設定の場合はすべて含める
        if (!currentBonusPaidOn) return true;
        // bonusPaidOnで比較（参照比較ではなく日付で比較）
        const recordBonusPaidOn = record.bonusPaidOn
          ? record.bonusPaidOn.replace(/\//g, '-')
          : undefined;
        return recordBonusPaidOn !== currentBonusPaidOn;
      })
      .reduce((sum, record) => {
        // 過去の標準賞与額（厚生年金）が設定されている場合はそれを使用
        if (record.standardWelfareBonus !== undefined && record.standardWelfareBonus > 0) {
          return sum + record.standardWelfareBonus;
        }
        // 後方互換性: standardBonusが設定されている場合はそれを使用
        if (record.standardBonus !== undefined && record.standardBonus > 0) {
          return sum + record.standardBonus;
        }
        // 標準賞与額が未設定の場合は、賞与総支給額から標準賞与額を計算
        if (record.bonusTotal !== undefined && record.bonusTotal > 0) {
          return sum + calculateStandardBonus(record.bonusTotal, welfareBonusCap);
        }
        return sum;
      }, 0);
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

  private getUserDisplayName(): string {
    const user = this.auth.currentUser;
    if (!user) return 'システム';
    if (user.displayName) return user.displayName;
    if (user.email) return user.email.split('@')[0];
    return user.uid ?? 'ユーザー';
  }

  private removeUndefined<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.removeUndefined(item)) as T;
    }
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj as any)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefined(value as any);
      }
    }
    return cleaned as T;
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
