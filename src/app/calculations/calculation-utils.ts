import {
  InsuranceRateRecord,
  PrefectureRate,
  StandardCompensationGrade,
} from '../app/services/insurance-rates.service';
import {
  PayrollData,
  ShahoEmployee,
} from '../app/services/shaho-employees.service';
import {
  CalculationType,
  StandardCalculationMethod,
} from './calculation-types';

export type InsuranceKey = 'health' | 'nursing' | 'welfare';

export interface PremiumBreakdown {
  employee: number;
  employer: number;
  total: number;
}

export interface StandardCompensationResult {
  standardMonthly: number;
  source: 'payroll' | 'master' | 'fallback';
  error?: string;
}

const WORKED_DAYS_THRESHOLD = 17;

export interface CalculationContext {
  targetMonth: string;
  bonusPaymentDate?: string;
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

export function roundToInsuranceUnit(value: number): number {
  const base = Math.floor(value);
  const fraction = value - base;

  if (fraction > 0.5) return base + 1;
  if (fraction < 0.5) return base;
  return base; // 50銭は切り捨て
}

export function floorInsuranceTotal(value: number): number {
  return Math.floor(value + 1e-6);
}

export function calculateStandardBonus(
  totalBonus: number,
  cap?: number,
): number {
  const capped = cap ? Math.min(totalBonus, cap) : totalBonus;
  return Math.floor(capped / 1000) * 1000;
}

export function findStandardCompensation(
  amount: number,
  grades: StandardCompensationGrade[],
  insuranceType: '健康保険' | '厚生年金',
): number {
  const applicable = grades.filter(
    (grade) => grade.insuranceType === insuranceType,
  );
  
  // デバッグ: 等級表が空の場合の警告
  if (applicable.length === 0) {
    console.warn(`標準報酬等級表に${insuranceType}の等級が登録されていません。平均報酬月額: ${amount}円`);
    return amount;
  }
  
  // 数値変換ヘルパー関数（カンマ区切りや文字列に対応）
  const parseNumber = (value: string | undefined | null): number => {
    if (!value) return 0;
    // カンマを削除してから数値に変換
    const cleaned = String(value).replace(/,/g, '').trim();
    // 「—」や空文字列の場合は0を返す（上限の場合は上限なしとして扱う）
    if (cleaned === '—' || cleaned === '' || cleaned === '-') return 0;
    const parsed = Number(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const matched = applicable.find((grade) => {
    // 下限が「—」、空文字列、または未設定の場合は0として扱う（等級1の下限は0円以上）
    const lowerLimitStr = String(grade.lowerLimit ?? '').trim();
    const isLowerLimitEmpty = !lowerLimitStr || lowerLimitStr === '—' || lowerLimitStr === '-';
    const lower = isLowerLimitEmpty ? 0 : parseNumber(grade.lowerLimit);
    
    // 上限が「—」、空文字列、または未設定の場合は上限なしとして扱う
    const upperLimitStr = String(grade.upperLimit ?? '').trim();
    const isUpperLimitEmpty = !upperLimitStr || upperLimitStr === '—' || upperLimitStr === '-';
    const upper = isUpperLimitEmpty 
      ? Number.MAX_SAFE_INTEGER
      : parseNumber(grade.upperLimit);
    // 標準報酬等級表のルール: 下限以上、上限未満
    const isMatch = amount >= lower && amount < upper;
    
    // デバッグ: 60,000円付近の等級を詳しく確認
    if (amount >= 55000 && amount <= 65000 && (lower <= 65000 && upper >= 55000)) {
      console.log(
        `等級チェック: 等級${grade.grade}, 下限=${grade.lowerLimit}→${lower === 0 && isLowerLimitEmpty ? '0（下限なし）' : lower}, 上限=${grade.upperLimit}→${upper === Number.MAX_SAFE_INTEGER ? '上限なし' : upper}, 平均報酬月額=${amount}, 該当=${isMatch} (${amount} >= ${lower} && ${amount} < ${upper})`
      );
    }
    
    return isMatch;
  });
  
  if (matched?.standardMonthlyCompensation) {
    const parsed = parseNumber(matched.standardMonthlyCompensation);
    if (parsed > 0) {
      // デバッグ: 該当する等級が見つかった場合
      if (amount >= 55000 && amount <= 65000) {
        console.log(
          `平均報酬月額${amount}円に該当する${insuranceType}の等級が見つかりました: 等級${matched.grade}, 標準報酬月額=${matched.standardMonthlyCompensation}→${parsed}円`
        );
      }
      // デバッグ: 高額報酬の場合も確認
      if (amount >= 1300000 && amount <= 1400000) {
        console.log(
          `平均報酬月額${amount}円に該当する${insuranceType}の等級が見つかりました: 等級${matched.grade}, 標準報酬月額=${matched.standardMonthlyCompensation}→${parsed}円`
        );
      }
      return parsed;
    }
    // デバッグ: standardMonthlyCompensationが無効な場合
    console.warn(
      `標準報酬等級表の等級で標準報酬月額が無効です。等級: ${matched.grade}, 下限: ${matched.lowerLimit}, 上限: ${matched.upperLimit}, 標準報酬月額: ${matched.standardMonthlyCompensation}→${parsed}, 平均報酬月額: ${amount}円`
    );
  } else {
    // デバッグ: 該当する等級が見つからない場合 - 等級1-3を詳しく表示
    console.warn(
      `平均報酬月額${amount}円に該当する${insuranceType}の等級が見つかりませんでした。全等級数: ${applicable.length}`
    );
    console.warn('最初の3等級の詳細:');
    applicable.slice(0, 3).forEach((g) => {
      const lowerLimitStr = String(g.lowerLimit ?? '').trim();
      const isLowerLimitEmpty = !lowerLimitStr || lowerLimitStr === '—' || lowerLimitStr === '-';
      const lower = isLowerLimitEmpty ? 0 : parseNumber(g.lowerLimit);
      const upperLimitStr = String(g.upperLimit ?? '').trim();
      const isUpperLimitEmpty = !upperLimitStr || upperLimitStr === '—' || upperLimitStr === '-';
      const upper = isUpperLimitEmpty ? Number.MAX_SAFE_INTEGER : parseNumber(g.upperLimit);
      const isMatch = amount >= lower && amount < upper;
      console.warn(
        `  等級${g.grade}: 下限=${g.lowerLimit}→${lower === 0 && isLowerLimitEmpty ? '0（下限なし）' : lower}, 上限=${g.upperLimit}→${upper === Number.MAX_SAFE_INTEGER ? '上限なし' : upper}, 標準報酬月額=${g.standardMonthlyCompensation}→${parseNumber(g.standardMonthlyCompensation)}, 該当=${isMatch}`
      );
    });
    
    // 60,000円付近の等級を全て確認
    if (amount >= 55000 && amount <= 65000) {
      console.warn(`${amount}円付近の等級を全て確認:`);
      applicable.forEach((g) => {
        const lowerLimitStr = String(g.lowerLimit ?? '').trim();
        const isLowerLimitEmpty = !lowerLimitStr || lowerLimitStr === '—' || lowerLimitStr === '-';
        const lower = isLowerLimitEmpty ? 0 : parseNumber(g.lowerLimit);
        const upperLimitStr = String(g.upperLimit ?? '').trim();
        const isUpperLimitEmpty = !upperLimitStr || upperLimitStr === '—' || upperLimitStr === '-';
        const upper = isUpperLimitEmpty ? Number.MAX_SAFE_INTEGER : parseNumber(g.upperLimit);
        if (lower <= 70000 && upper >= 50000) {
          const isMatch = amount >= lower && amount < upper;
          console.warn(
            `  等級${g.grade}: 下限=${g.lowerLimit}→${lower === 0 && isLowerLimitEmpty ? '0（下限なし）' : lower}, 上限=${g.upperLimit}→${upper === Number.MAX_SAFE_INTEGER ? '上限なし' : upper}, 標準報酬月額=${g.standardMonthlyCompensation}→${parseNumber(g.standardMonthlyCompensation)}, 該当=${isMatch}`
          );
        }
      });
    }
    
    // 1,360,000円付近の等級を全て確認
    if (amount >= 1300000 && amount <= 1400000) {
      console.warn(`${amount}円付近の等級を全て確認（最後の5等級）:`);
      // 最後の5等級を確認
      const lastFiveGrades = applicable.slice(-5);
      lastFiveGrades.forEach((g) => {
        const lowerLimitStr = String(g.lowerLimit ?? '').trim();
        const isLowerLimitEmpty = !lowerLimitStr || lowerLimitStr === '—' || lowerLimitStr === '-';
        const lower = isLowerLimitEmpty ? 0 : parseNumber(g.lowerLimit);
        const upperLimitStr = String(g.upperLimit ?? '').trim();
        const isUpperLimitEmpty = !upperLimitStr || upperLimitStr === '—' || upperLimitStr === '-';
        const upper = isUpperLimitEmpty ? Number.MAX_SAFE_INTEGER : parseNumber(g.upperLimit);
        const isMatch = amount >= lower && amount < upper;
        console.warn(
          `  等級${g.grade}: 下限=${g.lowerLimit}→${lower === 0 && isLowerLimitEmpty ? '0（下限なし）' : lower}, 上限=${g.upperLimit}→${upper === Number.MAX_SAFE_INTEGER ? '上限なし' : upper}, 標準報酬月額=${g.standardMonthlyCompensation}→${parseNumber(g.standardMonthlyCompensation)}, 該当=${isMatch}`
        );
      });
    }
  }
  
  return amount;
}

function filterEligiblePayrolls(payrolls: PayrollData[]): PayrollData[] {
  return payrolls.filter(
    (p) =>
      p.amount !== undefined && (p.workedDays ?? 0) >= WORKED_DAYS_THRESHOLD,
  );
}

function averagePayroll(payrolls: PayrollData[]): number | undefined {
  if (!payrolls.length) return undefined;
  const total = payrolls.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return Math.floor(total / payrolls.length);
}

function averageRecentPayroll(
  payrolls: PayrollData[],
  targetMonth: string,
  months: number,
): number | undefined {
  const eligible = filterEligiblePayrolls(payrolls);
  const sorted = eligible
    .filter((p) => p.yearMonth <= targetMonth)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .slice(0, months);
  return averagePayroll(sorted);
}

/**
 * 前年7月～当年6月の12か月の給与データの平均を計算する
 * 対象月が当年6月の場合、前年7月～当年6月の12か月を取得
 */
function averageAnnualPayroll(
  payrolls: PayrollData[],
  targetMonth: string,
): number | undefined {
  const parsed = toYearMonthParts(targetMonth);
  if (!parsed) return undefined;
  
  // 前年7月～当年6月の12か月を生成
  const startYear = parsed.year - 1;
  const startMonth = 7;
  const endYear = parsed.year;
  const endMonth = 6;
  
  const targetMonths: string[] = [];
  // 前年7月～12月
  for (let month = startMonth; month <= 12; month++) {
    targetMonths.push(buildYearMonth(startYear, month));
  }
  // 当年1月～6月
  for (let month = 1; month <= endMonth; month++) {
    targetMonths.push(buildYearMonth(endYear, month));
  }
  
  const eligible = filterEligiblePayrolls(payrolls);
  const targetPayrolls = eligible.filter((p) =>
    targetMonths.includes(p.yearMonth),
  );
  
  return averagePayroll(targetPayrolls);
}

function toYearMonthParts(
  yearMonth: string,
): { year: number; month: number } | undefined {
  if (!yearMonth || yearMonth.trim() === '') return undefined;
  const parts = yearMonth.split('-');
  if (parts.length < 2) return undefined;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (Number.isNaN(year) || Number.isNaN(month) || year <= 0 || month <= 0 || month > 12) return undefined;
  return { year, month };
}

function buildYearMonth(year: number, month: number): string {
  const normalizedMonth = String(month).padStart(2, '0');
  return `${year}-${normalizedMonth}`;
}

/**
 * 日付文字列を YYYY-MM 形式に正規化する
 * 対応形式: YYYY-MM-DD, YYYY/MM/DD, YYYY-M-D, YYYY/M/D など
 */
export function normalizeToYearMonth(dateString: string): string | undefined {
  if (!dateString || dateString.length < 7) return undefined;
  
  // YYYY-MM-DD または YYYY-M-D 形式の場合
  if (dateString.includes('-')) {
    const parts = dateString.split('-');
    if (parts.length >= 2) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      return `${year}-${month}`;
    }
  }
  
  // YYYY/MM/DD または YYYY/M/D 形式の場合
  if (dateString.includes('/')) {
    const parts = dateString.split('/');
    if (parts.length >= 2) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      return `${year}-${month}`;
    }
  }
  
  // 既に YYYY-MM 形式の場合
  if (dateString.length === 7 && dateString.match(/^\d{4}-\d{2}$/)) {
    return dateString;
  }
  
  return undefined;
}

function resolveGradeNumber(
  amount: number | undefined,
  grades: StandardCompensationGrade[],
  insuranceType: '健康保険' | '厚生年金',
): number | undefined {
  if (amount === undefined) return undefined;
  const applicable = grades.filter(
    (grade) => grade.insuranceType === insuranceType,
  );
  const matched = applicable.find((grade) => {
    const lower = Number(grade.lowerLimit ?? 0);
    const upper = Number(grade.upperLimit ?? Number.MAX_SAFE_INTEGER);
    // 標準報酬等級表のルール: 下限以上、上限未満
    return amount >= lower && amount < upper;
  });
  if (matched?.grade) {
    const parsed = Number(matched.grade);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const sorted = [...applicable].sort(
    (a, b) => Number(a.lowerLimit ?? 0) - Number(b.lowerLimit ?? 0),
  );
  const index = sorted.findIndex((grade) => grade === matched);
  return index >= 0 ? index + 1 : undefined;
}

export function resolveStandardMonthly(
  employee: ShahoEmployee,
  payrolls: PayrollData[],
  method: StandardCalculationMethod,
  targetMonth: string,
  compensationTable: StandardCompensationGrade[],
  previousStandardMonthly?: number,
): StandardCompensationResult {
  const eligiblePayrolls = filterEligiblePayrolls(payrolls);
  let base: number | undefined;
  let error: string | undefined;

  switch (method) {
    case '定時決定':
      base = (() => {
        const parsed = toYearMonthParts(targetMonth);
        if (!parsed) {
          error = '対象年月の解析に失敗しました。';
          return undefined;
        }
        const months = [4, 5, 6].map((month) =>
          buildYearMonth(parsed.year, month),
        );
        const targetMonths = eligiblePayrolls.filter((p) =>
          months.includes(p.yearMonth),
        );
        if (targetMonths.length === 0) {
          // デバッグ情報: 全給与データから該当する月のデータを確認
          const allPayrollsForMonths = payrolls.filter((p) =>
            months.includes(p.yearMonth) && p.amount !== undefined,
          );
          if (allPayrollsForMonths.length > 0) {
            // データは存在するが、workedDays < 17で除外されている
            const workedDaysInfo = allPayrollsForMonths
              .map((p) => `${p.yearMonth}: 勤務日数=${p.workedDays ?? '未設定'}`)
              .join(', ');
            error = `4-6月の給与データは存在しますが、勤務日数が17日未満のため計算対象外です。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）[${workedDaysInfo}]`;
          } else {
            // 全給与データから該当月のデータを確認（yearMonthの形式チェック）
            const allYearMonths = payrolls.map((p) => p.yearMonth).filter(Boolean);
            const targetYearMonthsStr = months.join(', ');
            const availableYearMonthsStr = [...new Set(allYearMonths)].join(', ');
            error = `4-6月の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）対象月: ${targetYearMonthsStr}、利用可能な年月: ${availableYearMonthsStr || 'なし'}`;
          }
          return undefined;
        }
        return averagePayroll(targetMonths);
      })();
      break;
    case '随時決定':
      base = (() => {
        const parsed = toYearMonthParts(targetMonth);
        if (!parsed) {
          error = '対象年月の解析に失敗しました。';
          return undefined;
        }
        
        // 対象月から連続した3ヶ月を生成
        const targetMonths: string[] = [];
        for (let i = 0; i < 3; i++) {
          let year = parsed.year;
          let month = parsed.month + i;
          while (month > 12) {
            month -= 12;
            year += 1;
          }
          targetMonths.push(buildYearMonth(year, month));
        }
        
        // 連続した3ヶ月のデータを取得（3ヶ月分揃っていなくても良い）
        const targetOrAfter = eligiblePayrolls.filter((p) =>
          targetMonths.includes(p.yearMonth),
        );
        
        // データが0件の場合はエラー、1件以上あれば利用可能なデータで計算
        if (targetOrAfter.length === 0) {
          // 全給与データから該当する月のデータを確認（workedDaysの条件なし）
          const allPayrollsForMonths = payrolls.filter((p) =>
            targetMonths.includes(p.yearMonth) && p.amount !== undefined,
          );
          if (allPayrollsForMonths.length > 0) {
            // データは存在するが、workedDays < 17で除外されている
            error = `対象月（${targetMonth}）から連続した3ヶ月の給与データは存在しますが、勤務日数が17日未満のため計算対象外です。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          } else {
            error = `対象月（${targetMonth}）から連続した3ヶ月（${targetMonths.join(', ')}）の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          }
          return undefined;
        }
        const average = averagePayroll(targetOrAfter);
        if (average === undefined) {
          error = `対象月以降の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        const candidateStandard = findStandardCompensation(
          average,
          compensationTable,
          '健康保険',
        );
        const previousGrade = resolveGradeNumber(
          previousStandardMonthly ?? employee.standardMonthly,
          compensationTable,
          '健康保険',
        );
        const candidateGrade = resolveGradeNumber(
          candidateStandard,
          compensationTable,
          '健康保険',
        );

        if (
          candidateStandard !== undefined &&
          previousStandardMonthly !== undefined &&
          previousGrade !== undefined &&
          candidateGrade !== undefined
        ) {
          const diff = Math.abs(candidateGrade - previousGrade);
          if (diff < 2) return previousStandardMonthly;
        }

        return average;
      })();
      break;
    case '年間平均':
      base = (() => {
        // 対象月が1～5月の場合はエラー
        const parsed = toYearMonthParts(targetMonth);
        if (!parsed) {
          error = '対象年月の解析に失敗しました。';
          return undefined;
        }
        if (parsed.month >= 1 && parsed.month <= 5) {
          error = `年間平均の計算は6月以降の対象月のみ指定可能です。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        // 前年7月～当年6月の12か月の平均を計算
        const annualAverage = averageAnnualPayroll(
          eligiblePayrolls,
          targetMonth,
        );
        if (annualAverage === undefined) {
          error = `前年7月～当年6月の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        return annualAverage;
      })();
      break;
    case '資格取得時':
      base = (() => {
        // 健康保険と厚生年金の資格取得日のうち、古い方を取得
        const healthAcq = employee.healthAcquisition;
        const pensionAcq = employee.pensionAcquisition;
        
        if (!healthAcq && !pensionAcq) {
          error = `資格取得日が設定されていません。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        
        // 古い方の資格取得日を特定
        const earliestAcquisition: string | undefined = healthAcq && pensionAcq
          ? (healthAcq < pensionAcq ? healthAcq : pensionAcq)
          : (healthAcq || pensionAcq);
        
        if (!earliestAcquisition || earliestAcquisition.length < 7) {
          error = `資格取得日が不正です。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        
        // 型ガード: この時点でearliestAcquisitionはstring型であることが保証されている
        const acquisitionDate: string = earliestAcquisition;
        
        // 資格取得日の年月を取得（YYYY-MM形式に正規化）
        const acquisitionYearMonth = normalizeToYearMonth(acquisitionDate);
        if (!acquisitionYearMonth) {
          error = `資格取得日が不正です。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        
        // 該当月の給与データを取得
        const acquisitionPayroll = eligiblePayrolls.find(
          (p) => p.yearMonth === acquisitionYearMonth,
        );
        
        if (!acquisitionPayroll || acquisitionPayroll.amount === undefined) {
          error = `資格取得月（${acquisitionYearMonth}）の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        
        return acquisitionPayroll.amount;
      })();
      break;
    case '育休復帰時':
      base = (() => {
        const targetOrAfter = eligiblePayrolls
          .filter((p) => p.yearMonth >= targetMonth)
          .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
          .slice(0, 3);
        const average = averagePayroll(targetOrAfter);
        if (average === undefined) {
          error = `対象月以降の給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`;
          return undefined;
        }
        const candidateStandard = findStandardCompensation(
          average,
          compensationTable,
          '健康保険',
        );
        const previousGrade = resolveGradeNumber(
          previousStandardMonthly ?? employee.standardMonthly,
          compensationTable,
          '健康保険',
        );
        const candidateGrade = resolveGradeNumber(
          candidateStandard,
          compensationTable,
          '健康保険',
        );

        if (
          candidateStandard !== undefined &&
          previousStandardMonthly !== undefined &&
          previousGrade !== undefined &&
          candidateGrade !== undefined
        ) {
          const diff = Math.abs(candidateGrade - previousGrade);
          if (diff < 1) return previousStandardMonthly;
        }

        return average;
      })();
      break;
  }

  if (error) {
    return {
      standardMonthly: 0,
      source: 'fallback',
      error,
    };
  }

  if (base === undefined) {
    return {
      standardMonthly: 0,
      source: 'fallback',
      error: `計算に必要な給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`,
    };
  }

  if (compensationTable.length === 0) {
    return {
      standardMonthly: 0,
      source: 'fallback',
      error: '標準報酬等級表が設定されていません。',
    };
  }

  // デバッグ: baseの値を確認
  if (base !== undefined && base >= 55000 && base <= 65000) {
    console.log(
      `resolveStandardMonthly: base=${base}, compensationTable.length=${compensationTable.length}, 標準報酬月額を計算します`
    );
  }

  const standardMonthly = findStandardCompensation(
    base,
    compensationTable,
    '健康保険',
  );
  
  // デバッグ: 結果を確認
  if (base !== undefined && base >= 55000 && base <= 65000) {
    console.log(
      `resolveStandardMonthly: 平均報酬月額=${base}円 → 標準報酬月額=${standardMonthly}円`
    );
  }
  
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
): PremiumBreakdown {
  if (!rate) {
    return { employee: 0, employer: 0, total: 0 };
  }

  const totalRate = parseRate(rate.totalRate);
  const employeeRate = parseRate(rate.employeeRate);
  const rawTotal = base * totalRate;
  const rawEmployee = base * employeeRate;
  const rawEmployer = rawTotal - rawEmployee;

  const employee = roundToInsuranceUnit(rawEmployee);
  const employer = roundToInsuranceUnit(rawEmployer);
  const total = floorInsuranceTotal(employee + employer);
  return { total, employee, employer };
}

export function calculatePensionPremium(
  base: number,
  rateDetail: InsuranceRateRecord['pensionRate'] | undefined,
): PremiumBreakdown {
  if (!rateDetail) return { total: 0, employee: 0, employer: 0 };

  const totalRate = parseRate(rateDetail.totalRate);
  const employeeRate = parseRate(rateDetail.employeeRate);
  const rawTotal = base * totalRate;
  const rawEmployee = base * employeeRate;
  const rawEmployer = rawTotal - rawEmployee;

  const employee = roundToInsuranceUnit(rawEmployee);
  const employer = roundToInsuranceUnit(rawEmployer);
  const total = floorInsuranceTotal(employee + employer);

  return { total, employee, employer };
}

export function extractBonusCap(
  record: InsuranceRateRecord | undefined,
  insuranceType: '健康保険' | '厚生年金',
  capType: 'monthly' | 'yearly' = 'monthly',
): number | undefined {
  const bonus = record?.bonusCaps?.find(
    (cap) => cap.insuranceType === insuranceType,
  );
  const rawCap =
    capType === 'yearly'
      ? bonus?.yearlyCap
      : bonus?.monthlyCap || bonus?.yearlyCap;
  const parsed = rawCap ? Number(rawCap) : undefined;
  return parsed && !isNaN(parsed) ? parsed : undefined;
}
