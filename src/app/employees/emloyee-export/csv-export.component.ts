import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
    CalculationCsvContext,
    CsvExportService,
    ExportContext,
    ExportSection,
  } from './csv-export.service';

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

  context: ExportContext = 'import';
  statusMessage = '';
  isExporting = false;
  calculationContext?: CalculationCsvContext;

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
      key: 'calculationReview',
      label: '結果確認画面の項目',
      description: '計算結果画面で確認した控除内訳や標準賞与額など',
      availableIn: ['calculation'],
    },
    {
        key: 'calculationResult',
        label: '計算結果の出力項目',
        description: '選択中の計算結果セット（社員ごとの保険料や標準額）をCSV化します',
        availableIn: ['calculation'],
      },
  ];

  selectedSections = new Set<ExportSection>();

  ngOnInit(): void {
    const queryContext = this.route.snapshot.queryParamMap.get('context');
    const stateContext = history.state?.context as ExportContext | undefined;
    this.calculationContext = history.state?.calculationContext as
      | CalculationCsvContext
      | undefined;
    this.context = this.normalizeContext(queryContext, stateContext);
    this.initializeSelection();
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

  onToggle(section: ExportSection, checked: boolean) {
    if (checked) {
      this.selectedSections.add(section);
    } else {
      this.selectedSections.delete(section);
    }
  }

  selectAll() {
    this.visibleOptions.forEach((option) => this.selectedSections.add(option.key));
  }

  deselectAll() {
    this.visibleOptions.forEach((option) => this.selectedSections.delete(option.key));
  }

  async exportCsv() {
    if (!this.selectedSections.size) {
      this.statusMessage = '出力項目を1つ以上選択してください。';
      return;
    }

    this.statusMessage = '';
    this.isExporting = true;

    try {
      const blob = await this.csvExportService.exportEmployeesCsv({
        context: this.context,
        calculationContext: this.calculationContext,
        sections: Array.from(this.selectedSections),
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

  private initializeSelection() {
    this.selectedSections.clear();
    this.visibleOptions.forEach((option) => this.selectedSections.add(option.key));
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
}