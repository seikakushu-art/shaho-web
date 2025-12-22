import { PrefectureRate, InsuranceRateRecord, StandardCompensationGrade } from '../app/services/insurance-rates.service';
import {
  calculateInsurancePremium,
  calculatePensionPremium,
  floorInsuranceTotal,
  findStandardCompensation,
  roundToInsuranceUnit,
} from './calculation-utils';


type StandardCase = {
  suite: string;
  testId: string;
  remuneration: number;
  expectedGrade: number;
  expectedStandard: number;
};

function parseStandardCases(csv: string): StandardCase[] {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [suite, testId, remuneration, expectedGrade, expectedStandard] = line.split(',');

      return {
        suite,
        testId,
        remuneration: Number(remuneration),
        expectedGrade: Number(expectedGrade),
        expectedStandard: Number(expectedStandard),
      };
    });
}

function buildStandardCompensationTable(
  cases: StandardCase[],
  insuranceType: '健康保険' | '厚生年金',
): StandardCompensationGrade[] {
  const standardByGrade = new Map<number, number>();
  cases.forEach((c) => {
    if (!standardByGrade.has(c.expectedGrade)) {
      standardByGrade.set(c.expectedGrade, c.expectedStandard);
    }
  });

  const lowerBounds = new Map<number, number>();
  cases
    .filter((c) => c.suite === 'boundary' && c.testId.endsWith('_at'))
    .forEach((c) => {
      lowerBounds.set(c.expectedGrade, c.remuneration);
    });

  const sorted = [...lowerBounds.entries()].sort((a, b) => a[1] - b[1]);
  const entries: { grade: number; lower: number; upper?: number }[] = [];

  if (sorted.length > 0) {
    entries.push({ grade: 1, lower: 0, upper: sorted[0][1] });
  }

  sorted.forEach(([grade, lower], index) => {
    const nextLower = sorted[index + 1]?.[1];
    entries.push({ grade, lower, upper: nextLower });
  });

  const expectedGrades = standardByGrade.size;
  if (expectedGrades > entries.length) {
    for (let grade = 1; grade <= expectedGrades; grade++) {
      if (!entries.find((e) => e.grade === grade)) {
        const previous = entries
          .filter((e) => e.grade < grade)
          .sort((a, b) => b.grade - a.grade)[0];
        const fallbackLower = previous ? previous.upper ?? previous.lower : 0;
        entries.push({ grade, lower: fallbackLower, upper: undefined });
      }
    }
  }

  return entries
    .sort((a, b) => a.grade - b.grade)
    .map(({ grade, lower, upper }) => {
      const standard = standardByGrade.get(grade);
      if (standard === undefined) {
        throw new Error(`${insuranceType} 等級${grade}の標準報酬月額が定義されていません`);
      }

      return {
        insuranceType,
        grade: String(grade),
        lowerLimit: String(lower),
        upperLimit: upper !== undefined ? String(upper) : undefined,
        standardMonthlyCompensation: String(standard),
      };
    });
}

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

describe('findStandardCompensation - 標準報酬月額計算', () => {
  const pensionCsv = `suite,test_id,remuneration,expected_grade,expected_standard
minmax,pension_min_0,0,1,88000
minmax,pension_max_big,10000000,32,650000
boundary,pension_B02_minus1,92999,1,88000
boundary,pension_B02_at,93000,2,98000
boundary,pension_B03_minus1,100999,2,98000
boundary,pension_B03_at,101000,3,104000
boundary,pension_B04_minus1,106999,3,104000
boundary,pension_B04_at,107000,4,110000
boundary,pension_B05_minus1,113999,4,110000
boundary,pension_B05_at,114000,5,118000
boundary,pension_B06_minus1,121999,5,118000
boundary,pension_B06_at,122000,6,126000
boundary,pension_B07_minus1,129999,6,126000
boundary,pension_B07_at,130000,7,134000
boundary,pension_B08_minus1,137999,7,134000
boundary,pension_B08_at,138000,8,142000
boundary,pension_B09_minus1,145999,8,142000
boundary,pension_B09_at,146000,9,150000
boundary,pension_B10_minus1,154999,9,150000
boundary,pension_B10_at,155000,10,160000
boundary,pension_B11_minus1,164999,10,160000
boundary,pension_B11_at,165000,11,170000
boundary,pension_B12_minus1,174999,11,170000
boundary,pension_B12_at,175000,12,180000
boundary,pension_B13_minus1,184999,12,180000
boundary,pension_B13_at,185000,13,190000
boundary,pension_B14_minus1,194999,13,190000
boundary,pension_B14_at,195000,14,200000
boundary,pension_B15_minus1,209999,14,200000
boundary,pension_B15_at,210000,15,220000
boundary,pension_B16_minus1,229999,15,220000
boundary,pension_B16_at,230000,16,240000
boundary,pension_B17_minus1,249999,16,240000
boundary,pension_B17_at,250000,17,260000
boundary,pension_B18_minus1,269999,17,260000
boundary,pension_B18_at,270000,18,280000
boundary,pension_B19_minus1,289999,18,280000
boundary,pension_B19_at,290000,19,300000
boundary,pension_B20_minus1,309999,19,300000
boundary,pension_B20_at,310000,20,320000
boundary,pension_B21_minus1,329999,20,320000
boundary,pension_B21_at,330000,21,340000
boundary,pension_B22_minus1,349999,21,340000
boundary,pension_B22_at,350000,22,360000
boundary,pension_B23_minus1,369999,22,360000
boundary,pension_B23_at,370000,23,380000
boundary,pension_B24_minus1,394999,23,380000
boundary,pension_B24_at,395000,24,410000
boundary,pension_B25_minus1,424999,24,410000
boundary,pension_B25_at,425000,25,440000
boundary,pension_B26_minus1,454999,25,440000
boundary,pension_B26_at,455000,26,470000
boundary,pension_B27_minus1,484999,26,470000
boundary,pension_B27_at,485000,27,500000
boundary,pension_B28_minus1,514999,27,500000
boundary,pension_B28_at,515000,28,530000
boundary,pension_B29_minus1,544999,28,530000
boundary,pension_B29_at,545000,29,560000
boundary,pension_B30_minus1,574999,29,560000
boundary,pension_B30_at,575000,30,590000
boundary,pension_B31_minus1,604999,30,590000
boundary,pension_B31_at,605000,31,620000
boundary,pension_B32_minus1,634999,31,620000
boundary,pension_B32_at,635000,32,650000
representative,pension_G01_mid,46500,1,88000
representative,pension_G02_mid,96999,2,98000
representative,pension_G03_mid,103999,3,104000
representative,pension_G04_mid,110499,4,110000
representative,pension_G05_mid,117999,5,118000
representative,pension_G06_mid,125999,6,126000
representative,pension_G07_mid,133999,7,134000
representative,pension_G08_mid,141999,8,142000
representative,pension_G09_mid,150499,9,150000
representative,pension_G10_mid,159999,10,160000
representative,pension_G11_mid,169999,11,170000
representative,pension_G12_mid,179999,12,180000
representative,pension_G13_mid,189999,13,190000
representative,pension_G14_mid,202499,14,200000
representative,pension_G15_mid,219999,15,220000
representative,pension_G16_mid,239999,16,240000
representative,pension_G17_mid,259999,17,260000
representative,pension_G18_mid,279999,18,280000
representative,pension_G19_mid,299999,19,300000
representative,pension_G20_mid,319999,20,320000
representative,pension_G21_mid,339999,21,340000
representative,pension_G22_mid,359999,22,360000
representative,pension_G23_mid,382499,23,380000
representative,pension_G24_mid,409999,24,410000
representative,pension_G25_mid,439999,25,440000
representative,pension_G26_mid,469999,26,470000
representative,pension_G27_mid,499999,27,500000
representative,pension_G28_mid,529999,28,530000
representative,pension_G29_mid,559999,29,560000
representative,pension_G30_mid,589999,30,590000
representative,pension_G31_mid,619999,31,620000
representative,pension_G32_mid,635001,32,650000`;

  const healthCsv = `suite,test_id,remuneration,expected_grade,expected_standard
minmax,health_min_0,0,1,58000
minmax,health_max_big,10000000,50,1390000
boundary,health_B02_minus1,62999,1,58000
boundary,health_B02_at,63000,2,68000
boundary,health_B03_minus1,72999,2,68000
boundary,health_B03_at,73000,3,78000
boundary,health_B04_minus1,82999,3,78000
boundary,health_B04_at,83000,4,88000
boundary,health_B05_minus1,92999,4,88000
boundary,health_B05_at,93000,5,98000
boundary,health_B06_minus1,100999,5,98000
boundary,health_B06_at,101000,6,104000
boundary,health_B07_minus1,106999,6,104000
boundary,health_B07_at,107000,7,110000
boundary,health_B08_minus1,113999,7,110000
boundary,health_B08_at,114000,8,118000
boundary,health_B09_minus1,121999,8,118000
boundary,health_B09_at,122000,9,126000
boundary,health_B10_minus1,129999,9,126000
boundary,health_B10_at,130000,10,134000
boundary,health_B11_minus1,137999,10,134000
boundary,health_B11_at,138000,11,142000
boundary,health_B12_minus1,145999,11,142000
boundary,health_B12_at,146000,12,150000
boundary,health_B13_minus1,154999,12,150000
boundary,health_B13_at,155000,13,160000
boundary,health_B14_minus1,164999,13,160000
boundary,health_B14_at,165000,14,170000
boundary,health_B15_minus1,174999,14,170000
boundary,health_B15_at,175000,15,180000
boundary,health_B16_minus1,184999,15,180000
boundary,health_B16_at,185000,16,190000
boundary,health_B17_minus1,194999,16,190000
boundary,health_B17_at,195000,17,200000
boundary,health_B18_minus1,209999,17,200000
boundary,health_B18_at,210000,18,220000
boundary,health_B19_minus1,229999,18,220000
boundary,health_B19_at,230000,19,240000
boundary,health_B20_minus1,249999,19,240000
boundary,health_B20_at,250000,20,260000
boundary,health_B21_minus1,269999,20,260000
boundary,health_B21_at,270000,21,280000
boundary,health_B22_minus1,289999,21,280000
boundary,health_B22_at,290000,22,300000
boundary,health_B23_minus1,309999,22,300000
boundary,health_B23_at,310000,23,320000
boundary,health_B24_minus1,329999,23,320000
boundary,health_B24_at,330000,24,340000
boundary,health_B25_minus1,349999,24,340000
boundary,health_B25_at,350000,25,360000
boundary,health_B26_minus1,369999,25,360000
boundary,health_B26_at,370000,26,380000
boundary,health_B27_minus1,394999,26,380000
boundary,health_B27_at,395000,27,410000
boundary,health_B28_minus1,424999,27,410000
boundary,health_B28_at,425000,28,440000
boundary,health_B29_minus1,454999,28,440000
boundary,health_B29_at,455000,29,470000
boundary,health_B30_minus1,484999,29,470000
boundary,health_B30_at,485000,30,500000
boundary,health_B31_minus1,514999,30,500000
boundary,health_B31_at,515000,31,530000
boundary,health_B32_minus1,544999,31,530000
boundary,health_B32_at,545000,32,560000
boundary,health_B33_minus1,574999,32,560000
boundary,health_B33_at,575000,33,590000
boundary,health_B34_minus1,604999,33,590000
boundary,health_B34_at,605000,34,620000
boundary,health_B35_minus1,634999,34,620000
boundary,health_B35_at,635000,35,650000
boundary,health_B36_minus1,664999,35,650000
boundary,health_B36_at,665000,36,680000
boundary,health_B37_minus1,694999,36,680000
boundary,health_B37_at,695000,37,710000
boundary,health_B38_minus1,729999,37,710000
boundary,health_B38_at,730000,38,750000
boundary,health_B39_minus1,769999,38,750000
boundary,health_B39_at,770000,39,790000
boundary,health_B40_minus1,809999,39,790000
boundary,health_B40_at,810000,40,830000
boundary,health_B41_minus1,854999,40,830000
boundary,health_B41_at,855000,41,880000
boundary,health_B42_minus1,904999,41,880000
boundary,health_B42_at,905000,42,930000
boundary,health_B43_minus1,954999,42,930000
boundary,health_B43_at,955000,43,980000
boundary,health_B44_minus1,1004999,43,980000
boundary,health_B44_at,1005000,44,1030000
boundary,health_B45_minus1,1054999,44,1030000
boundary,health_B45_at,1055000,45,1090000
boundary,health_B46_minus1,1114999,45,1090000
boundary,health_B46_at,1115000,46,1150000
boundary,health_B47_minus1,1174999,46,1150000
boundary,health_B47_at,1175000,47,1210000
boundary,health_B48_minus1,1234999,47,1210000
boundary,health_B48_at,1235000,48,1270000
boundary,health_B49_minus1,1294999,48,1270000
boundary,health_B49_at,1295000,49,1330000
boundary,health_B50_minus1,1354999,49,1330000
boundary,health_B50_at,1355000,50,1390000
representative,health_G01_mid,31500,1,58000
representative,health_G02_mid,67999,2,68000
representative,health_G03_mid,77999,3,78000
representative,health_G04_mid,87999,4,88000
representative,health_G05_mid,96999,5,98000
representative,health_G06_mid,103999,6,104000
representative,health_G07_mid,110499,7,110000
representative,health_G08_mid,117999,8,118000
representative,health_G09_mid,125999,9,126000
representative,health_G10_mid,133999,10,134000
representative,health_G11_mid,141999,11,142000
representative,health_G12_mid,150499,12,150000
representative,health_G13_mid,159999,13,160000
representative,health_G14_mid,169999,14,170000
representative,health_G15_mid,179999,15,180000
representative,health_G16_mid,189999,16,190000
representative,health_G17_mid,202499,17,200000
representative,health_G18_mid,219999,18,220000
representative,health_G19_mid,239999,19,240000
representative,health_G20_mid,259999,20,260000
representative,health_G21_mid,279999,21,280000
representative,health_G22_mid,299999,22,300000
representative,health_G23_mid,319999,23,320000
representative,health_G24_mid,339999,24,340000
representative,health_G25_mid,359999,25,360000
representative,health_G26_mid,382499,26,380000
representative,health_G27_mid,409999,27,410000
representative,health_G28_mid,439999,28,440000
representative,health_G29_mid,469999,29,470000
representative,health_G30_mid,499999,30,500000
representative,health_G31_mid,529999,31,530000
representative,health_G32_mid,559999,32,560000
representative,health_G33_mid,589999,33,590000
representative,health_G34_mid,619999,34,620000
representative,health_G35_mid,649999,35,650000
representative,health_G36_mid,679999,36,680000
representative,health_G37_mid,712499,37,710000
representative,health_G38_mid,749999,38,750000
representative,health_G39_mid,789999,39,790000
representative,health_G40_mid,832499,40,830000
representative,health_G41_mid,879999,41,880000
representative,health_G42_mid,929999,42,930000
representative,health_G43_mid,979999,43,980000
representative,health_G44_mid,1029999,44,1030000
representative,health_G45_mid,1084999,45,1090000
representative,health_G46_mid,1144999,46,1150000
representative,health_G47_mid,1204999,47,1210000
representative,health_G48_mid,1264999,48,1270000
representative,health_G49_mid,1324999,49,1330000
representative,health_G50_mid,1355001,50,1390000`;

  const pensionCases = parseStandardCases(pensionCsv);
  const healthCases = parseStandardCases(healthCsv);

  const pensionTable = buildStandardCompensationTable(pensionCases, '厚生年金');
  const healthTable = buildStandardCompensationTable(healthCases, '健康保険');

  describe('厚生年金 等級判定', () => {
    it('代表値・境界値・最大最小を網羅的に検証する', () => {
      pensionCases.forEach((testCase: StandardCase) => {
        const actual = findStandardCompensation(testCase.remuneration, pensionTable, '厚生年金');

        expect(actual).toBe(testCase.expectedStandard);
      });
    });
  });

  describe('健康保険 等級判定', () => {
    it('代表値・境界値・最大最小を網羅的に検証する', () => {
      healthCases.forEach((testCase: StandardCase) => {
        const actual = findStandardCompensation(testCase.remuneration, healthTable, '健康保険');

        expect(actual).toBe(testCase.expectedStandard);
      });
    });
  });
});