import {
  ChangeField,
  CSVParseResult,
  ParsedRow,
  Summary,
  TemplateType,
  ValidationError,
  ValidatedRow,
} from './csv-import.types';

const DATE_FIELDS = [
  '生年月日',
  '賞与支給日',
  '扶養 生年月日',
  '扶養 被扶養者になった日',
  '健康保険 資格取得日',
  '健康保険資格取得日',
  '厚生年金 資格取得日',
  '厚生年金資格取得日',
  '現在の休業開始日',
  '現在の休業予定終了日',
];
const YEAR_MONTH_FIELDS = [
  '算定対象期間開始年月',
  '算定対象期間終了年月',
  '算定年度',
  '賞与支給年度',
  '月給支払月',
];
const NUMBER_FIELDS = [
  '健保標準報酬月額',
  '厚年標準報酬月額',
  '賞与総支給額',
  '月給支払額',
  '支払基礎日数',
  '扶養 年収（見込みでも可）',
];
const POSTAL_CODE_FIELDS = ['郵便番号'];
const ADDRESS_FIELDS = ['住民票住所', '現住所', '扶養 住所（別居の場合のみ入力）'];
const FLAG_FIELDS = [
  '介護保険第2号フラグ',
  '介護保険第2号被保険者フラグ',
  '一時免除フラグ（健康保険料・厚生年金一時免除）',
  '健康保険・厚生年金一時免除フラグ',
  '扶養の有無',
  '扶養 国民年金第3号被保険者該当フラグ',
];

// 扶養家族関連の基本フィールド（番号なしの形）
const DEPENDENT_BASE_FIELDS = [
  '扶養 続柄',
  '扶養 氏名(漢字)',
  '扶養 氏名(カナ)',
  '扶養 生年月日',
  '扶養 性別',
  '扶養 個人番号',
  '扶養 基礎年金番号',
  '扶養 同居区分',
  '扶養 住所（別居の場合のみ入力）',
  '扶養 職業',
  '扶養 年収（見込みでも可）',
  '扶養 被扶養者になった日',
  '扶養 国民年金第3号被保険者該当フラグ',
];

const REQUIRED_FIELDS: Record<TemplateType, string[]> = {
  new: [
    '社員番号',
    '氏名(漢字)',
    '氏名(カナ)',
    '性別',
    '生年月日',
    '所属部署名',
    '勤務地都道府県名',
    '健康保険資格取得日',
    '厚生年金資格取得日',
  ],
  payroll: ['社員番号', '氏名(漢字)'],
  unknown: [],
};

const GENDER_VALUES = ['男', '女', '男性', '女性', 'male', 'female'];
const FLAG_VALUES = [
  '0',
  '1',
  'on',
  'off',
  'true',
  'false',
  'yes',
  'no',
  '有',
  '無',
];

export function parseCSV(csvText: string): string[][] {
  let text = csvText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  text = text.replace(/\r\n?/g, '\n').trim();

  const rows: string[][] = [];
  let currentField = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentField = '';
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  if (inQuotes) {
    throw new Error('ダブルクォートの対応が不正です');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function normalizeHeaders(rawHeaders: string[]): string[] {
  return rawHeaders
    .map((header) =>
      header
        .replace(/\u3000/g, ' ')
        .replace(/["'`]/g, '')
        .trim(),
    )
    .filter((header) => header.length > 0);
}

// 全角英数、カッコ、／を半角に変換する共通関数
function normalizeFullWidthCharacters(value: string): string {
  return (
    value
      // 全角数字を半角数字に変換
      .replace(/[０-９]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      })
      // 全角英字（大文字）を半角英字に変換
      .replace(/[Ａ-Ｚ]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      })
      // 全角英字（小文字）を半角英字に変換
      .replace(/[ａ-ｚ]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
      })
      // 全角カッコを半角カッコに変換
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      // 全角スラッシュを半角スラッシュに変換
      .replace(/／/g, '/')
  );
}

export function detectTemplateType(headers: string[]): TemplateType {
  const normalizedHeaders = headers.map((h) => h.toLowerCase());
  const headerSet = new Set(normalizedHeaders);

  // 月給/賞与支払額同期用テンプレートの判定（月給支払月と月給支払額を含む場合）
  if (headerSet.has('月給支払月') && headerSet.has('月給支払額')) {
    return 'payroll';
  }

  // 新規登録/一括更新用テンプレートの判定
  // 24項目以上（新形式拡張：扶養家族情報が追加されたバージョン以降に対応）
  if (headers.length >= 24) {
    return 'new';
  }

  return 'unknown';
}

export function convertToRecordArray(
  rows: string[][],
  headers: string[],
  rowOffset: number = 1,
): ParsedRow[] {
  return rows.map((row, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      const rawValue = (row[headerIndex] ?? '').trim();
      // 全角英数、カッコ、／を半角に変換してから格納
      let normalizedValue = normalizeFullWidthCharacters(rawValue);
      // 社員番号フィールドの場合は、スペースを削除して正規化
      if (header === '社員番号') {
        normalizedValue = normalizeEmployeeNoForComparison(normalizedValue);
      }
      record[header] = normalizedValue;
    });
    return { data: record, rowIndex: index + rowOffset };
  });
}

/**
 * 氏名を正規化（全ての空白文字を削除）
 * 半角スペース、全角スペース、タブなどの空白文字を全て削除して比較用に正規化
 */
function normalizeNameForComparison(name: string): string {
  if (!name) return '';
  // 全ての空白文字（半角スペース、全角スペース、タブ、改行など）を削除
  return name.replace(/\s+/g, '').trim();
}

/**
 * 社員番号を正規化（全ての空白文字を削除）
 * 半角スペース、全角スペース、タブなどの空白文字を全て削除して比較用に正規化
 */
export function normalizeEmployeeNoForComparison(employeeNo: string): string {
  if (!employeeNo) return '';
  // 全ての空白文字（半角スペース、全角スペース、タブ、改行など）を削除
  return employeeNo.replace(/\s+/g, '').trim();
}

export function validateRequiredFields(
  row: ParsedRow,
  templateType: TemplateType,
  existingEmployees?: ExistingEmployee[],
  allRows?: ParsedRow[],
): ValidationError[] {
  // 2行目以降（扶養家族追加行）かどうかを判定
  // 同じ社員番号で複数行ある場合、2行目以降を扶養家族追加行として扱う
  let isDependentOnlyRow = false;
  const employeeNo = row.data['社員番号'];

  if (employeeNo && allRows) {
    const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
    // 同じ社員番号の行をすべて取得
    const sameEmployeeRows = allRows.filter((r) => {
      const rEmployeeNo = r.data['社員番号'];
      return (
        rEmployeeNo &&
        normalizeEmployeeNoForComparison(rEmployeeNo) === normalizedEmployeeNo
      );
    });

    if (sameEmployeeRows.length > 1) {
      // 同じ社員番号で複数行ある場合、現在の行が最初の行以外かどうかを判定
      const sortedRows = sameEmployeeRows.sort(
        (a, b) => a.rowIndex - b.rowIndex,
      );
      const isFirstRow = sortedRows[0].rowIndex === row.rowIndex;
      isDependentOnlyRow = !isFirstRow;
    }
  }

  let requiredFields = REQUIRED_FIELDS[templateType];

  // 2行目以降（扶養家族追加行）の場合は、従業員情報の必須フィールドチェックをスキップ
  if (isDependentOnlyRow) {
    // 社員番号のみ必須
    requiredFields = ['社員番号'];
  } else {
    // 新規登録/一括更新用テンプレートの場合、既存社員の有無で必須項目を変更
    if (
      templateType === 'new' &&
      existingEmployees &&
      existingEmployees.length > 0
    ) {
      const employeeNo = row.data['社員番号'] || '';
      if (employeeNo) {
        // 念のため、existingEmployeesのemployeeNoも正規化して比較する
        const normalizedEmployeeNo =
          normalizeEmployeeNoForComparison(employeeNo);
        const existingEmployee = existingEmployees.find(
          (emp) =>
            normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
            normalizedEmployeeNo,
        );

        if (existingEmployee) {
          // 既存社員が見つかった場合 → 一括更新モード
          // 必須項目は「社員番号」と「氏名(漢字)」のみ
          requiredFields = ['社員番号', '氏名(漢字)'];
        }
        // 既存社員が見つからない場合 → 新規登録モード（現在の必須項目のまま）
      }
    }
  }

  const errors: ValidationError[] = [];

  requiredFields.forEach((field) => {
    // フィールド名のバリエーションをチェック（スペースあり/なし、新旧形式など）
    const fieldVariations = [
      field,
      field.replace(/\s+/g, ''), // スペースを削除
      field.replace(/([^（])（/g, '$1(').replace(/）/g, ')'), // 全角カッコを半角に
    ];

    // フィールド名のマッピング（新旧形式の対応）
    const fieldMapping: Record<string, string[]> = {
      健康保険資格取得日: ['健康保険資格取得日', '健康保険 資格取得日'],
      厚生年金資格取得日: ['厚生年金資格取得日', '厚生年金 資格取得日'],
      '氏名(漢字)': ['氏名(漢字)', '氏名漢字'],
    };

    // マッピングがある場合はそれを使用、ない場合はバリエーションを使用
    const fieldsToCheck = fieldMapping[field] || fieldVariations;

    // いずれかのフィールド名で値が存在するかチェック
    const hasValue = fieldsToCheck.some((f) => {
      const value = row.data[f];
      return value && value.trim().length > 0;
    });

    if (!hasValue) {
      // エラーメッセージ用に元のフィールド名を使用
      errors.push(
        buildError(row.rowIndex, field, `${field}は必須です`, templateType),
      );
    }
  });

  return errors;
}

export function validateDataFormat(
  row: ParsedRow,
  templateType: TemplateType,
): ValidationError[] {
  const errors: ValidationError[] = [];

  DATE_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    if (!/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}はYYYY/MM/DD形式で入力してください`,
          templateType,
        ),
      );
    }
  });

  YEAR_MONTH_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    // 算定年度と賞与支給年度はYYYY形式（4桁の年のみ）
    if (field === '算定年度' || field === '賞与支給年度') {
      if (!/^\d{4}$/.test(value)) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}はYYYY形式で入力してください`,
            templateType,
          ),
        );
      }
    } else {
      // その他はYYYY/MM形式
      if (!/^\d{4}[/-]\d{1,2}$/.test(value)) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}はYYYY/MM形式で入力してください`,
            templateType,
          ),
        );
      }
    }
  });

  NUMBER_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    const normalized = value.replace(/,/g, '');
    if (Number.isNaN(Number(normalized))) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は数値で入力してください`,
          templateType,
        ),
      );
    }
  });

  // 郵便番号の検証（7桁の数字、ハイフンは任意）
  POSTAL_CODE_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    // 7桁の数字（ハイフンは任意）：123-4567 または 1234567
    // ハイフンがある場合は3桁-4桁の形式のみ許可
    const normalized = value.replace(/-/g, '');
    if (!/^\d{7}$/.test(normalized)) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は7桁の数字で入力してください（例：123-4567 または 1234567）`,
          templateType,
        ),
      );
    } else if (value.includes('-') && !/^\d{3}-\d{4}$/.test(value)) {
      // ハイフンがある場合は3桁-4桁の形式のみ許可
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は123-4567形式で入力してください`,
          templateType,
        ),
      );
    }
  });

  // 住所の検証（最大80文字）
  ADDRESS_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    // 最大80文字まで許可
    if (value.length > 80) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は最大80文字まで入力できます（現在${value.length}文字）`,
          templateType,
        ),
      );
    }
  });

  // 個人番号の検証（12桁の数字）
  const personalNumberFields = ['個人番号', '扶養 個人番号'];
  personalNumberFields.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    // 数字以外の文字を除去
    const digitsOnly = value.replace(/[^\d]/g, '');
    // 12桁の数字であることを確認
    if (!/^\d{12}$/.test(digitsOnly)) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は12桁の数字で入力してください`,
          templateType,
        ),
      );
    }
  });

  const gender = row.data['性別'];
  if (gender && !GENDER_VALUES.includes(gender.toLowerCase())) {
    errors.push(
      buildError(row.rowIndex, '性別', '性別の値が不正です', templateType),
    );
  }
  const dependentGender = row.data['扶養 性別'];
  if (
    dependentGender &&
    !GENDER_VALUES.includes(dependentGender.toLowerCase())
  ) {
    errors.push(
      buildError(
        row.rowIndex,
        '扶養 性別',
        '扶養 性別の値が不正です',
        templateType,
      ),
    );
  }

  FLAG_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    if (!FLAG_VALUES.includes(value.toLowerCase())) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は0/1/true/falseで入力してください`,
          templateType,
          'warning',
        ),
      );
    }
  });

  return errors;
}

export function validateDataRange(
  row: ParsedRow,
  templateType: TemplateType,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hundredYearsAgo = new Date(today);
  hundredYearsAgo.setFullYear(today.getFullYear() - 100);

  DATE_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    const date = new Date(value.replace(/-/g, '/'));
    if (Number.isNaN(date.getTime())) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}の日付が不正です`,
          templateType,
        ),
      );
      return;
    }

    // 生年月日の場合は年分の制限をチェック
    if (field === '生年月日' || field === '扶養 生年月日') {
      // 日付を0時0分0秒に設定して時刻の影響を排除
      date.setHours(0, 0, 0, 0);
      const dateTime = date.getTime();
      const todayTime = today.getTime();
      
      // 未来の日付チェック（今日より後は不可）
      if (dateTime > todayTime) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}は未来の日付は入力できません`,
            templateType,
          ),
        );
      }
      // 100年前より前の日付チェック
      const hundredYearsAgoTime = hundredYearsAgo.getTime();
      if (dateTime < hundredYearsAgoTime) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}は100年前より前の日付は入力できません`,
            templateType,
          ),
        );
      }
    }
  });

  YEAR_MONTH_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    // 算定年度と賞与支給年度はYYYY形式（4桁の年のみ）
    if (field === '算定年度' || field === '賞与支給年度') {
      const year = Number(value);
      if (!year || year < 1900 || year > 2100) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}の年が不正です`,
            templateType,
          ),
        );
      }
    } else {
      // その他はYYYY/MM形式
      const [year, month] = value
        .replace(/-/g, '/')
        .split('/')
        .map((v) => Number(v));
      if (!year || !month || month < 1 || month > 12) {
        errors.push(
          buildError(
            row.rowIndex,
            field,
            `${field}の年月が不正です`,
            templateType,
          ),
        );
      }
    }
  });

  NUMBER_FIELDS.forEach((field) => {
    const value = row.data[field];
    if (!value) return;
    // データは既に正規化済み
    const normalized = Number(value.replace(/,/g, ''));
    if (normalized < 0) {
      errors.push(
        buildError(
          row.rowIndex,
          field,
          `${field}は0以上で入力してください`,
          templateType,
        ),
      );
    }
  });

  const start = row.data['算定対象期間開始年月'];
  const end = row.data['算定対象期間終了年月'];
  if (start && end) {
    // データは既に正規化済み
    const startValue = toYearMonth(start);
    const endValue = toYearMonth(end);
    if (startValue && endValue && startValue > endValue) {
      errors.push(
        buildError(
          row.rowIndex,
          '算定対象期間',
          '算定対象期間の開始が終了より後になっています',
          templateType,
        ),
      );
    }
  }

  return errors;
}

export function validateBusinessRules(
  row: ParsedRow,
  templateType: TemplateType,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 扶養の有無が「無」なのに扶養家族情報が入力されている場合のチェック
  const hasDependentFlag = row.data['扶養の有無'];
  if (hasDependentFlag) {
    const normalizedFlag = hasDependentFlag.trim().toLowerCase();
    const isNoDependent = ['0', 'false', 'no', 'off', '無'].includes(
      normalizedFlag,
    );

    if (isNoDependent) {
      // 扶養家族情報が入力されているかチェック
      const hasDependentInfo = DEPENDENT_BASE_FIELDS.some((field) => {
        const value = row.data[field];
        return value && value.trim().length > 0;
      });

      if (hasDependentInfo) {
        errors.push(
          buildError(
            row.rowIndex,
            '扶養の有無',
            '扶養の有無が「無」の場合、扶養家族情報は入力できません',
            templateType,
          ),
        );
      }
    }
  }

  // 月給/賞与支払額同期用テンプレートの場合、月給支払月・月給支払額・支払基礎日数は同時に存在する必要がある
  if (templateType === 'payroll') {
    const monthlyPayMonth = row.data['月給支払月'];
    const monthlyPayAmount = row.data['月給支払額'];
    const workedDays = row.data['支払基礎日数'];

    // どれか一つでも入力されているかチェック
    const hasAnyMonthlyField = !!(
      monthlyPayMonth?.trim() ||
      monthlyPayAmount?.trim() ||
      workedDays?.trim()
    );

    if (hasAnyMonthlyField) {
      // 一つでも入力されている場合、全て入力されている必要がある
      if (!monthlyPayMonth?.trim()) {
        errors.push(
          buildError(
            row.rowIndex,
            '月給支払月',
            '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります',
            templateType,
          ),
        );
      }
      if (!monthlyPayAmount?.trim()) {
        errors.push(
          buildError(
            row.rowIndex,
            '月給支払額',
            '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります',
            templateType,
          ),
        );
      }
      if (!workedDays?.trim()) {
        errors.push(
          buildError(
            row.rowIndex,
            '支払基礎日数',
            '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります',
            templateType,
          ),
        );
      }
    }

    // 賞与支給日と賞与総支給額は同時に存在する必要がある
    const bonusPaidOn = row.data['賞与支給日'];
    const bonusTotal = row.data['賞与総支給額'];

    // どちらか一つでも入力されているかチェック
    const hasAnyBonusField = !!(bonusPaidOn?.trim() || bonusTotal?.trim());

    if (hasAnyBonusField) {
      // 一つでも入力されている場合、両方入力されている必要がある
      if (!bonusPaidOn?.trim()) {
        errors.push(
          buildError(
            row.rowIndex,
            '賞与支給日',
            '賞与支給日と賞与総支給額は同時に入力する必要があります',
            templateType,
          ),
        );
      }
      if (!bonusTotal?.trim()) {
        errors.push(
          buildError(
            row.rowIndex,
            '賞与総支給額',
            '賞与支給日と賞与総支給額は同時に入力する必要があります',
            templateType,
          ),
        );
      }
    }
  }

  // 現在の休業状態のチェック
  const currentLeaveStatus = row.data['現在の休業状態'];
  const currentLeaveStartDate = row.data['現在の休業開始日'];
  const currentLeaveEndDate = row.data['現在の休業予定終了日'];

  // 現在の休業状態が空文字列または「なし」の場合、日付フィールドは入力不可
  const isLeaveStatusValid = currentLeaveStatus && currentLeaveStatus.trim() !== '' && currentLeaveStatus.trim() !== 'なし';
  
  if (!isLeaveStatusValid) {
    // 休業状態が無効な場合、日付フィールドが入力されているとエラー
    if (currentLeaveStartDate && currentLeaveStartDate.trim() !== '') {
      errors.push(
        buildError(
          row.rowIndex,
          '現在の休業開始日',
          '現在の休業状態が選択されていない、または「なし」の場合は、現在の休業開始日を入力できません',
          templateType,
        ),
      );
    }
    if (currentLeaveEndDate && currentLeaveEndDate.trim() !== '') {
      errors.push(
        buildError(
          row.rowIndex,
          '現在の休業予定終了日',
          '現在の休業状態が選択されていない、または「なし」の場合は、現在の休業予定終了日を入力できません',
          templateType,
        ),
      );
    }
  }

  // 現在の休業開始日と現在の休業予定終了日の関係チェック
  if (currentLeaveStartDate && currentLeaveEndDate) {
    const startDate = new Date(currentLeaveStartDate.replace(/-/g, '/'));
    const endDate = new Date(currentLeaveEndDate.replace(/-/g, '/'));

    // 日付が有効かチェック
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);

      // 終了日が開始日より前の場合はエラー
      if (endDate < startDate) {
        errors.push(
          buildError(
            row.rowIndex,
            '現在の休業予定終了日',
            '現在の休業予定終了日は現在の休業開始日より後の日付である必要があります',
            templateType,
          ),
        );
      }
    }
  }

  return errors;
}

export function validateFileLevelRules(
  rows: ParsedRow[],
  templateType: TemplateType,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (templateType === 'unknown') {
    return errors;
  }

  // 社員番号の重複チェック（複数の扶養家族を追加する場合は同じ社員番号で複数行が許可される）
  // スペースを無視して比較するため、正規化した社員番号をキーとして使用
  const employeeNos = new Map<string, number[]>();
  rows.forEach((row) => {
    const employeeNo = row.data['社員番号'];
    if (!employeeNo) return;

    const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
    if (!employeeNos.has(normalizedEmployeeNo)) {
      employeeNos.set(normalizedEmployeeNo, []);
    }
    employeeNos.get(normalizedEmployeeNo)!.push(row.rowIndex);
  });

  // 同じ社員番号の行がある場合、最初の行に従業員情報（氏名など）が必要かチェック
  employeeNos.forEach((rowIndices, employeeNo) => {
    // 最初の行を取得
    const firstRow = rows.find((r) => r.rowIndex === rowIndices[0]);

    if (firstRow) {
      // 扶養の有無が「無」かどうかをチェック
      const hasDependentFlag = firstRow.data['扶養の有無'];
      let isNoDependent = false;
      if (hasDependentFlag) {
        const normalizedFlag = hasDependentFlag.trim().toLowerCase();
        isNoDependent = ['0', 'false', 'no', 'off', '無'].includes(
          normalizedFlag,
        );
      }

      if (rowIndices.length > 1) {
        // 複数行ある場合、最初の行に従業員情報が必要
        const hasEmployeeInfo =
          firstRow.data['氏名(漢字)'] || firstRow.data['氏名漢字'];
        if (!hasEmployeeInfo) {
          errors.push(
            buildError(
              rowIndices[0],
              '氏名(漢字)',
              `社員番号 ${employeeNo} の最初の行には従業員情報（氏名など）が必要です`,
              templateType,
            ),
          );
        }

        // 同じ社員番号で名前が異なる場合のチェック（先に実行）
        // 名前が異なる行は、扶養家族情報のチェックをスキップする
        const nameMismatchRowIndices = new Set<number>();
        const firstRowName =
          firstRow.data['氏名(漢字)'] || firstRow.data['氏名漢字'] || '';
        if (firstRowName) {
          const normalizedFirstRowName =
            normalizeNameForComparison(firstRowName);
          for (let i = 1; i < rowIndices.length; i++) {
            const row = rows.find((r) => r.rowIndex === rowIndices[i]);
            if (row) {
              const rowName =
                row.data['氏名(漢字)'] || row.data['氏名漢字'] || '';
              if (rowName) {
                const normalizedRowName = normalizeNameForComparison(rowName);
                if (
                  normalizedRowName &&
                  normalizedRowName !== normalizedFirstRowName
                ) {
                  nameMismatchRowIndices.add(rowIndices[i]);
                  errors.push(
                    buildError(
                      rowIndices[i],
                      '氏名(漢字)',
                      `社員番号 ${employeeNo} の${i + 1}行目の氏名（${rowName}）が最初の行の氏名（${firstRowName}）と異なります。同じ社員番号の場合は同じ氏名である必要があります`,
                      templateType,
                    ),
                  );
                }
              }
            }
          }
        }

        // 扶養の有無が「無」の場合、2行目以降に扶養家族情報が入力されていたらエラー
        // ただし、名前が異なる行はスキップ
        if (isNoDependent) {
          for (let i = 1; i < rowIndices.length; i++) {
            if (nameMismatchRowIndices.has(rowIndices[i])) {
              continue;
            }
            const row = rows.find((r) => r.rowIndex === rowIndices[i]);
            if (row) {
              const hasDependentInfo = DEPENDENT_BASE_FIELDS.some((field) => {
                const value = row.data[field];
                return value && value.trim().length > 0;
              });

              if (hasDependentInfo) {
                errors.push(
                  buildError(
                    rowIndices[i],
                    '扶養の有無',
                    `社員番号 ${employeeNo} の扶養の有無が「無」の場合、${i + 1}行目に扶養家族情報は入力できません`,
                    templateType,
                  ),
                );
              }
            }
          }
        } else {
          // 2行目以降は扶養家族情報のみでOK（従業員情報の列は空でも可）
          // ただし、扶養情報が入力されていることを確認
          // 名前が異なる行はスキップ
          for (let i = 1; i < rowIndices.length; i++) {
            if (nameMismatchRowIndices.has(rowIndices[i])) {
              continue;
            }
            const row = rows.find((r) => r.rowIndex === rowIndices[i]);
            if (row) {
              const hasDependentInfo =
                row.data['扶養 続柄'] || row.data['扶養 氏名(漢字)'];
              if (!hasDependentInfo) {
                errors.push(
                  buildError(
                    rowIndices[i],
                    '扶養情報',
                    `社員番号 ${employeeNo} の${i + 1}行目には扶養家族情報が必要です`,
                    templateType,
                  ),
                );
              }
            }
          }
        }
      }
    }
  });

  return errors;
}

export function validateRow(
  row: ParsedRow,
  templateType: TemplateType,
  existingEmployees?: ExistingEmployee[],
  allRows?: ParsedRow[],
): ValidationError[] {
  return [
    ...validateRequiredFields(row, templateType, existingEmployees, allRows),
    ...validateDataFormat(row, templateType),
    ...validateDataRange(row, templateType),
    ...validateBusinessRules(row, templateType),
  ];
}

export function validateAllRows(
  rows: ParsedRow[],
  templateType: TemplateType,
  existingEmployees?: ExistingEmployee[],
): ValidatedRow[] {
  const validatedRows: ValidatedRow[] = rows.map((row) => ({
    parsedRow: row,
    normalized: {},
    errors: validateRow(row, templateType, existingEmployees, rows),
  }));

  const fileLevelErrors = validateFileLevelRules(rows, templateType);
  if (fileLevelErrors.length > 0) {
    // 同じ行番号が複数存在するケース（同一行に複数扶養家族を持つ形式）にも対応できるよう、
    // Map ではなく単純なループで付与する
    fileLevelErrors.forEach((error) => {
      validatedRows
        .filter((validated) => validated.parsedRow.rowIndex === error.rowIndex)
        .forEach((validated) => {
          validated.errors = [...validated.errors, error];
        });
    });
  }

  return validatedRows;
}

export function organizeErrors(
  validationErrors: ValidationError[],
): ValidationError[] {
  return validationErrors
    .slice()
    .sort(
      (a, b) =>
        a.rowIndex - b.rowIndex || a.fieldName.localeCompare(b.fieldName),
    );
}

export function calculateSummary(
  validatedRows: ValidatedRow[],
  differences: unknown[] | null = null,
): Summary {
  const errorRows = validatedRows.filter((row) =>
    row.errors.some((error) => error.severity === 'error'),
  );

  let newCount = 0;
  let updateCount = 0;

  if (differences && Array.isArray(differences)) {
    differences.forEach((diff: unknown) => {
      if (diff && typeof diff === 'object' && 'changes' in diff) {
        const changes = (diff as { changes: ChangeField[] }).changes;
        const isNew =
          changes.length > 0 && changes.every((c) => c.oldValue === null);
        if (isNew) {
          newCount++;
        } else if (changes.length > 0) {
          updateCount++;
        }
      }
    });
  }

  return {
    totalRecords: validatedRows.length,
    errorCount: errorRows.length,
    newCount,
    updateCount,
  };
}

export function parseCSVToResult(csvText: string): CSVParseResult {
  const matrix = parseCSV(csvText);
  if (matrix.length === 0) {
    throw new Error('CSVにデータがありません');
  }
  const rawHeaders = matrix[0];
  const headers = normalizeHeaders(rawHeaders);
  const templateType = detectTemplateType(headers);
  const dataRows = matrix.slice(1);
  const parsedRows = convertToRecordArray(dataRows, headers);
  const validatedRows = validateAllRows(parsedRows, templateType);
  const errors = organizeErrors(validatedRows.flatMap((row) => row.errors));

  return {
    headers,
    rawHeaders,
    rows: dataRows,
    errors,
    templateType,
  };
}

function buildError(
  rowIndex: number,
  fieldName: string,
  message: string,
  templateType: TemplateType,
  severity: 'error' | 'warning' = 'error',
): ValidationError {
  return { rowIndex, fieldName, message, severity, templateType };
}

function toYearMonth(value: string): number | null {
  const [year, month] = value
    .replace(/-/g, '/')
    .split('/')
    .map((v) => Number(v));
  if (!year || !month) return null;
  return year * 100 + month;
}

// 既存扶養家族データの型定義
export interface ExistingDependent {
  id?: string;
  relationship?: string;
  nameKanji?: string;
  nameKana?: string;
  birthDate?: string;
  gender?: string;
  personalNumber?: string;
  basicPensionNumber?: string;
  cohabitationType?: string;
  address?: string;
  occupation?: string;
  annualIncome?: number | null;
  dependentStartDate?: string;
  thirdCategoryFlag?: boolean;
}

// 既存社員データの型定義
export interface ExistingEmployee {
  id?: string;
  employeeNo: string;
  name?: string;
  kana?: string;
  gender?: string;
  birthDate?: string;
  postalCode?: string;
  address?: string;
  currentAddress?: string;
  department?: string;
  workPrefecture?: string;
  personalNumber?: string;
  basicPensionNumber?: string;
  hasDependent?: boolean;
  dependentRelationship?: string;
  dependentNameKanji?: string;
  dependentNameKana?: string;
  dependentBirthDate?: string;
  dependentGender?: string;
  dependentPersonalNumber?: string;
  dependentBasicPensionNumber?: string;
  dependentCohabitationType?: string;
  dependentAddress?: string;
  dependentOccupation?: string;
  dependentAnnualIncome?: number;
  dependentStartDate?: string;
  dependentThirdCategoryFlag?: boolean;
  dependents?: ExistingDependent[]; // 全ての扶養家族情報
  standardMonthly?: number;
  standardBonusAnnualTotal?: number;
  healthInsuredNumber?: string;
  pensionInsuredNumber?: string;
  insuredNumber?: string;
  careSecondInsured?: boolean;
  healthAcquisition?: string;
  pensionAcquisition?: string;
  currentLeaveStatus?: string;
  currentLeaveStartDate?: string;
  currentLeaveEndDate?: string;
  exemption?: boolean;
  [key: string]: unknown; // その他のフィールド
}

// 差分計算結果の型定義
export interface DifferenceCalculationResult {
  isNew: boolean;
  isUpdate: boolean;
  existingEmployee: ExistingEmployee | null;
  errors: ValidationError[];
  changes: ChangeField[];
}

// 新規/更新判定と差分計算
export function calculateDifferences(
  parsedRow: ParsedRow,
  existingEmployees: ExistingEmployee[],
  templateType: TemplateType,
): DifferenceCalculationResult {
  const employeeNo = parsedRow.data['社員番号'] || '';

  // 2行目以降（扶養家族追加行）かどうかを判定
  // 従業員情報（氏名）が空で、扶養家族情報がある場合は扶養家族追加行とみなす
  const hasEmployeeInfo = !!(
    parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字']
  );
  const hasDependentInfo = !!(
    parsedRow.data['扶養 続柄'] ||
    parsedRow.data['扶養 氏名(漢字)'] ||
    parsedRow.data['扶養 氏名(カナ)']
  );
  const isDependentOnlyRow =
    !hasEmployeeInfo && hasDependentInfo && !!employeeNo;

  const errors: ValidationError[] = [];
  let existingEmployee: ExistingEmployee | null = null;
  let isNew = false;
  let isUpdate = false;

  // payrollテンプレートの場合は社員番号の検証のみ行い、差分計算はスキップ
  if (templateType === 'payroll') {
    if (!employeeNo) {
      errors.push({
        rowIndex: parsedRow.rowIndex,
        fieldName: '社員番号',
        message: `社員番号は必須です`,
        severity: 'error',
        templateType,
      });
    } else {
      // 社員番号で既存社員を検索（スペースを無視して比較）
      // 念のため、existingEmployeesのemployeeNoも正規化して比較する
      const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
      const foundByEmployeeNo = existingEmployees.find(
        (emp) =>
          normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
          normalizedEmployeeNo,
      );
      if (!foundByEmployeeNo) {
        errors.push({
          rowIndex: parsedRow.rowIndex,
          fieldName: '社員番号',
          message: `社員番号 ${employeeNo} は登録されていません`,
          severity: 'error',
          templateType,
        });
      } else {
        // 社員番号と氏名の整合性チェック（スペースを無視して比較）
        const csvName =
          parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';
        const existingName = foundByEmployeeNo.name || '';

        if (
          csvName &&
          existingName &&
          normalizeNameForComparison(csvName) !==
            normalizeNameForComparison(existingName)
        ) {
          errors.push({
            rowIndex: parsedRow.rowIndex,
            fieldName: '氏名(漢字)',
            message: `社員番号 ${employeeNo} の既存氏名（${existingName}）と一致しません`,
            severity: 'error',
            templateType,
          });
        } else {
          existingEmployee = foundByEmployeeNo;
          isUpdate = true;
        }
      }
    }

    // 給与データの差分は計算しない（給与データは直接更新される）
    return {
      isNew: false,
      isUpdate,
      existingEmployee,
      errors,
      changes: [],
    };
  }

  // 既存社員データを検索（社員番号で、スペースを無視して比較）
  // 念のため、existingEmployeesのemployeeNoも正規化して比較する
  const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
  const foundByEmployeeNo = existingEmployees.find(
    (emp) =>
      normalizeEmployeeNoForComparison(emp.employeeNo || '') ===
      normalizedEmployeeNo,
  );

  // 判定ロジック
  // 社員番号が存在しない場合はエラー
  if (!employeeNo) {
    errors.push({
      rowIndex: parsedRow.rowIndex,
      fieldName: '社員番号',
      message: `社員番号は必須です`,
      severity: 'error',
      templateType,
    });
    // エラーがある場合は処理を終了
    return {
      isNew: false,
      isUpdate: false,
      existingEmployee: null,
      errors,
      changes: [],
    };
  }

  // 2行目以降（扶養家族追加行）の場合は、従業員情報の差分計算をスキップ
  // ただし、扶養家族情報の差分は計算する
  if (isDependentOnlyRow) {
    // 既存社員が見つかった場合はその情報を使用、見つからなくてもエラーにしない
    // （新規登録の場合、同じCSVファイル内の最初の行で従業員情報が登録される予定）

    // 扶養家族情報の差分を計算
    const changes: ChangeField[] = [];
    const csvData = parsedRow.data;
    const csvDependentNameKanji = csvData['扶養 氏名(漢字)']?.trim() || '';

    // 既存扶養家族と比較して更新/新規を判定
    let existingDependent: ExistingDependent | null = null;
    if (
      foundByEmployeeNo &&
      foundByEmployeeNo.dependents &&
      csvDependentNameKanji
    ) {
      // 扶養 氏名(漢字)で既存扶養家族を検索（スペースを無視して比較）
      const normalizedCsvName = normalizeNameForComparison(
        csvDependentNameKanji,
      );
      existingDependent =
        foundByEmployeeNo.dependents.find((dep) => {
          if (!dep.nameKanji) return false;
          const normalizedExistingName = normalizeNameForComparison(
            dep.nameKanji,
          );
          return normalizedExistingName === normalizedCsvName;
        }) || null;
    }

    // 扶養家族情報のフィールドをチェック
    const dependentFields = [
      '扶養 続柄',
      '扶養 氏名(漢字)',
      '扶養 氏名(カナ)',
      '扶養 生年月日',
      '扶養 性別',
      '扶養 個人番号',
      '扶養 基礎年金番号',
      '扶養 同居区分',
      '扶養 住所（別居の場合のみ入力）',
      '扶養 職業',
      '扶養 年収（見込みでも可）',
      '扶養 被扶養者になった日',
      '扶養 国民年金第3号被保険者該当フラグ',
    ];

    // フィールド名と既存データのマッピング
    const fieldMapping: Record<string, keyof ExistingDependent> = {
      '扶養 続柄': 'relationship',
      '扶養 氏名(漢字)': 'nameKanji',
      '扶養 氏名(カナ)': 'nameKana',
      '扶養 生年月日': 'birthDate',
      '扶養 性別': 'gender',
      '扶養 個人番号': 'personalNumber',
      '扶養 基礎年金番号': 'basicPensionNumber',
      '扶養 同居区分': 'cohabitationType',
      '扶養 住所（別居の場合のみ入力）': 'address',
      '扶養 職業': 'occupation',
      '扶養 年収（見込みでも可）': 'annualIncome',
      '扶養 被扶養者になった日': 'dependentStartDate',
      '扶養 国民年金第3号被保険者該当フラグ': 'thirdCategoryFlag',
    };

    dependentFields.forEach((csvField) => {
      const csvValue = csvData[csvField];
      if (!csvValue || csvValue.trim() === '') return;

      const dbField = fieldMapping[csvField];
      const existingValue = existingDependent?.[dbField];

      // 日付フィールドの正規化関数（YYYY/MM/DD形式に統一）
      const normalizeDate = (dateStr: string | undefined): string => {
        if (!dateStr) return '';
        return dateStr.replace(/-/g, '/');
      };

      // フラグ値を0/1に正規化して比較しやすくする
      const normalizeFlagValue = (value: unknown): string => {
        if (value === undefined || value === null) return '';
        const normalized = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on', '有'].includes(normalized)) return '1';
        if (['0', 'false', 'no', 'off', '無'].includes(normalized)) return '0';
        return normalized;
      };

      // 日付フィールドの比較
      const dateFields = ['扶養 生年月日', '扶養 被扶養者になった日'];
      if (dateFields.includes(csvField)) {
        const normalizedCsvValue = normalizeDate(csvValue.trim());
        const normalizedExistingValue = normalizeDate(
          existingValue ? String(existingValue) : undefined,
        );

        if (normalizedCsvValue !== normalizedExistingValue) {
          changes.push({
            fieldName: csvField,
            oldValue: normalizedExistingValue || null,
            newValue: normalizedCsvValue || null,
          });
        }
      } else if (csvField === '扶養 国民年金第3号被保険者該当フラグ') {
        // フラグフィールドの比較
        const normalizedCsvFlag = normalizeFlagValue(csvValue);
        const normalizedExistingFlag = normalizeFlagValue(existingValue);

        if (normalizedCsvFlag !== normalizedExistingFlag) {
          changes.push({
            fieldName: csvField,
            oldValue: normalizedExistingFlag || null,
            newValue: normalizedCsvFlag || null,
          });
        }
      } else if (csvField === '扶養 年収（見込みでも可）') {
        // 数値フィールドの比較
        const csvNum = Number(csvValue.replace(/,/g, ''));
        const existingNum =
          typeof existingValue === 'number'
            ? existingValue
            : existingValue
              ? Number(String(existingValue).replace(/,/g, ''))
              : undefined;

        if (isNaN(csvNum)) return;

        if (existingNum === undefined || existingNum !== csvNum) {
          changes.push({
            fieldName: csvField,
            oldValue: existingNum !== undefined ? String(existingNum) : null,
            newValue: String(csvNum),
          });
        }
      } else {
        // 文字列フィールドの比較
        const oldValue = existingValue ? String(existingValue) : '';
        const newValue = csvValue.trim();

        if (oldValue !== newValue) {
          changes.push({
            fieldName: csvField,
            oldValue: oldValue || null,
            newValue: newValue || null,
          });
        }
      }
    });

    return {
      isNew: false,
      isUpdate: false, // 従業員情報は更新しない
      existingEmployee: foundByEmployeeNo || null,
      errors: [],
      changes: changes, // 扶養家族情報の変更を返す
    };
  }

  // 社員番号で既存社員を検索
  if (foundByEmployeeNo) {
    // 社員番号が一致する場合 → 更新
    // 社員番号と氏名の整合性チェック（スペースを無視して比較）
    const csvName =
      parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';
    const existingName = foundByEmployeeNo.name || '';

    if (
      csvName &&
      existingName &&
      normalizeNameForComparison(csvName) !==
        normalizeNameForComparison(existingName)
    ) {
      errors.push({
        rowIndex: parsedRow.rowIndex,
        fieldName: '氏名(漢字)',
        message: `社員番号 ${employeeNo} の既存氏名（${existingName}）と一致しません`,
        severity: 'error',
        templateType,
      });
      // エラーがある場合は処理を終了
      return {
        isNew: false,
        isUpdate: false,
        existingEmployee: null,
        errors,
        changes: [],
      };
    } else {
      existingEmployee = foundByEmployeeNo;
      isUpdate = true;
    }
  } else {
    // 存在しない場合 → 新規
    isNew = true;
  }

  // 差分計算（更新の場合のみ）
  const changes: ChangeField[] = [];
  if (isUpdate && existingEmployee) {
    // CSVの各フィールドと既存データを比較
    const csvData = parsedRow.data;
    const fieldMapping: Record<string, string> = {
      '氏名(漢字)': 'name',
      氏名漢字: 'name',
      '氏名(カナ)': 'kana',
      性別: 'gender',
      生年月日: 'birthDate',
      郵便番号: 'postalCode',
      住民票住所: 'address',
      現住所: 'currentAddress',
      所属部署名: 'department',
      勤務地都道府県名: 'workPrefecture',
      個人番号: 'personalNumber',
      基礎年金番号: 'basicPensionNumber',
      扶養の有無: 'hasDependent',
      '扶養 続柄': 'dependentRelationship',
      '扶養 氏名(漢字)': 'dependentNameKanji',
      '扶養 氏名(カナ)': 'dependentNameKana',
      '扶養 生年月日': 'dependentBirthDate',
      '扶養 性別': 'dependentGender',
      '扶養 個人番号': 'dependentPersonalNumber',
      '扶養 基礎年金番号': 'dependentBasicPensionNumber',
      '扶養 同居区分': 'dependentCohabitationType',
      '扶養 住所（別居の場合のみ入力）': 'dependentAddress',
      '扶養 職業': 'dependentOccupation',
      '扶養 年収（見込みでも可）': 'dependentAnnualIncome',
      '扶養 被扶養者になった日': 'dependentStartDate',
      '扶養 国民年金第3号被保険者該当フラグ': 'dependentThirdCategoryFlag',
      健保標準報酬月額: 'healthStandardMonthly',
      厚年標準報酬月額: 'welfareStandardMonthly',
      '被保険者番号（健康保険)': 'healthInsuredNumber',
      '被保険者番号（厚生年金）': 'pensionInsuredNumber',
      健康保険資格取得日: 'healthAcquisition',
      '健康保険 資格取得日': 'healthAcquisition',
      厚生年金資格取得日: 'pensionAcquisition',
      '厚生年金 資格取得日': 'pensionAcquisition',
      '介護保険第2号被保険者フラグ': 'careSecondInsured',
      介護保険第2号フラグ: 'careSecondInsured',
      '現在の休業状態': 'currentLeaveStatus',
      '現在の休業開始日': 'currentLeaveStartDate',
      '現在の休業予定終了日': 'currentLeaveEndDate',
    };

    // 扶養家族情報の処理：扶養 氏名(漢字)で既存扶養家族を検索
    const csvDependentNameKanji = csvData['扶養 氏名(漢字)']?.trim() || '';
    let existingDependent: ExistingDependent | null = null;
    if (csvDependentNameKanji && existingEmployee?.dependents) {
      const normalizedCsvName = normalizeNameForComparison(
        csvDependentNameKanji,
      );
      existingDependent =
        existingEmployee.dependents.find((dep) => {
          if (!dep.nameKanji) return false;
          const normalizedExistingName = normalizeNameForComparison(
            dep.nameKanji,
          );
          return normalizedExistingName === normalizedCsvName;
        }) || null;
    }

    Object.keys(fieldMapping).forEach((csvField) => {
      const csvValue = csvData[csvField];
      // CSVに値が存在しない場合はスキップ
      if (csvValue === undefined || csvValue === '') return;

      // 扶養家族関連フィールドの場合は既存扶養家族と比較
      const dependentFields = [
        '扶養 続柄',
        '扶養 氏名(漢字)',
        '扶養 氏名(カナ)',
        '扶養 生年月日',
        '扶養 性別',
        '扶養 個人番号',
        '扶養 基礎年金番号',
        '扶養 同居区分',
        '扶養 住所（別居の場合のみ入力）',
        '扶養 職業',
        '扶養 年収（見込みでも可）',
        '扶養 被扶養者になった日',
        '扶養 国民年金第3号被保険者該当フラグ',
      ];

      if (dependentFields.includes(csvField)) {
        // 扶養家族情報のフィールドマッピング
        const dependentFieldMapping: Record<string, keyof ExistingDependent> = {
          '扶養 続柄': 'relationship',
          '扶養 氏名(漢字)': 'nameKanji',
          '扶養 氏名(カナ)': 'nameKana',
          '扶養 生年月日': 'birthDate',
          '扶養 性別': 'gender',
          '扶養 個人番号': 'personalNumber',
          '扶養 基礎年金番号': 'basicPensionNumber',
          '扶養 同居区分': 'cohabitationType',
          '扶養 住所（別居の場合のみ入力）': 'address',
          '扶養 職業': 'occupation',
          '扶養 年収（見込みでも可）': 'annualIncome',
          '扶養 被扶養者になった日': 'dependentStartDate',
          '扶養 国民年金第3号被保険者該当フラグ': 'thirdCategoryFlag',
        };

        const dbField = dependentFieldMapping[csvField];
        const existingValue = existingDependent?.[dbField];

        // 日付フィールドの正規化関数（YYYY/MM/DD形式に統一）
        const normalizeDate = (dateStr: string | undefined): string => {
          if (!dateStr) return '';
          return dateStr.replace(/-/g, '/');
        };

        // フラグ値を0/1に正規化して比較しやすくする
        const normalizeFlagValue = (value: unknown): string => {
          if (value === undefined || value === null) return '';
          const normalized = String(value).trim().toLowerCase();
          if (['1', 'true', 'yes', 'on', '有'].includes(normalized)) return '1';
          if (['0', 'false', 'no', 'off', '無'].includes(normalized))
            return '0';
          return normalized;
        };

        // 日付フィールドの比較
        const dateFields = ['扶養 生年月日', '扶養 被扶養者になった日'];
        if (dateFields.includes(csvField)) {
          const normalizedCsvValue = normalizeDate(csvValue.trim());
          const normalizedExistingValue = normalizeDate(
            existingValue ? String(existingValue) : undefined,
          );

          if (normalizedCsvValue !== normalizedExistingValue) {
            changes.push({
              fieldName: csvField,
              oldValue: normalizedExistingValue || null,
              newValue: normalizedCsvValue || null,
            });
          }
        } else if (csvField === '扶養 国民年金第3号被保険者該当フラグ') {
          // フラグフィールドの比較
          const normalizedCsvFlag = normalizeFlagValue(csvValue);
          const normalizedExistingFlag = normalizeFlagValue(existingValue);

          if (normalizedCsvFlag !== normalizedExistingFlag) {
            changes.push({
              fieldName: csvField,
              oldValue: normalizedExistingFlag || null,
              newValue: normalizedCsvFlag || null,
            });
          }
        } else if (csvField === '扶養 年収（見込みでも可）') {
          // 数値フィールドの比較
          const csvNum = Number(csvValue.replace(/,/g, ''));
          const existingNum =
            typeof existingValue === 'number'
              ? existingValue
              : existingValue
                ? Number(String(existingValue).replace(/,/g, ''))
                : undefined;

          if (isNaN(csvNum)) return;

          if (existingNum === undefined || existingNum !== csvNum) {
            changes.push({
              fieldName: csvField,
              oldValue: existingNum !== undefined ? String(existingNum) : null,
              newValue: String(csvNum),
            });
          }
        } else {
          // 文字列フィールドの比較
          const oldValue = existingValue ? String(existingValue) : '';
          const newValue = csvValue.trim();

          if (oldValue !== newValue) {
            changes.push({
              fieldName: csvField,
              oldValue: oldValue || null,
              newValue: newValue || null,
            });
          }
        }
        return; // 扶養家族フィールドの処理が完了したので次へ
      }

      // 従業員情報フィールドの処理
      const dbField = fieldMapping[csvField];
      const existingValue = existingEmployee?.[dbField];

      // 日付フィールドのリスト
      const dateFields = [
        '生年月日',
        '健康保険資格取得日',
        '健康保険 資格取得日',
        '厚生年金資格取得日',
        '厚生年金 資格取得日',
        '現在の休業開始日',
        '現在の休業予定終了日',
      ];

      // 日付フィールドの正規化関数（YYYY/MM/DD形式に統一）
      const normalizeDate = (dateStr: string | undefined): string => {
        if (!dateStr) return '';
        // YYYY-MM-DD形式をYYYY/MM/DD形式に変換
        return dateStr.replace(/-/g, '/');
      };

      // フラグ値を0/1に正規化して比較しやすくする
      const normalizeFlagValue = (value: unknown): string => {
        if (value === undefined || value === null) return '';
        const normalized = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on', '有'].includes(normalized)) return '1';
        if (['0', 'false', 'no', 'off', '無'].includes(normalized)) return '0';
        return normalized;
      };

      // フラグフィールドのリスト
      const flagFields = [
        '扶養の有無',
        '介護保険第2号被保険者フラグ',
        '介護保険第2号フラグ',
      ];

      // 数値フィールドの比較
      if (
        ['健保標準報酬月額', '厚年標準報酬月額', '標準報酬月額'].includes(
          csvField,
        )
      ) {
        const csvNum = Number(csvValue.replace(/,/g, ''));
        const existingNum =
          typeof existingValue === 'number'
            ? existingValue
            : existingValue
              ? Number(String(existingValue).replace(/,/g, ''))
              : undefined;

        if (isNaN(csvNum)) return; // CSVの値が数値でない場合はスキップ

        // 既存値がない、または値が異なる場合のみ差分として追加
        if (existingNum === undefined || existingNum !== csvNum) {
          changes.push({
            fieldName: csvField,
            oldValue: existingNum !== undefined ? String(existingNum) : null,
            newValue: String(csvNum),
          });
        }
      } else if (dateFields.includes(csvField)) {
        // 日付フィールドの比較（正規化して比較）
        const normalizedCsvValue = normalizeDate(csvValue);
        const normalizedExistingValue = normalizeDate(
          existingValue ? String(existingValue) : undefined,
        );

        if (normalizedCsvValue !== normalizedExistingValue) {
          changes.push({
            fieldName: csvField,
            oldValue: normalizedExistingValue || null,
            newValue: normalizedCsvValue || null,
          });
        }
      } else if (flagFields.includes(csvField)) {
        // フラグフィールドの比較（正規化して比較）
        const normalizedCsvFlag = normalizeFlagValue(csvValue);
        const normalizedExistingFlag = normalizeFlagValue(existingValue);

        if (normalizedCsvFlag !== normalizedExistingFlag) {
          changes.push({
            fieldName: csvField,
            oldValue: normalizedExistingFlag || null,
            newValue: normalizedCsvFlag || null,
          });
        }
      } else {
        // 文字列フィールドの比較
        const oldValue = existingValue ? String(existingValue) : '';
        const newValue = csvValue || '';

        // 値が異なる場合のみ差分として追加
        if (oldValue !== newValue) {
          changes.push({
            fieldName: csvField,
            oldValue: oldValue || null,
            newValue: newValue || null,
          });
        }
      }
    });
  } else if (isNew) {
    // 新規の場合、すべてのフィールドを新規値として追加
    const csvData = parsedRow.data;
    Object.keys(csvData).forEach((field) => {
      const value = csvData[field];
      if (value) {
        changes.push({
          fieldName: field,
          oldValue: null,
          newValue: value,
        });
      }
    });
  }

  return {
    isNew,
    isUpdate,
    existingEmployee,
    errors,
    changes,
  };
}
