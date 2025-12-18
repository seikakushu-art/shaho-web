import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { initializeApp, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { CorporateInfoService } from '../app/services/corporate-info.service';
import { InsuranceRateRecord, InsuranceRatesService, PrefectureRate} from '../app/services/insurance-rates.service';
import { ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';
import { CalculationDataService, CalculationQueryParams } from './calculation-data.service';

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

    expect(row.healthEmployeeMonthly).toBe(13500);
    expect(row.healthEmployerMonthly).toBe(13500);
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