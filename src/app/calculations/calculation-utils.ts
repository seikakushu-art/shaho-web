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

export interface InsuranceStandardMonthly {
  amount: number;
  source: 'payroll' | 'master' | 'fallback';
  error?: string;
}

export interface StandardCompensationResult {
  health: InsuranceStandardMonthly;
  welfare: InsuranceStandardMonthly;
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
  // 浮動小数点の誤差を避けるため、100倍して整数として扱う
  // 例: 2989.9 → 298990（銭単位）、41375.5 → 4137550（銭単位）
  const valueInSen = Math.floor(value * 100 + 1e-6); // 1e-6を加えて浮動小数点誤差を補正
  const baseInYen = Math.floor(value);
  const baseInSen = baseInYen * 100;
  const fractionInSen = valueInSen - baseInSen;

  // 50銭（50）未満は切り捨て、50銭以上は1円（100）に切り上げ
  // 50銭ちょうど（fractionInSen === 50）の場合は切り捨て
  if (fractionInSen > 50) {
    return baseInYen + 1;
  }
  return baseInYen; // 50銭未満または50銭ちょうどは切り捨て
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
): number | null {
  // デバッグ: 入力データの確認
  console.log(`[${insuranceType}] 入力データ確認: 全等級数=${grades.length}`);
  const insuranceTypeCounts = grades.reduce((acc, g) => {
    const type = g.insuranceType || '未設定';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`[${insuranceType}] 保険種別ごとの等級数:`, insuranceTypeCounts);
  
  // サンプルデータを表示（最初の5件）
  if (grades.length > 0) {
    console.log(`[${insuranceType}] サンプルデータ（最初の5件）:`, grades.slice(0, 5).map(g => ({
      insuranceType: g.insuranceType,
      grade: g.grade,
      standardMonthlyCompensation: g.standardMonthlyCompensation
    })));
  }
  
  const applicable = grades.filter(
    (grade) => {
      // insuranceTypeが一致することを確認
      if (grade.insuranceType !== insuranceType) {
        return false;
      }
      // 等級が空、「—」、または無効な場合は除外
      const gradeValue = grade.grade?.trim();
      if (!gradeValue || gradeValue === '—' || gradeValue === '-') {
        return false;
      }
      return true;
    },
  );
  
  // デバッグ: 等級表が空の場合の警告
  if (applicable.length === 0) {
    console.error(`[${insuranceType}] 標準報酬等級表に${insuranceType}の等級が登録されていません。平均報酬月額: ${amount}円`);
    console.error(`[${insuranceType}] 全等級データ:`, grades.map(g => ({ insuranceType: g.insuranceType, grade: g.grade })));
    // 健康保険の場合はエラーとしてnullを返す
    if (insuranceType === '健康保険') {
      return null;
    }
    // 厚生年金の場合は平均報酬月額をそのまま返す
    return amount;
  }
  
  // デバッグ: 等級表の内容を確認
  console.log(`[${insuranceType}] 平均報酬月額=${amount}円, 該当等級数=${applicable.length}`);
  
  // 該当等級のサンプルを表示
  if (applicable.length > 0) {
    console.log(`[${insuranceType}] 該当等級サンプル（最初の3件）:`, applicable.slice(0, 3).map(g => ({
      grade: g.grade,
      lowerLimit: g.lowerLimit,
      upperLimit: g.upperLimit,
      standardMonthlyCompensation: g.standardMonthlyCompensation
    })));
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
      // デバッグ: 該当する等級が見つかった場合（gradeとinsuranceTypeのペアを明確に表示）
      console.log(
        `[${insuranceType}] 平均報酬月額${amount}円に該当する等級が見つかりました: 等級${matched.grade}, 標準報酬月額=${matched.standardMonthlyCompensation}→${parsed}円`
      );
      return parsed;
    }
    // デバッグ: standardMonthlyCompensationが無効な場合
    console.warn(
      `標準報酬等級表の等級で標準報酬月額が無効です。等級: ${matched.grade}, 下限: ${matched.lowerLimit}, 上限: ${matched.upperLimit}, 標準報酬月額: ${matched.standardMonthlyCompensation}→${parsed}, 平均報酬月額: ${amount}円`
    );
  } else {
    // 該当する等級が見つからない場合、上限を超えているかどうかを判断
    // 等級表を標準報酬月額でソートして、最高等級を見つける
    const sortedGrades = [...applicable].sort((a, b) => {
      const standardA = parseNumber(a.standardMonthlyCompensation);
      const standardB = parseNumber(b.standardMonthlyCompensation);
      return standardA - standardB;
    });
    
    // 最高等級を取得（標準報酬月額が最大の等級）
    const highestGrade = sortedGrades[sortedGrades.length - 1];
    if (highestGrade?.standardMonthlyCompensation) {
      // 最高等級の上限を確認
      const highestUpperLimitStr = String(highestGrade.upperLimit ?? '').trim();
      const isHighestUpperLimitEmpty = !highestUpperLimitStr || highestUpperLimitStr === '—' || highestUpperLimitStr === '-';
      const highestUpperLimit = isHighestUpperLimitEmpty ? Number.MAX_SAFE_INTEGER : parseNumber(highestGrade.upperLimit);
      
      // 実際に上限を超えている場合のみ最高等級を適用
      if (highestUpperLimit < Number.MAX_SAFE_INTEGER && amount >= highestUpperLimit) {
        const highestStandardMonthly = parseNumber(highestGrade.standardMonthlyCompensation);
        if (highestStandardMonthly > 0) {
          console.warn(
            `平均報酬月額${amount}円は${insuranceType}の等級表の上限（${highestUpperLimit}円）を超えています。最高等級（等級${highestGrade.grade}）の標準報酬月額${highestStandardMonthly}円を適用します。`
          );
          return highestStandardMonthly;
        }
      }
    }
    
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
  
  // 等級が見つからなかった場合
  // 健康保険の場合はエラーとしてnullを返す
  if (insuranceType === '健康保険') {
    return null;
  }
  
  // 厚生年金の場合の特別処理
  if (insuranceType === '厚生年金') {
    // 等級1と等級32を取得
    const grade1 = applicable.find(g => g.grade?.trim() === '1');
    const grade32 = applicable.find(g => g.grade?.trim() === '32');
    
    if (grade1) {
      const grade1LowerLimit = parseNumber(grade1.lowerLimit);
      const grade1StandardMonthly = parseNumber(grade1.standardMonthlyCompensation);
      // 等級1の下限より低い場合は等級1の標準報酬月額を返す
      if (amount < grade1LowerLimit) {
        console.log(
          `[厚生年金] 平均報酬月額${amount}円は等級1の下限${grade1LowerLimit}円より低いため、等級1の標準報酬月額${grade1StandardMonthly}円を適用します。`
        );
        return grade1StandardMonthly;
      }
    }
    
    if (grade32) {
      const grade32UpperLimit = parseNumber(grade32.upperLimit);
      const grade32StandardMonthly = parseNumber(grade32.standardMonthlyCompensation);
      // 等級32の上限より高い場合は等級32の標準報酬月額を返す
      if (grade32UpperLimit > 0 && amount >= grade32UpperLimit) {
        console.log(
          `[厚生年金] 平均報酬月額${amount}円は等級32の上限${grade32UpperLimit}円を超えているため、等級32の標準報酬月額${grade32StandardMonthly}円を適用します。`
        );
        return grade32StandardMonthly;
      }
    }
    
    // その他の場合は平均報酬月額をそのまま返す
    return amount;
  }
  
  // その他の場合は平均報酬月額をそのまま返す
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
        return average;
      })();
      break;
  }

  if (error) {
    return {
      health: { amount: 0, source: 'fallback', error },
      welfare: { amount: 0, source: 'fallback', error },
    };
  }

  if (base === undefined) {
    return {
      health: {
        amount: 0,
        source: 'fallback',
        error: `計算に必要な給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`,
      },
      welfare: {
        amount: 0,
        source: 'fallback',
        error: `計算に必要な給与データが不足しています。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`,
      },
    };
  }

  if (compensationTable.length === 0) {
    return {
      health: {
        amount: 0,
        source: 'fallback',
        error: '標準報酬等級表が設定されていません。',
      },
      welfare: {
        amount: 0,
        source: 'fallback',
        error: '標準報酬等級表が設定されていません。',
      },
    };
  }

  // デバッグ: baseの値を確認
  if (base !== undefined && base >= 55000 && base <= 65000) {
    console.log(
      `resolveStandardMonthly: base=${base}, compensationTable.length=${compensationTable.length}, 標準報酬月額を計算します`
    );
  }

  // デバッグ: 等級表の内容を確認
  const healthGrades = compensationTable.filter(g => g.insuranceType === '健康保険');
  const welfareGrades = compensationTable.filter(g => g.insuranceType === '厚生年金');
  console.log(`[標準報酬月額計算] 平均報酬月額=${base}円`);
  console.log(`[標準報酬月額計算] 健康保険等級数: ${healthGrades.length}, 厚生年金等級数: ${welfareGrades.length}`);
  if (healthGrades.length > 0 && healthGrades.length <= 5) {
    console.log(`[標準報酬月額計算] 健康保険等級サンプル:`, healthGrades.slice(0, 3).map(g => ({
      grade: g.grade,
      lowerLimit: g.lowerLimit,
      upperLimit: g.upperLimit,
      standardMonthlyCompensation: g.standardMonthlyCompensation
    })));
  }
  if (welfareGrades.length > 0 && welfareGrades.length <= 5) {
    console.log(`[標準報酬月額計算] 厚生年金等級サンプル:`, welfareGrades.slice(0, 3).map(g => ({
      grade: g.grade,
      lowerLimit: g.lowerLimit,
      upperLimit: g.upperLimit,
      standardMonthlyCompensation: g.standardMonthlyCompensation
    })));
  }

  const standardHealthMonthly = findStandardCompensation(
    base,
    compensationTable,
    '健康保険',
  );
  const standardWelfareMonthly = findStandardCompensation(
    base,
    compensationTable,
    '厚生年金',

  );
  
  // 健康保険の等級が見つからない場合はエラーを返す
  if (standardHealthMonthly === null) {
    return {
      health: {
        amount: 0,
        source: 'fallback',
        error: `平均報酬月額${base}円に該当する健康保険の等級が見つかりませんでした。（社員番号: ${employee.employeeNo}, 氏名: ${employee.name}）`,
      },
      welfare: {
        amount: standardWelfareMonthly ?? 0,
        source: base
          ? 'payroll'
          : compensationTable.length
            ? 'master'
            : 'fallback',
      },
    };
  }
  
  // デバッグ: 結果を確認
  console.log(
    `[標準報酬月額計算] 平均報酬月額=${base}円 → 健保標準報酬月額=${standardHealthMonthly}円, 厚年標準報酬月額=${standardWelfareMonthly}円`
  );
  
  return {
    health: {
      amount: standardHealthMonthly,
      source: base
        ? 'payroll'
        : compensationTable.length
          ? 'master'
          : 'fallback',
    },
    welfare: {
      amount: standardWelfareMonthly ?? 0,
      source: base
        ? 'payroll'
        : compensationTable.length
          ? 'master'
          : 'fallback',
    },
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

  const employee = roundToInsuranceUnit(rawEmployee);
  const total = floorInsuranceTotal(rawTotal);
  const employer = total - employee;
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

  const employee = roundToInsuranceUnit(rawEmployee);
  const total = floorInsuranceTotal(rawTotal);
  const employer = total - employee;

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

