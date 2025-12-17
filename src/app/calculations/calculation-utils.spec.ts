import { PrefectureRate, InsuranceRateRecord } from '../app/services/insurance-rates.service';
import {
  calculateInsurancePremium,
  calculatePensionPremium,
  floorInsuranceTotal,
  roundToInsuranceUnit,
} from './calculation-utils';

describe('roundToInsuranceUnit', () => {
  it('rounds down at exactly 50銭', () => {
    expect(roundToInsuranceUnit(100.5)).toBe(100);
  });

  it('rounds up when exceeding 50銭', () => {
    expect(roundToInsuranceUnit(100.51)).toBe(101);
  });

  it('rounds down when below 50銭', () => {
    expect(roundToInsuranceUnit(100.49)).toBe(100);
  });
});

describe('floorInsuranceTotal', () => {
  it('drops any fraction under 1円', () => {
    expect(floorInsuranceTotal(123.99)).toBe(123);
  });
});

describe('premium calculations', () => {
  const insuranceRate: PrefectureRate = {
    prefecture: '東京',
    totalRate: '9.50',
    employeeRate: '4.75',
  };

  const pensionRate: InsuranceRateRecord['pensionRate'] = {
    totalRate: '18.30',
    employeeRate: '9.15',
  };

  it('applies half-down rounding for monthly health insurance premiums', () => {
    const monthly = calculateInsurancePremium(1234.56, insuranceRate);

    expect(monthly.employee).toBe(59);
    expect(monthly.employer).toBe(58);
    expect(monthly.total).toBe(117);
  });

  it('applies the same rounding when calculating bonus health premiums', () => {
    const bonus = calculateInsurancePremium(98765.43, insuranceRate);

    expect(bonus.employee).toBe(4691);
    expect(bonus.employer).toBe(4691);
    expect(bonus.total).toBe(9382);
  });

  it('applies updated rounding for pension premiums', () => {
    const pension = calculatePensionPremium(87654.32, pensionRate);

    expect(pension.employee).toBe(8020);
    expect(pension.employer).toBe(8020);
    expect(pension.total).toBe(16040);
  });
});