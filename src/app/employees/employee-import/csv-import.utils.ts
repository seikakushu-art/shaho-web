import {
    ChangeField,
    CSVParseResult,
    ParsedRow,
    Summary,
    TemplateType,
    ValidationError,
    ValidatedRow,
  } from './csv-import.types';
  
  const DATE_FIELDS = ['入社日', '生年月日', '賞与支給日', '扶養 生年月日', '扶養 被扶養者になった日'];
  const YEAR_MONTH_FIELDS = ['算定対象期間開始年月', '算定対象期間終了年月', '算定年度', '賞与支給年度', '月給支払月'];
  const NUMBER_FIELDS = [
    '標準報酬月額',
    '4月報酬額',
    '5月報酬額',
    '6月報酬額',
    '賞与総支給額',
    '月給支払額',
    '支払基礎日数',
    '4月支払基礎日数',
    '5月支払基礎日数',
    '6月支払基礎日数',
    '扶養 年収（見込みでも可）',
  ];
  const POSTAL_CODE_FIELDS = ['郵便番号'];
  const ADDRESS_FIELDS = ['住所', '扶養 住所（別居の場合のみ入力）'];
  const FLAG_FIELDS = ['介護保険第2号フラグ', '一時免除フラグ（健康保険料・厚生年金一時免除）', '扶養の有無', '扶養 国民年金第3号被保険者該当フラグ'];
  
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
  const FLAG_VALUES = ['0', '1', 'on', 'off', 'true', 'false', 'yes', 'no', '有', '無'];
  
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

    // 月給/賞与支払額同期用テンプレートの判定（月給支払月と月給支払額を含む場合）
    if (headerSet.has('月給支払月') && headerSet.has('月給支払額')) {
      return 'payroll';
    }

    // 新規登録/一括更新用テンプレートの判定
    // 11項目（旧形式）、24項目以上（新形式拡張）、または15項目以上で氏名(漢字)を含む場合
    if (
      headers.length === 11 ||
      headers.length >= 24 ||
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
  
  export function validateRequiredFields(
    row: ParsedRow,
    templateType: TemplateType,
    existingEmployees?: ExistingEmployee[],
  ): ValidationError[] {
    let requiredFields = REQUIRED_FIELDS[templateType];
    
    // 新規登録/一括更新用テンプレートの場合、既存社員の有無で必須項目を変更
    if (templateType === 'new' && existingEmployees) {
      const employeeNo = row.data['社員番号'] || '';
      const existingEmployee = existingEmployees.find((emp) => emp.employeeNo === employeeNo);
      
      if (existingEmployee) {
        // 既存社員が見つかった場合 → 一括更新モード
        // 必須項目は「社員番号」と「氏名(漢字)」のみ
        requiredFields = ['社員番号', '氏名(漢字)'];
      }
      // 既存社員が見つからない場合 → 新規登録モード（現在の必須項目のまま）
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
        '健康保険資格取得日': ['健康保険資格取得日', '健康保険 資格取得日'],
        '厚生年金資格取得日': ['厚生年金資格取得日', '厚生年金 資格取得日'],
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
        errors.push(buildError(row.rowIndex, field, `${field}は必須です`, templateType));
      }
    });
    
    return errors;
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

    // 郵便番号の検証（7桁の数字、ハイフンは任意）
    POSTAL_CODE_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      // 7桁の数字（ハイフンは任意）：123-4567 または 1234567
      // ハイフンがある場合は3桁-4桁の形式のみ許可
      const normalized = value.replace(/-/g, '');
      if (!/^\d{7}$/.test(normalized)) {
        errors.push(buildError(row.rowIndex, field, `${field}は7桁の数字で入力してください（例：123-4567 または 1234567）`, templateType));
      } else if (value.includes('-') && !/^\d{3}-\d{4}$/.test(value)) {
        // ハイフンがある場合は3桁-4桁の形式のみ許可
        errors.push(buildError(row.rowIndex, field, `${field}は123-4567形式で入力してください`, templateType));
      }
    });

    // 住所の検証（最大80文字）
    ADDRESS_FIELDS.forEach((field) => {
      const value = row.data[field];
      if (!value) return;
      // データは既に正規化済み
      // 最大80文字まで許可
      if (value.length > 80) {
        errors.push(buildError(row.rowIndex, field, `${field}は最大80文字まで入力できます（現在${value.length}文字）`, templateType));
      }
    });

    const gender = row.data['性別'];
    if (gender && !GENDER_VALUES.includes(gender.toLowerCase())) {
      errors.push(buildError(row.rowIndex, '性別', '性別の値が不正です', templateType));
    }
  const dependentGender = row.data['扶養 性別'];
  if (dependentGender && !GENDER_VALUES.includes(dependentGender.toLowerCase())) {
    errors.push(buildError(row.rowIndex, '扶養 性別', '扶養 性別の値が不正です', templateType));
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
      if (field === '生年月日' || field === '扶養 生年月日') {
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

    // 月給/賞与支払額同期用テンプレートの場合、月給支払月・月給支払額・支払基礎日数は同時に存在する必要がある
    if (templateType === 'payroll') {
      const monthlyPayMonth = row.data['月給支払月'];
      const monthlyPayAmount = row.data['月給支払額'];
      const workedDays = row.data['支払基礎日数'];
      
      // どれか一つでも入力されているかチェック
      const hasAnyMonthlyField = !!(monthlyPayMonth?.trim() || monthlyPayAmount?.trim() || workedDays?.trim());
      
      if (hasAnyMonthlyField) {
        // 一つでも入力されている場合、全て入力されている必要がある
        if (!monthlyPayMonth?.trim()) {
          errors.push(buildError(row.rowIndex, '月給支払月', '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります', templateType));
        }
        if (!monthlyPayAmount?.trim()) {
          errors.push(buildError(row.rowIndex, '月給支払額', '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります', templateType));
        }
        if (!workedDays?.trim()) {
          errors.push(buildError(row.rowIndex, '支払基礎日数', '月給支払月、月給支払額、支払基礎日数は同時に入力する必要があります', templateType));
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
          errors.push(buildError(row.rowIndex, '賞与支給日', '賞与支給日と賞与総支給額は同時に入力する必要があります', templateType));
        }
        if (!bonusTotal?.trim()) {
          errors.push(buildError(row.rowIndex, '賞与総支給額', '賞与支給日と賞与総支給額は同時に入力する必要があります', templateType));
        }
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

    return errors;
  }
  
  export function validateRow(
    row: ParsedRow,
    templateType: TemplateType,
    existingEmployees?: ExistingEmployee[],
  ): ValidationError[] {
    return [
      ...validateRequiredFields(row, templateType, existingEmployees),
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
      errors: validateRow(row, templateType, existingEmployees),
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
  
  export function calculateSummary(validatedRows: ValidatedRow[], differences: unknown[] | null = null): Summary {
    const errorRows = validatedRows.filter((row) => row.errors.some((error) => error.severity === 'error'));
  
    let newCount = 0;
    let updateCount = 0;

    if (differences && Array.isArray(differences)) {
      differences.forEach((diff: unknown) => {
        if (diff && typeof diff === 'object' && 'changes' in diff) {
          const changes = (diff as { changes: ChangeField[] }).changes;
          const isNew = changes.length > 0 && changes.every((c) => c.oldValue === null);
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
    const [year, month] = value.replace(/-/g, '/').split('/').map((v) => Number(v));
    if (!year || !month) return null;
    return year * 100 + month;
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
    standardMonthly?: number;
    standardBonusAnnualTotal?: number;
    healthInsuredNumber?: string;
    pensionInsuredNumber?: string;
    insuredNumber?: string;
    careSecondInsured?: boolean;
    healthAcquisition?: string;
    pensionAcquisition?: string;
    childcareLeaveStart?: string;
    childcareLeaveEnd?: string;
    maternityLeaveStart?: string;
    maternityLeaveEnd?: string;
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
        // 社員番号で既存社員を検索
        const foundByEmployeeNo = existingEmployees.find((emp) => emp.employeeNo === employeeNo);
        if (!foundByEmployeeNo) {
          errors.push({
            rowIndex: parsedRow.rowIndex,
            fieldName: '社員番号',
            message: `社員番号 ${employeeNo} は登録されていません`,
            severity: 'error',
            templateType,
          });
        } else {
          // 社員番号と氏名の整合性チェック
          const csvName = parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';
          const existingName = foundByEmployeeNo.name || '';
          
          if (csvName && existingName && csvName.trim() !== existingName.trim()) {
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

    // 既存社員データを検索（社員番号で）
    const foundByEmployeeNo = existingEmployees.find((emp) => emp.employeeNo === employeeNo);

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

    // 社員番号で既存社員を検索
    if (foundByEmployeeNo) {
      // 社員番号が一致する場合 → 更新
      // 社員番号と氏名の整合性チェック
      const csvName = parsedRow.data['氏名(漢字)'] || parsedRow.data['氏名漢字'] || '';
      const existingName = foundByEmployeeNo.name || '';
      
      if (csvName && existingName && csvName.trim() !== existingName.trim()) {
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
        '氏名漢字': 'name',
        '氏名(カナ)': 'kana',
        '性別': 'gender',
        '生年月日': 'birthDate',
        '郵便番号': 'postalCode',
        '住所': 'address',
        '所属部署名': 'department',
        '勤務地都道府県名': 'workPrefecture',
        '個人番号': 'personalNumber',
        '基礎年金番号': 'basicPensionNumber',
        '扶養の有無': 'hasDependent',
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
        '標準報酬月額': 'standardMonthly',
        '被保険者番号（健康保険)': 'healthInsuredNumber',
        '被保険者番号（厚生年金）': 'pensionInsuredNumber',
        '健康保険資格取得日': 'healthAcquisition',
        '健康保険 資格取得日': 'healthAcquisition',
        '厚生年金資格取得日': 'pensionAcquisition',
        '厚生年金 資格取得日': 'pensionAcquisition',
        '育休開始日': 'childcareLeaveStart',
        '育休終了日': 'childcareLeaveEnd',
        '産休開始日': 'maternityLeaveStart',
        '産休終了日': 'maternityLeaveEnd',
      };

      Object.keys(fieldMapping).forEach((csvField) => {
        const csvValue = csvData[csvField];
        // CSVに値が存在しない場合はスキップ
        if (csvValue === undefined || csvValue === '') return;

        const dbField = fieldMapping[csvField];
        const existingValue = existingEmployee?.[dbField];

        // 日付フィールドのリスト
        const dateFields = [
          '生年月日',
          '扶養 生年月日',
          '健康保険資格取得日',
          '健康保険 資格取得日',
          '厚生年金資格取得日',
          '厚生年金 資格取得日',
          '育休開始日',
          '育休終了日',
          '産休開始日',
          '産休終了日',
          '扶養 被扶養者になった日',
        ];
        
        // 日付フィールドの正規化関数（YYYY/MM/DD形式に統一）
        const normalizeDate = (dateStr: string | undefined): string => {
          if (!dateStr) return '';
          // YYYY-MM-DD形式をYYYY/MM/DD形式に変換
          return dateStr.replace(/-/g, '/');
        };
        
        // 数値フィールドの比較
        if (csvField === '標準報酬月額' || csvField === '扶養 年収（見込みでも可）') {
          const csvNum = Number(csvValue.replace(/,/g, ''));
          const existingNum = typeof existingValue === 'number' ? existingValue : 
                             (existingValue ? Number(String(existingValue).replace(/,/g, '')) : undefined);
          
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
          const normalizedExistingValue = normalizeDate(existingValue ? String(existingValue) : undefined);
          
          if (normalizedCsvValue !== normalizedExistingValue) {
            changes.push({
              fieldName: csvField,
              oldValue: normalizedExistingValue || null,
              newValue: normalizedCsvValue || null,
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