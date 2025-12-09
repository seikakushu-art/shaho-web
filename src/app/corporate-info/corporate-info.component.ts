import { AsyncPipe, DatePipe, NgIf, CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RoleKey } from '../models/roles';
import {
  CorporateInfo,
  CorporateInfoPayload,
  CorporateInfoService,
  HealthInsuranceType,
} from '../app/services/corporate-info.service';
import {  Subscription, firstValueFrom, map, tap } from 'rxjs';
import { FlowSelectorComponent } from '../approvals/flow-selector/flow-selector.component';
import { ApprovalFlow, ApprovalHistory, ApprovalRequest, ApprovalEmployeeDiff, ApprovalNotification, ApprovalAttachmentMetadata } from '../models/approvals';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { ApprovalAttachmentService } from '../approvals/approval-attachment.service';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-corporate-info',
  standalone: true,
  imports: [
    CommonModule,
    AsyncPipe,
    DatePipe,
    NgIf,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    FlowSelectorComponent,
  ],
  templateUrl: './corporate-info.component.html',
  styleUrl: './corporate-info.component.scss',
})
export class CorporateInfoComponent implements OnInit, OnDestroy  {
  private fb = inject(FormBuilder);
  private corporateInfoService = inject(CorporateInfoService);
  private authService = inject(AuthService);
  private approvalWorkflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  readonly attachmentService = inject(ApprovalAttachmentService);

  readonly RoleKey = RoleKey;
  editMode = false;
  isSaving = false;
  message = '';
  currentInfo: CorporateInfo | null = null;
  selectedFlow?: ApprovalFlow;
  selectedFlowId: string | null = null;
  flows: ApprovalFlow[] = [];
  applicantId = '';
  applicantName = '';
  pendingPayload?: CorporateInfoPayload;
  pendingRequestId?: string;
  approvalSubscription?: Subscription;
  requestComment = '';
  selectedFiles: File[] = [];
  validationErrors: string[] = [];

  readonly form = this.fb.group({
    officeName: ['', [Validators.required]],
    address: ['', [Validators.required]],
    ownerName: ['', [Validators.required]],
    phoneNumber: ['', [Validators.required]],
    healthInsuranceType: ['協会けんぽ' as HealthInsuranceType, Validators.required],
    healthInsuranceOfficeCode: [''],
    pensionOfficeCode: [''],
    sharedOfficeNumber: [''],
    insurerNumber: [''],
    approvedBy: [''],
  });

  readonly role$ = this.authService.role$;
  readonly isSystemAdmin$ = this.authService.userRoles$.pipe(
    tap((roles) => {
      if (!roles.includes(RoleKey.SystemAdmin)) {
        this.editMode = false;
      }
    }),
    map((roles) => roles.includes(RoleKey.SystemAdmin)),
  );

  readonly corporateInfo$ = this.corporateInfoService.getCorporateInfo().pipe(
    tap((info) => {
      this.currentInfo = info;
      if (info) {
        this.form.patchValue({
          officeName: info.officeName ?? '',
          address: info.address ?? '',
          ownerName: info.ownerName ?? '',
          phoneNumber: info.phoneNumber ?? '',
          healthInsuranceType: info.healthInsuranceType ?? '協会けんぽ',
          healthInsuranceOfficeCode: info.healthInsuranceOfficeCode ?? '',
          pensionOfficeCode: info.pensionOfficeCode ?? '',
          sharedOfficeNumber: info.sharedOfficeNumber ?? '',
          insurerNumber: info.insurerNumber ?? '',
          approvedBy: info.approvedBy ?? '',
        });
      }
    }),
  );

  async ngOnInit(): Promise<void> {
    // デモデータが未作成の場合は初期登録する
    await this.corporateInfoService.ensureDemoData();
    const user = await firstValueFrom(this.authService.user$);
    this.applicantId = user?.email ?? 'system-admin';
    this.applicantName = user?.displayName ?? user?.email ?? 'システム管理者';
  }

  async toggleEdit(): Promise<void> {
    this.message = '';
    const roles = await firstValueFrom(this.authService.userRoles$);
    if (!roles.includes(RoleKey.SystemAdmin)) {
      this.message = 'システム管理者のみ編集できます。';
      return;
    }

    this.editMode = true;
  }

  cancelEdit(): void {
    this.message = '';
    this.editMode = false;
    if (this.currentInfo) {
      this.form.patchValue({
        officeName: this.currentInfo.officeName ?? '',
        address: this.currentInfo.address ?? '',
        ownerName: this.currentInfo.ownerName ?? '',
        phoneNumber: this.currentInfo.phoneNumber ?? '',
        healthInsuranceType: this.currentInfo.healthInsuranceType ?? '協会けんぽ',
        healthInsuranceOfficeCode: this.currentInfo.healthInsuranceOfficeCode ?? '',
        pensionOfficeCode: this.currentInfo.pensionOfficeCode ?? '',
        sharedOfficeNumber: this.currentInfo.sharedOfficeNumber ?? '',
        insurerNumber: this.currentInfo.insurerNumber ?? '',
        approvedBy: this.currentInfo.approvedBy ?? '',
      });
    } else {
      this.form.reset({ healthInsuranceType: '協会けんぽ' });
    }
  }

  onFlowSelected(flow?: ApprovalFlow): void {
    this.selectedFlow = flow ?? undefined;
    this.selectedFlowId = flow?.id ?? null;
  }

  onFlowsUpdated(flows: ApprovalFlow[]): void {
    this.flows = flows;
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

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message = '未入力の必須項目があります。';
      return;
    }

    const roles = await firstValueFrom(this.authService.userRoles$);
    if (!roles.includes(RoleKey.SystemAdmin)) {
      this.message = 'システム管理者のみ承認依頼を起票できます。閲覧のみ可能です。';
      return;
    }

    if (!this.selectedFlow) {
      this.message = '承認フローを選択してください。';
      return;
    }

    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;

    if (!validation.valid && this.selectedFiles.length) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
      return;
    }

    this.message = '';
    const formValue = this.form.getRawValue();
    // null を undefined に変換（CorporateInfoPayload は undefined を期待）
    const payload: CorporateInfoPayload = {
      officeName: formValue.officeName ?? undefined,
      address: formValue.address ?? undefined,
      ownerName: formValue.ownerName ?? undefined,
      phoneNumber: formValue.phoneNumber ?? undefined,
      healthInsuranceType: formValue.healthInsuranceType ?? undefined,
      healthInsuranceOfficeCode: formValue.healthInsuranceOfficeCode ?? undefined,
      pensionOfficeCode: formValue.pensionOfficeCode ?? undefined,
      sharedOfficeNumber: formValue.sharedOfficeNumber ?? undefined,
      insurerNumber: formValue.insurerNumber ?? undefined,
      approvedBy: formValue.approvedBy ?? undefined,
    };

    const steps = this.selectedFlow.steps.map((step) => ({
      stepOrder: step.order,
      status: 'waiting' as const,
    }));

    // 法人情報の差分を計算
    const employeeDiffs: ApprovalEmployeeDiff[] = [
      {
        employeeNo: '法人情報',
        name: payload.officeName || '法人情報',
        status: 'ok',
        changes: this.calculateCorporateInfoChanges(this.currentInfo, payload),
      },
    ];

    const request: ApprovalRequest = {
      title: '法人情報の更新',
      category: '法人情報更新',
      targetCount: 1,
      applicantId: this.applicantId,
      applicantName: this.applicantName,
      flowId: this.selectedFlow.id ?? 'corporate-flow',
      flowSnapshot: this.selectedFlow,
      status: 'pending',
      currentStep: this.selectedFlow.steps[0]?.order,
      comment: this.requestComment || `${payload.officeName ?? '法人情報'} の変更申請`,
      steps,
      histories: [],
      attachments: [],
      employeeDiffs,
      createdAt: Timestamp.fromDate(new Date()),
    };
    this.pendingPayload = payload;

    this.isSaving = true;
    try {
      const savedBase = await this.approvalWorkflowService.saveRequest(request);
      if (!savedBase.id) {
        throw new Error('承認依頼IDの取得に失敗しました。');
      }

      let uploaded: ApprovalAttachmentMetadata[] = [];

      if (validation.files.length && savedBase.id) {
        uploaded = await this.attachmentService.upload(
          savedBase.id,
          validation.files,
          this.applicantId,
          this.applicantName,
        );
      }

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

      const saved = await this.approvalWorkflowService.saveRequest({
        ...savedBase,
        attachments: uploaded,
        histories: [applyHistory],
      });

      this.selectedFiles = [];
      this.validationErrors = [];

      const result = await this.approvalWorkflowService.startApprovalProcess({
        request: { ...saved, id: saved.id },
        onApproved: async () => {
          if (!this.pendingPayload) return;
          await this.corporateInfoService.saveCorporateInfo(this.pendingPayload);
          this.message = '承認が完了しました。法人情報を更新しました。';
          this.editMode = false;
          this.pendingPayload = undefined;
          this.pendingRequestId = undefined;
        },
        onFailed: () => {
          this.pendingPayload = undefined;
          this.pendingRequestId = undefined;
          this.editMode = false;
        },
        setMessage: (message) => (this.message = message),
        setLoading: (loading) => (this.isSaving = loading),
      });

      if (result) {
        this.pendingRequestId = result.requestId;
        this.approvalSubscription = result.subscription;
        this.editMode = false;
        
        // 通知を送信
        this.pushApprovalNotifications({ ...saved, id: saved.id }, result.requestId);
      }
    } catch (error) {
      console.error('承認依頼エラー:', error);
      this.message = '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.isSaving = false;
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
   * 法人情報の差分を計算
   */
  private calculateCorporateInfoChanges(
    existing: CorporateInfo | null,
    newData: CorporateInfoPayload,
  ): { field: string; oldValue: string | null; newValue: string | null }[] {
    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    const fieldMap: Record<string, string> = {
      officeName: '事業所名',
      address: '住所',
      ownerName: '代表者名',
      phoneNumber: '電話番号',
      healthInsuranceType: '健康保険種別',
      healthInsuranceOfficeCode: '健康保険事業所コード',
      pensionOfficeCode: '年金事務所コード',
      sharedOfficeNumber: '共済事業所番号',
      insurerNumber: '保険者番号',
      approvedBy: '承認者',
    };

    for (const [key, label] of Object.entries(fieldMap)) {
      const oldValue = existing?.[key as keyof CorporateInfo] ?? null;
      const newValue = newData[key as keyof CorporateInfoPayload] ?? null;

      // 値が変更されている場合のみ追加
      if (oldValue !== newValue) {
        changes.push({
          field: label,
          oldValue: oldValue ? String(oldValue) : null,
          newValue: newValue ? String(newValue) : null,
        });
      }
    }

    return changes;
  }

  ngOnDestroy(): void {
    this.approvalSubscription?.unsubscribe();
  }
}