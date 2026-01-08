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
  includeDependents = false;
  departmentOptions: string[] = [];
  workPrefectureOptions: string[] = [];
  selectedDepartment = '';
  selectedWorkPrefecture = '';
  payrollStartMonth = '';
  payrollEndMonth = '';
  readonly EXPORT_ALL = EXPORT_ALL;
  private readonly insurancePremiumFields: CalculationResultField[] = [
    'healthEmployeeMonthly',
    'healthEmployerMonthly',
    'nursingEmployeeMonthly',
    'nursingEmployerMonthly',
    'welfareEmployeeMonthly',
    'welfareEmployerMonthly',
    'healthEmployeeBonus',
    'healthEmployerBonus',
    'nursingEmployeeBonus',
    'nursingEmployerBonus',
    'welfareEmployeeBonus',
    'welfareEmployerBonus',
    'totalPremium',
  ];
  private readonly totalFields: CalculationResultField[] = [
    'healthTotalMonthly',
    'nursingTotalMonthly',
    'welfareTotalMonthly',
    'healthTotalBonus',
    'nursingTotalBonus',
    'welfareTotalBonus',
  ];
  private readonly bonusFields: CalculationResultField[] = [
    'standardHealthBonus',
    'standardWelfareBonus',
  ];
  private readonly bonusRelatedFields: CalculationResultField[] = [
    'standardHealthBonus',
    'standardWelfareBonus',
    'healthEmployeeBonus',
    'healthEmployerBonus',
    'nursingEmployeeBonus',
    'nursingEmployerBonus',
    'welfareEmployeeBonus',
    'welfareEmployerBonus',
    'healthTotalBonus',
    'nursingTotalBonus',
    'welfareTotalBonus',
  ];
  private readonly healthInsuranceFields: CalculationResultField[] = [
    'exemption',
    'healthStandardMonthly',
    'standardHealthBonus',
    'healthEmployeeMonthly',
    'healthEmployerMonthly',
    'healthEmployeeBonus',
    'healthEmployerBonus',
    'healthTotalMonthly',
    'healthTotalBonus',
  ];
  private readonly welfareInsuranceFields: CalculationResultField[] = [
    'exemption',
    'welfareStandardMonthly',
    'standardWelfareBonus',
    'welfareEmployeeMonthly',
    'welfareEmployerMonthly',
    'welfareEmployeeBonus',
    'welfareEmployerBonus',
    'welfareTotalMonthly',
    'welfareTotalBonus',
  ];
  private readonly nursingInsuranceFields: CalculationResultField[] = [
    'healthStandardMonthly',
    'standardHealthBonus',
    'nursingEmployeeMonthly',
    'nursingEmployerMonthly',
    'nursingEmployeeBonus',
    'nursingEmployerBonus',
    'nursingTotalMonthly',
    'nursingTotalBonus',
  ];
  private readonly monthlyInsuranceFields: CalculationResultField[] = [
    'healthStandardMonthly',
    'welfareStandardMonthly',
    'healthEmployeeMonthly',
    'healthEmployerMonthly',
    'nursingEmployeeMonthly',
    'nursingEmployerMonthly',
    'welfareEmployeeMonthly',
    'welfareEmployerMonthly',
    'healthTotalMonthly',
    'nursingTotalMonthly',
    'welfareTotalMonthly',
  ];

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
    if (!this.selectedSections.has('payrollHistory')) {
      return false;
    }
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
        this.initializeCalculationFields(!this.shouldExcludeInsurancePremiumFields());
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

    if (this.selectedSections.has('payrollHistory')) {
      if (this.isPayrollRangeIncomplete) {
        this.statusMessage = '給与履歴の開始年月と終了年月を指定してください。';
        return;
      }

      if (this.hasInvalidPayrollRange()) {
        this.statusMessage = '開始年月は終了年月以前を指定してください。';
        return;
      }
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
        includeDependents: this.includeDependents,
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
      const allEmployees = await firstValueFrom(this.employeesService.getEmployees());
      
      // 部署・勤務地の選択肢は常にすべての従業員から生成（計算コンテキストに関係なく）
      this.departmentOptions = this.buildUniqueList(
        allEmployees.map((employee) => employee.department),
      );
      this.workPrefectureOptions = this.buildUniqueList(
        allEmployees.map((employee) => employee.workPrefecture),
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
      this.initializeCalculationFields(!this.shouldExcludeInsurancePremiumFields());
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

  initializeCalculationFields(selectAll = true) {
    if (!this.calculationContext?.rows?.length) {
      this.selectedCalculationFields.clear();
      return;
    }
    const keys = selectAll
      ? this.calculationFieldOptions.map((option) => option.key)
      : this.buildDefaultCalculationFieldKeys();
    this.selectedCalculationFields = new Set(keys);
  }

  onToggleCalculationField(field: CalculationResultField, checked: boolean) {
    if (!this.canSelectItems) return;
    if (checked) {
      this.selectedCalculationFields.add(field);
    } else {
      this.selectedCalculationFields.delete(field);
    }
  }

  private shouldExcludeInsurancePremiumFields() {
    return this.context === 'calculation';
  }

  private buildDefaultCalculationFieldKeys(): CalculationResultField[] {
    // 計算IDと計算種別は常に含める
    const alwaysIncluded: CalculationResultField[] = ['calculationId', 'calculationType'];
    
    // 標準賞与額計算の場合は計算ID、計算種別、対象年/年月、標準賞与額(健・介)、標準賞与額(厚生年金)のみ
    if (this.calculationContext?.meta?.calculationType === 'bonus') {
      return [...alwaysIncluded, 'targetMonth', ...this.bonusFields];
    }
    
    // 標準報酬月額計算の場合は、健康保険（月例 個人）から個人＋会社 保険料合計までの項目と賞与関連の項目、一時免除フラグ、標準賞与額を除外
    if (this.calculationContext?.meta?.calculationType === 'standard') {
      const excludedFields: CalculationResultField[] = [
        'exemption',
        'standardHealthBonus',
        'standardWelfareBonus',
        'healthEmployeeMonthly',
        'healthEmployerMonthly',
        'nursingEmployeeMonthly',
        'nursingEmployerMonthly',
        'welfareEmployeeMonthly',
        'welfareEmployerMonthly',
        'healthTotalMonthly',
        'nursingTotalMonthly',
        'welfareTotalMonthly',
        'healthEmployeeBonus',
        'healthEmployerBonus',
        'nursingEmployeeBonus',
        'nursingEmployerBonus',
        'welfareEmployeeBonus',
        'welfareEmployerBonus',
        'healthTotalBonus',
        'nursingTotalBonus',
        'welfareTotalBonus',
        'totalPremium',
      ];
      const otherFields = this.calculationFieldOptions
        .map((option) => option.key)
        .filter((key) => !alwaysIncluded.includes(key) && !excludedFields.includes(key));
      return [...alwaysIncluded, ...otherFields];
    }
    
    // 社会保険料計算の場合
    if (this.calculationContext?.meta?.calculationType === 'insurance') {
      // 「対象月に賞与を含める」と「賞与のみ計算」が両方ともfalseまたはundefinedの場合、賞与関連フィールドを除外
      const includeBonusInMonth = this.calculationContext.meta.includeBonusInMonth ?? false;
      const bonusOnly = this.calculationContext.meta.bonusOnly ?? false;
      const shouldExcludeBonusFields = !includeBonusInMonth && !bonusOnly;
      
      // 保険種別が1つのみ選択されている場合
      if (this.calculationContext.meta.activeInsurances?.length === 1) {
        const activeInsurance = this.calculationContext.meta.activeInsurances[0];
        let fields: CalculationResultField[] = [];
        
        if (activeInsurance === '健康保険') {
          fields = [...this.healthInsuranceFields];
        } else if (activeInsurance === '厚生年金') {
          fields = [...this.welfareInsuranceFields];
        } else if (activeInsurance === '介護保険') {
          fields = [...this.nursingInsuranceFields];
        }
        
        // 賞与のみ計算の場合は月額の社会保険料項目を除外
        if (bonusOnly) {
          fields = fields.filter((field) => !this.monthlyInsuranceFields.includes(field));
        }
        
        // 賞与関連フィールドを除外
        if (shouldExcludeBonusFields) {
          fields = fields.filter((field) => !this.bonusRelatedFields.includes(field));
        }
        
        return [...alwaysIncluded, 'targetMonth', 'activeInsurances', ...fields];
      }
      
      // 保険種別が複数選択されている場合
      // 賞与のみ計算の場合は月額の社会保険料項目を除外
      if (bonusOnly) {
        const otherFields = this.calculationFieldOptions
          .map((option) => option.key)
          .filter((key) => !alwaysIncluded.includes(key) && !this.monthlyInsuranceFields.includes(key));
        return [...alwaysIncluded, ...otherFields];
      }
      
      // 賞与関連フィールドを除外する必要がある場合は、それらを除外したフィールドリストを返す
      if (shouldExcludeBonusFields) {
        const otherFields = this.calculationFieldOptions
          .map((option) => option.key)
          .filter((key) => !alwaysIncluded.includes(key) && !this.bonusRelatedFields.includes(key));
        return [...alwaysIncluded, ...otherFields];
      }
    }
    
    // それ以外の場合はすべての項目（計算IDと計算種別を除く）
    const otherFields = this.calculationFieldOptions
      .map((option) => option.key)
      .filter((key) => !alwaysIncluded.includes(key));
    return [...alwaysIncluded, ...otherFields];
  }
}