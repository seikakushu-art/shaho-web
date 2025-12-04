import { InsuranceRateRecord, PrefectureRate, StandardCompensationGrade } from '../app/services/insurance-rates.service';
import { PayrollData, ShahoEmployee } from '../app/services/shaho-employees.service';
import { CalculationType, StandardCalculationMethod } from './calculation-types';

export type InsuranceKey = 'health' | 'nursing' | 'welfare';

export interface PremiumBreakdown {
  employee: number;
  employer: number;
  total: number;
}

export interface StandardCompensationResult {
  standardMonthly: number;
  source: 'payroll' | 'master' | 'fallback';
}

export interface CalculationContext {
  targetMonth: string;
  bonusMonth: string;
  calculationType: CalculationType;
  standardCalculationMethod: StandardCalculationMethod;
  activeInsurances: InsuranceKey[];
  includeBonusInMonth?: boolean;
}

export function parseRate(rate?: string): number {
  if (!rate) return 0;
  const normalized = rate.replace(/%/g, '').trim();
  const parsed = Number(normalized);
  return isNaN(parsed) ? 0 : parsed / 100;
}

export function roundToInsuranceUnit(value: number, mode: 'ceil' | 'floor' = 'ceil'): number {
  const halfRounded = mode === 'ceil' ? Math.ceil(value * 2) / 2 : Math.floor(value * 2) / 2;
  return Math.floor(halfRounded + 1e-6);
}

export function calculateStandardBonus(totalBonus: number, cap?: number): number {
  const capped = cap ? Math.min(totalBonus, cap) : totalBonus;
  return Math.floor(capped / 1000) * 1000;
}

export function findStandardCompensation(
  amount: number,
  grades: StandardCompensationGrade[],
  insuranceType: '健康保険' | '厚生年金',
): number {
  const applicable = grades.filter((grade) => grade.insuranceType === insuranceType);
  const matched = applicable.find((grade) => {
    const lower = Number(grade.lowerLimit ?? 0);
    const upper = Number(grade.upperLimit ?? Number.MAX_SAFE_INTEGER);
    return amount >= lower && amount <= upper;
  });
  if (matched?.standardMonthlyCompensation) {
    const parsed = Number(matched.standardMonthlyCompensation);
    if (!isNaN(parsed)) return parsed;
  }
  return amount;
}

function averageRecentPayroll(
  payrolls: PayrollData[],
  targetMonth: string,
  months: number,
): number | undefined {
  const sorted = payrolls
    .filter((p) => p.amount !== undefined && p.yearMonth <= targetMonth)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .slice(0, months);
  if (!sorted.length) return undefined;
  const total = sorted.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return total / sorted.length;
}

export function resolveStandardMonthly(
  employee: ShahoEmployee,
  payrolls: PayrollData[],
  method: StandardCalculationMethod,
  targetMonth: string,
  compensationTable: StandardCompensationGrade[],
): StandardCompensationResult {
  const fallback = employee.standardMonthly ?? payrolls.find((p) => p.amount)?.amount ?? 0;
  let base: number | undefined;

  switch (method) {
    case '定時決定':
      base = averageRecentPayroll(payrolls, targetMonth, 3);
      break;
    case '随時決定':
      base = payrolls.find((p) => p.yearMonth === targetMonth)?.amount;
      break;
    case '年間平均':
      base = averageRecentPayroll(payrolls, targetMonth, 12);
      break;
    case '資格取得時':
      base = [...payrolls].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))[0]?.amount;
      break;
    case '育休復帰時':
      base = payrolls.find((p) => p.amount && p.yearMonth >= targetMonth)?.amount;
      break;
  }

  const resolvedBase = base ?? fallback;
  const standardMonthly = findStandardCompensation(resolvedBase, compensationTable, '健康保険');
  return {
    standardMonthly,
    source: base ? 'payroll' : compensationTable.length ? 'master' : 'fallback',
  };
}

export function findPrefectureRate(
  rates: PrefectureRate[],
  prefecture?: string,
): PrefectureRate | undefined {
  if (!rates?.length) return undefined;
  if (prefecture) {
    const exact = rates.find((rate) => rate.prefecture === prefecture);
    if (exact) return exact;
  }
  return rates[0];
}

export function calculateInsurancePremium(
  base: number,
  rate: PrefectureRate | undefined,
  rounding: 'ceil' | 'floor' = 'ceil',
): PremiumBreakdown {
  if (!rate) {
    return { employee: 0, employer: 0, total: 0 };
  }

  const totalRate = parseRate(rate.totalRate);
  const employeeRate = parseRate(rate.employeeRate);
  const total = roundToInsuranceUnit(base * totalRate, rounding);
  const employee = roundToInsuranceUnit(base * employeeRate, rounding);
  const employer = roundToInsuranceUnit(total - employee, rounding);

  return { total, employee, employer };
}

export function calculatePensionPremium(
  base: number,
  rateDetail: InsuranceRateRecord['pensionRate'] | undefined,
  rounding: 'ceil' | 'floor' = 'ceil',
): PremiumBreakdown {
  if (!rateDetail) return { total: 0, employee: 0, employer: 0 };

  const totalRate = parseRate(rateDetail.totalRate);
  const employeeRate = parseRate(rateDetail.employeeRate);
  const total = roundToInsuranceUnit(base * totalRate, rounding);
  const employee = roundToInsuranceUnit(base * employeeRate, rounding);
  const employer = roundToInsuranceUnit(total - employee, rounding);

  return { total, employee, employer };
}

export function extractBonusCap(
  record: InsuranceRateRecord | undefined,
  insuranceType: '健康保険' | '厚生年金',
): number | undefined {
  const bonus = record?.bonusCaps?.find((cap) => cap.insuranceType === insuranceType);
  const rawCap = bonus?.monthlyCap || bonus?.yearlyCap;
  const parsed = rawCap ? Number(rawCap) : undefined;
  return parsed && !isNaN(parsed) ? parsed : undefined;
}