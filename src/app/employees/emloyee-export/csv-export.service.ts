import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { ShahoEmployeesService } from '../../app/services/shaho-employees.service';
import {
  CalculationRow,
  CalculationResultHistory,
} from '../../calculations/calculation-data.service';
import { CalculationType } from '../../calculations/calculation-types';

export type ExportContext = 'import' | 'calculation';
export type ExportSection =
  | 'basic'
  | 'socialInsurance'
  | 'payrollHistory'
  | 'calculationResult';
export type CalculationResultField =
  | 'calculationId'
  | 'calculationType'
  | 'targetMonth'
  | 'activeInsurances'
  | 'healthStandardMonthly'
  | 'welfareStandardMonthly'
  | 'standardHealthBonus'
  | 'standardWelfareBonus'
  | 'healthEmployeeMonthly'
  | 'healthEmployerMonthly'
  | 'nursingEmployeeMonthly'
  | 'nursingEmployerMonthly'
  | 'welfareEmployeeMonthly'
  | 'welfareEmployerMonthly'
  | 'healthEmployeeBonus'
  | 'healthEmployerBonus'
  | 'nursingEmployeeBonus'
  | 'nursingEmployerBonus'
  | 'welfareEmployeeBonus'
  | 'welfareEmployerBonus'
  | 'healthTotalMonthly'
  | 'nursingTotalMonthly'
  | 'welfareTotalMonthly'
  | 'healthTotalBonus'
  | 'nursingTotalBonus'
  | 'welfareTotalBonus'
  | 'totalPremium';
export const EXPORT_ALL = '__ALL__';

export const CALCULATION_RESULT_FIELD_DEFS: ReadonlyArray<{
  key: CalculationResultField;
  header: string;
}> = [
  { key: 'calculationId', header: '計算ID' },
  { key: 'calculationType', header: '計算種別' },
  { key: 'targetMonth', header: '対象年/年月' },
  { key: 'activeInsurances', header: '対象保険種別' },
  { key: 'healthStandardMonthly', header: '健保標準報酬月額(計算結果)' },
  { key: 'welfareStandardMonthly', header: '厚年標準報酬月額(計算結果)' },
  { key: 'standardHealthBonus', header: '標準賞与額(健・介)' },
  { key: 'standardWelfareBonus', header: '標準賞与額(厚生年金)' },
  { key: 'healthEmployeeMonthly', header: '健康保険（月例 個人）' },
  { key: 'healthEmployerMonthly', header: '健康保険（月例 会社）' },
  { key: 'nursingEmployeeMonthly', header: '介護保険（月例 個人）' },
  { key: 'nursingEmployerMonthly', header: '介護保険（月例 会社）' },
  { key: 'welfareEmployeeMonthly', header: '厚生年金（月例 個人）' },
  { key: 'welfareEmployerMonthly', header: '厚生年金（月例 会社）' },
  { key: 'healthEmployeeBonus', header: '健康保険（賞与 個人）' },
  { key: 'healthEmployerBonus', header: '健康保険（賞与 会社）' },
  { key: 'nursingEmployeeBonus', header: '介護保険（賞与 個人）' },
  { key: 'nursingEmployerBonus', header: '介護保険（賞与 会社）' },
  { key: 'welfareEmployeeBonus', header: '厚生年金（賞与 個人）' },
  { key: 'welfareEmployerBonus', header: '厚生年金（賞与 会社）' },
  { key: 'healthTotalMonthly', header: '健康保険（合計・月例）' },
  { key: 'nursingTotalMonthly', header: '介護保険（合計・月例）' },
  { key: 'welfareTotalMonthly', header: '厚生年金（合計・月例）' },
  { key: 'healthTotalBonus', header: '健康保険（合計・賞与）' },
  { key: 'nursingTotalBonus', header: '介護保険（合計・賞与）' },
  { key: 'welfareTotalBonus', header: '厚生年金（合計・賞与）' },
  { key: 'totalPremium', header: '個人＋会社 保険料合計' },
];

type CalculationCsvMeta = {
  id?: CalculationResultHistory['id'];
  targetMonth?: string;
  calculationType?: CalculationType;
  activeInsurances?: string[];
  historyId?: string;
};

export interface InsuranceSummary {
  type: string;
  employee: number;
  employer: number;
  total?: number;
  error?: string;
}

export interface CalculationCsvContext {
  rows: CalculationRow[];
  meta?: CalculationCsvMeta;
  insuranceSummaries?: InsuranceSummary[];
}

type EmployeesObservable = ReturnType<
  ShahoEmployeesService['getEmployeesWithPayrolls']
>;
type EmployeeWithPayrolls =
  EmployeesObservable extends Observable<infer Arr>
    ? Arr extends readonly any[]
      ? Arr[number]
      : never
    : never;
type Payroll = NonNullable<EmployeeWithPayrolls['payrolls']>[number];

interface CsvColumn {
  header: string;
  value: (
    employee: EmployeeWithPayrolls,
  ) => string | number | boolean | null | undefined;
}

@Injectable({ providedIn: 'root' })
export class CsvExportService {
  private employeesService = inject(ShahoEmployeesService);

  async exportEmployeesCsv(options: {
    sections: ExportSection[];
    context: ExportContext;
    calculationContext?: CalculationCsvContext;
    calculationFields?: CalculationResultField[];
    department?: string;
    workPrefecture?: string;
    payrollStartMonth?: string;
    payrollEndMonth?: string;
  }): Promise<Blob> {
    const employees = await firstValueFrom(
      this.employeesService.getEmployeesWithPayrolls(),
    );
    const calculationScopedEmployees =
      options.context === 'calculation' &&
      options.calculationContext?.rows &&
      options.calculationContext.rows.length > 0
        ? this.filterEmployeesByCalculationRows(
            employees,
            options.calculationContext.rows,
          )
        : employees;
    const filteredEmployees = this.filterEmployees(
      calculationScopedEmployees,
      options.department,
      options.workPrefecture,
    );
    const columns = this.buildColumns(
      options.sections,
      options.context,
      options.calculationContext,
      options.calculationFields,
      filteredEmployees,
      options.payrollStartMonth,
      options.payrollEndMonth,
    );

    const rows = filteredEmployees.map((employee) =>
      columns.map((column) => this.escapeForCsv(column.value(employee))),
    );
    const csvMatrix = [columns.map((column) => column.header), ...rows];
    let csvContent = csvMatrix.map((row) => row.join(',')).join('\n');

    // 保険種別まとめテーブルを追加（計算コンテキストが存在し、保険料計算の場合のみ）
    if (
      options.context === 'calculation' &&
      options.calculationContext?.insuranceSummaries &&
      options.calculationContext.insuranceSummaries.length > 0 &&
      options.calculationContext.meta?.calculationType === 'insurance'
    ) {
      csvContent += '\n\n';
      csvContent += '保険種別まとめ\n';
      csvContent += '保険種別,個人負担,会社負担,合計\n';
      options.calculationContext.insuranceSummaries.forEach((summary) => {
        if (summary.error) {
          csvContent += `${this.escapeForCsv(summary.type)},${this.escapeForCsv(summary.employee)},エラー: ${this.escapeForCsv(summary.error)},\n`;
        } else {
          csvContent += `${this.escapeForCsv(summary.type)},${this.escapeForCsv(summary.employee)},${this.escapeForCsv(summary.employer)},${this.escapeForCsv(summary.total ?? '')}\n`;
        }
      });
    }

    return new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
  }

  buildFileName(context: ExportContext) {
    return context === 'calculation'
      ? 'calculation-csv-export.csv'
      : 'employee-csv-export.csv';
  }

  private buildColumns(
    sections: ExportSection[],
    context: ExportContext,
    calculationContext?: CalculationCsvContext,
    calculationFields?: CalculationResultField[],
    employees: EmployeeWithPayrolls[] = [],
    payrollStartMonth?: string,
    payrollEndMonth?: string,
  ): CsvColumn[] {
    const columns: CsvColumn[] = [];

    if (sections.includes('basic')) {
      columns.push(
        { header: '社員番号', value: (employee) => employee.employeeNo },
        { header: '氏名(漢字)', value: (employee) => employee.name },
        { header: '氏名(カナ)', value: (employee) => employee.kana },
        { header: '部署', value: (employee) => employee.department },
        {
          header: '勤務地都道府県',
          value: (employee) => employee.workPrefecture,
        },
        {
          header: '生年月日',
          value: (employee) => this.formatDate(employee.birthDate),
        },
        { header: '郵便番号', value: (employee) => employee.postalCode },
        { header: '住民票住所', value: (employee) => employee.address },
        { header: '現住所', value: (employee) => employee.currentAddress },
        { header: '個人番号', value: (employee) => employee.personalNumber },
        {
          header: '基礎年金番号',
          value: (employee) => employee.basicPensionNumber,
        },
        {
          header: '扶養の有無',
          value: (employee) => (employee.hasDependent ? 'はい' : 'いいえ'),
        },
      );
    }

    if (sections.includes('socialInsurance')) {
      columns.push(
        {
          header: '健康保険被保険者番号',
          value: (employee) => employee.healthInsuredNumber,
        },
        {
          header: '厚生年金被保険者番号',
          value: (employee) => employee.pensionInsuredNumber,
        },
        {
          header: '健保標準報酬月額',
          value: (employee) =>
            employee.healthStandardMonthly,
        },
        {
          header: '厚年標準報酬月額',
          value: (employee) =>
            employee.welfareStandardMonthly,
        },
        {
          header: '標準賞与額年間合計',
          value: (employee) => employee.standardBonusAnnualTotal,
        },
        {
          header: '介護第2号被保険者',
          value: (employee) => (employee.careSecondInsured ? 'はい' : 'いいえ'),
        },
        {
          header: '健康保険 資格取得日',
          value: (employee) => this.formatDate(employee.healthAcquisition),
        },
        {
          header: '厚生年金 資格取得日',
          value: (employee) => this.formatDate(employee.pensionAcquisition),
        },
        {
          header: '現在の休業状態',
          value: (employee) => employee.currentLeaveStatus || '',
        },
        {
          header: '現在の休業開始日',
          value: (employee) => this.formatDate(employee.currentLeaveStartDate),
        },
        {
          header: '現在の休業予定終了日',
          value: (employee) => this.formatDate(employee.currentLeaveEndDate),
        },
      );
    }

    if (sections.includes('payrollHistory')) {
      const targetMonths = this.determinePayrollMonths(
        employees,
        payrollStartMonth,
        payrollEndMonth,
      );

      targetMonths.forEach((month) => {
        columns.push(
          {
            header: `給与(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.amount ?? '',
          },
          {
            header: `支払基礎日数(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.workedDays ?? '',
          },
          {
            header: `健康保険（月給）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.healthInsuranceMonthly ?? '',
          },
          {
            header: `介護保険（月給）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.careInsuranceMonthly ?? '',
          },
          {
            header: `厚生年金（月給）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.pensionMonthly ?? '',
          },
          {
            header: `賞与(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.bonusTotal ?? '',
          },
          {
            header: `賞与支給日(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.bonusPaidOn ?? '',
          },
          {
            header: `標準賞与額(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.standardBonus ?? '',
          },
          {
            header: `健康保険（賞与）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.healthInsuranceBonus ?? '',
          },
          {
            header: `介護保険（賞与）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.careInsuranceBonus ?? '',
          },
          {
            header: `厚生年金（賞与）(${month})`,
            value: (employee) =>
              (employee.payrolls ?? []).find(
                (payroll) => payroll.yearMonth === month,
              )?.pensionBonus ?? '',
          },
        );
      });
    }

    if (
      sections.includes('calculationResult') &&
      context === 'calculation' &&
      calculationContext?.rows?.length
    ) {
      const rowMap = new Map(
        calculationContext.rows.map((row) => [row.employeeNo, row]),
      );
      const meta: CalculationCsvMeta = calculationContext.meta ?? {};
      const fields = this.resolveCalculationFields(calculationFields);
      columns.push(...this.buildCalculationResultColumns(fields, rowMap, meta));
    }

    return columns;
  }

  private resolveCalculationFields(
    calculationFields?: CalculationResultField[],
  ): CalculationResultField[] {
    if (calculationFields && calculationFields.length > 0) {
      return calculationFields;
    }
    return CALCULATION_RESULT_FIELD_DEFS.map((field) => field.key);
  }

  private buildCalculationResultColumns(
    fields: CalculationResultField[],
    rowMap: Map<string, CalculationRow>,
    meta: CalculationCsvMeta,
  ): CsvColumn[] {
    const byKey: Record<CalculationResultField, CsvColumn> = {
      calculationId: {
        header: '計算ID',
        value: () => meta.historyId ?? meta.id,
      },
      calculationType: {
        header: '計算種別',
        value: () => meta.calculationType,
      },
      targetMonth: { header: '対象年/年月', value: () => meta.targetMonth },
      activeInsurances: {
        header: '対象保険種別',
        value: () => (meta.activeInsurances ?? []).join('/'),
      },
      healthStandardMonthly: {
        header: '健保標準報酬月額(計算結果)',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          return row?.healthStandardMonthly;
        },
      },
      welfareStandardMonthly: {
        header: '厚年標準報酬月額(計算結果)',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          return row?.welfareStandardMonthly;
        },
      },
      standardHealthBonus: {
        header: '標準賞与額(健・介)',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.standardHealthBonus,
      },
      standardWelfareBonus: {
        header: '標準賞与額(厚生年金)',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.standardWelfareBonus,
      },
      healthEmployeeMonthly: {
        header: '健康保険（月例 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.healthEmployeeMonthly,
      },
      healthEmployerMonthly: {
        header: '健康保険（月例 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.healthEmployerMonthly,
      },
      nursingEmployeeMonthly: {
        header: '介護保険（月例 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.nursingEmployeeMonthly,
      },
      nursingEmployerMonthly: {
        header: '介護保険（月例 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.nursingEmployerMonthly,
      },
      welfareEmployeeMonthly: {
        header: '厚生年金（月例 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.welfareEmployeeMonthly,
      },
      welfareEmployerMonthly: {
        header: '厚生年金（月例 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.welfareEmployerMonthly,
      },
      healthEmployeeBonus: {
        header: '健康保険（賞与 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.healthEmployeeBonus,
      },
      healthEmployerBonus: {
        header: '健康保険（賞与 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.healthEmployerBonus,
      },
      nursingEmployeeBonus: {
        header: '介護保険（賞与 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.nursingEmployeeBonus,
      },
      nursingEmployerBonus: {
        header: '介護保険（賞与 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.nursingEmployerBonus,
      },
      welfareEmployeeBonus: {
        header: '厚生年金（賞与 個人）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.welfareEmployeeBonus,
      },
      welfareEmployerBonus: {
        header: '厚生年金（賞与 会社）',
        value: (employee) =>
          rowMap.get(employee.employeeNo)?.welfareEmployerBonus,
      },
      healthTotalMonthly: {
        header: '健康保険（合計・月例）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.healthEmployeeMonthly ?? 0) + (row.healthEmployerMonthly ?? 0);
        },
      },
      nursingTotalMonthly: {
        header: '介護保険（合計・月例）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.nursingEmployeeMonthly ?? 0) + (row.nursingEmployerMonthly ?? 0);
        },
      },
      welfareTotalMonthly: {
        header: '厚生年金（合計・月例）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.welfareEmployeeMonthly ?? 0) + (row.welfareEmployerMonthly ?? 0);
        },
      },
      healthTotalBonus: {
        header: '健康保険（合計・賞与）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.healthEmployeeBonus ?? 0) + (row.healthEmployerBonus ?? 0);
        },
      },
      nursingTotalBonus: {
        header: '介護保険（合計・賞与）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.nursingEmployeeBonus ?? 0) + (row.nursingEmployerBonus ?? 0);
        },
      },
      welfareTotalBonus: {
        header: '厚生年金（合計・賞与）',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          return (row.welfareEmployeeBonus ?? 0) + (row.welfareEmployerBonus ?? 0);
        },
      },
      totalPremium: {
        header: '個人＋会社 保険料合計',
        value: (employee) => {
          const row = rowMap.get(employee.employeeNo);
          if (!row) return '';
          const personal =
            (row.healthEmployeeMonthly ?? 0) +
            (row.nursingEmployeeMonthly ?? 0) +
            (row.welfareEmployeeMonthly ?? 0) +
            (row.healthEmployeeBonus ?? 0) +
            (row.nursingEmployeeBonus ?? 0) +
            (row.welfareEmployeeBonus ?? 0);
          const employer =
            (row.healthEmployerMonthly ?? 0) +
            (row.nursingEmployerMonthly ?? 0) +
            (row.welfareEmployerMonthly ?? 0) +
            (row.healthEmployerBonus ?? 0) +
            (row.nursingEmployerBonus ?? 0) +
            (row.welfareEmployerBonus ?? 0);
          return personal + employer;
        },
      },
    };

    const fieldOrder = CALCULATION_RESULT_FIELD_DEFS.map((def) => def.key);
    return fieldOrder
      .filter((key) => fields.includes(key))
      .map((key) => byKey[key]);
  }

  private formatDate(value: string | Date | null | undefined): string {
    if (!value) return '';

    if (value instanceof Date) {
      return this.formatDateParts(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      );
    }

    const trimmed = String(value).trim();
    const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

    if (match) {
      const [, y, m, d] = match;
      return this.formatDateParts(Number(y), Number(m), Number(d));
    }

    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return trimmed;

    return this.formatDateParts(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
    );
  }

  private formatDateParts(year: number, month: number, day: number): string {
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  }

  private escapeForCsv(
    value: string | number | boolean | null | undefined,
  ): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  private filterEmployeesByCalculationRows(
    employees: EmployeeWithPayrolls[],
    rows: CalculationRow[],
  ) {
    const employeeNoSet = new Set(rows.map((row) => row.employeeNo));
    return employees.filter((employee) =>
      employeeNoSet.has(employee.employeeNo),
    );
  }

  private filterEmployees(
    employees: EmployeeWithPayrolls[],
    department?: string,
    workPrefecture?: string,
  ) {
    return employees.filter((employee) => {
      const matchesDepartment =
        !department || department === EXPORT_ALL
          ? true
          : employee.department === department;
      const matchesWorkPrefecture =
        !workPrefecture || workPrefecture === EXPORT_ALL
          ? true
          : employee.workPrefecture === workPrefecture;
      return matchesDepartment && matchesWorkPrefecture;
    });
  }
  private determinePayrollMonths(
    employees: EmployeeWithPayrolls[],
    start?: string,
    end?: string,
  ): string[] {
    const uniqueMonths = new Set<string>();

    employees.forEach((employee) => {
      (employee.payrolls ?? []).forEach((payroll) => {
        if (payroll.yearMonth) {
          uniqueMonths.add(payroll.yearMonth);
        }
      });
    });

    const sorted = Array.from(uniqueMonths).sort();
    if (!start && !end) return sorted;

    return sorted.filter((month) => {
      const afterStart = start ? month >= start : true;
      const beforeEnd = end ? month <= end : true;
      return afterStart && beforeEnd;
    });
  }
}
