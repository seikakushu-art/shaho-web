import {
    CSVParseResult,
    ParsedRow,
    Summary,
    TemplateType,
    ValidationError,
    ValidatedRow,
  } from './csv-import.types';
  
  const DATE_FIELDS = ['入社日', '生年月日', '賞与支給日'];
  const YEAR_MONTH_FIELDS = ['算定対象期間開始年月', '算定対象期間終了年月', '算定年度', '賞与支給年度'];
  const NUMBER_FIELDS = [
    '現在標準報酬月額',
    '標準報酬月額',
    '4月報酬額',
    '5月報酬額',
    '6月報酬額',
    '賞与総支給額',
    '4月支払基礎日数',
    '5月支払基礎日数',
    '6月支払基礎日数',
  ];
  const INSURANCE_NUMBER_FIELDS = ['被保険者番号'];
  const FLAG_FIELDS = ['介護保険第2号フラグ', '一時免除フラグ（健康保険料・厚生年金一時免除）'];
  
  const REQUIRED_FIELDS: Record<TemplateType, string[]> = {
    new: [
      '社員番号',
      '氏名(漢字)',
      '氏名(カナ)',
      '性別',
      '生年月日',
      '所属部署名',
      '勤務地都道府県名',
      '現在標準報酬月額',
      '被保険者番号',
      '健康保険資格取得日',
      '厚生年金資格取得日',
    ],
    salary: ['社員番号', '氏名漢字', '算定年度', '算定対象期間開始年月', '算定対象期間終了年月'],
    bonus: ['社員番号', '賞与支給日', '賞与総支給額'],
    unknown: [],
  };
  
  const GENDER_VALUES = ['男', '女', '男性', '女性', 'male', 'female'];
  const FLAG_VALUES = ['0', '1', 'on', 'off', 'true', 'false', 'yes', 'no'];
  
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
    return value
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
      .replace(/／/g, '/');
  }
  
  export function detectTemplateType(headers: string[]): TemplateType {
    const normalizedHeaders = headers.map((h) => h.toLowerCase());
    const headerSet = new Set(normalizedHeaders);

    if (headerSet.has('賞与支給日') || headerSet.has('賞与総支給額')) {
      return 'bonus';
    }

    if (headerSet.has('算定年度') || headerSet.has('4月報酬額') || headers.length === 24) {
      return 'salary';
    }

    // 新規登録/一括更新用テンプレートの判定
    // 11項目（社員番号、氏名(漢字)、氏名(カナ)、性別、生年月日、所属部署名、勤務地都道府県名、現在標準報酬月額、被保険者番号、健康保険資格取得日、厚生年金資格取得日）
    // または、旧形式の15項目以上
    if (
      headers.length === 11 ||
      (headers.length >= 15 && (headerSet.has('氏名(漢字)') || headerSet.has('氏名漢字')))
    ) {
      return 'new';
    }

    return 'unknown';
  }
  
  export function convertToRecordArray(rows: string[][], headers: string[], rowOffset: number = 1): ParsedRow[] {
    return rows.map((row, index) => {
      const record: Record<string, string> = {};
      headers.forEach((header, headerIndex) => {
        const rawValue = (row[headerIndex] ?? '').trim();
        // 全角英数、カッコ、／を半角に変換してから格納
        record[header] = normalizeFullWidthCharacters(rawValue);
      });
      return { data: record, rowIndex: index + rowOffset };
    });
  }
  
  export function validateRequiredFields(row: ParsedRow, templateType: TemplateType): ValidationError[] {
    const requiredFields = REQUIRED_FIELDS[templateType];
    return requiredFields
      .filter((field) => !row.data[field] || row.data[field].trim().length === 0)
      .map((fieldName) => buildError(row.rowIndex, fieldName, `${fieldName}は必須です`, templateType));
  }
  
  export function validateDataFormat(row: ParsedRow, templateType: TemplateType): ValidationError[] {
    const errors: ValidationError[] = [];
  
    DATE_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      if (!/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)) {
        errors.push(buildError(row.rowIndex, field, `${field}はYYYY/MM/DD形式で入力してください`, templateType));
      }
    });
  
    YEAR_MONTH_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      // 算定年度と賞与支給年度はYYYY形式（4桁の年のみ）
      if (field === '算定年度' || field === '賞与支給年度') {
        if (!/^\d{4}$/.test(value)) {
          errors.push(buildError(row.rowIndex, field, `${field}はYYYY形式で入力してください`, templateType));
        }
      } else {
        // その他はYYYY/MM形式
        if (!/^\d{4}[/-]\d{1,2}$/.test(value)) {
          errors.push(buildError(row.rowIndex, field, `${field}はYYYY/MM形式で入力してください`, templateType));
        }
      }
    });
  
    NUMBER_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      const normalized = value.replace(/,/g, '');
      if (Number.isNaN(Number(normalized))) {
        errors.push(buildError(row.rowIndex, field, `${field}は数値で入力してください`, templateType));
      }
    });

    // 被保険者番号の検証（数字のみ、またはハイフンを含む形式）
    INSURANCE_NUMBER_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      // 数字のみ、またはハイフンを含む形式（例：12345678 または 12345678-9）
      if (!/^\d+(-\d+)?$/.test(value)) {
        errors.push(buildError(row.rowIndex, field, `${field}は数字のみで入力してください（ハイフンを含む場合は末尾のみ）`, templateType));
      }
    });

    const gender = row.data['性別'];
    if (gender && !GENDER_VALUES.includes(gender.toLowerCase())) {
      errors.push(buildError(row.rowIndex, '性別', '性別の値が不正です', templateType));
    }
  
    FLAG_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      if (!FLAG_VALUES.includes(value.toLowerCase())) {
        errors.push(buildError(row.rowIndex, field, `${field}は0/1/true/falseで入力してください`, templateType, 'warning'));
      }
    });
  
    return errors;
  }
  
  export function validateDataRange(row: ParsedRow, templateType: TemplateType): ValidationError[] {
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
        errors.push(buildError(row.rowIndex, field, `${field}の日付が不正です`, templateType));
        return;
      }

      // 生年月日の場合は年分の制限をチェック
      if (field === '生年月日') {
        date.setHours(0, 0, 0, 0);
        if (date > today) {
          errors.push(buildError(row.rowIndex, field, `${field}は未来の日付は入力できません`, templateType));
        }
        if (date < hundredYearsAgo) {
          errors.push(buildError(row.rowIndex, field, `${field}は100年前より前の日付は入力できません`, templateType));
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
          errors.push(buildError(row.rowIndex, field, `${field}の年が不正です`, templateType));
        }
      } else {
        // その他はYYYY/MM形式
        const [year, month] = value.replace(/-/g, '/').split('/').map((v) => Number(v));
        if (!year || !month || month < 1 || month > 12) {
          errors.push(buildError(row.rowIndex, field, `${field}の年月が不正です`, templateType));
        }
      }
    });
  
    NUMBER_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      const normalized = Number(value.replace(/,/g, ''));
      if (normalized < 0) {
        errors.push(buildError(row.rowIndex, field, `${field}は0以上で入力してください`, templateType));
      }
    });
  
    const start = row.data['算定対象期間開始年月'];
    const end = row.data['算定対象期間終了年月'];
    if (start && end) {
      // データは既に正規化済み
      const startValue = toYearMonth(start);
      const endValue = toYearMonth(end);
      if (startValue && endValue && startValue > endValue) {
        errors.push(buildError(row.rowIndex, '算定対象期間', '算定対象期間の開始が終了より後になっています', templateType));
      }
    }
  
    return errors;
  }
  
  export function validateBusinessRules(row: ParsedRow, templateType: TemplateType): ValidationError[] {
    const errors: ValidationError[] = [];
  
    const birthDate = row.data['生年月日'];
    const hireDate = row.data['入社日'];
    if (birthDate && hireDate) {
      // データは既に正規化済み
      const birth = new Date(birthDate.replace(/-/g, '/'));
      const hire = new Date(hireDate.replace(/-/g, '/'));
      if (!Number.isNaN(birth.getTime()) && !Number.isNaN(hire.getTime()) && hire < birth) {
        errors.push(buildError(row.rowIndex, '入社日', '入社日が生年月日より前です', templateType, 'warning'));
      }
    }
  
    if (templateType === 'salary') {
      // データは既に正規化済み
      const salaryValue = row.data['現在標準報酬月額'];
      const aprilValue = row.data['4月報酬額'];
      const salary = salaryValue ? Number(salaryValue.replace(/,/g, '')) : NaN;
      const april = aprilValue ? Number(aprilValue.replace(/,/g, '')) : NaN;
      if (!Number.isNaN(salary) && !Number.isNaN(april) && april > salary * 2) {
        errors.push(buildError(row.rowIndex, '4月報酬額', '報酬額が標準報酬月額と大きく乖離しています', templateType, 'warning'));
      }
    }
  
    return errors;
  }
  
  export function validateFileLevelRules(rows: ParsedRow[], templateType: TemplateType): ValidationError[] {
    const errors: ValidationError[] = [];
    if (templateType === 'unknown') {
      return errors;
    }

    // 社員番号の重複チェック
    const employeeNos = new Map<string, number>();
    rows.forEach((row) => {
      const employeeNo = row.data['社員番号'];
      if (!employeeNo) return;
      if (employeeNos.has(employeeNo)) {
        errors.push(
          buildError(row.rowIndex, '社員番号', `社員番号 ${employeeNo} が重複しています`, templateType),
        );
      } else {
        employeeNos.set(employeeNo, row.rowIndex);
      }
    });

    // 被保険者番号の重複チェック
    const insuranceNos = new Map<string, number>();
    rows.forEach((row) => {
      const insuranceNo = row.data['被保険者番号'];
      if (!insuranceNo) return;
      if (insuranceNos.has(insuranceNo)) {
        errors.push(
          buildError(row.rowIndex, '被保険者番号', `被保険者番号 ${insuranceNo} が重複しています`, templateType),
        );
      } else {
        insuranceNos.set(insuranceNo, row.rowIndex);
      }
    });

    return errors;
  }
  
  export function validateRow(row: ParsedRow, templateType: TemplateType): ValidationError[] {
    return [
      ...validateRequiredFields(row, templateType),
      ...validateDataFormat(row, templateType),
      ...validateDataRange(row, templateType),
      ...validateBusinessRules(row, templateType),
    ];
  }
  
  export function validateAllRows(rows: ParsedRow[], templateType: TemplateType): ValidatedRow[] {
    const validatedRows: ValidatedRow[] = rows.map((row) => ({
      parsedRow: row,
      normalized: {},
      errors: validateRow(row, templateType),
    }));
  
    const fileLevelErrors = validateFileLevelRules(rows, templateType);
    if (fileLevelErrors.length > 0) {
      const errorMap = new Map<number, ValidationError[]>();
      validatedRows.forEach((validated) => {
        errorMap.set(validated.parsedRow.rowIndex, validated.errors);
      });
      fileLevelErrors.forEach((error) => {
        const existing = errorMap.get(error.rowIndex) ?? [];
        existing.push(error);
        errorMap.set(error.rowIndex, existing);
      });
      validatedRows.forEach((validated) => {
        validated.errors = errorMap.get(validated.parsedRow.rowIndex) ?? validated.errors;
      });
    }
  
    return validatedRows;
  }
  
  export function organizeErrors(validationErrors: ValidationError[]): ValidationError[] {
    return validationErrors
      .slice()
      .sort((a, b) => a.rowIndex - b.rowIndex || a.fieldName.localeCompare(b.fieldName));
  }
  
  export function calculateSummary(validatedRows: ValidatedRow[], differences: null | unknown = null): Summary {
    const errorRows = validatedRows.filter((row) => row.errors.some((error) => error.severity === 'error'));
  
    return {
      totalRecords: validatedRows.length,
      errorCount: errorRows.length,
      newCount: differences ? 0 : 0,
      updateCount: differences ? 0 : 0,
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
    const [year, month] = value.replace(/-/g, '/').split('/').map((v) => Number(v));
    if (!year || !month) return null;
    return year * 100 + month;
  }