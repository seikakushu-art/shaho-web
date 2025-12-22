import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { initializeApp, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { CorporateInfoService } from '../app/services/corporate-info.service';
import {
  InsuranceRateRecord,
  InsuranceRatesService,
  PrefectureRate,
} from '../app/services/insurance-rates.service';
import {
  ShahoEmployee,
  PayrollData,
  ShahoEmployeesService,
} from '../app/services/shaho-employees.service';
import {
  CalculationDataService,
  CalculationQueryParams,
} from './calculation-data.service';
import { calculateStandardBonus } from './calculation-utils';

class EmployeesStub {
  employees: ShahoEmployee[] = [];

  getEmployees() {
    return of(this.employees);
  }
  getEmployeesWithPayrolls() {
    return of(this.employees);
  }
}

class RatesStub {
  rateHistory: InsuranceRateRecord[] = [];

  getRateHistory() {
    return of(this.rateHistory);
  }
}

class CorporateInfoStub {
  getCorporateInfo() {
    return of({ healthInsuranceType: '協会けんぽ' });
  }
}

// Firebaseアプリのテスト用設定
const firebaseConfig = {
  apiKey: 'test-api-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'test-project',
  storageBucket: 'test.appspot.com',
  messagingSenderId: '123456789',
  appId: 'test-app-id',
};

const standardCompensations = [
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

function createRateRecord(
  { healthYearlyCap, welfareMonthlyCap }: { healthYearlyCap: number; welfareMonthlyCap: number },
): InsuranceRateRecord {
  return {
    healthInsuranceRates: [
      { prefecture: '東京', totalRate: '9.00', employeeRate: '4.50', effectiveFrom: '2024-04-01' },
    ],
    nursingCareRates: [
      { prefecture: '東京', totalRate: '1.80', employeeRate: '0.90', effectiveFrom: '2024-04-01' },
    ],
    pensionRate: { totalRate: '18.30', employeeRate: '9.15', effectiveFrom: '2024-04-01' },
    bonusCaps: [
      {
        insuranceType: '健康保険',
        monthlyCap: `${healthYearlyCap}`,
        yearlyCap: `${healthYearlyCap}`,
        yearlyCapEffectiveFrom: '2024-04-01',
      },
      {
        insuranceType: '厚生年金',
        monthlyCap: `${welfareMonthlyCap}`,
        yearlyCap: `${welfareMonthlyCap}`,
        yearlyCapEffectiveFrom: '2024-04-01',
      },
    ],
    standardCompensations,
    createdAt: '2024-04-01',
    updatedAt: '2024-04-01',
    healthType: '協会けんぽ',
    insurerName: 'テスト',
  } as InsuranceRateRecord;
}

function createPremiumRateRecord(
  options?: {
    health?: PrefectureRate;
    nursing?: PrefectureRate;
    pension?: InsuranceRateRecord['pensionRate'];
    caps?: { health?: number; welfare?: number };
  },
): InsuranceRateRecord {
  const rate = createRateRecord({
    healthYearlyCap: options?.caps?.health ?? 3000000,
    welfareMonthlyCap: options?.caps?.welfare ?? 3000000,
  });

  rate.healthInsuranceRates = [
    options?.health ?? {
      prefecture: '東京',
      totalRate: '10.00',
      employeeRate: '5.00',
      effectiveFrom: '2024-04-01',
    },
  ];
  rate.nursingCareRates = [
    options?.nursing ?? {
      prefecture: '東京',
      totalRate: '1.50',
      employeeRate: '0.75',
      effectiveFrom: '2024-04-01',
    },
  ];
  rate.pensionRate =
    options?.pension ??
    {
      totalRate: '18.30',
      employeeRate: '9.15',
      effectiveFrom: '2024-04-01',
    };

  return rate;
}

function createSocialInsuranceRateRecord(): InsuranceRateRecord {
  const rate = createRateRecord({
    healthYearlyCap: 5730000,
    welfareMonthlyCap: 1500000,
  });

  rate.healthInsuranceRates = [
    {
      prefecture: '東京都',
      totalRate: '9.91',
      employeeRate: '4.955',
      effectiveFrom: '2024-04-01',
    },
    {
      prefecture: '大阪府',
      totalRate: '10.24',
      employeeRate: '5.12',
      effectiveFrom: '2024-04-01',
    },
  ];
  rate.nursingCareRates = [
    {
      prefecture: '東京都',
      totalRate: '1.59',
      employeeRate: '0.795',
      effectiveFrom: '2024-04-01',
    },
    {
      prefecture: '大阪府',
      totalRate: '1.59',
      employeeRate: '0.795',
      effectiveFrom: '2024-04-01',
    },
  ];
  return rate;
}


type BonusCase = {
  caseId: string;
  bonusPaidOn: string;
  bonusGrossThisPayment: number;
  priorBonusGrossSameMonth: number;
  priorKenpoStdBonusFiscalYTD: number;
  expectedKenpoStdBonusThisPayment: number;
  expectedKouseiStdBonusThisPayment: number;
  expectedKenpoFiscalYTD_After: number;
  expectedKouseiMonthTotal_After: number;
  note: string;
};

type SocialInsuranceBonusCase = {
  caseId: string;
  prefecture: string;
  careApplicable: boolean;
  bonusGross: number;
  healthYtdStandardBonusBefore: number;
  expectedStandardBonusHealth: number;
  expectedStandardBonusPension: number;
  expectedHealthEmployeeBonus: number;
  expectedHealthTotalBonus: number;
  expectedCareEmployeeBonus: number;
  expectedCareTotalBonus: number;
  expectedPensionEmployeeBonus: number;
  expectedPensionTotalBonus: number;
  note: string;
};

type SocialInsuranceMonthlyCase = {
  caseId: string;
  prefecture: string;
  careApplicable: boolean;
  healthStandardMonthly: number;
  pensionStandardMonthly: number;
  expectedHealthEmployeeMonthly: number;
  expectedHealthTotalMonthly: number;
  expectedCareEmployeeMonthly: number;
  expectedCareTotalMonthly: number;
  expectedPensionEmployeeMonthly: number;
  expectedPensionTotalMonthly: number;
  note: string;
};

function parseCsvWithTrailingNote(csv: string) {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const headers = lines[0].split(',');

  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    const base = parts.slice(0, headers.length - 1);
    const note = parts.slice(headers.length - 1).join(',');
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (index === headers.length - 1) {
        record[header] = note;
      } else {
        record[header] = base[index] ?? '';
      }
    });
    return record;
  });
}

const standardBonusCsv = `caseId,bonusPaidOn,bonusGrossThisPayment,priorBonusGrossSameMonth,priorKenpoStdBonusFiscalYTD,expectedKenpoStdBonusThisPayment,expectedKouseiStdBonusThisPayment,expectedKenpoFiscalYTD_After,expectedKouseiMonthTotal_After,note
M02a,2025-07-10,999,0,0,0,0,0,0,同月複数：999→まだ0
M02b,2025-07-25,1,999,0,1000,1000,1000,1000,同月複数：999+1=1000で一気に1000（支給回別切捨てだと誤りやすい）

M03a,2025-08-05,500,0,0,0,0,0,0,同月複数：500→0
M03b,2025-08-20,600,500,0,1000,1000,1000,1000,同月複数：500+600=1100→1000（両方単体だと0）

M04a,2025-09-10,1000,0,0,1000,1000,1000,1000,同月複数：最初に1000入る
M04b,2025-09-25,999,1000,1000,0,0,1000,1000,同月複数：1000+999=1999→月標準は1000のまま（増分0）

M05a,2025-10-10,1999,0,0,1000,1000,1000,1000,同月複数：1999→1000
M05b,2025-10-28,1,1999,1000,1000,1000,2000,2000,同月複数：1999+1=2000で増分1000

M06a,2025-11-05,333,0,0,0,0,0,0,同月3回：333→0
M06b,2025-11-15,333,333,0,0,0,0,0,同月3回：累計666→0
M06c,2025-11-25,333,666,0,0,0,0,0,同月3回：累計999→0（3回でも増分0）

M07a,2025-12-05,333,0,0,0,0,0,0,同月3回：333→0
M07b,2025-12-15,333,333,0,0,0,0,0,同月3回：累計666→0
M07c,2025-12-25,334,666,0,1000,1000,1000,1000,同月3回：累計1000→最後の1回で増分1000

M08a,2026-01-05,1200,0,0,1000,1000,1000,1000,同月3回：1200→1000
M08b,2026-01-20,800,1200,1000,1000,1000,2000,2000,同月3回：累計2000→増分1000
M08c,2026-01-30,500,2000,2000,0,0,2000,2000,同月3回：累計2500→月標準2000のまま（増分0）

M09a,2026-02-05,10000,0,0,10000,10000,10000,10000,同月3回：最初に10000
M09b,2026-02-15,999,10000,10000,0,0,10000,10000,同月3回：10000+999=10999→月標準10000のまま
M09c,2026-02-25,1,10999,10000,1000,1000,11000,11000,同月3回：最後の1円で11000に到達→増分1000

P07a,2025-09-10,1490500,0,0,1490000,1490000,1490000,1490000,厚年上限前：1490500→1490000
P07b,2025-09-25,20000,1490500,1490000,20000,10000,1510000,1500000,厚年：月150万上限で増分が10,000に圧縮（健保は20,000）

P08a,2025-10-10,2000000,0,0,2000000,1500000,2000000,1500000,厚年：初回で上限到達（150万）
P08b,2025-10-28,10000,2000000,2000000,10000,0,2010000,1500000,厚年：上限到達後は増分0（健保は増える）

K06a,2025-12-10,1999,0,5728000,1000,1000,5729000,1000,健保年度上限目前：残り2,000の状態でまず+1,000
K06b,2025-12-25,2001,1999,5729000,1000,3000,5730000,4000,健保：本来増分3,000だが残り1,000しかなく+1,000で頭打ち

K07a,2026-01-10,500000,0,5730000,0,500000,5730000,500000,健保：年度上限到達済→増分0
K07b,2026-01-25,500,500000,5730000,0,0,5730000,500000,健保：増分0のまま（厚年も月標準は変わらず）

K08a,2026-02-10,1499999,0,5720000,10000,1499000,5730000,1499000,健保：残り10,000で即上限到達（厚年は149.9万）
K08b,2026-02-25,10000,1499999,5730000,0,1000,5730000,1500000,健保：上限到達後は0／厚年：月150万上限で増分1,000`;

const socialInsuranceBonusCsv = `case_id,prefecture,care_applicable,bonus_gross,health_ytd_standard_bonus_before,expected_standard_bonus_health,expected_standard_bonus_pension,expected_health_employee_bonus,expected_health_total_bonus,expected_care_employee_bonus,expected_care_total_bonus,expected_pension_employee_bonus,expected_pension_total_bonus,note
B001,東京都,0,999,0,0,0,0,0,0,0,0,0,総支給999→標準0
B002,東京都,0,1000,0,1000,1000,50,99,0,0,91,183,総支給1000→標準1000
B003,東京都,0,1001,0,1000,1000,50,99,0,0,91,183,総支給1001→標準1000
B004,東京都,1,110000,0,110000,110000,5450,10901,874,1749,10065,20130,健保個人*.50境界/介護あり
B005,東京都,1,118000,0,118000,118000,5847,11693,938,1876,10797,21594,端数確認/介護あり
B006,東京都,1,333000,0,333000,333000,16500,33000,2647,5294,30469,60939,よくある値/介護あり
B007,東京都,0,333000,0,333000,333000,16500,33000,0,0,30469,60939,よくある値/介護なし
B008,大阪府,1,333000,0,333000,333000,17050,34099,2647,5294,30469,60939,大阪 料率差分/介護あり
B009,大阪府,0,333000,0,333000,333000,17050,34099,0,0,30469,60939,大阪 介護なし
B010,東京都,1,999000,0,999000,999000,49500,99000,7942,15884,91408,182817,高額レンジ/介護あり
B011,大阪府,1,999000,0,999000,999000,51149,102297,7942,15884,91408,182817,高額レンジ(大阪)/介護あり
B012,東京都,1,1234567,0,1234000,1234000,61145,122289,9810,19620,112911,225822,"標準=1,234,000(千円未満切捨)"
B013,大阪府,1,2345678,0,2345000,1500000,120064,240128,18643,37285,137250,274500,"標準=2,345,000(厚年上限)"
B014,東京都,0,1500999,0,1500000,1500000,74325,148650,0,0,137250,274500,"標準=1,500,000(厚年上限ぴったり)"
B015,東京都,1,1500999,0,1500000,1500000,74325,148650,11925,23850,137250,274500,上と同じ/介護あり
B016,大阪府,1,1600000,0,1600000,1500000,81920,163840,12720,25440,137250,274500,"厚年上限1,500,000(超過)"
B017,東京都,1,5730000,0,5730000,1500000,283921,567843,45553,91107,137250,274500,健保年度上限ぴったり
B018,東京都,1,6000000,0,5730000,1500000,283921,567843,45553,91107,137250,274500,健保年度上限でカット
B019,東京都,1,800000,5600000,130000,800000,6441,12883,1033,2067,73200,146400,"年度累計あり(残130,000)"
B020,東京都,1,500000,5730000,0,500000,0,0,0,0,45750,91500,年度累計上限到達(残0)
B021,大阪府,1,800000,5729000,1000,800000,51,102,8,15,73200,146400,"年度累計あり(残1,000)"
B022,大阪府,0,800000,5729000,1000,800000,51,102,0,0,73200,146400,"年度累計あり(残1,000)/介護なし"
B023,東京都,1,1000,5729000,1000,1000,50,99,8,15,91,183,"残1,000にピッタリ"
B024,東京都,1,2000,5729000,1000,2000,50,99,8,15,183,366,"標準2,000だが残1,000でカット"
B025,大阪府,1,1499999,0,1499000,1499000,76749,153497,11917,23834,137158,274317,"標準=1,499,000(厚年上限未満)"
B026,東京都,1,1500000,0,1500000,1500000,74325,148650,11925,23850,137250,274500,"標準=1,500,000(上限境界)"
B027,東京都,1,1501000,0,1501000,1500000,74375,148749,11933,23865,137250,274500,"標準=1,501,000(厚年上限超)"
B028,大阪府,1,1499000,0,1499000,1499000,76749,153497,11917,23834,137158,274317,"標準=1,499,000(大阪)"
B029,大阪府,1,151000,0,151000,151000,7731,15462,1200,2400,13816,27633,"標準=151,000(大阪)"
B030,東京都,0,2500000,3000000,2500000,1500000,123875,247750,0,0,137250,274500,"年度累計あり(残2,730,000)/厚年上限"`;

const socialInsuranceMonthlyCsv = `case_id,prefecture,care_applicable,health_standard_monthly,pension_standard_monthly,expected_health_employee_monthly,expected_health_total_monthly,expected_care_employee_monthly,expected_care_total_monthly,expected_pension_employee_monthly,expected_pension_total_monthly,note
M001,東京都,0,58000,88000,2874,5747,0,0,8052,16104,"min(健保/厚年),介護なし"
M002,東京都,1,58000,88000,2874,5747,461,922,8052,16104,"min,介護あり"
M003,東京都,0,110000,89000,5450,10901,0,0,8143,16287,"健保個人=*.50境界,厚年個人=*.50境界"
M004,東京都,1,110000,89000,5450,10901,874,1749,8143,16287,"健保/介護個人=*.50境界,厚年個人=*.50境界"
M005,東京都,0,104000,104000,5153,10306,0,0,9516,19032,端数(合計)確認
M006,東京都,1,118000,118000,5847,11693,938,1876,10797,21594,端数(合計/介護)確認
M007,東京都,1,150000,150000,7432,14865,1192,2385,13725,27450,中間値
M008,東京都,0,250000,250000,12387,24775,0,0,22875,45750,中間値
M009,東京都,1,250000,300000,12387,24775,1987,3975,27450,54900,健保と厚年が異なる
M010,東京都,0,500000,650000,24775,49550,0,0,59475,118950,厚年上限側
M011,東京都,1,1390000,650000,68874,137749,11050,22101,59475,118950,"健保最大/厚年最大,介護あり"
M012,大阪府,0,58000,88000,2970,5939,0,0,8052,16104,"大阪 料率差分,介護なし"
M013,大阪府,1,58000,88000,2970,5939,461,922,8052,16104,大阪 健保個人 端数>0.5で切上
M014,大阪府,1,62000,89000,3174,6348,493,985,8143,16287,"大阪 健保個人 端数<0.5で切捨,厚年*.50"
M015,大阪府,0,60000,90000,3072,6144,0,0,8235,16470,"大阪 健保個人 端数0,介護なし"
M016,大阪府,1,61000,91000,3123,6246,485,969,8326,16653,"大阪 健保個人 端数0.2,厚年*.50"
M017,大阪府,1,59000,92000,3021,6041,469,938,8418,16836,"大阪 健保個人 端数0.8,厚年個人整数"
M018,大阪府,0,300000,300000,15360,30720,0,0,27450,54900,"大阪 中間値,介護なし"
M019,大阪府,1,300000,300000,15360,30720,2385,4770,27450,54900,"大阪 中間値,介護あり"
M020,大阪府,0,1390000,650000,71168,142336,0,0,59475,118950,"大阪 最大,介護なし"
M021,大阪府,1,1390000,650000,71168,142336,11050,22101,59475,118950,"大阪 最大,介護あり"
M022,東京都,1,631000,631000,31266,62532,5016,10032,57736,115473,端数パターンA
M023,東京都,0,632000,632000,31316,62631,0,0,57828,115656,端数パターンB
M024,東京都,1,333000,333000,16500,33000,2647,5294,30469,60939,よくある値
M025,大阪府,1,333000,333000,17050,34099,2647,5294,30469,60939,よくある値(大阪)
M026,東京都,0,127000,180000,6293,12585,0,0,16470,32940,健保と厚年が異なる(例)
M027,大阪府,0,127000,180000,6502,13004,0,0,16470,32940,健保と厚年が異なる(大阪)
M028,東京都,1,999000,999000,49500,99000,7942,15884,91408,182817,高額レンジ
M029,大阪府,1,999000,650000,51149,102297,7942,15884,59475,118950,健保高額/厚年上限
M030,東京都,1,1000000,500000,49550,99100,7950,15900,45750,91500,健保高額/厚年中間`;

const legacyStandardBonusCases: BonusCase[] = [
  {
    caseId: 'B01',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 0,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 0,
    expectedKouseiStdBonusThisPayment: 0,
    expectedKenpoFiscalYTD_After: 0,
    expectedKouseiMonthTotal_After: 0,
    note: '最小値',
  },
  {
    caseId: 'B02',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 0,
    expectedKouseiStdBonusThisPayment: 0,
    expectedKenpoFiscalYTD_After: 0,
    expectedKouseiMonthTotal_After: 0,
    note: '1000円未満→0',
  },
  {
    caseId: 'B03',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 1000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1000,
    expectedKouseiStdBonusThisPayment: 1000,
    expectedKenpoFiscalYTD_After: 1000,
    expectedKouseiMonthTotal_After: 1000,
    note: 'ちょうど1000円',
  },
  {
    caseId: 'B04',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 1001,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1000,
    expectedKouseiStdBonusThisPayment: 1000,
    expectedKenpoFiscalYTD_After: 1000,
    expectedKouseiMonthTotal_After: 1000,
    note: '1001→1000',
  },
  {
    caseId: 'B05',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 1999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1000,
    expectedKouseiStdBonusThisPayment: 1000,
    expectedKenpoFiscalYTD_After: 1000,
    expectedKouseiMonthTotal_After: 1000,
    note: '1999→1000',
  },
  {
    caseId: 'B06',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 2000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 2000,
    expectedKouseiStdBonusThisPayment: 2000,
    expectedKenpoFiscalYTD_After: 2000,
    expectedKouseiMonthTotal_After: 2000,
    note: 'ちょうど2000円',
  },
  {
    caseId: 'M01a',
    bonusPaidOn: '2025-07-10',
    bonusGrossThisPayment: 999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 0,
    expectedKouseiStdBonusThisPayment: 0,
    expectedKenpoFiscalYTD_After: 0,
    expectedKouseiMonthTotal_After: 0,
    note: '同月複数①',
  },
  {
    caseId: 'M01b',
    bonusPaidOn: '2025-07-25',
    bonusGrossThisPayment: 1001,
    priorBonusGrossSameMonth: 999,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 2000,
    expectedKouseiStdBonusThisPayment: 2000,
    expectedKenpoFiscalYTD_After: 2000,
    expectedKouseiMonthTotal_After: 2000,
    note: '同月複数②：合算してから1000円未満切捨て',
  },
  {
    caseId: 'P01',
    bonusPaidOn: '2025-08-05',
    bonusGrossThisPayment: 1499999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1499000,
    expectedKouseiStdBonusThisPayment: 1499000,
    expectedKenpoFiscalYTD_After: 1499000,
    expectedKouseiMonthTotal_After: 1499000,
    note: '150万直前（千円未満切捨てで149.9万）',
  },
  {
    caseId: 'P02',
    bonusPaidOn: '2025-08-05',
    bonusGrossThisPayment: 1500000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1500000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 1500000,
    expectedKouseiMonthTotal_After: 1500000,
    note: 'ちょうど150万',
  },
  {
    caseId: 'P03',
    bonusPaidOn: '2025-08-05',
    bonusGrossThisPayment: 1500999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1500000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 1500000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '1500999→1500000',
  },
  {
    caseId: 'P04',
    bonusPaidOn: '2025-08-05',
    bonusGrossThisPayment: 1501000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 1501000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 1501000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '1501000→1501000（厚年は150万で頭打ち）',
  },
  {
    caseId: 'P05a',
    bonusPaidOn: '2025-09-10',
    bonusGrossThisPayment: 800000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 800000,
    expectedKouseiStdBonusThisPayment: 800000,
    expectedKenpoFiscalYTD_After: 800000,
    expectedKouseiMonthTotal_After: 800000,
    note: '同月複数で上限到達①',
  },
  {
    caseId: 'P05b',
    bonusPaidOn: '2025-09-25',
    bonusGrossThisPayment: 800500,
    priorBonusGrossSameMonth: 800000,
    priorKenpoStdBonusFiscalYTD: 800000,
    expectedKenpoStdBonusThisPayment: 800000,
    expectedKouseiStdBonusThisPayment: 700000,
    expectedKenpoFiscalYTD_After: 1600000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '同月複数②：月合算が150万超→厚年は差分700,000',
  },
  {
    caseId: 'P06',
    bonusPaidOn: '2025-10-20',
    bonusGrossThisPayment: 2000,
    priorBonusGrossSameMonth: 1499999,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 2000,
    expectedKouseiStdBonusThisPayment: 1000,
    expectedKenpoFiscalYTD_After: 2000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '同月直前が149.9万、今回2000→月合算で150万到達（厚年差分1000）',
  },
  {
    caseId: 'K01',
    bonusPaidOn: '2025-11-01',
    bonusGrossThisPayment: 5729999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 5729000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 5729000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '健保 年度上限直前（572.9万）',
  },
  {
    caseId: 'K02',
    bonusPaidOn: '2025-11-01',
    bonusGrossThisPayment: 5730000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 5730000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '健保 年度上限ちょうど',
  },
  {
    caseId: 'K03',
    bonusPaidOn: '2025-11-01',
    bonusGrossThisPayment: 5730999,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 5730000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '健保 年度上限超（切捨てで573万）',
  },
  {
    caseId: 'K04',
    bonusPaidOn: '2025-12-10',
    bonusGrossThisPayment: 10000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 5729000,
    expectedKenpoStdBonusThisPayment: 1000,
    expectedKouseiStdBonusThisPayment: 10000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 10000,
    note: '健保 既に572.9万→残り1,000だけ計上',
  },
  {
    caseId: 'K05',
    bonusPaidOn: '2026-01-15',
    bonusGrossThisPayment: 1000000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 5730000,
    expectedKenpoStdBonusThisPayment: 0,
    expectedKouseiStdBonusThisPayment: 1000000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 1000000,
    note: '健保 既に上限到達→0',
  },
  {
    caseId: 'FY01',
    bonusPaidOn: '2026-03-31',
    bonusGrossThisPayment: 300000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 5500000,
    expectedKenpoStdBonusThisPayment: 230000,
    expectedKouseiStdBonusThisPayment: 300000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 300000,
    note: '年度末に上限到達：残り230,000',
  },
  {
    caseId: 'FY02',
    bonusPaidOn: '2026-04-01',
    bonusGrossThisPayment: 300000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 300000,
    expectedKouseiStdBonusThisPayment: 300000,
    expectedKenpoFiscalYTD_After: 300000,
    expectedKouseiMonthTotal_After: 300000,
    note: '年度切替（4/1）で年度累計リセット想定',
  },
  {
    caseId: 'MAX',
    bonusPaidOn: '2025-06-10',
    bonusGrossThisPayment: 10000000,
    priorBonusGrossSameMonth: 0,
    priorKenpoStdBonusFiscalYTD: 0,
    expectedKenpoStdBonusThisPayment: 5730000,
    expectedKouseiStdBonusThisPayment: 1500000,
    expectedKenpoFiscalYTD_After: 5730000,
    expectedKouseiMonthTotal_After: 1500000,
    note: '極端に大きい賞与',
  },
];

const csvStandardBonusCases: BonusCase[] = parseCsvWithTrailingNote(standardBonusCsv).map(
  (row) => ({
    caseId: row['caseId'],
    bonusPaidOn: row['bonusPaidOn'],
    bonusGrossThisPayment: Number(row['bonusGrossThisPayment']),
    priorBonusGrossSameMonth: Number(row['priorBonusGrossSameMonth']),
    priorKenpoStdBonusFiscalYTD: Number(row['priorKenpoStdBonusFiscalYTD']),
    expectedKenpoStdBonusThisPayment: Number(row['expectedKenpoStdBonusThisPayment']),
    expectedKouseiStdBonusThisPayment: Number(row['expectedKouseiStdBonusThisPayment']),
    expectedKenpoFiscalYTD_After: Number(row['expectedKenpoFiscalYTD_After']),
    expectedKouseiMonthTotal_After: Number(row['expectedKouseiMonthTotal_After']),
    note: row['note'],
  }),
);

const standardBonusCases: BonusCase[] = [
  ...legacyStandardBonusCases,
  ...csvStandardBonusCases,
];

const socialInsuranceBonusCases: SocialInsuranceBonusCase[] = parseCsvWithTrailingNote(
  socialInsuranceBonusCsv,
).map((row) => ({
  caseId: row['case_id'],
  prefecture: row['prefecture'],
  careApplicable: row['care_applicable'] === '1',
  bonusGross: Number(row['bonus_gross']),
  healthYtdStandardBonusBefore: Number(row['health_ytd_standard_bonus_before']),
  expectedStandardBonusHealth: Number(row['expected_standard_bonus_health']),
  expectedStandardBonusPension: Number(row['expected_standard_bonus_pension']),
  expectedHealthEmployeeBonus: Number(row['expected_health_employee_bonus']),
  expectedHealthTotalBonus: Number(row['expected_health_total_bonus']),
  expectedCareEmployeeBonus: Number(row['expected_care_employee_bonus']),
  expectedCareTotalBonus: Number(row['expected_care_total_bonus']),
  expectedPensionEmployeeBonus: Number(row['expected_pension_employee_bonus']),
  expectedPensionTotalBonus: Number(row['expected_pension_total_bonus']),
  note: row['note'],
}));

const socialInsuranceMonthlyCases: SocialInsuranceMonthlyCase[] = parseCsvWithTrailingNote(
  socialInsuranceMonthlyCsv,
).map((row) => ({
  caseId: row['case_id'],
  prefecture: row['prefecture'],
  careApplicable: row['care_applicable'] === '1',
  healthStandardMonthly: Number(row['health_standard_monthly']),
  pensionStandardMonthly: Number(row['pension_standard_monthly']),
  expectedHealthEmployeeMonthly: Number(row['expected_health_employee_monthly']),
  expectedHealthTotalMonthly: Number(row['expected_health_total_monthly']),
  expectedCareEmployeeMonthly: Number(row['expected_care_employee_monthly']),
  expectedCareTotalMonthly: Number(row['expected_care_total_monthly']),
  expectedPensionEmployeeMonthly: Number(row['expected_pension_employee_monthly']),
  expectedPensionTotalMonthly: Number(row['expected_pension_total_monthly']),
  note: row['note'],
}));

function buildBonusPayrolls(
  testCase: SocialInsuranceBonusCase,
  bonusPaidOn: string,
): PayrollData[] {
  const payrolls: PayrollData[] = [];
  const targetMonth = bonusPaidOn.slice(0, 7);

  if (testCase.healthYtdStandardBonusBefore > 0) {
    payrolls.push({
      yearMonth: '2025-04',
      bonusPaidOn: '2025-04-01',
      bonusTotal: testCase.healthYtdStandardBonusBefore,
      standardHealthBonus: testCase.healthYtdStandardBonusBefore,
      standardWelfareBonus: calculateStandardBonus(
        testCase.healthYtdStandardBonusBefore,
        1500000,
      ),
    } as unknown as PayrollData);
  }

  payrolls.push({
    yearMonth: targetMonth,
    bonusPaidOn,
    bonusTotal: testCase.bonusGross,
  } as unknown as PayrollData);

  return payrolls;
}


describe('CalculationDataService bonus caps', () => {
  let service: CalculationDataService;
  let employeesStub: EmployeesStub;
  let ratesStub: RatesStub;

  beforeEach(() => {
    employeesStub = new EmployeesStub();
    ratesStub = new RatesStub();

    TestBed.configureTestingModule({
      providers: [
        CalculationDataService,
        { provide: ShahoEmployeesService, useValue: employeesStub },
        { provide: InsuranceRatesService, useValue: ratesStub },
        { provide: CorporateInfoService, useClass: CorporateInfoStub },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });

    service = TestBed.inject(CalculationDataService);
  });

  it('excludes前年度の賞与を年度累積に含めず、年度上限で標準賞与額を抑制する', async () => {
    ratesStub.rateHistory = [createRateRecord({ healthYearlyCap: 1000000, welfareMonthlyCap: 2000000 })];
    employeesStub.employees = [
      {
        employeeNo: 'E001',
        name: '年度跨ぎ',
        department: '総務',
        workPrefecture: '東京',
        payrolls: [
          { yearMonth: '2024-03', bonusPaidOn: '2024-03-15', bonusTotal: 400000 },
          { yearMonth: '2024-04', bonusPaidOn: '2024-04-10', bonusTotal: 300000 },
          { yearMonth: '2024-04', bonusPaidOn: '2024-04-25', bonusTotal: 800000 },
        ],
      } as unknown as ShahoEmployee,
    ];

    const params: CalculationQueryParams = {
      type: 'bonus',
      targetMonth: '2024-04',
      method: 'none',
      standardMethod: '定時決定',
      insurances: ['健康保険', '厚生年金'],
      employeeNo: 'E001',
      bonusPaidOn: '2024-04-25',
    };

    const [row] = await firstValueFrom(service.getCalculationRows(params));

    expect(row.standardHealthBonus).toBe(700000);
    expect(row.standardWelfareBonus).toBe(800000);
  });

  it('同月内の累積と月次上限を考慮して厚生年金の標準賞与額を計算する', async () => {
    ratesStub.rateHistory = [createRateRecord({ healthYearlyCap: 2000000, welfareMonthlyCap: 1000000 })];
    employeesStub.employees = [
      {
        employeeNo: 'E002',
        name: '同月複数',
        department: '開発',
        workPrefecture: '東京',
        payrolls: [
          { yearMonth: '2024-05', bonusPaidOn: '2024-05-01', bonusTotal: 500000 },
          { yearMonth: '2024-06', bonusPaidOn: '2024-06-05', bonusTotal: 600000 },
          { yearMonth: '2024-06', bonusPaidOn: '2024-06-20', bonusTotal: 600000 },
        ],
      } as unknown as ShahoEmployee,
    ];

    const params: CalculationQueryParams = {
      type: 'bonus',
      targetMonth: '2024-06',
      method: 'none',
      standardMethod: '定時決定',
      insurances: ['健康保険', '厚生年金'],
      employeeNo: 'E002',
      bonusPaidOn: '2024-06-20',
    };

    const [row] = await firstValueFrom(service.getCalculationRows(params));

    expect(row.standardHealthBonus).toBe(600000);
    expect(row.standardWelfareBonus).toBe(400000);
  });
});

describe('CalculationDataService standard bonus fixtures', () => {
  let service: CalculationDataService;
  let employeesStub: EmployeesStub;
  let ratesStub: RatesStub;

  beforeEach(() => {
    employeesStub = new EmployeesStub();
    ratesStub = new RatesStub();

    TestBed.configureTestingModule({
      providers: [
        CalculationDataService,
        { provide: ShahoEmployeesService, useValue: employeesStub },
        { provide: InsuranceRatesService, useValue: ratesStub },
        { provide: CorporateInfoService, useClass: CorporateInfoStub },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });

    service = TestBed.inject(CalculationDataService);
    ratesStub.rateHistory = [
      createRateRecord({ healthYearlyCap: 5730000, welfareMonthlyCap: 1500000 }),
    ];
  });

  standardBonusCases.forEach((testCase) => {
    it(`${testCase.caseId}: ${testCase.note}`, async () => {
      const targetMonth = testCase.bonusPaidOn.slice(0, 7);
      const priorBonuses = [];

      if (testCase.priorKenpoStdBonusFiscalYTD > 0) {
        priorBonuses.push({
          yearMonth: '2025-04',
          bonusPaidOn: '2025-04-01',
          bonusTotal: testCase.priorKenpoStdBonusFiscalYTD,
          standardHealthBonus: testCase.priorKenpoStdBonusFiscalYTD,
          standardWelfareBonus: calculateStandardBonus(
            testCase.priorKenpoStdBonusFiscalYTD,
            1500000,
          ),
        });
      }

      if (testCase.priorBonusGrossSameMonth > 0) {
        const priorMonth = `${targetMonth}-01`;
        priorBonuses.push({
          yearMonth: targetMonth,
          bonusPaidOn: priorMonth,
          bonusTotal: testCase.priorBonusGrossSameMonth,
        });
      }

      const payrolls = [
        ...priorBonuses,
        {
          yearMonth: targetMonth,
          bonusPaidOn: testCase.bonusPaidOn,
          bonusTotal: testCase.bonusGrossThisPayment,
        },
      ];

      employeesStub.employees = [
        {
          employeeNo: `TC-${testCase.caseId}`,
          name: testCase.note,
          department: '計算',
          workPrefecture: '東京',
          payrolls,
        } as unknown as ShahoEmployee,
      ];

      const params: CalculationQueryParams = {
        type: 'bonus',
        targetMonth,
        method: 'none',
        standardMethod: '定時決定',
        insurances: ['健康保険', '厚生年金'],
        employeeNo: `TC-${testCase.caseId}`,
        bonusPaidOn: testCase.bonusPaidOn,
      };

      const [row] = await firstValueFrom(service.getCalculationRows(params));

      expect(row.standardHealthBonus).toBe(
        testCase.expectedKenpoStdBonusThisPayment,
      );
      expect(row.standardWelfareBonus).toBe(
        testCase.expectedKouseiStdBonusThisPayment,
      );

      const healthAfter =
        testCase.priorKenpoStdBonusFiscalYTD + row.standardHealthBonus;
      expect(healthAfter).toBe(testCase.expectedKenpoFiscalYTD_After);

      const priorWelfareStandard = calculateStandardBonus(
        testCase.priorBonusGrossSameMonth,
        1500000,
      );
      expect(priorWelfareStandard + row.standardWelfareBonus).toBe(
        testCase.expectedKouseiMonthTotal_After,
      );
    });
  });
});

describe('CalculationDataService social insurance bonus fixtures', () => {
  let service: CalculationDataService;
  let employeesStub: EmployeesStub;
  let ratesStub: RatesStub;

  beforeEach(() => {
    employeesStub = new EmployeesStub();
    ratesStub = new RatesStub();

    TestBed.configureTestingModule({
      providers: [
        CalculationDataService,
        { provide: ShahoEmployeesService, useValue: employeesStub },
        { provide: InsuranceRatesService, useValue: ratesStub },
        { provide: CorporateInfoService, useClass: CorporateInfoStub },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });

    service = TestBed.inject(CalculationDataService);
    ratesStub.rateHistory = [createSocialInsuranceRateRecord()];
  });

  socialInsuranceBonusCases.forEach((testCase) => {
    it(`${testCase.caseId}: ${testCase.note}`, async () => {
      const bonusPaidOn = '2025-12-15';
      const payrolls = buildBonusPayrolls(testCase, bonusPaidOn);

      employeesStub.employees = [
        {
          employeeNo: `SB-${testCase.caseId}`,
          name: testCase.note,
          department: '計算',
          workPrefecture: testCase.prefecture,
          careSecondInsured: testCase.careApplicable,
          healthStandardMonthly: 0,
          welfareStandardMonthly: 0,
          payrolls,
        } as unknown as ShahoEmployee,
      ];

      const params: CalculationQueryParams = {
        type: 'bonus',
        targetMonth: bonusPaidOn.slice(0, 7),
        method: 'none',
        standardMethod: '定時決定',
        insurances: ['健康保険', '介護保険', '厚生年金'],
        employeeNo: `SB-${testCase.caseId}`,
        bonusPaidOn,
      };

      const [row] = await firstValueFrom(service.getCalculationRows(params));

      expect(row.standardHealthBonus).toBe(testCase.expectedStandardBonusHealth);
      expect(row.standardWelfareBonus).toBe(
        testCase.expectedStandardBonusPension,
      );
      expect(row.healthEmployeeBonus).toBe(
        testCase.expectedHealthEmployeeBonus,
      );
      expect(row.healthEmployerBonus + row.healthEmployeeBonus).toBe(
        testCase.expectedHealthTotalBonus,
      );
      expect(row.nursingEmployeeBonus).toBe(
        testCase.expectedCareEmployeeBonus,
      );
      expect(row.nursingEmployerBonus + row.nursingEmployeeBonus).toBe(
        testCase.expectedCareTotalBonus,
      );
      expect(row.welfareEmployeeBonus).toBe(
        testCase.expectedPensionEmployeeBonus,
      );
      expect(row.welfareEmployerBonus + row.welfareEmployeeBonus).toBe(
        testCase.expectedPensionTotalBonus,
      );
    });
  });
});

describe('CalculationDataService social insurance monthly fixtures', () => {
  let service: CalculationDataService;
  let employeesStub: EmployeesStub;
  let ratesStub: RatesStub;

  beforeEach(() => {
    employeesStub = new EmployeesStub();
    ratesStub = new RatesStub();

    TestBed.configureTestingModule({
      providers: [
        CalculationDataService,
        { provide: ShahoEmployeesService, useValue: employeesStub },
        { provide: InsuranceRatesService, useValue: ratesStub },
        { provide: CorporateInfoService, useClass: CorporateInfoStub },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });

    service = TestBed.inject(CalculationDataService);
    ratesStub.rateHistory = [createSocialInsuranceRateRecord()];
  });

  socialInsuranceMonthlyCases.forEach((testCase) => {
    it(`${testCase.caseId}: ${testCase.note}`, async () => {
      employeesStub.employees = [
        {
          employeeNo: `SM-${testCase.caseId}`,
          name: testCase.note,
          department: '計算',
          workPrefecture: testCase.prefecture,
          careSecondInsured: testCase.careApplicable,
          healthStandardMonthly: testCase.healthStandardMonthly,
          welfareStandardMonthly: testCase.pensionStandardMonthly,
          payrolls: [
            {
              yearMonth: '2024-07',
              amount: testCase.healthStandardMonthly,
              workedDays: 20,
            },
          ],
        } as unknown as ShahoEmployee,
      ];

      const params: CalculationQueryParams = {
        type: 'insurance',
        targetMonth: '2024-07',
        method: 'none',
        standardMethod: '定時決定',
        insurances: ['健康保険', '介護保険', '厚生年金'],
        includeBonusInMonth: false,
        employeeNo: `SM-${testCase.caseId}`,
      };

      const [row] = await firstValueFrom(service.getCalculationRows(params));

      expect(row.healthEmployeeMonthly).toBe(
        testCase.expectedHealthEmployeeMonthly,
      );
      expect(row.healthEmployerMonthly + row.healthEmployeeMonthly).toBe(
        testCase.expectedHealthTotalMonthly,
      );
      expect(row.nursingEmployeeMonthly).toBe(
        testCase.expectedCareEmployeeMonthly,
      );
      expect(row.nursingEmployerMonthly + row.nursingEmployeeMonthly).toBe(
        testCase.expectedCareTotalMonthly,
      );
      expect(row.welfareEmployeeMonthly).toBe(
        testCase.expectedPensionEmployeeMonthly,
      );
      expect(row.welfareEmployerMonthly + row.welfareEmployeeMonthly).toBe(
        testCase.expectedPensionTotalMonthly,
      );
      expect(row.healthEmployeeBonus).toBe(0);
      expect(row.nursingEmployeeBonus).toBe(0);
      expect(row.welfareEmployeeBonus).toBe(0);
    });
  });
});

describe('CalculationDataService insurance premiums', () => {
  let service: CalculationDataService;
  let employeesStub: EmployeesStub;
  let ratesStub: RatesStub;

  beforeEach(() => {
    employeesStub = new EmployeesStub();
    ratesStub = new RatesStub();

    TestBed.configureTestingModule({
      providers: [
        CalculationDataService,
        { provide: ShahoEmployeesService, useValue: employeesStub },
        { provide: InsuranceRatesService, useValue: ratesStub },
        { provide: CorporateInfoService, useClass: CorporateInfoStub },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });

    service = TestBed.inject(CalculationDataService);
  });

  it('applies each rate to monthly and bonus premiums when all insurances are active', async () => {
    ratesStub.rateHistory = [createPremiumRateRecord()];
    employeesStub.employees = [
      {
        employeeNo: 'E100',
        name: '基本ケース',
        department: '総務',
        workPrefecture: '東京',
        careSecondInsured: true,
        healthStandardMonthly: 300000,
        welfareStandardMonthly: 300000,
        payrolls: [
          {
            yearMonth: '2024-07',
            amount: 300000,
            workedDays: 20,
            bonusPaidOn: '2024-07-15',
            bonusTotal: 500000,
          },
        ],
      } as unknown as ShahoEmployee,
    ];

    const params: CalculationQueryParams = {
      type: 'insurance',
      targetMonth: '2024-07',
      method: 'none',
      standardMethod: '定時決定',
      insurances: ['健康保険', '介護保険', '厚生年金'],
      includeBonusInMonth: true,
    };

    const [row] = await firstValueFrom(service.getCalculationRows(params));

    expect(row.healthEmployeeMonthly).toBe(15000);
    expect(row.healthEmployerMonthly).toBe(15000);
    expect(row.nursingEmployeeMonthly).toBe(2250);
    expect(row.nursingEmployerMonthly).toBe(2250);
    expect(row.welfareEmployeeMonthly).toBe(27450);
    expect(row.welfareEmployerMonthly).toBe(27450);

    expect(row.healthEmployeeBonus).toBe(25000);
    expect(row.healthEmployerBonus).toBe(25000);
    expect(row.nursingEmployeeBonus).toBe(3750);
    expect(row.nursingEmployerBonus).toBe(3750);
    expect(row.welfareEmployeeBonus).toBe(45750);
    expect(row.welfareEmployerBonus).toBe(45750);
  });

  it('zeros out every premium when the employee is marked as exempted', async () => {
    ratesStub.rateHistory = [createPremiumRateRecord()];
    employeesStub.employees = [
      {
        employeeNo: 'E101',
        name: '免除対象',
        department: '開発',
        workPrefecture: '東京',
        careSecondInsured: true,
        exemption: true,
        healthStandardMonthly: 280000,
        welfareStandardMonthly: 280000,
        payrolls: [
          {
            yearMonth: '2024-07',
            amount: 280000,
            workedDays: 20,
            bonusPaidOn: '2024-07-10',
            bonusTotal: 400000,
          },
        ],
      } as unknown as ShahoEmployee,
    ];

    const params: CalculationQueryParams = {
      type: 'insurance',
      targetMonth: '2024-07',
      method: 'none',
      standardMethod: '定時決定',
      insurances: ['健康保険', '介護保険', '厚生年金'],
      includeBonusInMonth: true,
    };

    const [row] = await firstValueFrom(service.getCalculationRows(params));

    expect(row.healthEmployeeMonthly).toBe(0);
    expect(row.healthEmployerMonthly).toBe(0);
    expect(row.nursingEmployeeMonthly).toBe(0);
    expect(row.nursingEmployerMonthly).toBe(0);
    expect(row.welfareEmployeeMonthly).toBe(0);
    expect(row.welfareEmployerMonthly).toBe(0);
    expect(row.healthEmployeeBonus).toBe(0);
    expect(row.healthEmployerBonus).toBe(0);
    expect(row.nursingEmployeeBonus).toBe(0);
    expect(row.nursingEmployerBonus).toBe(0);
    expect(row.welfareEmployeeBonus).toBe(0);
    expect(row.welfareEmployerBonus).toBe(0);
  });

  it('respects selected insurances and skips bonus premiums when the flag is disabled', async () => {
    ratesStub.rateHistory = [createPremiumRateRecord()];
    employeesStub.employees = [
      {
        employeeNo: 'E102',
        name: '選択制御',
        department: '営業',
        workPrefecture: '東京',
        careSecondInsured: true,
        healthStandardMonthly: 310000,
        welfareStandardMonthly: 310000,
        payrolls: [
          {
            yearMonth: '2024-07',
            amount: 310000,
            workedDays: 20,
            bonusPaidOn: '2024-07-05',
            bonusTotal: 600000,
          },
        ],
      } as unknown as ShahoEmployee,
    ];

    const params: CalculationQueryParams = {
      type: 'insurance',
      targetMonth: '2024-07',
      method: 'none',
      standardMethod: '定時決定',
      insurances: ['健康保険', '厚生年金'],
      includeBonusInMonth: false,
    };

    const [row] = await firstValueFrom(service.getCalculationRows(params));

    expect(row.healthEmployeeMonthly).toBe(15500);
    expect(row.healthEmployerMonthly).toBe(15500);
    expect(row.nursingEmployeeMonthly).toBe(0);
    expect(row.nursingEmployerMonthly).toBe(0);
    expect(row.welfareEmployeeMonthly).toBe(28365);
    expect(row.welfareEmployerMonthly).toBe(28365);
    expect(row.healthEmployeeBonus).toBe(0);
    expect(row.healthEmployerBonus).toBe(0);
    expect(row.nursingEmployeeBonus).toBe(0);
    expect(row.nursingEmployerBonus).toBe(0);
    expect(row.welfareEmployeeBonus).toBe(0);
    expect(row.welfareEmployerBonus).toBe(0);
  });
});