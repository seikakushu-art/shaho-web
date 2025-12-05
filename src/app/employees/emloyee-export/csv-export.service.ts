import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { ShahoEmployeesService } from '../../app/services/shaho-employees.service';

export type ExportContext = 'import' | 'calculation';
export type ExportSection =
  | 'basic'
  | 'socialInsurance'
  | 'payrollHistory'
  | 'calculationReview';

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
  }): Promise<Blob> {
    const employees = await firstValueFrom(this.employeesService.getEmployeesWithPayrolls());
    const columns = this.buildColumns(options.sections, options.context);

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

  private buildColumns(sections: ExportSection[], context: ExportContext): CsvColumn[] {
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