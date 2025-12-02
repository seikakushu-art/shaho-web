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

@Component({
  selector: 'app-corporate-info',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    NgIf,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './corporate-info.component.html',
  styleUrl: './corporate-info.component.scss',
})
export class CorporateInfoComponent implements OnInit {
  private fb = inject(FormBuilder);
  private corporateInfoService = inject(CorporateInfoService);
  private authService = inject(AuthService);

  readonly RoleKey = RoleKey;
  editMode = false;
  isSaving = false;
  message = '';
  currentInfo: CorporateInfo | null = null;

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

  async save(): Promise<void> {
    // 一時的にすべてのユーザーに保存を許可

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message = '未入力の必須項目があります。';
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
      await this.corporateInfoService.saveCorporateInfo(payload);
      this.message = '法人情報を保存しました。';
      this.editMode = false;
    } catch (error) {
      console.error(error);
      this.message = '保存に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.isSaving = false;
    }
  }
}