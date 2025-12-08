import { AsyncPipe, DatePipe, NgIf } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RoleKey } from '../models/roles';
import {
  CorporateInfo,
  CorporateInfoPayload,
  CorporateInfoService,
  HealthInsuranceType,
} from '../app/services/corporate-info.service';
import { firstValueFrom, tap } from 'rxjs';
import { FlowSelectorComponent } from '../approvals/flow-selector/flow-selector.component';
import { ApprovalFlow, ApprovalHistory, ApprovalRequest } from '../models/approvals';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-corporate-info',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    NgIf,
    ReactiveFormsModule,
    RouterLink,
    FlowSelectorComponent,
  ],
  templateUrl: './corporate-info.component.html',
  styleUrl: './corporate-info.component.scss',
})
export class CorporateInfoComponent implements OnInit {
  private fb = inject(FormBuilder);
  private corporateInfoService = inject(CorporateInfoService);
  private authService = inject(AuthService);
  private approvalWorkflowService = inject(ApprovalWorkflowService);

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
    // 一時的にすべてのユーザーに編集を許可
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


    this.isSaving = true;
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

    try {
      const history: ApprovalHistory = {
        id: `hist-${Date.now()}`,
        statusAfter: 'pending',
        action: 'apply',
        actorId: this.applicantId,
        actorName: this.applicantName,
        comment: '法人情報を更新します。',
        attachments: [],
        createdAt: Timestamp.fromDate(new Date()),
      };

      const steps = this.selectedFlow.steps.map((step) => ({
        stepOrder: step.order,
        status: 'waiting' as const,
      }));

      const request: ApprovalRequest = {
        title: '法人情報の更新',
        category: '個別更新',
        targetCount: 1,
        applicantId: this.applicantId,
        applicantName: this.applicantName,
        flowId: this.selectedFlow.id ?? 'corporate-flow',
        flowSnapshot: this.selectedFlow,
        status: 'pending',
        currentStep: this.selectedFlow.steps[0]?.order,
        comment: `${payload.officeName ?? '法人情報'} の変更申請`,
        steps,
        histories: [history],
        attachments: [],
        createdAt: Timestamp.fromDate(new Date()),
      };

      await this.approvalWorkflowService.saveRequest(request);
      this.message = '承認依頼を送信しました。承認完了後に反映されます。';
      this.editMode = false;
    } catch (error) {
      console.error(error);
      this.message = '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.isSaving = false;
    }
  }
}