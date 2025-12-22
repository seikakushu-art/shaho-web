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

type SocialInsuranceComprehensiveCase = {
  caseId: string;
  prefecture: string;
  careApplicable: boolean;
  healthStandardMonthly: number;
  pensionStandardMonthly: number;
  standardBonusHealth: number;
  standardBonusPension: number;
  expectedHealthEmployeeMonthly: number;
  expectedHealthTotalMonthly: number;
  expectedCareEmployeeMonthly: number;
  expectedCareTotalMonthly: number;
  expectedPensionEmployeeMonthly: number;
  expectedPensionTotalMonthly: number;
  expectedHealthEmployeeBonus: number;
  expectedHealthTotalBonus: number;
  expectedCareEmployeeBonus: number;
  expectedCareTotalBonus: number;
  expectedPensionEmployeeBonus: number;
  expectedPensionTotalBonus: number;
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

function parseSimpleCsv(csv: string) {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const headers = lines[0].split(',');

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
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

const socialInsuranceComprehensiveCsv = `caseId,勤務地都道府県,介護該当(40-64),健保等級,健保標準報酬月額,厚年等級,厚年標準報酬月額,標準賞与額(健保・介護),標準賞与額(厚年),健康保険(個人・月例),健康保険(合計・月例),介護保険(個人・月例),介護保険(合計・月例),厚生年金(個人・月例),厚生年金(合計・月例),健康保険(個人・賞与),健康保険(合計・賞与),介護保険(個人・賞与),介護保険(合計・賞与),厚生年金(個人・賞与),厚生年金(合計・賞与)
R7-M01,北海道,0,1,58000,1,88000,0,0,2990,5979,0,0,8052,16104,0,0,0,0,0,0
R7-M02,青森県,1,2,68000,2,98000,1000,1000,3349,6698,541,1081,8967,17934,49,98,8,15,91,183
R7-M03,岩手県,0,3,78000,3,104000,10000,10000,3752,7503,0,0,9516,19032,481,962,0,0,915,1830
R7-M04,宮城県,1,4,88000,4,110000,999000,999000,4448,8896,700,1399,10065,20130,50499,100998,7942,15884,91408,182817
R7-M05,秋田県,0,5,98000,5,118000,1499000,1499000,4905,9809,0,0,10797,21594,75025,150049,0,0,137158,274317
R7-M06,山形県,1,6,104000,6,126000,1500000,1500000,5070,10140,827,1653,11529,23058,73125,146250,11925,23850,137250,274500
R7-M07,福島県,0,7,110000,7,134000,5730000,1500000,5291,10582,0,0,12261,24522,275613,551226,0,0,137250,274500
R7-M08,茨城県,1,8,118000,8,142000,5729000,1499000,5705,11410,938,1876,12993,25986,276997,553994,45546,91091,137158,274317
R7-M09,栃木県,0,9,126000,9,150000,284000,284000,6187,12373,0,0,13725,27450,13944,27888,0,0,25986,51972
R7-M10,群馬県,1,10,134000,10,160000,457000,457000,6546,13091,1065,2130,14640,29280,22324,44648,3633,7266,41815,83631
R7-M11,埼玉県,0,11,142000,11,170000,630000,630000,6930,13859,0,0,15555,31110,30744,61488,0,0,57645,115290
R7-M12,千葉県,1,12,150000,12,180000,803000,803000,7342,14685,1192,2385,16470,32940,39307,78613,6384,12767,73474,146949
R7-M13,東京都,0,13,160000,13,190000,976000,976000,7928,15856,0,0,17385,34770,48361,96721,0,0,89304,178608
R7-M14,神奈川県,1,14,170000,14,200000,1149000,1149000,8432,16864,1351,2703,18300,36600,56990,113980,9135,18269,105133,210267
R7-M15,新潟県,0,15,180000,15,220000,172000,172000,8595,17190,0,0,20130,40260,8213,16426,0,0,15738,31476
R7-M16,富山県,1,16,190000,16,240000,345000,345000,9167,18335,1510,3021,21960,43920,16646,33292,2743,5485,31567,63135
R7-M17,石川県,0,17,200000,17,260000,518000,518000,9880,19760,0,0,23790,47580,25589,51178,0,0,47397,94794
R7-M18,福井県,1,18,220000,18,280000,691000,691000,10934,21868,1749,3498,25620,51240,34343,68685,5493,10986,63226,126453
R7-M19,山梨県,0,19,240000,19,300000,864000,864000,11868,23736,0,0,27450,54900,42725,85449,0,0,79056,158112
R7-M20,長野県,1,20,260000,20,320000,1037000,1037000,12597,25194,2067,4134,29280,58560,50243,100485,8244,16488,94885,189771
R7-M21,岐阜県,0,21,280000,21,340000,60000,60000,13902,27804,0,0,31110,62220,2979,5958,0,0,5490,10980
R7-M22,静岡県,1,22,300000,22,360000,233000,233000,14700,29400,2385,4770,32940,65880,11417,22834,1852,3704,21319,42639
R7-M23,愛知県,0,23,320000,23,380000,406000,406000,16048,32096,0,0,34770,69540,20361,40721,0,0,37149,74298
R7-M24,三重県,1,24,340000,24,410000,579000,579000,16983,33966,2703,5406,37515,75030,28921,57842,4603,9206,52978,105957
R7-M25,滋賀県,0,25,360000,25,440000,752000,752000,17946,35892,0,0,40260,80520,37487,74974,0,0,68808,137616
R7-M26,京都府,1,26,380000,26,470000,925000,925000,19057,38114,3021,6042,43005,86010,46389,92777,7354,14707,84637,169275
R7-M27,大阪府,0,27,410000,27,500000,1098000,1098000,20992,41984,0,0,45750,91500,56218,112435,0,0,100467,200934
R7-M28,兵庫県,1,28,440000,28,530000,121000,121000,22352,44704,3498,6996,48495,96990,6147,12293,962,1923,11071,22143
R7-M29,奈良県,0,29,470000,29,560000,294000,294000,23547,47094,0,0,51240,102480,14729,29458,0,0,26901,53802
R7-M30,和歌山県,1,30,500000,30,590000,467000,467000,25475,50950,3975,7950,53985,107970,23794,47587,3713,7425,42730,85461
R7-M31,鳥取県,0,31,530000,31,620000,640000,640000,26314,52629,0,0,56730,113460,31776,63552,0,0,58560,117120
R7-M32,島根県,1,32,560000,32,650000,813000,813000,27832,55664,4452,8904,59475,118950,40406,80812,6463,12926,74389,148779
R7-M33,岡山県,0,33,590000,1,88000,986000,986000,30001,60003,0,0,8052,16104,50138,100276,0,0,90219,180438
R7-M34,広島県,1,34,620000,2,98000,1159000,1159000,30907,61814,4929,9858,8967,17934,57776,115552,9214,18428,106048,212097
R7-M35,山口県,0,35,650000,3,104000,182000,182000,33670,67340,0,0,9516,19032,9428,18855,0,0,16653,33306
R7-M36,徳島県,1,36,680000,4,110000,355000,355000,35598,71196,5406,10812,10065,20130,18584,37168,2822,5644,32482,64965
R7-M37,香川県,0,37,710000,5,118000,528000,528000,36245,72491,0,0,10797,21594,26954,53908,0,0,48312,96624
R7-M38,愛媛県,1,38,750000,6,126000,701000,701000,38175,76350,5962,11925,11529,23058,35681,71361,5573,11145,64141,128283
R7-M39,高知県,0,39,790000,7,134000,874000,874000,40013,80027,0,0,12261,24522,44268,88536,0,0,79971,159942
R7-M40,福岡県,1,40,830000,8,142000,1047000,1047000,42786,85573,6598,13197,12993,25986,53973,107945,8324,16647,95800,191601
R7-M41,佐賀県,0,41,880000,9,150000,70000,70000,47432,94864,0,0,13725,27450,3773,7546,0,0,6405,12810
R7-M42,長崎県,1,42,930000,10,160000,243000,243000,48406,96813,7393,14787,14640,29280,12648,25296,1932,3863,22234,44469
R7-M43,熊本県,0,43,980000,11,170000,416000,416000,49588,99176,0,0,15555,31110,21050,42099,0,0,38064,76128
R7-M44,大分県,1,44,1030000,12,180000,589000,589000,52787,105575,8188,16377,16470,32940,30186,60372,4683,9365,53893,107787
R7-M45,宮崎県,0,45,1090000,13,190000,762000,762000,54990,109981,0,0,17385,34770,38443,76885,0,0,69723,139446
R7-M46,鹿児島県,1,46,1150000,14,200000,935000,935000,59282,118565,9142,18285,18300,36600,48199,96398,7433,14866,85552,171105
R7-M47,沖縄県,0,47,1210000,15,220000,1108000,1108000,57112,114224,0,0,20130,40260,52298,104595,0,0,101382,202764
R7-M48,北海道,1,48,1270000,16,240000,131000,131000,65468,130937,10096,20193,21960,43920,6753,13506,1041,2082,11986,23973
R7-M49,青森県,0,49,1330000,17,260000,304000,304000,65502,131005,0,0,23790,47580,14972,29944,0,0,27816,55632
R7-M50,岩手県,1,50,1390000,18,280000,477000,477000,66859,133718,11050,22101,25620,51240,22944,45887,3792,7584,43645,87291`;

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

function deriveRoundedRate(
  baseAmounts: Array<{ base: number; expected: number }>,
): number {
  const intervals = baseAmounts
    .filter(({ base }) => base > 0)
    .map(({ base, expected }) => {
      const lower = (expected - 0.5) / base;
      const upper = (expected + 0.5) / base;
      return [Math.max(lower, 0), Math.max(upper, 0)];
    });

  if (intervals.length === 0) return 0;
  const lowerBound = Math.max(...intervals.map(([lower]) => lower));
  const upperBound = Math.min(...intervals.map(([, upper]) => upper));
  const candidate = (lowerBound + upperBound) / 2;
  return Math.max(candidate, 0);
}

function deriveFlooredRate(
  baseAmounts: Array<{ base: number; expected: number }>,
): number {
  const intervals = baseAmounts
    .filter(({ base }) => base > 0)
    .map(({ base, expected }) => {
      const lower = expected / base;
      const upper = (expected + 0.9999) / base;
      return [Math.max(lower, 0), Math.max(upper, 0)];
    });

  if (intervals.length === 0) return 0;
  const lowerBound = Math.max(...intervals.map(([lower]) => lower));
  const upperBound = Math.min(...intervals.map(([, upper]) => upper));
  const candidate = (lowerBound + upperBound) / 2;
  return Math.max(candidate, 0);
}

function buildPrefectureRate(
  monthly: { base: number; expectedEmployee: number; expectedTotal: number },
  bonus: { base: number; expectedEmployee: number; expectedTotal: number },
  prefecture: string,
): PrefectureRate {
  const employeeRate = deriveRoundedRate([
    { base: monthly.base, expected: monthly.expectedEmployee },
    { base: bonus.base, expected: bonus.expectedEmployee },
  ]);
  const totalRate = deriveFlooredRate([
    { base: monthly.base, expected: monthly.expectedTotal },
    { base: bonus.base, expected: bonus.expectedTotal },
  ]);

  return {
    prefecture,
    employeeRate: (employeeRate * 100).toFixed(6),
    totalRate: (totalRate * 100).toFixed(6),
    effectiveFrom: '2024-04-01',
  };
}

function buildPensionRate(
  monthly: { base: number; expectedEmployee: number; expectedTotal: number },
  bonus: { base: number; expectedEmployee: number; expectedTotal: number },
): InsuranceRateRecord['pensionRate'] {
  const employeeRate = deriveRoundedRate([
    { base: monthly.base, expected: monthly.expectedEmployee },
    { base: bonus.base, expected: bonus.expectedEmployee },
  ]);
  const totalRate = deriveFlooredRate([
    { base: monthly.base, expected: monthly.expectedTotal },
    { base: bonus.base, expected: bonus.expectedTotal },
  ]);

  return {
    employeeRate: (employeeRate * 100).toFixed(6),
    totalRate: (totalRate * 100).toFixed(6),
    effectiveFrom: '2024-04-01',
  };
}

const socialInsuranceComprehensiveCases: SocialInsuranceComprehensiveCase[] = parseSimpleCsv(
  socialInsuranceComprehensiveCsv,
).map((row) => ({
  caseId: row['caseId'],
  prefecture: row['勤務地都道府県'],
  careApplicable: row['介護該当(40-64)'] === '1',
  healthStandardMonthly: Number(row['健保標準報酬月額']),
  pensionStandardMonthly: Number(row['厚年標準報酬月額']),
  standardBonusHealth: Number(row['標準賞与額(健保・介護)']),
  standardBonusPension: Number(row['標準賞与額(厚年)']),
  expectedHealthEmployeeMonthly: Number(row['健康保険(個人・月例)']),
  expectedHealthTotalMonthly: Number(row['健康保険(合計・月例)']),
  expectedCareEmployeeMonthly: Number(row['介護保険(個人・月例)']),
  expectedCareTotalMonthly: Number(row['介護保険(合計・月例)']),
  expectedPensionEmployeeMonthly: Number(row['厚生年金(個人・月例)']),
  expectedPensionTotalMonthly: Number(row['厚生年金(合計・月例)']),
  expectedHealthEmployeeBonus: Number(row['健康保険(個人・賞与)']),
  expectedHealthTotalBonus: Number(row['健康保険(合計・賞与)']),
  expectedCareEmployeeBonus: Number(row['介護保険(個人・賞与)']),
  expectedCareTotalBonus: Number(row['介護保険(合計・賞与)']),
  expectedPensionEmployeeBonus: Number(row['厚生年金(個人・賞与)']),
  expectedPensionTotalBonus: Number(row['厚生年金(合計・賞与)']),
}));

function buildRateRecordFromComprehensiveCase(
  testCase: SocialInsuranceComprehensiveCase,
): InsuranceRateRecord {
  const healthRate = buildPrefectureRate(
    {
      base: testCase.healthStandardMonthly,
      expectedEmployee: testCase.expectedHealthEmployeeMonthly,
      expectedTotal: testCase.expectedHealthTotalMonthly,
    },
    {
      base: testCase.standardBonusHealth,
      expectedEmployee: testCase.expectedHealthEmployeeBonus,
      expectedTotal: testCase.expectedHealthTotalBonus,
    },
    testCase.prefecture,
  );

  const nursingRate = buildPrefectureRate(
    {
      base: testCase.healthStandardMonthly,
      expectedEmployee: testCase.expectedCareEmployeeMonthly,
      expectedTotal: testCase.expectedCareTotalMonthly,
    },
    {
      base: testCase.standardBonusHealth,
      expectedEmployee: testCase.expectedCareEmployeeBonus,
      expectedTotal: testCase.expectedCareTotalBonus,
    },
    testCase.prefecture,
  );

  const pensionRate = buildPensionRate(
    {
      base: testCase.pensionStandardMonthly,
      expectedEmployee: testCase.expectedPensionEmployeeMonthly,
      expectedTotal: testCase.expectedPensionTotalMonthly,
    },
    {
      base: testCase.standardBonusPension,
      expectedEmployee: testCase.expectedPensionEmployeeBonus,
      expectedTotal: testCase.expectedPensionTotalBonus,
    },
  );

  return {
    healthInsuranceRates: [healthRate],
    nursingCareRates: [nursingRate],
    pensionRate,
    bonusCaps: [
      {
        insuranceType: '健康保険',
        monthlyCap: '5730000',
        yearlyCap: '5730000',
        yearlyCapEffectiveFrom: '2024-04-01',
      },
      {
        insuranceType: '厚生年金',
        monthlyCap: '1500000',
        yearlyCap: '1500000',
        yearlyCapEffectiveFrom: '2024-04-01',
      },
    ],
    standardCompensations,
    createdAt: '2024-04-01',
    updatedAt: '2024-04-01',
    healthType: '協会けんぽ',
    insurerName: 'テスト自動算出レート',
  } as InsuranceRateRecord;
}

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

describe('CalculationDataService social insurance comprehensive fixtures (R7)', () => {
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

  socialInsuranceComprehensiveCases.forEach((testCase) => {
    it(`${testCase.caseId}: ${testCase.prefecture}`, async () => {
      const rateRecord = buildRateRecordFromComprehensiveCase(testCase);
      ratesStub.rateHistory = [rateRecord];

      const payrolls: PayrollData[] = [
        {
          yearMonth: '2024-07',
          amount: testCase.healthStandardMonthly,
          workedDays: 20,
          bonusPaidOn: '2024-07-15',
          bonusTotal: testCase.standardBonusHealth,
          standardHealthBonus: testCase.standardBonusHealth,
          standardWelfareBonus: testCase.standardBonusPension,
        } as unknown as PayrollData,
      ];

      employeesStub.employees = [
        {
          employeeNo: `R7-${testCase.caseId}`,
          name: `R7-${testCase.prefecture}`,
          department: '計算',
          workPrefecture: testCase.prefecture,
          careSecondInsured: testCase.careApplicable,
          healthStandardMonthly: testCase.healthStandardMonthly,
          welfareStandardMonthly: testCase.pensionStandardMonthly,
          payrolls,
        } as unknown as ShahoEmployee,
      ];

      const params: CalculationQueryParams = {
        type: 'insurance',
        targetMonth: '2024-07',
        method: 'none',
        standardMethod: '定時決定',
        insurances: ['健康保険', '介護保険', '厚生年金'],
        includeBonusInMonth: true,
        employeeNo: `R7-${testCase.caseId}`,
        bonusPaidOn: '2024-07-15',
      };

      const [row] = await firstValueFrom(service.getCalculationRows(params));

      expect(row.healthStandardMonthly).toBe(testCase.healthStandardMonthly);
      expect(row.welfareStandardMonthly).toBe(testCase.pensionStandardMonthly);
      expect(row.standardHealthBonus).toBe(testCase.standardBonusHealth);
      expect(row.standardWelfareBonus).toBe(testCase.standardBonusPension);

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