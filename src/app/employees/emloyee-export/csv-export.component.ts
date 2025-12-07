import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CALCULATION_RESULT_FIELD_DEFS,
  CalculationCsvContext,
  CalculationResultField,
  CsvExportService,
  EXPORT_ALL,
  ExportContext,
  ExportSection,
} from './csv-export.service';
import { ShahoEmployeesService } from '../../app/services/shaho-employees.service';

interface CsvExportOption {
  key: ExportSection;
  label: string;
  description: string;
  availableIn: ExportContext[];
}

@Component({
  selector: 'app-csv-export',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './csv-export.component.html',
  styleUrl: './csv-export.component.scss',
})
export class CsvExportComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private csvExportService = inject(CsvExportService);
  private employeesService = inject(ShahoEmployeesService);

  context: ExportContext = 'import';
  statusMessage = '';
  isExporting = false;
  calculationContext?: CalculationCsvContext;
  calculationFieldOptions = CALCULATION_RESULT_FIELD_DEFS;

  options: CsvExportOption[] = [
    {
      key: 'basic',
      label: '基本情報',
      description: '氏名・社員番号・住所などの基本プロフィール',
      availableIn: ['import', 'calculation'],
    },
    {
      key: 'socialInsurance',
      label: '社会保険情報',
      description: '標準報酬月額や被保険者番号などの保険関連データ',
      availableIn: ['import', 'calculation'],
    },
    {
      key: 'payrollHistory',
      label: '給与/賞与/社会保険料履歴',
      description: '過去の給与・賞与・社会保険料の記録',
      availableIn: ['import', 'calculation'],
    },
    {
        key: 'calculationResult',
        label: '計算結果の出力項目',
        description: '選択中の計算結果セットをCSV化します',
        availableIn: ['calculation'],
      },
  ];

  selectedSections = new Set<ExportSection>();
  selectedCalculationFields = new Set<CalculationResultField>();
  departmentOptions: string[] = [];
  workPrefectureOptions: string[] = [];
  selectedDepartment = '';
  selectedWorkPrefecture = '';
  payrollStartMonth = '';
  payrollEndMonth = '';
  readonly EXPORT_ALL = EXPORT_ALL;

  ngOnInit(): void {
    const queryContext = this.route.snapshot.queryParamMap.get('context');
    const stateContext = history.state?.context as ExportContext | undefined;
    this.calculationContext = history.state?.calculationContext as
      | CalculationCsvContext
      | undefined;
    this.context = this.normalizeContext(queryContext, stateContext);
    void this.loadFilterOptions();
  }

  get visibleOptions() {
    return this.options.filter(
        (option) =>
          option.availableIn.includes(this.context) &&
          (option.key !== 'calculationResult' ||
            !!this.calculationContext?.rows?.length),
      );
  }

  get isCalculationContext() {
    return this.context === 'calculation';
  }

  get canSelectItems() {
    return !!this.selectedDepartment && !!this.selectedWorkPrefecture;
  }

  get isPayrollRangeIncomplete() {
    return !this.payrollStartMonth || !this.payrollEndMonth;
  }

  onToggle(section: ExportSection, checked: boolean) {
    if (!this.canSelectItems) return;
    if (checked) {
      this.selectedSections.add(section);
    } else {
      this.selectedSections.delete(section);
    }
    if (section === 'calculationResult') {
      if (checked && !this.selectedCalculationFields.size) {
        this.initializeCalculationFields();
      }
      if (!checked) {
        this.selectedCalculationFields.clear();
      }
    }
  }

  selectAll() {
    if (!this.canSelectItems) return;
    this.visibleOptions.forEach((option) => this.selectedSections.add(option.key));
    if (this.visibleOptions.some((option) => option.key === 'calculationResult')) {
      this.initializeCalculationFields();
    }
  }

  deselectAll() {
    if (!this.canSelectItems) return;
    this.visibleOptions.forEach((option) => this.selectedSections.delete(option.key));
    this.selectedCalculationFields.clear();
  }

  async exportCsv() {
    if (!this.canSelectItems) {
      this.statusMessage = '部署と勤務地を選択してください。';
      return;
    }

    if (this.isPayrollRangeIncomplete) {
      this.statusMessage = '給与履歴の開始年月と終了年月を指定してください。';
      return;
    }

    if (this.hasInvalidPayrollRange()) {
      this.statusMessage = '開始年月は終了年月以前を指定してください。';
      return;
    }

    if (!this.selectedSections.size) {
      this.statusMessage = '出力項目を1つ以上選択してください。';
      return;
    }

    if (
      this.selectedSections.has('calculationResult') &&
      !this.selectedCalculationFields.size
    ) {
      this.statusMessage = '計算結果の出力項目を1つ以上選択してください。';
      return;
    }

    this.statusMessage = '';
    this.isExporting = true;

    try {
      const blob = await this.csvExportService.exportEmployeesCsv({
        context: this.context,
        calculationContext: this.calculationContext,
        calculationFields: Array.from(this.selectedCalculationFields),
        sections: Array.from(this.selectedSections),
        department: this.selectedDepartment || undefined,
        workPrefecture: this.selectedWorkPrefecture || undefined,
        payrollStartMonth: this.payrollStartMonth || undefined,
        payrollEndMonth: this.payrollEndMonth || undefined,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = this.csvExportService.buildFileName(this.context);
      anchor.click();
      URL.revokeObjectURL(url);
      this.statusMessage = 'CSVを生成しました。ダウンロードが開始されます。';
    } catch (error) {
      console.error(error);
      this.statusMessage = 'CSV生成に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.isExporting = false;
    }
  }

  onFilterChange() {
    this.statusMessage = '';
    if (this.canSelectItems) {
      this.initializeSelection();
    } else {
      this.selectedSections.clear();
      this.selectedCalculationFields.clear();
    }
  }

  onPayrollRangeChange() {
    this.statusMessage = '';
  }

  private async loadFilterOptions() {
    try {
      const employees = await firstValueFrom(this.employeesService.getEmployees());
      this.departmentOptions = this.buildUniqueList(
        employees.map((employee) => employee.department),
      );
      this.workPrefectureOptions = this.buildUniqueList(
        employees.map((employee) => employee.workPrefecture),
      );
      this.departmentOptions = this.withAllOption(this.departmentOptions);
      this.workPrefectureOptions = this.withAllOption(this.workPrefectureOptions);

      // デフォルトは「すべて」を選択
      this.selectedDepartment = EXPORT_ALL;
      this.selectedWorkPrefecture = EXPORT_ALL;

      if (this.canSelectItems) {
        this.initializeSelection();
      }
    } catch (error) {
      console.error(error);
      this.statusMessage = '部署・勤務地の候補取得に失敗しました。';
    }
  }

  private buildUniqueList(values: Array<string | undefined>) {
    return Array.from(new Set(values.filter(Boolean) as string[])).sort();
  }

  private withAllOption(values: string[]) {
    if (values.includes(EXPORT_ALL)) return values;
    return [EXPORT_ALL, ...values];
  }

  private initializeSelection() {
    if (!this.canSelectItems) {
      this.selectedSections.clear();
      this.selectedCalculationFields.clear();
      return;
    }
    this.selectedSections.clear();
    this.visibleOptions.forEach((option) => this.selectedSections.add(option.key));
    if (this.selectedSections.has('calculationResult')) {
      this.initializeCalculationFields();
    }
  }

  private normalizeContext(
    queryContext: string | null,
    stateContext: ExportContext | undefined,
  ): ExportContext {
    if (queryContext === 'calculation' || stateContext === 'calculation') {
      return 'calculation';
    }
    return 'import';
  }

  private hasInvalidPayrollRange() {
    if (!this.payrollStartMonth || !this.payrollEndMonth) return false;
    return this.payrollStartMonth > this.payrollEndMonth;
  }

  initializeCalculationFields() {
    if (!this.calculationContext?.rows?.length) {
      this.selectedCalculationFields.clear();
      return;
    }
    this.selectedCalculationFields = new Set(
      this.calculationFieldOptions.map((option) => option.key),
    );
  }

  onToggleCalculationField(field: CalculationResultField, checked: boolean) {
    if (!this.canSelectItems) return;
    if (checked) {
      this.selectedCalculationFields.add(field);
    } else {
      this.selectedCalculationFields.delete(field);
    }
  }
}