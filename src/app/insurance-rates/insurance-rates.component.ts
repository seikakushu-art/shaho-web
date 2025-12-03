import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import {
  CorporateInfoService,
  HealthInsuranceType,
} from '../app/services/corporate-info.service';
import {
  BonusCap,
  InsuranceRatePayload,
  InsuranceRateRecord,
  InsuranceRatesService,
  PrefectureRate,
  StandardCompensationGrade,
} from '../app/services/insurance-rates.service';

@Component({
  selector: 'app-insurance-rates',
  standalone: true,
  imports: [DatePipe, NgFor, NgIf, ReactiveFormsModule],
  templateUrl: './insurance-rates.component.html',
  styleUrl: './insurance-rates.component.scss',
})
export class InsuranceRatesComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private insuranceRatesService = inject(InsuranceRatesService);
  private corporateInfoService = inject(CorporateInfoService);

  readonly healthTypes: HealthInsuranceType[] = ['協会けんぽ', '組合健保'];
  message = '';
  editMode = false;
  saving = false;
  selectedHealthType: HealthInsuranceType = '協会けんぽ';
  latestRecord?: InsuranceRateRecord;
  viewingRecord?: InsuranceRateRecord;
  historyRecords: InsuranceRateRecord[] = [];

  private historySub?: Subscription;

  form = this.fb.group({
    id: [''],
    healthType: ['協会けんぽ' as HealthInsuranceType, Validators.required],
    insurerName: [''],
    healthInsuranceRates: this.fb.array<FormGroup<RateFormGroup>>([], Validators.required),
    nursingCareRates: this.fb.array<FormGroup<RateFormGroup>>([], Validators.required),
    pensionRate: this.fb.group<RateGroup>({
      totalRate: this.fb.control('', Validators.required),
      employeeRate: this.fb.control('', Validators.required),
      effectiveFrom: this.fb.control('', Validators.required),
    }),
    standardCompensations: this.fb.array<FormGroup<StandardCompensationGroup>>(
      [],
      Validators.required,
    ),
    bonusCaps: this.fb.array<FormGroup<BonusCapGroup>>([], Validators.required),
  });

  ngOnInit(): void {
    this.loadHealthTypeFromCorporateInfo();
  }

  ngOnDestroy(): void {
    this.historySub?.unsubscribe();
  }

  get healthInsuranceRates(): FormArray<FormGroup<RateFormGroup>> {
    return this.form.get('healthInsuranceRates') as FormArray<FormGroup<RateFormGroup>>;
  }

  get nursingCareRates(): FormArray<FormGroup<RateFormGroup>> {
    return this.form.get('nursingCareRates') as FormArray<FormGroup<RateFormGroup>>;
  }

  get standardCompensations(): FormArray<FormGroup<StandardCompensationGroup>> {
    return this.form.get('standardCompensations') as FormArray<
      FormGroup<StandardCompensationGroup>
    >;
  }

  get bonusCaps(): FormArray<FormGroup<BonusCapGroup>> {
    return this.form.get('bonusCaps') as FormArray<FormGroup<BonusCapGroup>>;
  }

  get isLatestSelection(): boolean {
    return !!this.latestRecord && this.viewingRecord?.id === this.latestRecord.id;
  }

  async loadHealthTypeFromCorporateInfo(): Promise<void> {
    const corporateInfo = await firstValueFrom(
      this.corporateInfoService.getCorporateInfo(),
    );
    this.selectedHealthType = corporateInfo?.healthInsuranceType ?? '協会けんぽ';
    this.form.patchValue({ healthType: this.selectedHealthType });
    this.loadHistory();
  }

  loadHistory(): void {
    this.historySub?.unsubscribe();
    this.historySub = this.insuranceRatesService
      .getRateHistory(this.selectedHealthType)
      .subscribe((records) => {
        this.historyRecords = records;
        this.latestRecord = records[0];
        this.viewingRecord = records[0];
        if (records.length) {
          this.message = '';
          this.populateForm(records[0]);
          this.editMode = false;
        } else {
          this.message = 'まだ保険料率が登録されていません。新規登録を作成してください。';
          this.startNewRecord();
        }
      });
  }

  changeHealthType(type: HealthInsuranceType): void {
    this.selectedHealthType = type;
    this.form.patchValue({ healthType: type });
    this.viewingRecord = undefined;
    this.latestRecord = undefined;
    this.editMode = false;
    this.loadHistory();
  }

  populateForm(record?: InsuranceRateRecord): void {
    this.form.patchValue({
      id: record?.id ?? '',
      healthType: record?.healthType ?? this.selectedHealthType,
      insurerName: record?.insurerName ?? '',
    });

    // レコードが存在する場合はそのまま使用、存在しない場合は空配列
    if (record?.healthInsuranceRates && record.healthInsuranceRates.length > 0) {
      this.setRates(this.healthInsuranceRates, record.healthInsuranceRates);
    } else {
      this.setRates(this.healthInsuranceRates, []);
    }

    if (record?.nursingCareRates && record.nursingCareRates.length > 0) {
      this.setRates(this.nursingCareRates, record.nursingCareRates);
    } else {
      this.setRates(this.nursingCareRates, []);
    }

    this.form.setControl(
      'pensionRate',
      this.fb.group<RateGroup>({
        totalRate: this.fb.control(record?.pensionRate?.totalRate ?? '', Validators.required),
        employeeRate: this.fb.control(
          record?.pensionRate?.employeeRate ?? '',
          Validators.required,
        ),
        effectiveFrom: this.fb.control(
          record?.pensionRate?.effectiveFrom ?? '',
          Validators.required,
        ),
      }),
    );

    this.setStandardCompensations(record?.standardCompensations ?? []);

    this.setBonusCaps(record?.bonusCaps ?? []);
  }

  private setRates(
    array: FormArray<FormGroup<RateFormGroup>>,
    rates: PrefectureRate[],
  ): void {
    array.clear();
    rates.forEach((rate) => {
      const group = this.fb.group<RateFormGroup>({
        prefecture: this.fb.control(rate.prefecture, Validators.required),
        totalRate: this.fb.control(rate.totalRate ?? ''),
        employeeRate: this.fb.control(rate.employeeRate ?? ''),
        effectiveFrom: this.fb.control(rate.effectiveFrom ?? ''),
      });
      
      // 総保険料率が変更されたときに従業員負担率を自動計算
      group.get('totalRate')?.valueChanges.subscribe((totalRate) => {
        if (totalRate) {
          const numValue = parseFloat(totalRate);
          if (!isNaN(numValue)) {
            const employeeRate = (numValue / 2).toString();
            group.get('employeeRate')?.setValue(employeeRate, { emitEvent: false });
          }
        } else {
          group.get('employeeRate')?.setValue('', { emitEvent: false });
        }
      });
      
      array.push(group);
    });
  }

  private setStandardCompensations(records: StandardCompensationGrade[]): void {
    this.standardCompensations.clear();
    
    // 健康保険と厚生年金のレコードをマージ
    const healthRecords = records.filter(r => r.insuranceType === '健康保険');
    const pensionRecords = records.filter(r => r.insuranceType === '厚生年金');
    
    const maxLength = Math.max(healthRecords.length, pensionRecords.length);
    
    for (let i = 0; i < maxLength; i++) {
      const healthRecord = healthRecords[i];
      const pensionRecord = pensionRecords[i];
      
      // どちらかのレコードがあれば、そのレコードの共通情報を使用
      const baseRecord = healthRecord || pensionRecord;
      
      this.standardCompensations.push(
        this.fb.group<StandardCompensationGroup>({
          healthInsuranceGrade: this.fb.control(healthRecord?.grade ?? ''),
          pensionGrade: this.fb.control(pensionRecord?.grade ?? ''),
          standardMonthlyCompensation: this.fb.control(baseRecord?.standardMonthlyCompensation ?? ''),
          lowerLimit: this.fb.control(baseRecord?.lowerLimit ?? ''),
          upperLimit: this.fb.control(baseRecord?.upperLimit ?? ''),
          effectiveFrom: this.fb.control(baseRecord?.effectiveFrom ?? ''),
        }),
      );
    }
    
  }

  private setBonusCaps(records: BonusCap[]): void {
    this.bonusCaps.clear();
    
    // 健康保険と厚生年金のレコードをマージ
    const healthRecords = records.filter(r => r.insuranceType === '健康保険');
    const pensionRecords = records.filter(r => r.insuranceType === '厚生年金');
    
    const maxLength = Math.max(healthRecords.length, pensionRecords.length);
    
    for (let i = 0; i < maxLength; i++) {
      const healthRecord = healthRecords[i];
      const pensionRecord = pensionRecords[i];
      
      this.bonusCaps.push(
        this.fb.group<BonusCapGroup>({
          yearlyCap: this.fb.control(healthRecord?.yearlyCap ?? ''),
          yearlyCapEffectiveFrom: this.fb.control(healthRecord?.yearlyCapEffectiveFrom ?? ''),
          monthlyCap: this.fb.control(pensionRecord?.monthlyCap ?? ''),
          monthlyCapEffectiveFrom: this.fb.control(pensionRecord?.monthlyCapEffectiveFrom ?? ''),
        }),
      );
    }
    
  }

  addRate(target: 'healthInsuranceRates' | 'nursingCareRates'): void {
    const array = this.form.get(target) as FormArray<FormGroup<RateFormGroup>>;
    const group = this.fb.group<RateFormGroup>({
      prefecture: this.fb.control('', Validators.required),
      totalRate: this.fb.control(''),
      employeeRate: this.fb.control(''),
      effectiveFrom: this.fb.control(''),
    });
    
    // 総保険料率が変更されたときに従業員負担率を自動計算
    group.get('totalRate')?.valueChanges.subscribe((totalRate) => {
      if (totalRate) {
        const numValue = parseFloat(totalRate);
        if (!isNaN(numValue)) {
          const employeeRate = (numValue / 2).toString();
          group.get('employeeRate')?.setValue(employeeRate, { emitEvent: false });
        }
      } else {
        group.get('employeeRate')?.setValue('', { emitEvent: false });
      }
    });
    
    array.push(group);
  }

  removeRate(target: 'healthInsuranceRates' | 'nursingCareRates', index: number): void {
    const array = this.form.get(target) as FormArray<FormGroup<RateFormGroup>>;
    array.removeAt(index);
  }

  onHealthInsuranceCsvUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        this.parseAndSetHealthInsuranceRates(text);
        this.message = 'CSVファイルを読み込みました。';
        input.value = ''; // 同じファイルを再度選択できるようにリセット
      } catch (error) {
        console.error(error);
        this.message = 'CSVファイルの読み込みに失敗しました。形式を確認してください。';
      }
    };
    reader.onerror = () => {
      this.message = 'ファイルの読み込みに失敗しました。';
      input.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  }

  private parseAndSetHealthInsuranceRates(csvText: string): void {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      throw new Error('CSVファイルが空です');
    }

    // ヘッダー行を確認（オプション）
    let startIndex = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('都道府県') || firstLine.includes('prefecture')) {
      startIndex = 1; // ヘッダー行をスキップ
    }

    const rates: PrefectureRate[] = [];
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // CSVのパース（カンマ区切り、ダブルクォート対応）
      const columns = this.parseCsvLine(line);
      if (columns.length < 1) continue;

      const prefecture = columns[0]?.trim() || '';
      const totalRate = columns[1]?.trim() || '';
      const employeeRate = columns[2]?.trim() || '';
      const effectiveFrom = columns[3]?.trim() || '—';

      if (prefecture) {
        rates.push({
          prefecture,
          totalRate: totalRate || '—',
          employeeRate: employeeRate || '—',
          effectiveFrom: effectiveFrom || '—',
        });
      }
    }

    if (rates.length === 0) {
      throw new Error('有効なデータが見つかりませんでした');
    }

    this.setRates(this.healthInsuranceRates, rates);
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // 次の文字をスキップ
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }

  onStandardCompensationCsvUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        this.parseAndSetStandardCompensations(text);
        this.message = 'CSVファイルを読み込みました。';
        input.value = ''; // 同じファイルを再度選択できるようにリセット
      } catch (error) {
        console.error(error);
        this.message = 'CSVファイルの読み込みに失敗しました。形式を確認してください。';
      }
    };
    reader.onerror = () => {
      this.message = 'ファイルの読み込みに失敗しました。';
      input.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  }

  private parseAndSetStandardCompensations(csvText: string): void {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      throw new Error('CSVファイルが空です');
    }

    // ヘッダー行を確認（オプション）
    let startIndex = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('健康保険等級') || firstLine.includes('health') || 
        firstLine.includes('厚生年金等級') || firstLine.includes('pension') ||
        firstLine.includes('標準報酬月額') || firstLine.includes('standard') ||
        firstLine.includes('等級')) {
      startIndex = 1; // ヘッダー行をスキップ
    }

    const compensations: Array<{
      healthInsuranceGrade: string;
      pensionGrade: string;
      standardMonthlyCompensation: string;
      lowerLimit: string;
      upperLimit: string;
      effectiveFrom: string;
    }> = [];
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // CSVのパース（カンマ区切り、ダブルクォート対応）
      const columns = this.parseCsvLine(line);
      if (columns.length < 1) continue;

      const healthInsuranceGrade = columns[0]?.trim() || '';
      const pensionGrade = columns[1]?.trim() || '';
      const standardMonthlyCompensation = columns[2]?.trim() || '';
      const lowerLimit = columns[3]?.trim() || '';
      const upperLimit = columns[4]?.trim() || '';
      const effectiveFrom = columns[5]?.trim() || '—';

      // 健康保険等級または厚生年金等級のいずれかがあれば追加
      if (healthInsuranceGrade || pensionGrade) {
        compensations.push({
          healthInsuranceGrade: healthInsuranceGrade || '—',
          pensionGrade: pensionGrade || '—',
          standardMonthlyCompensation: standardMonthlyCompensation || '—',
          lowerLimit: lowerLimit || '—',
          upperLimit: upperLimit || '—',
          effectiveFrom: effectiveFrom || '—',
        });
      }
    }

    if (compensations.length === 0) {
      throw new Error('有効なデータが見つかりませんでした');
    }

    // フォームに設定
    this.standardCompensations.clear();
    compensations.forEach((comp) => {
      this.standardCompensations.push(
        this.fb.group<StandardCompensationGroup>({
          healthInsuranceGrade: this.fb.control(comp.healthInsuranceGrade),
          pensionGrade: this.fb.control(comp.pensionGrade),
          standardMonthlyCompensation: this.fb.control(comp.standardMonthlyCompensation),
          lowerLimit: this.fb.control(comp.lowerLimit ?? null),
          upperLimit: this.fb.control(comp.upperLimit ?? null),
          effectiveFrom: this.fb.control(comp.effectiveFrom),
        }),
      );
    });
  }

  addStandardCompensation(): void {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    this.standardCompensations.push(
      this.fb.group<StandardCompensationGroup>({
        healthInsuranceGrade: this.fb.control(''),
        pensionGrade: this.fb.control(''),
        standardMonthlyCompensation: this.fb.control(''),
        lowerLimit: this.fb.control(''),
        upperLimit: this.fb.control(''),
        effectiveFrom: this.fb.control(defaultMonth),
      }),
    );
  }

  removeStandardCompensation(index: number): void {
    this.standardCompensations.removeAt(index);
  }

  addBonusCap(): void {
    this.bonusCaps.push(
      this.fb.group<BonusCapGroup>({
        yearlyCap: this.fb.control(''),
        yearlyCapEffectiveFrom: this.fb.control(''),
        monthlyCap: this.fb.control(''),
        monthlyCapEffectiveFrom: this.fb.control(''),
      }),
    );
  }

  removeBonusCap(index: number): void {
    this.bonusCaps.removeAt(index);
  }

  startNewRecord(): void {
    this.viewingRecord = undefined;
    this.editMode = true;
    this.form.reset({
      id: '',
      healthType: this.selectedHealthType,
      insurerName: '',
    });
    this.populateForm();
  }

  viewHistory(record: InsuranceRateRecord): void {
    this.viewingRecord = record;
    this.populateForm(record);
    this.editMode = false;
    this.message = this.isLatestSelection
      ? ''
      : '過去の履歴は参照のみです。修正する場合は最新のレコードを編集してください。';
  }

  enableEdit(): void {
    if (!this.isLatestSelection) {
      return;
    }
    this.editMode = true;
    this.message = '最新レコードを編集しています。新規登録も可能です。';
  }

  cancelEdit(): void {
    if (this.viewingRecord) {
      this.populateForm(this.viewingRecord);
    }
    this.editMode = false;
    this.message = '';
  }

  async save(): Promise<void> {
    // 都道府県が入力されている行のみを有効な行として扱う
    const healthInsuranceRatesValue = this.form.get('healthInsuranceRates')?.value || [];
    const validHealthInsuranceRates = healthInsuranceRatesValue.filter((r: any) => r.prefecture && r.prefecture.trim() !== '');
    
    // 都道府県が入力されている行が1つ以上あることを確認
    if (validHealthInsuranceRates.length === 0) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（都道府県別健康保険料率：少なくとも1行、都道府県を入力してください）';
      return;
    }
    
    // 介護保険料率も同様にチェック
    const nursingCareRatesValue = this.form.get('nursingCareRates')?.value || [];
    const validNursingCareRates = nursingCareRatesValue.filter((r: any) => 
      (r.totalRate && r.totalRate.trim() !== '') || 
      (r.employeeRate && r.employeeRate.trim() !== '') || 
      (r.effectiveFrom && r.effectiveFrom.trim() !== '')
    );
    
    if (validNursingCareRates.length === 0 && nursingCareRatesValue.length > 0) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（介護保険料率：少なくとも1行、データを入力してください）';
      return;
    }
    
    // その他の必須項目をチェック
    if (this.form.get('healthType')?.invalid) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（健康保険パターン）';
      return;
    }
    
    if (this.form.get('pensionRate')?.invalid) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（厚生年金保険料率）';
      return;
    }
    
    if (this.standardCompensations.length === 0) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（標準報酬等級：少なくとも1行必要）';
      return;
    }
    
    if (this.bonusCaps.length === 0) {
      this.form.markAllAsTouched();
      this.message = '必須項目を入力してください。（標準賞与額上限：少なくとも1行必要）';
      return;
    }

    this.saving = true;
    this.message = '';

    const formValue = this.form.getRawValue();
    const payload: InsuranceRatePayload = {
      id: formValue.id || undefined,
      healthType: formValue.healthType!,
      insurerName: formValue.insurerName ?? undefined,
      // 都道府県が入力されている行のみを保存対象とする
      healthInsuranceRates: (formValue.healthInsuranceRates ?? [])
        .filter((r: any) => r.prefecture && r.prefecture.trim() !== '')
        .map((r) => ({
          prefecture: r.prefecture ?? '',
          totalRate: r.totalRate ?? undefined,
          employeeRate: r.employeeRate ?? undefined,
          effectiveFrom: r.effectiveFrom ?? undefined,
        })),
      // 介護保険料率も同様に、有効な行のみを保存対象とする
      nursingCareRates: (formValue.nursingCareRates ?? [])
        .filter((r: any) => r.totalRate || r.employeeRate || r.effectiveFrom)
        .map((r) => ({
          prefecture: r.prefecture ?? '',
          totalRate: r.totalRate ?? undefined,
          employeeRate: r.employeeRate ?? undefined,
          effectiveFrom: r.effectiveFrom ?? undefined,
        })),
      pensionRate: {
        totalRate: formValue.pensionRate?.totalRate ?? undefined,
        employeeRate: formValue.pensionRate?.employeeRate ?? undefined,
        effectiveFrom: formValue.pensionRate?.effectiveFrom ?? undefined,
      },
      standardCompensations: (formValue.standardCompensations ?? []).flatMap((r) => {
        const result: StandardCompensationGrade[] = [];
        // 健康保険の等級がある場合は健康保険レコードを追加
        if (r.healthInsuranceGrade) {
          result.push({
            insuranceType: '健康保険',
            grade: r.healthInsuranceGrade ?? '',
            standardMonthlyCompensation: r.standardMonthlyCompensation ?? undefined,
            lowerLimit: r.lowerLimit ?? undefined,
            upperLimit: r.upperLimit ?? undefined,
            effectiveFrom: r.effectiveFrom ?? undefined,
          });
        }
        // 厚生年金の等級がある場合は厚生年金レコードを追加
        if (r.pensionGrade) {
          result.push({
            insuranceType: '厚生年金',
            grade: r.pensionGrade ?? '',
            standardMonthlyCompensation: r.standardMonthlyCompensation ?? undefined,
            lowerLimit: r.lowerLimit ?? undefined,
            upperLimit: r.upperLimit ?? undefined,
            effectiveFrom: r.effectiveFrom ?? undefined,
          });
        }
        return result;
      }),
      bonusCaps: (formValue.bonusCaps ?? []).flatMap((r) => {
        const result: BonusCap[] = [];
        // 健康保険の年度累計上限がある場合は健康保険レコードを追加
        if (r.yearlyCap || r.yearlyCapEffectiveFrom) {
          result.push({
            insuranceType: '健康保険',
            yearlyCap: r.yearlyCap ?? undefined,
            yearlyCapEffectiveFrom: r.yearlyCapEffectiveFrom ?? undefined,
          });
        }
        // 厚生年金の月額上限がある場合は厚生年金レコードを追加
        if (r.monthlyCap || r.monthlyCapEffectiveFrom) {
          result.push({
            insuranceType: '厚生年金',
            monthlyCap: r.monthlyCap ?? undefined,
            monthlyCapEffectiveFrom: r.monthlyCapEffectiveFrom ?? undefined,
          });
        }
        return result;
      }),
    };

    try {
      await this.insuranceRatesService.saveRates(payload);
      this.message = '保険料率を保存しました。履歴が更新されました。';
      this.editMode = false;
      this.loadHistory();
    } catch (error) {
      console.error(error);
      this.message = '保存に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.saving = false;
    }
  }
}

type RateFormGroup = {
  prefecture: FormControl<string | null>;
  totalRate: FormControl<string | null>;
  employeeRate: FormControl<string | null>;
  effectiveFrom: FormControl<string | null>;
};

type RateGroup = {
  totalRate: FormControl<string | null>;
  employeeRate: FormControl<string | null>;
  effectiveFrom: FormControl<string | null>;
};

type StandardCompensationGroup = {
  healthInsuranceGrade: FormControl<string | null>;
  pensionGrade: FormControl<string | null>;
  standardMonthlyCompensation: FormControl<string | null>;
  lowerLimit: FormControl<string | null>;
  upperLimit: FormControl<string | null>;
  effectiveFrom: FormControl<string | null>;
};

type BonusCapGroup = {
  yearlyCap: FormControl<string | null>;
  yearlyCapEffectiveFrom: FormControl<string | null>;
  monthlyCap: FormControl<string | null>;
  monthlyCapEffectiveFrom: FormControl<string | null>;
};