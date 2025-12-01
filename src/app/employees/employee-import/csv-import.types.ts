export type TemplateType = 'new' | 'payroll' | 'unknown';

export type ImportStatus = 'ok' | 'warning' | 'error';

export type ChangeField = {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
};

export type DifferenceRow = {
  rowIndex: number;
  employeeNo: string | null;
  changes: ChangeField[];
  status: ImportStatus;
};

export type ParsedRow = {
  data: Record<string, string>;
  rowIndex: number;
};

export type ValidatedRow<TNormalized = Record<string, unknown>> = {
  parsedRow: ParsedRow;
  normalized: TNormalized;
  errors: ValidationError[];
};

export type ValidationError = {
  rowIndex: number;
  fieldName: string;
  message: string;
  severity: 'error' | 'warning';
  templateType: TemplateType;
  employeeNo?: string | null;
  name?: string | null;
};

export type CSVParseResult = {
  headers: string[];
  rawHeaders: string[];
  rows: string[][];
  errors: ValidationError[];
  templateType: TemplateType;
};

export type Summary = {
  totalRecords: number;
  errorCount: number;
  newCount: number;
  updateCount: number;
};