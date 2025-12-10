import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { combineLatest, Subscription, firstValueFrom, interval, map, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  ApprovalNotification,
  ApprovalRequest,
  ApprovalStepState,
  ApprovalStepStatus,
  ApprovalRequestStatus,
  ApprovalAttachmentMetadata,
  ApprovalHistory,
} from '../models/approvals';
import { ApprovalNotificationService } from './approval-notification.service';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { RoleKey } from '../models/roles';
import { UserDirectoryService } from '../auth/user-directory.service';
import { InsuranceRatesService } from '../app/services/insurance-rates.service';
import { DependentData, ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';

type EmployeeStatus = 'OK' | '警告' | 'エラー';

interface ApprovalDetailEmployee {
  employeeNo: string;
  name: string;
  status: EmployeeStatus;
  diffs: { field: string; oldValue: string; newValue: string }[];
}

// 計算種別のマッピング
const calculationTypeLabels: Record<string, string> = {
  standard: '標準報酬月額',
  bonus: '標準賞与額',
  insurance: '社会保険料',
};

@Component({
  selector: 'app-approval-detail',
  standalone: true,
  imports: [CommonModule, NgIf, NgFor, FormsModule, DatePipe, RouterLink],
  templateUrl: './approval-detail.component.html',
  styleUrl: './approval-detail.component.scss',
})
export class ApprovalDetailComponent implements OnDestroy {
  private workflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private userDirectory = inject(UserDirectoryService);
  private insuranceRatesService = inject(InsuranceRatesService);
  private employeesService = inject(ShahoEmployeesService);

  approval?: ApprovalRequest;
  private subscription: Subscription;

  employees: ApprovalDetailEmployee[] = [];

  selectedEmployee?: ApprovalDetailEmployee;
  showDiffModal = false;
  approvalComment = '';

  toasts: { message: string; type: 'info' | 'success' | 'warning' }[] = [];

  readonly approval$ = combineLatest([
    this.route.paramMap.pipe(
      map((params) => params.get('id')),
      switchMap((id) => this.workflowService.getRequest(id)),
    ),
    this.userDirectory.getUsers(),
  ]).pipe(
    map(([approval, users]) => {
      if (!approval) return null;
      const userMap = new Map(users.map(u => [u.email.toLowerCase(), u.displayName || u.email]));
      return {
        ...approval,
        applicantDisplayName: userMap.get(approval.applicantId.toLowerCase()) || approval.applicantName || approval.applicantId,
        stepsWithDisplayNames: approval.steps.map(step => ({
          ...step,
          approverDisplayName: step.approverId 
            ? (userMap.get(step.approverId.toLowerCase()) || step.approverName || step.approverId)
            : step.approverName,
        })),
        attachmentsWithDisplayNames: (approval.attachments || []).map(attachment => ({
          ...attachment,
          uploaderDisplayName: attachment.uploaderId
            ? (userMap.get(attachment.uploaderId.toLowerCase()) || attachment.uploaderName || attachment.uploaderId)
            : attachment.uploaderName || attachment.uploaderId,
        })),
        historiesWithDisplayNames: [...(approval.histories || [])]
          .map(history => ({
            ...history,
            actorDisplayName: userMap.get(history.actorId.toLowerCase()) || history.actorName || history.actorId,
          }))
          .sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime()),
        remandComment: [...(approval.histories || [])]
          .filter(history => history.action === 'remand')
          .sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime())[0]?.comment,
      };
    }),
    tap((approval) => {
      this.approval = approval || undefined;
      console.log('承認詳細 - approval:', approval);
      console.log('承認詳細 - approval.employeeDiffs:', approval?.employeeDiffs);
      if (approval?.employeeDiffs) {
        this.employees = approval.employeeDiffs.map((diff) => {
          console.log('差分処理 - diff:', diff);
          console.log('差分処理 - diff.changes:', diff.changes);
          
          // 区分が「社員情報更新」の場合は、変更がある項目だけをフィルタリング
          let filteredChanges = diff.changes;
          if (approval.category === '社員情報更新') {
            filteredChanges = diff.changes.filter((change) => {
              // oldValueとnewValueが異なる場合のみ含める
              const oldVal = change.oldValue ?? '';
              const newVal = change.newValue ?? '';
              return oldVal !== newVal;
            });
          }
          
          return {
            employeeNo: diff.employeeNo,
            name: diff.name,
            status: diff.status === 'warning' ? '警告' : diff.status === 'error' ? 'エラー' : 'OK',
            diffs: filteredChanges.map((change) => ({
              field: change.field,
              oldValue: change.oldValue ?? '',
              newValue: change.newValue ?? '',
            })),
          };
        });
        console.log('承認詳細 - this.employees:', this.employees);
      } else {
        this.employees = [];
      }
    }),
  );

  readonly canApprove$ = combineLatest([
    this.authService.hasAnyRole([RoleKey.SystemAdmin, RoleKey.Approver]),
    this.authService.user$,
    this.approval$,
  ]).pipe(
    map(([roleAllowed, user, approval]) => {
      if (!roleAllowed || !approval?.currentStep) return false;
      const email = user?.email?.toLowerCase();
      if (!email) return false;

      const flowStep = approval.flowSnapshot?.steps.find((s) => s.order === approval.currentStep);
      const candidateIds = flowStep?.candidates?.map((c) => c.id.toLowerCase()) ?? [];
      const currentStepState = approval.steps.find((s) => s.stepOrder === approval.currentStep);
      const assignedApprover = currentStepState?.approverId?.toLowerCase();

      return candidateIds.includes(email) || assignedApprover === email;
    }),
  );
  readonly isOperator$ = this.authService.hasAnyRole([RoleKey.Operator]);

  readonly isApplicant$ = combineLatest([
    this.authService.user$,
    this.approval$,
  ]).pipe(
    map(([user, approval]) => {
      if (!user?.email || !approval) return false;
      return user.email.toLowerCase() === approval.applicantId.toLowerCase();
    }),
  );

  readonly canResubmit$ = combineLatest([
    this.approval$,
    this.isApplicant$,
  ]).pipe(
    map(([approval, isApplicant]) => {
      return isApplicant && approval?.status === 'remanded';
    }),
  );

  private expiryWatcher = interval(30_000)
    .pipe(
      tap(() => {
        if (this.approval && this.isOverdue(this.approval)) {
          this.workflowService.expire(this.approval);
        }
      }),
    )
    .subscribe();

  constructor() {
    this.subscription = this.approval$.subscribe();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.expiryWatcher.unsubscribe();
  }

  statusClass(status: ApprovalStepStatus) {
    switch (status) {
      case 'approved':
        return 'status-approved';
      case 'remanded':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  requestStatusClass(status: ApprovalRequestStatus) {
    switch (status) {
      case 'approved':
        return 'status-approved';
      case 'remanded':
      case 'expired':
        return 'status-rejected';
      default:
        return 'status-pending';
    }
  }

  requestStatusLabel(status: ApprovalRequestStatus) {
    switch (status) {
      case 'approved':
        return '承認済';
      case 'remanded':
        return '差戻し';
      case 'expired':
        return '失効';
      case 'draft':
        return '下書き';
      default:
        return '承認待ち';
    }
  }

  openDiffModal(employee: ApprovalDetailEmployee) {
    // 区分が「新規社員登録」の場合は、社員新規登録画面へ遷移
    if (this.approval?.category === '新規社員登録' && this.approval?.id) {
      this.router.navigate(['/employees/new'], {
        queryParams: {
          approvalId: this.approval.id,
        },
      });
      return;
    }
    
    // その他の区分の場合はモーダルを表示
    this.selectedEmployee = employee;
    this.showDiffModal = true;
  }

  closeDiffModal() {
    this.showDiffModal = false;
    this.selectedEmployee = undefined;
  }

  goToCalculationResult(approvalId: string | undefined) {
    if (!approvalId) return;
    this.router.navigate(['/calculations/results'], {
      queryParams: {
        approvalId,
        viewMode: 'true',
      },
    });
  }

  /**
   * 承認済みの新規社員登録申請を社員コレクションへ反映
   */
  private async persistNewEmployee(request: ApprovalRequest): Promise<void> {
    if (!request.employeeData) {
      throw new Error('employeeData が見つかりません');
    }

    const { basicInfo, socialInsurance, dependentInfo, dependentInfos } = request.employeeData;
    if (!basicInfo?.employeeNo || !basicInfo?.name) {
      throw new Error('社員番号または氏名が不足しています');
    }

    const employeePayload: ShahoEmployee = {
      employeeNo: basicInfo.employeeNo,
      name: basicInfo.name,
      kana: basicInfo.kana || undefined,
      gender: basicInfo.gender || undefined,
      birthDate: basicInfo.birthDate || undefined,
      postalCode: basicInfo.postalCode || undefined,
      address: basicInfo.address || undefined,
      department: basicInfo.department || undefined,
      workPrefecture: basicInfo.workPrefecture || undefined,
      personalNumber: basicInfo.myNumber || undefined,
      basicPensionNumber: basicInfo.basicPensionNumber || undefined,
      hasDependent: basicInfo.hasDependent ?? false,
      standardMonthly: socialInsurance?.standardMonthly || undefined,
      standardBonusAnnualTotal: socialInsurance?.healthCumulative || undefined,
      healthInsuredNumber: socialInsurance?.healthInsuredNumber || undefined,
      pensionInsuredNumber: socialInsurance?.pensionInsuredNumber || undefined,
      careSecondInsured: socialInsurance?.careSecondInsured || false,
      healthAcquisition: socialInsurance?.healthAcquisition || undefined,
      pensionAcquisition: socialInsurance?.pensionAcquisition || undefined,
      childcareLeaveStart: socialInsurance?.childcareLeaveStart || undefined,
      childcareLeaveEnd: socialInsurance?.childcareLeaveEnd || undefined,
      maternityLeaveStart: socialInsurance?.maternityLeaveStart || undefined,
      maternityLeaveEnd: socialInsurance?.maternityLeaveEnd || undefined,
      exemption: socialInsurance?.exemption || false,
    };

    const cleanedEmployee = this.removeUndefinedFields(employeePayload) as ShahoEmployee;
    const employeeRef = await this.employeesService.addEmployee(cleanedEmployee);
    const employeeId = employeeRef.id;

    // 扶養情報（複数件対応。従来の単一形式もフォールバック）
    const dependentsSource =
      dependentInfos && dependentInfos.length > 0
        ? dependentInfos
        : dependentInfo
          ? [dependentInfo]
          : [];

    if (dependentsSource.length > 0) {
      for (const dep of dependentsSource) {
        const hasData = Object.values(dep).some(
          (value) => value !== '' && value !== null && value !== false && value !== undefined,
        );
        if (!hasData) continue;

        const dependentData: DependentData = {
          relationship: dep.relationship || undefined,
          nameKanji: dep.nameKanji || undefined,
          nameKana: dep.nameKana || undefined,
          birthDate: dep.birthDate || undefined,
          gender: dep.gender || undefined,
          personalNumber: dep.personalNumber || undefined,
          basicPensionNumber: dep.basicPensionNumber || undefined,
          cohabitationType: dep.cohabitationType || undefined,
          address: dep.address || undefined,
          occupation: dep.occupation || undefined,
          annualIncome: dep.annualIncome ?? undefined,
          dependentStartDate: dep.dependentStartDate || undefined,
          thirdCategoryFlag: dep.thirdCategoryFlag || false,
        };

        const cleanedDependent = this.removeUndefinedFields(dependentData) as DependentData;
        await this.employeesService.addOrUpdateDependent(employeeId, cleanedDependent);
      }
    }
  }

  private removeUndefinedFields<T extends object>(obj: T): T {
    const cleaned: Partial<T> = {};
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const value = (obj as Record<string, unknown>)[key];
      if (value === undefined) continue;

      if (Array.isArray(value)) {
        const normalized = value
          .map((item) =>
            item && typeof item === 'object' ? this.removeUndefinedFields(item as object) : item,
          )
          .filter((item) => item !== undefined);
        if (normalized.length) {
          (cleaned as Record<string, unknown>)[key] = normalized;
        }
      } else if (value && typeof value === 'object') {
        const nested = this.removeUndefinedFields(value as object);
        if (Object.keys(nested as object).length > 0) {
          (cleaned as Record<string, unknown>)[key] = nested;
        }
      } else {
        (cleaned as Record<string, unknown>)[key] = value;
      }
    }
    return cleaned as T;
  }

  addToast(message: string, type: 'info' | 'success' | 'warning' = 'info') {
    const toast = { message, type };
    this.toasts.push(toast);
    setTimeout(() => {
      const index = this.toasts.indexOf(toast);
      if (index !== -1) {
        this.toasts.splice(index, 1);
      }
    }, 3800);
  }

  isOverdue(approval: ApprovalRequest | undefined): boolean {
    if (!approval?.dueDate) return false;
    return approval.status === 'pending' && approval.dueDate.toDate().getTime() < Date.now();
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



  stepLabel(step: ApprovalStepState): string {
    switch (step.status) {
      case 'approved':
        return '承認済';
      case 'remanded':
        return '差戻し';
      case 'skipped':
        return '自動スキップ';
      default:
        return '承認待ち';
    }
  }

  candidateNames(stepOrder: number): string {
    const candidateStep = this.approval?.flowSnapshot?.steps.find((s) => s.order === stepOrder);
    if (!candidateStep) return '未設定';
    return candidateStep.candidates.map((candidate) => candidate.displayName).join(' / ');
  }

  async saveApproval(action: 'approve' | 'remand') {
    if (!this.approval?.id || !this.approval.currentStep) return;

    const user = await firstValueFrom(this.authService.user$);
    const approverId = user?.email ?? 'demo-approver';
    const approverName = user?.displayName ?? user?.email ?? 'デモ承認者';
    const canApprove = await firstValueFrom(this.canApprove$);
    if (!canApprove) {
      this.addToast('承認候補者ではないため操作できません。', 'warning');
      return;
    }

    // 承認処理前に現在のステップ番号を保存
    const approvedStep = this.approval.currentStep;

    try {
      const result =
        action === 'approve'
          ? await this.workflowService.approve(
              this.approval.id,
              approverId,
              approverName,
              this.approvalComment,
              [],
            )
          : await this.workflowService.remand(
              this.approval.id,
              approverId,
              approverName,
              this.approvalComment,
              [],
            );

      if (!result) return;
      const actionText = action === 'approve' ? '承認しました' : '差戻しました';
      this.addToast(`申請を${actionText}（コメント: ${this.approvalComment || 'なし'}）`, 'success');
      this.approvalComment = '';

      // 新規社員登録の最終承認時に社員データを保存
      if (action === 'approve' && result.request.status === 'approved' && result.request.category === '新規社員登録') {
        try {
          await this.persistNewEmployee(result.request);
          this.addToast('承認済みの社員データを登録しました。', 'success');
        } catch (error) {
          console.error('社員データの保存に失敗しました', error);
          this.addToast('社員データの保存に失敗しました。', 'warning');
        }
      }

      // 保険料率更新の承認が完了した場合、データを保存
      if (action === 'approve' && result.request.status === 'approved' && result.request.category === '保険料率更新' && result.request.insuranceRateData) {
        try {
          // 履歴を保持するため、常に新しいレコードとして保存（idはundefined）
          const payloadToSave = {
            ...result.request.insuranceRateData,
            id: undefined,
          };
          await this.insuranceRatesService.saveRates(payloadToSave);
          this.addToast('保険料率のデータを保存しました。', 'success');
        } catch (error) {
          console.error('保険料率の保存に失敗しました', error);
          this.addToast('保険料率の保存に失敗しました。', 'warning');
        }
      }

      // 計算結果保存の場合は、計算種別を含めたタイトルを生成
      let requestTitle = result.request.title || result.request.flowSnapshot?.name || result.request.id || '申請';
      const category = result.request.category || this.approval?.category;
      if (category === '計算結果保存') {
        // this.approval を優先して計算種別を取得（最新のデータを持っている可能性が高い）
        const calculationType = this.approval?.calculationQueryParams?.type || result.request.calculationQueryParams?.type;
        if (calculationType && calculationTypeLabels[calculationType]) {
          const calculationLabel = calculationTypeLabels[calculationType];
          requestTitle = `${calculationLabel}の計算結果`;
        } else {
          // デバッグ用: 計算種別が取得できない場合
          console.warn('計算種別が取得できませんでした', {
            category,
            calculationType,
            resultRequestCategory: result.request.category,
            approvalCategory: this.approval?.category,
            resultRequestCalculationQueryParams: result.request.calculationQueryParams,
            approvalCalculationQueryParams: this.approval?.calculationQueryParams,
          });
        }
      }

      const applicantNotification: ApprovalNotification = {
        id: `ntf-${Date.now()}`,
        requestId: result.request.id!,
        recipientId: this.approval.applicantId,
        message:
          action === 'approve'
            ? `${requestTitle} が承認ステップ ${approvedStep} を通過しました`
            : `${requestTitle} が差戻しされました`,
        unread: true,
        createdAt: new Date(),
        type: action === 'approve' ? 'success' : 'warning',
      };

      const nextStepNotifications: ApprovalNotification[] = result.nextAssignees.map((assignee) => ({
        id: `ntf-${Date.now()}-${assignee}`,
        requestId: result.request.id!,
        recipientId: assignee,
        message:
          action === 'approve'
            ? `${requestTitle} のステップ${result.request.currentStep}を承認してください`
            : `${requestTitle} が差戻しされました。申請者と調整してください。`,
        unread: true,
        createdAt: new Date(),
        type: action === 'approve' ? 'info' : 'warning',
      }));

      this.notificationService.pushBatch([applicantNotification, ...nextStepNotifications]);
    } catch (error) {
      console.error('approval action failed', error);
      this.addToast('承認処理中にエラーが発生しました。', 'warning');
    }
  }

  async resubmitApproval() {
    if (!this.approval?.id) return;

    const user = await firstValueFrom(this.authService.user$);
    const applicantId = user?.email ?? '';
    const applicantName = user?.displayName ?? user?.email ?? '申請者';

    if (!applicantId) {
      this.addToast('ユーザー情報が取得できませんでした。', 'warning');
      return;
    }

    const canResubmit = await firstValueFrom(this.canResubmit$);
    if (!canResubmit) {
      this.addToast('再申請できません。申請者本人で、差し戻し状態の申請のみ再申請できます。', 'warning');
      return;
    }

    try {
      const resubmitted = await this.workflowService.resubmit(
        this.approval.id,
        applicantId,
        applicantName,
        '差し戻しされた申請を再申請しました',
      );

      if (!resubmitted) {
        this.addToast('再申請に失敗しました。', 'warning');
        return;
      }

      this.addToast('申請を再申請しました。承認フローが最初から開始されます。', 'success');

      // 承認者への通知
      const firstStep = resubmitted.flowSnapshot?.steps[0];
      if (firstStep?.candidates) {
        const notifications: ApprovalNotification[] = firstStep.candidates.map((candidate) => ({
          id: `ntf-${Date.now()}-${candidate.id}`,
          requestId: resubmitted.id!,
          recipientId: candidate.id,
          message: `${resubmitted.title} が再申請されました。ステップ1を承認してください`,
          unread: true,
          createdAt: new Date(),
          type: 'info',
        }));
        this.notificationService.pushBatch(notifications);
      }
    } catch (error) {
      console.error('resubmit failed', error);
      const errorMessage = error instanceof Error ? error.message : '再申請処理中にエラーが発生しました。';
      this.addToast(errorMessage, 'warning');
    }
  }
}