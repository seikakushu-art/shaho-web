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
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { ApprovalAttachmentService } from '../approvals/approval-attachment.service';
import { FlowSelectorComponent } from '../approvals/flow-selector/flow-selector.component';
import { ApprovalFlow, ApprovalHistory, ApprovalRequest, ApprovalEmployeeDiff, ApprovalNotification, ApprovalAttachmentMetadata } from '../models/approvals';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth.service';
import { RoleKey } from '../models/roles';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-insurance-rates',
  standalone: true,
  imports: [DatePipe, NgFor, NgIf, ReactiveFormsModule, FormsModule, FlowSelectorComponent],
  templateUrl: './insurance-rates.component.html',
  styleUrl: './insurance-rates.component.scss',
})
export class InsuranceRatesComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private insuranceRatesService = inject(InsuranceRatesService);
  private corporateInfoService = inject(CorporateInfoService);
  private approvalWorkflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private authService = inject(AuthService);
  readonly attachmentService = inject(ApprovalAttachmentService);

  readonly healthTypes: HealthInsuranceType[] = ['協会けんぽ', '組合健保'];
  message = '';
  editMode = false;
  saving = false;
  selectedHealthType: HealthInsuranceType = '協会けんぽ';
  latestRecord?: InsuranceRateRecord;
  viewingRecord?: InsuranceRateRecord;
  historyRecords: InsuranceRateRecord[] = [];
  selectedFlow?: ApprovalFlow;
  selectedFlowId: string | null = null;
  applicantId = '';
  applicantName = '';
  approvalRequestId: string | null = null;
  awaitingApproval = false;
  isSystemAdmin = false;
  private pendingPayload?: InsuranceRatePayload;
  requestComment = '';
  selectedFiles: File[] = [];
  validationErrors: string[] = [];

  private historySub?: Subscription;
  private approvalSubscription?: Subscription;

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
    void firstValueFrom(this.authService.user$).then((user) => {
      this.applicantId = user?.email ?? 'system-admin';
      this.applicantName = user?.displayName ?? user?.email ?? 'システム管理者';
    });

    void firstValueFrom(this.authService.userRoles$).then((roles) => {
      this.isSystemAdmin = roles.includes(RoleKey.SystemAdmin);
    });
  }

  ngOnDestroy(): void {
    this.historySub?.unsubscribe();
    this.approvalSubscription?.unsubscribe();
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
          this.message = 'まだ保険料率が登録されていません。';
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
  onFlowSelected(flow?: ApprovalFlow): void {
    this.selectedFlow = flow ?? undefined;
    this.selectedFlowId = flow?.id ?? null;
  }

  onFlowsUpdated(flows: ApprovalFlow[]): void {
    if (!this.selectedFlow && flows[0]) {
      this.selectedFlow = flows[0];
      this.selectedFlowId = flows[0].id ?? null;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) {
      input.value = '';
      return;
    }

    const merged = [...this.selectedFiles, ...files];
    const validation = this.attachmentService.validateFiles(merged);
    this.validationErrors = validation.errors;
    this.selectedFiles = validation.files;

    if (!validation.valid) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
    }

    input.value = '';
  }

  removeFile(index: number): void {
    this.selectedFiles.splice(index, 1);
    this.selectedFiles = [...this.selectedFiles];
    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;
  }

  totalSelectedSize(): number {
    return this.selectedFiles.reduce((sum, file) => sum + file.size, 0);
  }

  formatFileSize(size: number): string {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
  }


  viewHistory(record: InsuranceRateRecord): void {
    this.viewingRecord = record;
    this.populateForm(record);
    this.editMode = false;
    this.message = this.isLatestSelection
      ? ''
      : '過去の履歴は参照のみです。';
  }

  enableEdit(): void {
    // 履歴を表示している場合は、最新レコードに切り替えて編集モードに入る
    if (!this.isLatestSelection && this.latestRecord) {
      this.viewingRecord = this.latestRecord;
      this.populateForm(this.latestRecord);
    }
    this.editMode = true;
    this.message = '最新レコードを編集しています。';
  }

  cancelEdit(): void {
    if (this.viewingRecord) {
      this.populateForm(this.viewingRecord);
    }
    this.editMode = false;
    this.message = '';
    this.selectedFiles = [];
    this.validationErrors = [];
    this.requestComment = '';
  }

  async save(): Promise<void> {
    if (this.awaitingApproval) {
      this.message = '承認結果待ちのため新しい承認依頼を送信できません。';
      return;
    }

    // 既存の承認待ちリクエストをチェック
    const existingPendingRequest = this.approvalWorkflowService.getPendingRequestForInsuranceRates();
    if (existingPendingRequest) {
      const requestTitle = existingPendingRequest.title || '承認待ちの申請';
      this.message = `保険料率には既に承認待ちの申請が存在します（${requestTitle}）。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。`;
      return;
    }

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

    const roles = await firstValueFrom(this.authService.userRoles$);
    if (!roles.includes(RoleKey.SystemAdmin)) {
      this.message = 'システム管理者のみ保険料率の承認依頼を起票できます。';
      return;
    }

    if (!this.selectedFlow) {
      this.message = '承認フローを選択してください。';
      return;
    }

    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;

    if (!validation.valid && this.selectedFiles.length) {
      this.message = validation.errors[0] ?? '添付ファイルの条件を確認してください。';
      return;
    }

    const formValue = this.form.getRawValue();
    const payload: InsuranceRatePayload = {
      // 履歴を保持するため、常に新しいレコードとして保存（idはundefined）
      id: undefined,
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
        // 健康保険の等級がある場合は健康保険レコードを追加（空文字、「—」、null、undefinedを除外）
        const healthGrade = r.healthInsuranceGrade?.trim();
        if (healthGrade && healthGrade !== '—' && healthGrade !== '-') {
          result.push({
            insuranceType: '健康保険',
            grade: healthGrade,
            standardMonthlyCompensation: r.standardMonthlyCompensation ?? undefined,
            lowerLimit: r.lowerLimit ?? undefined,
            upperLimit: r.upperLimit ?? undefined,
            effectiveFrom: r.effectiveFrom ?? undefined,
          });
        }
        // 厚生年金の等級がある場合は厚生年金レコードを追加（空文字、「—」、null、undefinedを除外）
        const pensionGrade = r.pensionGrade?.trim();
        if (pensionGrade && pensionGrade !== '—' && pensionGrade !== '-') {
          result.push({
            insuranceType: '厚生年金',
            grade: pensionGrade,
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

    const history: ApprovalHistory = {
      id: `hist-${Date.now()}`,
      statusAfter: 'pending',
      action: 'apply',
      actorId: this.applicantId,
      actorName: this.applicantName,
      comment: this.requestComment || `${payload.healthType} の保険料率を更新します。`,
      attachments: [],
      createdAt: Timestamp.fromDate(new Date()),
    };
    const steps = this.selectedFlow.steps.map((step) => ({
      stepOrder: step.order,
      status: 'waiting' as const,
    }));
    const targetCount =
      payload.healthInsuranceRates.length +
      payload.nursingCareRates.length +
      payload.standardCompensations.length +
      payload.bonusCaps.length +
      1; // 年金料率含む

    // 保険料率の差分を計算
    const changes = this.calculateInsuranceRateChanges(this.latestRecord, payload);

    // 差分が検出されなかった場合でも、サマリ差分を1件入れて主要差分を表示する
    if (changes.length === 0) {
      const summarize = (data: { healthInsuranceRates?: any[]; nursingCareRates?: any[]; pensionRate?: any; standardCompensations?: any[]; bonusCaps?: any[]; insurerName?: string; healthType?: string; }) => {
        return `保険者: ${data.insurerName ?? data.healthType ?? '—'} / 健康: ${(data.healthInsuranceRates ?? []).length}件 / 介護: ${(data.nursingCareRates ?? []).length}件 / 年金: ${data.pensionRate ? 'あり' : 'なし'} / 等級: ${(data.standardCompensations ?? []).length}件 / 賞与上限: ${(data.bonusCaps ?? []).length}件`;
      };
      changes.push({
        field: '保険料率の変更',
        oldValue: this.latestRecord ? summarize(this.latestRecord) : null,
        newValue: summarize(payload),
      });
    }

    console.log('保険料率の差分計算結果:', changes);
    console.log('既存レコード:', this.latestRecord);
    console.log('新しいデータ:', payload);
    
    const employeeDiffs: ApprovalEmployeeDiff[] = [
      {
        employeeNo: '保険料率',
        name: payload.insurerName || payload.healthType || '保険料率',
        status: 'ok',
        changes: changes,
      },
    ];
    console.log('employeeDiffs:', employeeDiffs);

    const createdAt = new Date();
    const dueDate = new Date(createdAt);
    dueDate.setDate(dueDate.getDate() + 14);

    const request: ApprovalRequest = {
      title: `保険料率更新（${payload.healthType}）`,
      category: '保険料率更新',
      targetCount: targetCount || 1,
      applicantId: this.applicantId,
      applicantName: this.applicantName,
      flowId: this.selectedFlow.id ?? 'insurance-rates-flow',
      flowSnapshot: this.selectedFlow,
      status: 'pending',
      currentStep: this.selectedFlow.steps[0]?.order,
      comment: this.requestComment || (payload.insurerName
        ? `${payload.insurerName} の料率更新`
        : '保険料率更新の承認を依頼します。'),
      steps,
      histories: [history],
      attachments: [],
      employeeDiffs,
      insuranceRateData: {
        id: payload.id,
        healthType: payload.healthType,
        insurerName: payload.insurerName,
        healthInsuranceRates: payload.healthInsuranceRates,
        nursingCareRates: payload.nursingCareRates,
        pensionRate: payload.pensionRate,
        standardCompensations: payload.standardCompensations,
        bonusCaps: payload.bonusCaps,
      },
      createdAt: Timestamp.fromDate(createdAt),
      dueDate: Timestamp.fromDate(dueDate),
    };

    this.pendingPayload = payload;
    this.saving = true;

    try {
      // まずrequestを保存してIDを取得
      const savedBase = await this.approvalWorkflowService.saveRequest(request);
      
      let uploaded: ApprovalAttachmentMetadata[] = [];

      // 添付ファイルをアップロード
      if (validation.files.length && savedBase.id) {
        uploaded = await this.attachmentService.upload(
          savedBase.id,
          validation.files,
          this.applicantId,
          this.applicantName,
        );
      }

      // 添付ファイルを含むhistoryを作成
      const applyHistory: ApprovalHistory = {
        id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        statusAfter: 'pending',
        action: 'apply',
        actorId: this.applicantId,
        actorName: this.applicantName,
        comment: this.requestComment || undefined,
        attachments: uploaded,
        createdAt: Timestamp.fromDate(new Date()),
      };

      // 添付ファイルとhistoryを含む完全なrequestを作成
      // savedBaseにemployeeDiffsが含まれていない場合があるため、明示的に設定
      const completeRequest: ApprovalRequest = {
        ...savedBase,
        attachments: uploaded,
        histories: [applyHistory],
        employeeDiffs: savedBase.employeeDiffs || request.employeeDiffs, // employeeDiffsを保持
      };
      console.log('completeRequest.employeeDiffs:', completeRequest.employeeDiffs);
      console.log('completeRequest.employeeDiffs[0].changes:', completeRequest.employeeDiffs?.[0]?.changes);

      // startApprovalProcessに渡す（内部でsaveRequestが呼ばれるが、既に保存済みのIDがあるので更新される）
      // 注意: 反映処理は承認側（approval-detail.component.ts）で実行されるため、
      // ここでは反映処理を行わない（二重実行を防ぐため）
      const result = await this.approvalWorkflowService.startApprovalProcess({
      request: completeRequest,
      onApproved: async () => {
        // 承認完了時の通知のみ（反映処理は承認側で実行）
        console.log('承認が完了しました。反映処理は承認側で実行されます。');
      },
      onFailed: () => {
        this.awaitingApproval = false;
        this.pendingPayload = undefined;
        this.approvalRequestId = null;
      },
      setMessage: (message) => (this.message = message),
      setLoading: (loading) => (this.saving = loading),
    });

    if (result) {
      this.approvalRequestId = result.requestId;
      this.approvalSubscription?.unsubscribe();
      this.approvalSubscription = result.subscription;
      this.awaitingApproval = true;
      
      // メッセージを表示してから少し待ってからeditModeをfalseにする
      setTimeout(() => {
        this.editMode = false;
        // メッセージ表示位置をスクロール
        setTimeout(() => {
          const messageElement = document.querySelector('.message');
          if (messageElement) {
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }, 500);
      
      // 通知を送信
      this.pushApprovalNotifications(completeRequest, result.requestId);
    }
    } catch (error) {
      const message = error instanceof Error ? error.message : '承認依頼の送信に失敗しました。';
      console.error(message, error);
      this.message = message;
      this.saving = false;
    }
  }

  private pushApprovalNotifications(request: ApprovalRequest, requestId: string): void {
    const notifications: ApprovalNotification[] = [];

    const applicantNotification: ApprovalNotification = {
      id: `ntf-${Date.now()}`,
      requestId: requestId,
      recipientId: request.applicantId,
      message: `${request.title} を起票しました（${request.targetCount}件）。`,
      unread: true,
      createdAt: new Date(),
      type: 'info',
    };
    notifications.push(applicantNotification);

    const currentStep = request.steps.find((step) => step.stepOrder === request.currentStep);
    const candidates = currentStep
      ? request.flowSnapshot?.steps.find((step) => step.order === currentStep.stepOrder)?.candidates ?? []
      : [];

    candidates.forEach((candidate) => {
      notifications.push({
        id: `ntf-${Date.now()}-${candidate.id}`,
        requestId: requestId,
        recipientId: candidate.id,
        message: `${request.title} の承認依頼が届いています。`,
        unread: true,
        createdAt: new Date(),
        type: 'info',
      });
    });

    if (notifications.length) {
      this.notificationService.pushBatch(notifications);
    }
  }

  /**
   * 保険料率の差分を計算
   */
  private calculateInsuranceRateChanges(
    existing: InsuranceRateRecord | undefined,
    newData: InsuranceRatePayload,
  ): { field: string; oldValue: string | null; newValue: string | null }[] {
    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    // 保険者名称の差分
    if (existing?.insurerName !== newData.insurerName) {
      changes.push({
        field: '保険者名称',
        oldValue: existing?.insurerName ?? null,
        newValue: newData.insurerName ?? null,
      });
    }

    // 都道府県別健康保険料率の差分
    const existingHealthRates = existing?.healthInsuranceRates || [];
    const newHealthRates = newData.healthInsuranceRates || [];
    
    // 既存の都道府県と新しい都道府県を比較
    const allPrefectures = new Set([
      ...existingHealthRates.map(r => r.prefecture).filter(p => p),
      ...newHealthRates.map(r => r.prefecture).filter(p => p),
    ]);

    // 都道府県が存在する場合のみ差分を計算
    if (allPrefectures.size > 0) {
      for (const prefecture of allPrefectures) {
        const existingRate = existingHealthRates.find(r => r.prefecture === prefecture);
        const newRate = newHealthRates.find(r => r.prefecture === prefecture);

        if (!existingRate && newRate) {
          // 新規追加
          changes.push({
            field: `健康保険料率（${prefecture}）`,
            oldValue: null,
            newValue: `総率: ${newRate.totalRate || '—'}, 従業員負担: ${newRate.employeeRate || '—'}, 適用開始: ${newRate.effectiveFrom || '—'}`,
          });
        } else if (existingRate && !newRate) {
          // 削除
          changes.push({
            field: `健康保険料率（${prefecture}）`,
            oldValue: `総率: ${existingRate.totalRate || '—'}, 従業員負担: ${existingRate.employeeRate || '—'}, 適用開始: ${existingRate.effectiveFrom || '—'}`,
            newValue: null,
          });
        } else if (existingRate && newRate) {
          // 変更チェック
          if (
            existingRate.totalRate !== newRate.totalRate ||
            existingRate.employeeRate !== newRate.employeeRate ||
            existingRate.effectiveFrom !== newRate.effectiveFrom
          ) {
            changes.push({
              field: `健康保険料率（${prefecture}）`,
              oldValue: `総率: ${existingRate.totalRate || '—'}, 従業員負担: ${existingRate.employeeRate || '—'}, 適用開始: ${existingRate.effectiveFrom || '—'}`,
              newValue: `総率: ${newRate.totalRate || '—'}, 従業員負担: ${newRate.employeeRate || '—'}, 適用開始: ${newRate.effectiveFrom || '—'}`,
            });
          }
        }
      }
    } else if (newHealthRates.length > 0 || existingHealthRates.length > 0) {
      // 都道府県が設定されていないが、データが存在する場合
      if (newHealthRates.length !== existingHealthRates.length) {
        changes.push({
          field: '健康保険料率（件数）',
          oldValue: existing ? String(existingHealthRates.length) : null,
          newValue: String(newHealthRates.length),
        });
      }
    }

    // 介護保険料率の差分
    const existingNursingRates = existing?.nursingCareRates || [];
    const newNursingRates = newData.nursingCareRates || [];
    
    // 既存レコードがない場合、または件数が異なる場合
    if (!existing || existingNursingRates.length !== newNursingRates.length) {
      changes.push({
        field: '介護保険料率（件数）',
        oldValue: existing ? String(existingNursingRates.length) : null,
        newValue: String(newNursingRates.length),
      });
    }
    
    // 介護保険料率の詳細差分（既存レコードがある場合のみ）
    if (existing && existingNursingRates.length === newNursingRates.length) {
      for (let i = 0; i < newNursingRates.length; i++) {
        const existingRate = existingNursingRates[i];
        const newRate = newNursingRates[i];
        if (
          existingRate?.totalRate !== newRate?.totalRate ||
          existingRate?.employeeRate !== newRate?.employeeRate ||
          existingRate?.effectiveFrom !== newRate?.effectiveFrom
        ) {
          changes.push({
            field: `介護保険料率（${i + 1}件目）`,
            oldValue: existingRate
              ? `総率: ${existingRate.totalRate || '—'}, 従業員負担: ${existingRate.employeeRate || '—'}, 適用開始: ${existingRate.effectiveFrom || '—'}`
              : null,
            newValue: newRate
              ? `総率: ${newRate.totalRate || '—'}, 従業員負担: ${newRate.employeeRate || '—'}, 適用開始: ${newRate.effectiveFrom || '—'}`
              : null,
          });
        }
      }
    }

    // 厚生年金保険料率の差分
    const existingPension = existing?.pensionRate;
    const newPension = newData.pensionRate;
    
    // 既存レコードがない場合、または値が異なる場合
    if (
      !existing ||
      !existingPension ||
      existingPension?.totalRate !== newPension?.totalRate ||
      existingPension?.employeeRate !== newPension?.employeeRate ||
      existingPension?.effectiveFrom !== newPension?.effectiveFrom
    ) {
      changes.push({
        field: '厚生年金保険料率',
        oldValue: existingPension
          ? `総率: ${existingPension.totalRate || '—'}, 従業員負担: ${existingPension.employeeRate || '—'}, 適用開始: ${existingPension.effectiveFrom || '—'}`
          : null,
        newValue: newPension
          ? `総率: ${newPension.totalRate || '—'}, 従業員負担: ${newPension.employeeRate || '—'}, 適用開始: ${newPension.effectiveFrom || '—'}`
          : null,
      });
    }

    // 標準報酬等級の差分
    const existingStandard = existing?.standardCompensations || [];
    const newStandard = newData.standardCompensations || [];
    
    if (!existing || existingStandard.length !== newStandard.length) {
      changes.push({
        field: '標準報酬等級（件数）',
        oldValue: existing ? String(existingStandard.length) : null,
        newValue: String(newStandard.length),
      });
    }

    // 標準賞与額上限の差分（値単位で比較）
    const existingBonus = existing?.bonusCaps || [];
    const newBonus = newData.bonusCaps || [];

    const existingHealthBonus = existingBonus.find((b) => b.insuranceType === '健康保険');
    const existingPensionBonus = existingBonus.find((b) => b.insuranceType === '厚生年金');
    const newHealthBonus = newBonus.find((b) => b.insuranceType === '健康保険');
    const newPensionBonus = newBonus.find((b) => b.insuranceType === '厚生年金');

    // 健康保険ー年度累計上限
    if (
      (existingHealthBonus?.yearlyCap ?? null) !== (newHealthBonus?.yearlyCap ?? null) ||
      (existingHealthBonus?.yearlyCapEffectiveFrom ?? null) !== (newHealthBonus?.yearlyCapEffectiveFrom ?? null)
    ) {
      changes.push({
        field: '健康保険ー年度累計上限',
        oldValue:
          existingHealthBonus?.yearlyCap != null
            ? `${existingHealthBonus.yearlyCap}（適用開始: ${existingHealthBonus.yearlyCapEffectiveFrom || '—'}）`
            : null,
        newValue:
          newHealthBonus?.yearlyCap != null
            ? `${newHealthBonus.yearlyCap}（適用開始: ${newHealthBonus.yearlyCapEffectiveFrom || '—'}）`
            : null,
      });
    }

    // 厚生年金ー月額上限
    if (
      (existingPensionBonus?.monthlyCap ?? null) !== (newPensionBonus?.monthlyCap ?? null) ||
      (existingPensionBonus?.monthlyCapEffectiveFrom ?? null) !== (newPensionBonus?.monthlyCapEffectiveFrom ?? null)
    ) {
      changes.push({
        field: '厚生年金ー月額上限',
        oldValue:
          existingPensionBonus?.monthlyCap != null
            ? `${existingPensionBonus.monthlyCap}（適用開始: ${existingPensionBonus.monthlyCapEffectiveFrom || '—'}）`
            : null,
        newValue:
          newPensionBonus?.monthlyCap != null
            ? `${newPensionBonus.monthlyCap}（適用開始: ${newPensionBonus.monthlyCapEffectiveFrom || '—'}）`
            : null,
      });
    }

    return changes;
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