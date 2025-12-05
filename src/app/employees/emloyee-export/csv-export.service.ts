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
  | 'calculationReview'
  | 'calculationResult';

type CalculationCsvMeta = {
  id?: CalculationResultHistory['id'];
  targetMonth?: string;
  calculationType?: CalculationType;
  activeInsurances?: string[];
  historyId?: string;
};

export interface CalculationCsvContext {
  rows: CalculationRow[];
  meta?: CalculationCsvMeta;
}

type EmployeesObservable = ReturnType<ShahoEmployeesService['getEmployeesWithPayrolls']>;
type EmployeeWithPayrolls = EmployeesObservable extends Observable<infer Arr>
  ? Arr extends readonly any[]
    ? Arr[number]
    : never
  : never;
type Payroll = NonNullable<EmployeeWithPayrolls['payrolls']>[number];

interface CsvColumn {
  header: string;
  value: (employee: EmployeeWithPayrolls) => string | number | boolean | null | undefined;
}

@Injectable({ providedIn: 'root' })
export class CsvExportService {
  private employeesService = inject(ShahoEmployeesService);

  async exportEmployeesCsv(options: {
    sections: ExportSection[];
    context: ExportContext;
    calculationContext?: CalculationCsvContext;
  }): Promise<Blob> {
    const employees = await firstValueFrom(this.employeesService.getEmployeesWithPayrolls());
    const columns = this.buildColumns(
        options.sections,
        options.context,
        options.calculationContext,
      );

    const rows = employees.map((employee) =>
      columns.map((column) => this.escapeForCsv(column.value(employee))),
    );
    const csvMatrix = [columns.map((column) => column.header), ...rows];
    const csvContent = csvMatrix.map((row) => row.join(',')).join('\n');

    return new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  }

  buildFileName(context: ExportContext) {
    return context === 'calculation' ? 'calculation-csv-export.csv' : 'employee-csv-export.csv';
  }

  private buildColumns(
    sections: ExportSection[],
    context: ExportContext,
    calculationContext?: CalculationCsvContext,
  ): CsvColumn[] {
    const columns: CsvColumn[] = [];

    if (sections.includes('basic')) {
      columns.push(
        { header: '社員番号', value: (employee) => employee.employeeNo },
        { header: '氏名(漢字)', value: (employee) => employee.name },
        { header: '氏名(カナ)', value: (employee) => employee.kana },
        { header: '部署', value: (employee) => employee.department },
        { header: '生年月日', value: (employee) => employee.birthDate },
        { header: '住所', value: (employee) => employee.address },
      );
    }

    if (sections.includes('socialInsurance')) {
      columns.push(
        { header: '健康保険被保険者番号', value: (employee) => employee.healthInsuredNumber },
        { header: '厚生年金被保険者番号', value: (employee) => employee.pensionInsuredNumber },
        { header: '標準報酬月額', value: (employee) => employee.standardMonthly },
        { header: '標準賞与額年間合計', value: (employee) => employee.standardBonusAnnualTotal },
        { header: '介護第2号被保険者', value: (employee) => (employee.careSecondInsured ? 'はい' : 'いいえ') },
      );
    }

    if (sections.includes('payrollHistory')) {
      columns.push({
        header: '給与/賞与/社会保険料履歴',
        value: (employee) =>
          (employee.payrolls ?? [])
            .map((payroll: Payroll) => {
              const monthly = payroll.amount ?? '-';
              const bonus = payroll.bonusTotal ?? '-';
              const contributions = [
                payroll.healthInsuranceMonthly,
                payroll.pensionMonthly,
                payroll.careInsuranceMonthly,
              ]
                .filter((value) => value !== undefined && value !== null)
                .join(' / ');
              return `${payroll.yearMonth}: 月給=${monthly}, 賞与=${bonus}, 社保=${contributions || '-'}`;
            })
            .join(' | '),
      });
    }

    if (sections.includes('calculationReview') && context === 'calculation') {
      columns.push({
        header: '結果確認(計算内訳)',
        value: (employee) =>
          (employee.payrolls ?? [])
            .map((payroll: Payroll) => {
              const base = payroll.standardBonus ? `標準賞与額=${payroll.standardBonus}` : '';
              const health = payroll.healthInsuranceBonus
                ? `健保(${payroll.healthInsuranceBonus})`
                : undefined;
              const pension = payroll.pensionBonus ? `厚年(${payroll.pensionBonus})` : undefined;
              const care = payroll.careInsuranceBonus ? `介護(${payroll.careInsuranceBonus})` : undefined;
              const monthlyHealth = payroll.healthInsuranceMonthly
                ? `月次健保(${payroll.healthInsuranceMonthly})`
                : undefined;
              const monthlyPension = payroll.pensionMonthly
                ? `月次厚年(${payroll.pensionMonthly})`
                : undefined;
              return [base, health, pension, care, monthlyHealth, monthlyPension]
                .filter((part) => part)
                .join(' / ');
            })
            .join(' | '),
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
  
        columns.push(
          { header: '計算ID', value: () => meta.historyId ?? meta.id },
          { header: '計算種別', value: () => meta.calculationType },
          { header: '対象年/年月', value: () => meta.targetMonth },
          {
            header: '対象保険種別',
            value: () => (meta.activeInsurances ?? []).join('/'),
          },
          {
            header: '標準報酬月額(計算結果)',
            value: (employee) => rowMap.get(employee.employeeNo)?.standardMonthly,
          },
          {
            header: '賞与支給日',
            value: (employee) => rowMap.get(employee.employeeNo)?.bonusPaymentDate,
          },
          {
            header: '賞与総支給額',
            value: (employee) => rowMap.get(employee.employeeNo)?.bonusTotalPay,
          },
          {
            header: '標準賞与額(健・介)',
            value: (employee) => rowMap.get(employee.employeeNo)?.standardHealthBonus,
          },
          {
            header: '標準賞与額(厚生年金)',
            value: (employee) => rowMap.get(employee.employeeNo)?.standardWelfareBonus,
          },
          {
            header: '健康保険（月例 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.healthEmployeeMonthly} / ${row.healthEmployerMonthly}`;
            },
          },
          {
            header: '介護保険（月例 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.nursingEmployeeMonthly} / ${row.nursingEmployerMonthly}`;
            },
          },
          {
            header: '厚生年金（月例 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.welfareEmployeeMonthly} / ${row.welfareEmployerMonthly}`;
            },
          },
          {
            header: '健康保険（賞与 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.healthEmployeeBonus} / ${row.healthEmployerBonus}`;
            },
          },
          {
            header: '厚生年金（賞与 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.welfareEmployeeBonus} / ${row.welfareEmployerBonus}`;
            },
          },
          {
            header: '介護保険（賞与 個人/会社）',
            value: (employee) => {
              const row = rowMap.get(employee.employeeNo);
              if (!row) return '';
              return `${row.nursingEmployeeBonus} / ${row.nursingEmployerBonus}`;
            },
          },
          {
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
        );
      }

    return columns;
  }

  private escapeForCsv(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
}