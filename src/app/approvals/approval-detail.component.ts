import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import {
  combineLatest,
  Subscription,
  firstValueFrom,
  interval,
  map,
  switchMap,
  tap,
  take,
} from 'rxjs';
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
import { CorporateInfoService } from '../app/services/corporate-info.service';
import {
  DependentData,
  PayrollData,
  ShahoEmployee,
  ShahoEmployeesService,
} from '../app/services/shaho-employees.service';
import {
  normalizeEmployeeNoForComparison,
  normalizeNameForComparison,
} from '../employees/employee-import/csv-import.utils';
import {
  CalculationDataService,
  CalculationRow,
  CalculationQueryParams,
} from '../calculations/calculation-data.service';
import { StandardCalculationMethod } from '../calculations/calculation-types';
import { normalizeToYearMonth } from '../calculations/calculation-utils';
import { calculateCareSecondInsured } from '../app/services/care-insurance.utils';

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
  private corporateInfoService = inject(CorporateInfoService);
  private employeesService = inject(ShahoEmployeesService);
  private calculationDataService = inject(CalculationDataService);

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
      const userMap = new Map(
        users.map((u) => [u.email.toLowerCase(), u.displayName || u.email]),
      );
      return {
        ...approval,
        applicantDisplayName:
          userMap.get(approval.applicantId.toLowerCase()) ||
          approval.applicantName ||
          approval.applicantId,
        stepsWithDisplayNames: approval.steps.map((step) => ({
          ...step,
          approverDisplayName: step.approverId
            ? userMap.get(step.approverId.toLowerCase()) ||
              step.approverName ||
              step.approverId
            : step.approverName,
        })),
        attachmentsWithDisplayNames: (approval.attachments || []).map(
          (attachment) => ({
            ...attachment,
            uploaderDisplayName: attachment.uploaderId
              ? userMap.get(attachment.uploaderId.toLowerCase()) ||
                attachment.uploaderName ||
                attachment.uploaderId
              : attachment.uploaderName || attachment.uploaderId,
          }),
        ),
        historiesWithDisplayNames: [...(approval.histories || [])]
          .map((history) => ({
            ...history,
            actorDisplayName:
              userMap.get(history.actorId.toLowerCase()) ||
              history.actorName ||
              history.actorId,
          }))
          .sort(
            (a, b) =>
              b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime(),
          ),
        remandComment: [...(approval.histories || [])]
          .filter((history) => history.action === 'remand')
          .sort(
            (a, b) =>
              b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime(),
          )[0]?.comment,
      };
    }),
    tap((approval) => {
      this.approval = approval || undefined;
      console.log('承認詳細 - approval:', approval);
      console.log(
        '承認詳細 - approval.employeeDiffs:',
        approval?.employeeDiffs,
      );
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
            status:
              diff.status === 'warning'
                ? '警告'
                : diff.status === 'error'
                  ? 'エラー'
                  : 'OK',
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
      if (!roleAllowed || !approval?.flowSnapshot) return false;
      const email = user?.email?.toLowerCase();
      if (!email) return false;

      // いずれかのステップの承認候補者であればボタンを押せるようにする
      // 実際の承認処理で前のステップのチェックを行う
      for (const step of approval.flowSnapshot.steps) {
        const candidateIds =
          step.candidates?.map((c) => c.id.toLowerCase()) ?? [];
        const stepState = approval.steps.find(
          (s) => s.stepOrder === step.order,
        );
        const assignedApprover = stepState?.approverId?.toLowerCase();

        if (candidateIds.includes(email) || assignedApprover === email) {
          return true;
        }
      }

      return false;
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

    const { basicInfo, socialInsurance, dependentInfo, dependentInfos } =
      request.employeeData;
    if (!basicInfo?.employeeNo || !basicInfo?.name) {
      throw new Error('社員番号または氏名が不足しています');
    }

    const healthStandardMonthly = socialInsurance?.healthStandardMonthly ?? 0;
    const welfareStandardMonthly = socialInsurance?.welfareStandardMonthly ?? 0;

    // 現住所の処理：isCurrentAddressSameAsResidentがtrueの場合はundefined、falseの場合はcurrentAddressを設定
    const currentAddress = basicInfo.isCurrentAddressSameAsResident
      ? undefined
      : basicInfo.currentAddress || undefined;

    const employeePayload: ShahoEmployee = {
      employeeNo: basicInfo.employeeNo,
      name: basicInfo.name,
      kana: basicInfo.kana || undefined,
      gender: basicInfo.gender || undefined,
      birthDate: basicInfo.birthDate || undefined,
      postalCode: basicInfo.postalCode || undefined,
      address: basicInfo.address || undefined,
      currentAddress: currentAddress,
      department: basicInfo.department || undefined,
      workPrefecture: basicInfo.workPrefecture || undefined,
      personalNumber: basicInfo.myNumber || undefined,
      basicPensionNumber: basicInfo.basicPensionNumber || undefined,
      hasDependent: basicInfo.hasDependent ?? false,
      healthStandardMonthly: healthStandardMonthly || undefined,
      welfareStandardMonthly: welfareStandardMonthly || undefined,
      standardBonusAnnualTotal: socialInsurance?.healthCumulative || undefined,
      healthInsuredNumber: socialInsurance?.healthInsuredNumber || undefined,
      pensionInsuredNumber: socialInsurance?.pensionInsuredNumber || undefined,
      careSecondInsured: socialInsurance?.careSecondInsured || false,
      healthAcquisition: socialInsurance?.healthAcquisition || undefined,
      pensionAcquisition: socialInsurance?.pensionAcquisition || undefined,
      currentLeaveStatus:
        (socialInsurance as any)?.currentLeaveStatus || undefined,
      currentLeaveStartDate:
        (socialInsurance as any)?.currentLeaveStartDate || undefined,
      currentLeaveEndDate:
        (socialInsurance as any)?.currentLeaveEndDate || undefined,
    };

    const cleanedEmployee = this.removeUndefinedFields(
      employeePayload,
    ) as ShahoEmployee;

    // 申請者情報をcreatedByとして設定
    const createdBy = request.applicantName || request.applicantId || undefined;

    // 承認履歴から最新の承認者を取得
    let approvedBy: string | undefined;
    const approvalHistories = (request.histories || []).filter(
      (h) => h.action === 'approve',
    );
    if (approvalHistories.length > 0) {
      // 最新の承認履歴を取得（作成日時でソート）
      const latestApprovalHistory = approvalHistories.sort((a, b) => {
        const aTime =
          typeof a.createdAt?.toDate === 'function'
            ? a.createdAt.toDate().getTime()
            : new Date(a.createdAt as unknown as string).getTime();
        const bTime =
          typeof b.createdAt?.toDate === 'function'
            ? b.createdAt.toDate().getTime()
            : new Date(b.createdAt as unknown as string).getTime();
        return bTime - aTime;
      })[0];
      approvedBy =
        latestApprovalHistory.actorName ||
        latestApprovalHistory.actorId ||
        undefined;
    }

    const employeeRef = await this.employeesService.addEmployee(
      cleanedEmployee,
      {
        createdBy,
        approvedBy,
      },
    );
    const employeeId = employeeRef.id;

    // 承認リクエストのemployeeDiffsにexistingEmployeeIdを設定
    if (
      request.id &&
      request.employeeDiffs &&
      request.employeeDiffs.length > 0
    ) {
      const updatedDiffs = request.employeeDiffs.map((diff) => ({
        ...diff,
        existingEmployeeId: employeeId,
      }));
      const updatedRequest: ApprovalRequest = {
        ...request,
        employeeDiffs: updatedDiffs,
      };
      await this.workflowService.saveRequest(updatedRequest);
    }

    // 扶養情報（複数件対応。従来の単一形式もフォールバック）
    const dependentsSource =
      dependentInfos && dependentInfos.length > 0
        ? dependentInfos
        : dependentInfo
          ? [dependentInfo]
          : [];

    if (dependentsSource.length > 0) {
      for (const dep of dependentsSource) {
        if (!this.hasDependentData(dep)) continue;
        const dependentData: DependentData = {
          relationship: dep.relationship || undefined,
          nameKanji: dep.nameKanji || undefined,
          nameKana: dep.nameKana || undefined,
          birthDate: dep.birthDate,
          gender: dep.gender || undefined,
          personalNumber: dep.personalNumber || undefined,
          basicPensionNumber: dep.basicPensionNumber || undefined,
          cohabitationType: dep.cohabitationType || undefined,
          address: dep.address || undefined,
          occupation: dep.occupation || undefined,
          annualIncome: dep.annualIncome ?? undefined,
          dependentStartDate: dep.dependentStartDate,
          thirdCategoryFlag: dep.thirdCategoryFlag || false,
        };

        const normalizedDependent = this.normalizeDependentDates(
          dependentData,
        ) as DependentData;
        const cleanedDependent = this.removeUndefinedFields(
          normalizedDependent,
        ) as DependentData;
        await this.employeesService.addOrUpdateDependent(
          employeeId,
          cleanedDependent,
        );
      }
    }
  }

  /**
   * 承認済みの社員情報更新申請を社員コレクションへ反映
   */
  private async persistUpdatedEmployee(
    request: ApprovalRequest,
  ): Promise<void> {
    if (!request.employeeData) {
      throw new Error('employeeData が見つかりません');
    }

    // employeeDiffsから既存社員IDを取得
    const employeeDiff = request.employeeDiffs?.[0];
    if (!employeeDiff?.existingEmployeeId) {
      throw new Error('既存社員IDが見つかりません');
    }

    const employeeId = employeeDiff.existingEmployeeId;
    const { basicInfo, socialInsurance, dependentInfo, dependentInfos } =
      request.employeeData;
    if (!basicInfo?.employeeNo || !basicInfo?.name) {
      throw new Error('社員番号または氏名が不足しています');
    }

    // 最終承認者の名前を取得
    let approverDisplayName: string | undefined;
    if (request.histories) {
      const approvalHistories = request.histories.filter(
        (h) => h.action === 'approve',
      );

      if (approvalHistories.length > 0) {
        const latestHistory = approvalHistories.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        })[0];

        if (latestHistory.actorId) {
          try {
            const users = await firstValueFrom(this.userDirectory.getUsers());
            const userMap = new Map(
              users.map((u) => [
                u.email.toLowerCase(),
                u.displayName || u.email,
              ]),
            );
            approverDisplayName =
              userMap.get(latestHistory.actorId.toLowerCase()) ||
              latestHistory.actorName ||
              latestHistory.actorId;
          } catch (error) {
            console.error('承認者情報の取得に失敗しました:', error);
            approverDisplayName =
              latestHistory.actorName || latestHistory.actorId;
          }
        }
      }
    }

    const healthStandardMonthly = socialInsurance?.healthStandardMonthly ?? 0;
    const welfareStandardMonthly = socialInsurance?.welfareStandardMonthly ?? 0;

    // employeeDataをShahoEmployee形式に変換
    const currentAddress = basicInfo.isCurrentAddressSameAsResident
      ? undefined
      : basicInfo.currentAddress || undefined;

    // 削除されたフィールドを識別するため、employeeDiffsのchangesを確認
    const deletedFields = new Set<string>();
    if (employeeDiff?.changes) {
      employeeDiff.changes.forEach((change) => {
        // oldValueがあってnewValueが空文字列やnullの場合は削除されたフィールド
        if (
          change.oldValue &&
          change.oldValue !== '' &&
          change.oldValue !== null &&
          (!change.newValue ||
            change.newValue === '' ||
            change.newValue === null)
        ) {
          // フィールド名をマッピング
          const fieldMapping: Record<string, string> = {
            性別: 'gender',
            マイナンバー: 'personalNumber',
            基礎年金番号: 'basicPensionNumber',
            郵便番号: 'postalCode',
            住民票住所: 'address',
            現住所: 'currentAddress',
            健保標準報酬月額: 'healthStandardMonthly',
            厚年標準報酬月額: 'welfareStandardMonthly',
            健康保険被保険者番号: 'healthInsuredNumber',
            厚生年金被保険者番号: 'pensionInsuredNumber',
          };
          const fieldKey = fieldMapping[change.field];
          if (fieldKey) {
            deletedFields.add(fieldKey);
          }
        }
      });
    }

    const employeePayload: Partial<ShahoEmployee> = {
      employeeNo: basicInfo.employeeNo,
      name: basicInfo.name,
      kana: basicInfo.kana || undefined,
      gender: deletedFields.has('gender')
        ? (null as any)
        : basicInfo.gender || undefined,
      birthDate: basicInfo.birthDate || undefined,
      postalCode: deletedFields.has('postalCode')
        ? (null as any)
        : basicInfo.postalCode || undefined,
      address: deletedFields.has('address')
        ? (null as any)
        : basicInfo.address || undefined,
      currentAddress: deletedFields.has('currentAddress')
        ? (null as any)
        : currentAddress,
      department: basicInfo.department || undefined,
      workPrefecture: basicInfo.workPrefecture || undefined,
      personalNumber: deletedFields.has('personalNumber')
        ? (null as any)
        : basicInfo.myNumber || undefined,
      basicPensionNumber: deletedFields.has('basicPensionNumber')
        ? (null as any)
        : basicInfo.basicPensionNumber || undefined,
      hasDependent: basicInfo.hasDependent ?? undefined,
      healthStandardMonthly: deletedFields.has('healthStandardMonthly')
        ? (null as any)
        : healthStandardMonthly || undefined,
      welfareStandardMonthly: deletedFields.has('welfareStandardMonthly')
        ? (null as any)
        : welfareStandardMonthly || undefined,
      standardBonusAnnualTotal: socialInsurance?.healthCumulative || undefined,
      healthInsuredNumber: deletedFields.has('healthInsuredNumber')
        ? (null as any)
        : socialInsurance?.healthInsuredNumber || undefined,
      pensionInsuredNumber: deletedFields.has('pensionInsuredNumber')
        ? (null as any)
        : socialInsurance?.pensionInsuredNumber || undefined,
      careSecondInsured: socialInsurance?.careSecondInsured || false,
      healthAcquisition: socialInsurance?.healthAcquisition || undefined,
      pensionAcquisition: socialInsurance?.pensionAcquisition || undefined,
      currentLeaveStatus:
        (socialInsurance as any)?.currentLeaveStatus === null ||
        (socialInsurance as any)?.currentLeaveStatus === ''
          ? null
          : (socialInsurance as any)?.currentLeaveStatus || undefined,
      currentLeaveStartDate:
        (socialInsurance as any)?.currentLeaveStartDate === null ||
        (socialInsurance as any)?.currentLeaveStartDate === ''
          ? null
          : (socialInsurance as any)?.currentLeaveStartDate || undefined,
      currentLeaveEndDate:
        (socialInsurance as any)?.currentLeaveEndDate === null ||
        (socialInsurance as any)?.currentLeaveEndDate === ''
          ? null
          : (socialInsurance as any)?.currentLeaveEndDate || undefined,
      approvedBy: approverDisplayName,
    };

    const cleanedEmployee = this.removeUndefinedFields(
      employeePayload,
    ) as Partial<ShahoEmployee>;

    // 社員情報を更新
    await this.employeesService.updateEmployee(employeeId, cleanedEmployee);

    // 扶養情報の削除されたフィールドを識別
    const deletedDependentFields = new Map<
      number,
      Set<keyof DependentData>
    >();
    if (employeeDiff?.changes) {
      employeeDiff.changes.forEach((change) => {
        // 扶養情報のフィールドかどうかをチェック
        if (!change.field.startsWith('扶養')) return;

        // oldValueがあってnewValueが空文字列やnullの場合は削除されたフィールド
        if (
          change.oldValue &&
          change.oldValue !== '' &&
          change.oldValue !== null &&
          (!change.newValue ||
            change.newValue === '' ||
            change.newValue === null)
        ) {
          // フィールド名から扶養情報のインデックスを抽出（「扶養1 氏名(カナ)」→1、「扶養 氏名(カナ)」→0）
          const match = change.field.match(/^扶養(\d+)?\s+(.+)$/);
          if (match) {
            const dependentIndex = match[1] ? parseInt(match[1], 10) - 1 : 0;
            const fieldName = match[2];

            // フィールド名をマッピング
            const fieldMapping: Record<string, keyof DependentData> = {
              '氏名(カナ)': 'nameKana',
              性別: 'gender',
              個人番号: 'personalNumber',
              基礎年金番号: 'basicPensionNumber',
              同居区分: 'cohabitationType',
              住所: 'address',
              職業: 'occupation',
              年収: 'annualIncome',
            };

            const fieldKey = fieldMapping[fieldName];
            if (fieldKey) {
              if (!deletedDependentFields.has(dependentIndex)) {
                deletedDependentFields.set(dependentIndex, new Set());
              }
              deletedDependentFields.get(dependentIndex)!.add(fieldKey);
            }
          }
        }
      });
    }

    // 扶養情報を同期
    const dependentsSource =
      dependentInfos && dependentInfos.length > 0
        ? dependentInfos
        : dependentInfo
          ? [dependentInfo]
          : [];

    const dependentDataList: DependentData[] = [];
    for (let i = 0; i < dependentsSource.length; i++) {
      const dep = dependentsSource[i];
      if (!this.hasDependentData(dep)) continue;

      const deletedFields = deletedDependentFields.get(i) || new Set();
      const dependentData: DependentData = {
        relationship: dep.relationship || undefined,
        nameKanji: dep.nameKanji || undefined,
        nameKana: deletedFields.has('nameKana')
          ? (null as any)
          : dep.nameKana || undefined,
        birthDate: dep.birthDate,
        gender: deletedFields.has('gender')
          ? (null as any)
          : dep.gender || undefined,
        personalNumber: deletedFields.has('personalNumber')
          ? (null as any)
          : dep.personalNumber || undefined,
        basicPensionNumber: deletedFields.has('basicPensionNumber')
          ? (null as any)
          : dep.basicPensionNumber || undefined,
        cohabitationType: deletedFields.has('cohabitationType')
          ? (null as any)
          : dep.cohabitationType || undefined,
        address: deletedFields.has('address')
          ? (null as any)
          : dep.address || undefined,
        occupation: deletedFields.has('occupation')
          ? (null as any)
          : dep.occupation || undefined,
        annualIncome: deletedFields.has('annualIncome')
          ? (null as any)
          : dep.annualIncome ?? undefined,
        dependentStartDate: dep.dependentStartDate,
        thirdCategoryFlag: dep.thirdCategoryFlag || false,
      };

      const normalizedDependent = this.normalizeDependentDates(
        dependentData,
      ) as DependentData;
      const cleanedDependent = this.removeUndefinedFields(
        normalizedDependent,
      ) as DependentData;
      dependentDataList.push(cleanedDependent);
    }

    await this.syncDependents(
      employeeId,
      basicInfo.hasDependent,
      dependentDataList,
    );
  }

  /**
   * 承認済みのCSVインポートデータを社員コレクションへ反映
   */
  private async saveApprovedImportData(
    importData: Array<{
      employeeNo: string;
      csvData: Record<string, string>;
      isNew: boolean;
      existingEmployeeId?: string;
      templateType: string;
    }>,
  ): Promise<void> {
    // 承認履歴から最新の承認者を取得
    let approvedBy: string | undefined;
    if (this.approval?.histories) {
      const approvalHistories = this.approval.histories.filter(
        (h) => h.action === 'approve',
      );
      if (approvalHistories.length > 0) {
        // 最新の承認履歴を取得（作成日時でソート）
        const latestApprovalHistory = approvalHistories.sort((a, b) => {
          const aTime =
            typeof a.createdAt?.toDate === 'function'
              ? a.createdAt.toDate().getTime()
              : new Date(a.createdAt as unknown as string).getTime();
          const bTime =
            typeof b.createdAt?.toDate === 'function'
              ? b.createdAt.toDate().getTime()
              : new Date(b.createdAt as unknown as string).getTime();
          return bTime - aTime;
        })[0];
        approvedBy =
          latestApprovalHistory.actorName ||
          latestApprovalHistory.actorId ||
          undefined;
      }
    }

    // undefinedのフィールドを除外するヘルパー関数
    const removeUndefinedFields = <T extends Record<string, unknown>>(
      obj: T,
    ): Partial<T> => {
      const cleaned: Partial<T> = {};
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        // currentAddressの場合は、空文字列でも保存する（CSVインポート時は明示的に空文字列を指定できるようにする）
        if (key === 'currentAddress') {
          if (value !== undefined && value !== null) {
            const trimmed = typeof value === 'string' ? value.trim() : value;
            // 空文字列でも保存する（CSVで明示的に空文字列が指定された場合）
            cleaned[key as keyof T] = trimmed as T[keyof T];
          }
        } else if (value !== undefined && value !== '') {
          cleaned[key as keyof T] = value as T[keyof T];
        }
      });
      return cleaned;
    };

    // 数値変換ヘルパー関数
    const toNumber = (value: string | undefined): number | undefined => {
      if (!value) return undefined;
      const num = Number(value.replace(/,/g, ''));
      return isNaN(num) ? undefined : num;
    };

    // ブール値変換ヘルパー関数（1/0, true/false, on/off などを変換）
    const toBoolean = (
      value: string | undefined,
      treatUndefinedAsNoChange = false,
    ): boolean | undefined => {
      if (value === undefined || value === null) {
        return treatUndefinedAsNoChange ? undefined : undefined;
      }
      const normalized = value.toLowerCase().trim();
      if (normalized === '') {
        return treatUndefinedAsNoChange ? undefined : undefined;
      }
      if (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'on' ||
        normalized === 'yes' ||
        normalized === '有'
      ) {
        return true;
      }
      if (
        normalized === '0' ||
        normalized === 'false' ||
        normalized === 'off' ||
        normalized === 'no' ||
        normalized === '無'
      ) {
        return false;
      }
      return undefined;
    };

    try {
      // 同じ社員番号の行をグループ化（複数の扶養家族をサポート）
      const groupedByEmployeeNo = new Map<
        string,
        Array<{
          employeeNo: string;
          csvData: Record<string, string>;
          isNew: boolean;
          existingEmployeeId?: string;
          templateType: string;
        }>
      >();

      importData.forEach((item) => {
        const employeeNo = item.employeeNo;
        if (!groupedByEmployeeNo.has(employeeNo)) {
          groupedByEmployeeNo.set(employeeNo, []);
        }
        groupedByEmployeeNo.get(employeeNo)!.push(item);
      });

      const results = await Promise.allSettled(
        Array.from(groupedByEmployeeNo.entries()).map(
          async ([employeeNo, items]) => {
            // 最初の行で従業員情報を登録/更新
            const firstItem = items[0];
            const csvData = firstItem.csvData;
            const templateType = firstItem.templateType;

            // employeeIdを取得（テンプレートタイプによって異なる）
            let employeeId: string;

            if (templateType === 'payroll') {
              // payrollテンプレートの場合は既存社員のIDを取得
              const normalizedEmployeeNo =
                normalizeEmployeeNoForComparison(employeeNo);
              const employees = await firstValueFrom(
                this.employeesService.getEmployees().pipe(take(1)),
              );
              const existingEmployee = employees.find(
                (emp) =>
                  normalizeEmployeeNoForComparison(emp.employeeNo) ===
                  normalizedEmployeeNo,
              );

              if (!existingEmployee || !existingEmployee.id) {
                throw new Error(
                  `社員番号 ${employeeNo} の社員が見つかりません`,
                );
              }

              employeeId = existingEmployee.id;
            } else {
              // その他のテンプレートの場合は社員情報を更新
              const healthStandardMonthly = toNumber(
                csvData['健保標準報酬月額'],
              );
              const welfareStandardMonthly =
                toNumber(csvData['厚年標準報酬月額']) ?? healthStandardMonthly;
              const employeeDataRaw: Partial<ShahoEmployee> = {
                employeeNo: normalizeEmployeeNoForComparison(
                  csvData['社員番号'] || '',
                ),
                name: csvData['氏名(漢字)'] || csvData['氏名漢字'] || '',
                kana: csvData['氏名(カナ)'] || undefined,
                gender: csvData['性別'] || undefined,
                birthDate: csvData['生年月日'] || undefined,
                postalCode: csvData['郵便番号'] || undefined,
                address: csvData['住民票住所'] || undefined,
                // CSVインポート時は、現住所に値が入っていればそのまま保存（チェックボックスのロジックは適用しない）
                currentAddress: csvData['現住所']?.trim() || undefined,
                department: csvData['所属部署名'] || undefined,
                workPrefecture: csvData['勤務地都道府県名'] || undefined,
                personalNumber: csvData['個人番号'] || undefined,
                basicPensionNumber: csvData['基礎年金番号'] || undefined,
                healthStandardMonthly,
                welfareStandardMonthly,
                healthInsuredNumber:
                  csvData['被保険者番号（健康保険)'] || undefined,
                pensionInsuredNumber:
                  csvData['被保険者番号（厚生年金）'] || undefined,
                healthAcquisition:
                  csvData['健康保険 資格取得日'] ||
                  csvData['健康保険資格取得日'] ||
                  undefined,
                pensionAcquisition:
                  csvData['厚生年金 資格取得日'] ||
                  csvData['厚生年金資格取得日'] ||
                  undefined,
                // 介護保険第2号被保険者フラグは、CSVに値があれば優先的に使用
                // 値がない場合のみ生年月日から自動判定
                careSecondInsured: (() => {
                  const csvValue = toBoolean(
                    csvData['介護保険第2号被保険者フラグ'] ||
                      csvData['介護保険第2号フラグ'] ||
                      undefined,
                  );
                  if (csvValue !== undefined) {
                    return csvValue;
                  }
                  // CSVに値がない場合のみ、生年月日から自動判定
                  return csvData['生年月日']
                    ? calculateCareSecondInsured(csvData['生年月日'])
                    : false;
                })(),
                currentLeaveStatus: csvData['現在の休業状態'] || undefined,
                // 現在の休業状態が空文字列または「なし」の場合は、日付フィールドをクリア
                currentLeaveStartDate: (() => {
                  const status = csvData['現在の休業状態'];
                  if (
                    !status ||
                    status.trim() === '' ||
                    status.trim() === 'なし'
                  ) {
                    return undefined;
                  }
                  return csvData['現在の休業開始日'] || undefined;
                })(),
                currentLeaveEndDate: (() => {
                  const status = csvData['現在の休業状態'];
                  if (
                    !status ||
                    status.trim() === '' ||
                    status.trim() === 'なし'
                  ) {
                    return undefined;
                  }
                  return csvData['現在の休業予定終了日'] || undefined;
                })(),
                // 扶養情報（hasDependentのみ）
                hasDependent: toBoolean(csvData['扶養の有無'], true),
              };

              // undefinedのフィールドを除外
              const employeeData = removeUndefinedFields(employeeDataRaw);

              if (firstItem.isNew) {
                // 新規登録
                const result = await this.employeesService.addEmployee(
                  employeeData as ShahoEmployee,
                  {
                    approvedBy,
                  },
                );
                employeeId = result.id;
              } else if (firstItem.existingEmployeeId) {
                // 更新
                const updateDataWithApprover = {
                  ...employeeData,
                  approvedBy,
                };
                await this.employeesService.updateEmployee(
                  firstItem.existingEmployeeId,
                  updateDataWithApprover,
                );
                employeeId = firstItem.existingEmployeeId;
              } else {
                throw new Error(
                  `既存社員のIDが見つかりません: ${firstItem.employeeNo}`,
                );
              }

              // 扶養情報をdependentsサブコレクションに保存（複数件対応）
              if (employeeId) {
                const hasDependentColumn = '扶養の有無' in csvData;
                const hasDependent = toBoolean(csvData['扶養の有無'], true);

                if (hasDependentColumn) {
                  const dependentDataList: DependentData[] = [];

                  if (hasDependent === true) {
                    for (const item of items) {
                      const itemCsvData = item.csvData;
                      const dependentData: DependentData = {
                        relationship: itemCsvData['扶養 続柄'] || undefined,
                        nameKanji: itemCsvData['扶養 氏名(漢字)'] || undefined,
                        nameKana: itemCsvData['扶養 氏名(カナ)'] || undefined,
                        birthDate: itemCsvData['扶養 生年月日'] || undefined,
                        gender: itemCsvData['扶養 性別'] || undefined,
                        personalNumber:
                          itemCsvData['扶養 個人番号'] || undefined,
                        basicPensionNumber:
                          itemCsvData['扶養 基礎年金番号'] || undefined,
                        cohabitationType:
                          itemCsvData['扶養 同居区分'] || undefined,
                        address:
                          itemCsvData['扶養 住所（別居の場合のみ入力）'] ||
                          undefined,
                        occupation: itemCsvData['扶養 職業'] || undefined,
                        annualIncome: toNumber(
                          itemCsvData['扶養 年収（見込みでも可）'],
                        ),
                        dependentStartDate:
                          itemCsvData['扶養 被扶養者になった日'] || undefined,
                        thirdCategoryFlag: toBoolean(
                          itemCsvData['扶養 国民年金第3号被保険者該当フラグ'],
                        ),
                      };

                      if (this.hasDependentData(dependentData)) {
                        dependentDataList.push(dependentData);
                      }
                    }
                  }

                  await this.syncDependents(
                    employeeId,
                    hasDependent,
                    dependentDataList,
                  );
                }
              }
            }

            // 月給/賞与支払額同期用テンプレート（payrollテンプレート）の処理
            if (templateType === 'payroll') {
              const normalizedEmployeeNo =
                normalizeEmployeeNoForComparison(employeeNo);
              const employees = await firstValueFrom(
                this.employeesService.getEmployees().pipe(take(1)),
              );
              const existingEmployee = employees.find(
                (emp) =>
                  normalizeEmployeeNoForComparison(emp.employeeNo) ===
                  normalizedEmployeeNo,
              );

              if (!existingEmployee || !existingEmployee.id) {
                throw new Error(
                  `社員番号 ${employeeNo} の社員が見つかりません`,
                );
              }

              const employeeId = existingEmployee.id;
              const payrollPromises: Promise<void>[] = [];

              // 月給支払月から年月を抽出（YYYY/MM形式をYYYY-MM形式に変換）
              const monthlyPayMonth = csvData['月給支払月'];
              const monthlyPayAmount = csvData['月給支払額'];
              const workedDays = csvData['支払基礎日数'];
              const bonusPaidOn = csvData['賞与支給日'];
              const bonusTotal = csvData['賞与総支給額'];
              const exemptionFlag =
                toBoolean(csvData['健康保険・厚生年金一時免除フラグ']) ?? false;

              // 月給データの処理
              if (monthlyPayMonth) {
                // YYYY/MM形式をYYYY-MM形式に変換
                const yearMonth = monthlyPayMonth.replace(/\//g, '-');
                // 月が1桁の場合は0埋め（例: 2025-4 → 2025-04）
                const [year, month] = yearMonth.split('-');
                const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

                // 月次データを準備
                const payrollMonthData: any = {
                  exemption: exemptionFlag,
                  workedDays: workedDays
                    ? Number(workedDays.replace(/,/g, ''))
                    : undefined,
                  amount: monthlyPayAmount
                    ? Number(monthlyPayAmount.replace(/,/g, ''))
                    : undefined,
                };

                // undefinedのフィールドを除外
                Object.keys(payrollMonthData).forEach((key) => {
                  if (
                    key !== 'exemption' &&
                    payrollMonthData[key] === undefined
                  ) {
                    delete payrollMonthData[key];
                  }
                });

                // 賞与データがある場合は賞与明細として追加
                let bonusPaymentData: any | undefined;
                if (bonusPaidOn?.trim() && bonusTotal) {
                  bonusPaymentData = {
                    bonusPaidOn: bonusPaidOn.trim(),
                    bonusTotal: Number(bonusTotal.replace(/,/g, '')),
                  };
                }

                payrollPromises.push(
                  this.employeesService.addOrUpdatePayrollMonth(
                    employeeId,
                    normalizedYearMonth,
                    payrollMonthData,
                    bonusPaymentData,
                  ),
                );
              } else if (bonusPaidOn) {
                // 月給データがなく、賞与データのみの場合
                // 賞与支給日から年月を抽出
                const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
                if (!isNaN(bonusDate.getTime())) {
                  const year = bonusDate.getFullYear();
                  const month = String(bonusDate.getMonth() + 1).padStart(
                    2,
                    '0',
                  );
                  const normalizedYearMonth = `${year}-${month}`;

                  // 賞与明細データを準備
                  const bonusPaymentData: any = {
                    bonusPaidOn: bonusPaidOn.trim(),
                    bonusTotal: bonusTotal
                      ? Number(bonusTotal.replace(/,/g, ''))
                      : undefined,
                  };

                  // undefinedのフィールドを除外
                  Object.keys(bonusPaymentData).forEach((key) => {
                    if (bonusPaymentData[key] === undefined) {
                      delete bonusPaymentData[key];
                    }
                  });

                  payrollPromises.push(
                    this.employeesService.addOrUpdatePayrollMonth(
                      employeeId,
                      normalizedYearMonth,
                      { exemption: exemptionFlag }, // 月次データなし
                      bonusPaymentData,
                    ),
                  );
                }
              }

              // すべての給与データを保存
              if (payrollPromises.length > 0) {
                await Promise.all(payrollPromises);
              }
            }

            return {
              success: true,
              employeeNo: employeeNo,
              action: firstItem.isNew ? '新規登録' : '更新',
            };
          },
        ),
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failureCount = results.filter(
        (r) => r.status === 'rejected',
      ).length;

      if (failureCount === 0) {
        console.log(`${successCount}件の社員データを正常に保存しました。`);
      } else {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map(
            (r) =>
              (r as PromiseRejectedResult).reason?.message || '不明なエラー',
          )
          .join('\n');
        console.error(
          `${successCount}件成功、${failureCount}件失敗しました。\n\nエラー:\n${errors}`,
        );
        throw new Error(`一部のデータの保存に失敗しました: ${errors}`);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '承認後のデータ保存中にエラーが発生しました';
      console.error(`エラー: ${message}`, error);
      throw error;
    }
  }

  /**
   * 扶養の生年月日・被扶養開始日について、空文字やnullが申請で渡された場合でも
   * 明示的にnullとして扱い、既存日付を削除できるようにする。
   */
  private normalizeDependentDates(
    dep: Partial<DependentData>,
  ): Partial<DependentData> {
    const normalize = (
      value: string | null | undefined,
    ): string | null | undefined =>
      value === '' || value === null ? null : value;

    const result = {
      ...dep,
      birthDate: normalize(dep.birthDate),
      dependentStartDate: normalize(dep.dependentStartDate),
    } as Partial<DependentData>;

    return result;
  }

  private removeUndefinedFields<T extends object>(obj: T): T {
    const cleaned: Partial<T> = {};
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const value = (obj as Record<string, unknown>)[key];
      // undefinedは除外するが、nullは保持する（削除の意図を表すため）
      if (value === undefined) continue;

      if (Array.isArray(value)) {
        const normalized = value
          .map((item) =>
            item && typeof item === 'object'
              ? this.removeUndefinedFields(item as object)
              : item,
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
    return (
      approval.status === 'pending' &&
      approval.dueDate.toDate().getTime() < Date.now()
    );
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
      default:
        return '承認待ち';
    }
  }

  candidateNames(stepOrder: number): string {
    const candidateStep = this.approval?.flowSnapshot?.steps.find(
      (s) => s.order === stepOrder,
    );
    if (!candidateStep) return '未設定';
    return candidateStep.candidates
      .map((candidate) => candidate.displayName)
      .join(' / ');
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

    // ユーザーがどのステップの候補者かを確認
    const userEmail = user?.email?.toLowerCase();
    if (!userEmail) return;

    let userStepOrder: number | undefined;
    for (const step of this.approval.flowSnapshot?.steps ?? []) {
      const candidateIds =
        step.candidates?.map((c) => c.id.toLowerCase()) ?? [];
      const stepState = this.approval.steps.find(
        (s) => s.stepOrder === step.order,
      );
      const assignedApprover = stepState?.approverId?.toLowerCase();

      if (candidateIds.includes(userEmail) || assignedApprover === userEmail) {
        userStepOrder = step.order;
        break;
      }
    }

    if (userStepOrder === undefined) {
      this.addToast('承認候補者ではないため操作できません。', 'warning');
      return;
    }

    // 前のステップが承認されているかチェック
    if (userStepOrder > 1) {
      for (let i = 1; i < userStepOrder; i++) {
        const previousStep = this.approval.steps.find((s) => s.stepOrder === i);
        if (!previousStep || previousStep.status !== 'approved') {
          const previousFlowStep = this.approval.flowSnapshot?.steps.find(
            (s) => s.order === i,
          );
          const stepName = previousFlowStep?.name || `ステップ${i}`;
          this.addToast(
            `ステップ${i}（${stepName}）が承認されていないため、ステップ${userStepOrder}を承認できません。`,
            'warning',
          );
          return;
        }
      }
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
      this.addToast(
        `申請を${actionText}（コメント: ${this.approvalComment || 'なし'}）`,
        'success',
      );
      this.approvalComment = '';

      // 新規社員登録の最終承認時に社員データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '新規社員登録'
      ) {
        try {
          await this.persistNewEmployee(result.request);
          this.addToast('承認済みの社員データを登録しました。', 'success');
        } catch (error) {
          console.error('社員データの保存に失敗しました', error);
          this.addToast('社員データの保存に失敗しました。', 'warning');
        }
      }

      // 社員情報更新の最終承認時に社員データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '社員情報更新' &&
        result.request.employeeData &&
        result.request.employeeDiffs?.[0]?.existingEmployeeId
      ) {
        try {
          await this.persistUpdatedEmployee(result.request);
          this.addToast('承認済みの社員データを更新しました。', 'success');
        } catch (error) {
          console.error('社員データの更新に失敗しました', error);
          this.addToast('社員データの更新に失敗しました。', 'warning');
        }
      }

      // 社員削除の最終承認時に社員データを削除
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '社員削除' &&
        result.request.employeeDiffs?.[0]?.existingEmployeeId
      ) {
        try {
          const employeeId = result.request.employeeDiffs[0].existingEmployeeId;
          await this.employeesService.deleteEmployee(employeeId);
          this.addToast('承認済みの社員データを削除しました。', 'success');
        } catch (error) {
          console.error('社員データの削除に失敗しました', error);
          this.addToast('社員データの削除に失敗しました。', 'warning');
        }
      }

      // CSVインポート（社員情報一括更新）の最終承認時に社員データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '社員情報一括更新' &&
        result.request.importEmployeeData
      ) {
        try {
          await this.saveApprovedImportData(result.request.importEmployeeData);
          this.addToast(
            '承認済みのCSVインポートデータを保存しました。',
            'success',
          );
        } catch (error) {
          console.error('CSVインポートデータの保存に失敗しました', error);
          this.addToast('CSVインポートデータの保存に失敗しました。', 'warning');
        }
      }

      // 法人情報更新の承認が完了した場合、データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '法人情報更新' &&
        result.request.corporateInfoData
      ) {
        try {
          // 最終承認者の名前を取得
          const finalApproverHistory = result.request.histories
            ?.filter((h) => h.action === 'approve')
            .sort(
              (a, b) =>
                b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime(),
            )[0];

          // ユーザー表示名を取得
          let approverDisplayName = approverName;
          if (finalApproverHistory) {
            const users = await firstValueFrom(this.userDirectory.getUsers());
            const userMap = new Map(
              users.map((u) => [
                u.email.toLowerCase(),
                u.displayName || u.email,
              ]),
            );
            approverDisplayName =
              userMap.get(finalApproverHistory.actorId.toLowerCase()) ||
              finalApproverHistory.actorName ||
              finalApproverHistory.actorId;
          }

          // 承認者名を含めて保存
          const payloadWithApprover = {
            ...result.request.corporateInfoData,
            approvedBy: approverDisplayName,
          };
          await this.corporateInfoService.saveCorporateInfo(
            payloadWithApprover,
          );
          this.addToast('法人情報のデータを保存しました。', 'success');
        } catch (error) {
          console.error('法人情報の保存に失敗しました', error);
          this.addToast('法人情報の保存に失敗しました。', 'warning');
        }
      }

      // 保険料率更新の承認が完了した場合、データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '保険料率更新' &&
        result.request.insuranceRateData
      ) {
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

      // 計算結果保存の承認が完了した場合、データを保存
      if (
        action === 'approve' &&
        result.request.status === 'approved' &&
        result.request.category === '計算結果保存' &&
        result.request.calculationResultRows &&
        result.request.calculationQueryParams
      ) {
        try {
          const queryParams = result.request.calculationQueryParams;
          if (
            !queryParams.type ||
            (queryParams.type !== 'standard' &&
              queryParams.type !== 'bonus' &&
              queryParams.type !== 'insurance')
          ) {
            throw new Error('計算種別が不正です');
          }
          const validQuery: CalculationQueryParams = {
            type: queryParams.type as 'standard' | 'bonus' | 'insurance',
            targetMonth: queryParams.targetMonth || '',
            method: queryParams.method || '',
            standardMethod:
              (queryParams.standardMethod as StandardCalculationMethod) ||
              '定時決定',
            insurances: queryParams.insurances || [],
            includeBonusInMonth: queryParams.includeBonusInMonth,
            department: queryParams.department,
            location: queryParams.location,
            employeeNo: queryParams.employeeNo,
            bonusPaidOn: queryParams.bonusPaidOn,
          };
          const validRows: CalculationRow[] =
            result.request.calculationResultRows.map((row) => ({
              employeeNo: row.employeeNo,
              name: row.name,
              department: row.department,
              location: row.location,
              month: row.month,
              monthlySalary: row.monthlySalary,
              healthStandardMonthly: row.healthStandardMonthly,
              welfareStandardMonthly: row.welfareStandardMonthly,
              healthEmployeeMonthly: row.healthEmployeeMonthly,
              healthEmployerMonthly: row.healthEmployerMonthly,
              nursingEmployeeMonthly: row.nursingEmployeeMonthly,
              nursingEmployerMonthly: row.nursingEmployerMonthly,
              welfareEmployeeMonthly: row.welfareEmployeeMonthly,
              welfareEmployerMonthly: row.welfareEmployerMonthly,
              bonusPaymentDate: row.bonusPaymentDate,
              bonusTotalPay: row.bonusTotalPay,
              healthEmployeeBonus: row.healthEmployeeBonus,
              healthEmployerBonus: row.healthEmployerBonus,
              nursingEmployeeBonus: row.nursingEmployeeBonus,
              nursingEmployerBonus: row.nursingEmployerBonus,
              welfareEmployeeBonus: row.welfareEmployeeBonus,
              welfareEmployerBonus: row.welfareEmployerBonus,
              standardHealthBonus: row.standardHealthBonus,
              standardWelfareBonus: row.standardWelfareBonus,
              exemption: row.exemption,
              error: row.error,
            }));
          await this.persistCalculationResults(validRows, validQuery);
          this.addToast('計算結果を保存しました。', 'success');
        } catch (error) {
          console.error('計算結果の保存に失敗しました', error);
          this.addToast('計算結果の保存に失敗しました。', 'warning');
        }
      }

      // 計算結果保存の場合は、計算種別を含めたタイトルを生成
      let requestTitle =
        result.request.title ||
        result.request.flowSnapshot?.name ||
        result.request.id ||
        '申請';
      const category = result.request.category || this.approval?.category;
      if (category === '計算結果保存') {
        // this.approval を優先して計算種別を取得（最新のデータを持っている可能性が高い）
        const calculationType =
          this.approval?.calculationQueryParams?.type ||
          result.request.calculationQueryParams?.type;
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
            resultRequestCalculationQueryParams:
              result.request.calculationQueryParams,
            approvalCalculationQueryParams:
              this.approval?.calculationQueryParams,
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

      const nextStepNotifications: ApprovalNotification[] =
        result.nextAssignees.map((assignee) => ({
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

      this.notificationService.pushBatch([
        applicantNotification,
        ...nextStepNotifications,
      ]);
    } catch (error) {
      console.error('approval action failed', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : '承認処理中にエラーが発生しました。';
      this.addToast(errorMessage, 'warning');
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
      this.addToast(
        '再申請できません。申請者本人で、差し戻し状態の申請のみ再申請できます。',
        'warning',
      );
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

      this.addToast(
        '申請を再申請しました。承認フローが最初から開始されます。',
        'success',
      );

      // 承認者への通知
      const firstStep = resubmitted.flowSnapshot?.steps[0];
      if (firstStep?.candidates) {
        const notifications: ApprovalNotification[] = firstStep.candidates.map(
          (candidate) => ({
            id: `ntf-${Date.now()}-${candidate.id}`,
            requestId: resubmitted.id!,
            recipientId: candidate.id,
            message: `${resubmitted.title} が再申請されました。ステップ1を承認してください`,
            unread: true,
            createdAt: new Date(),
            type: 'info',
          }),
        );
        this.notificationService.pushBatch(notifications);
      }
    } catch (error) {
      console.error('resubmit failed', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : '再申請処理中にエラーが発生しました。';
      this.addToast(errorMessage, 'warning');
    }
  }

  private async persistCalculationResults(
    validRows: CalculationRow[],
    query: CalculationQueryParams,
  ): Promise<void> {
    try {
      const employees = await firstValueFrom(
        this.employeesService.getEmployeesWithPayrolls(),
      );
      const employeeMap = new Map<string, string>();
      employees.forEach((emp) => {
        if (emp.id && emp.employeeNo) {
          employeeMap.set(emp.employeeNo, emp.id);
        }
      });

      const savePromises = validRows
        .filter((row) => !row.error)
        .map(async (row) => {
          try {
            const employeeId = employeeMap.get(row.employeeNo);
            if (!employeeId) {
              console.warn(
                `社員番号 ${row.employeeNo} の社員IDが見つかりません`,
              );
              return {
                success: false,
                employeeNo: row.employeeNo,
                error: '社員IDが見つかりません',
              };
            }

            console.log(`保険料計算: 社員番号=${row.employeeNo}`, {
              健康保険料月額: {
                従業員負担: row.healthEmployeeMonthly,
                事業主負担: row.healthEmployerMonthly,
                保存値: row.healthEmployeeMonthly, // 従業員負担分のみ保存
              },
              介護保険料月額: {
                従業員負担: row.nursingEmployeeMonthly,
                事業主負担: row.nursingEmployerMonthly,
                保存値: row.nursingEmployeeMonthly, // 従業員負担分のみ保存
              },
              厚生年金保険料月額: {
                従業員負担: row.welfareEmployeeMonthly,
                事業主負担: row.welfareEmployerMonthly,
                保存値: row.welfareEmployeeMonthly, // 従業員負担分のみ保存
              },
              健康保険料賞与: {
                従業員負担: row.healthEmployeeBonus,
                事業主負担: row.healthEmployerBonus,
                保存値: row.healthEmployeeBonus, // 従業員負担分のみ保存
              },
              介護保険料賞与: {
                従業員負担: row.nursingEmployeeBonus,
                事業主負担: row.nursingEmployerBonus,
                保存値: row.nursingEmployeeBonus, // 従業員負担分のみ保存
              },
              厚生年金保険料賞与: {
                従業員負担: row.welfareEmployeeBonus,
                事業主負担: row.welfareEmployerBonus,
                保存値: row.welfareEmployeeBonus, // 従業員負担分のみ保存
              },
            });

            // 賞与データがある場合は、bonusPaidOnから年月を抽出してyearMonthを設定
            let yearMonth = row.month;
            if (row.bonusPaymentDate) {
              const normalized = normalizeToYearMonth(row.bonusPaymentDate);
              if (normalized) {
                yearMonth = normalized;
              }
            }

            // 月次データを準備（従業員負担分のみ保存）
            const payrollMonthData: any = {
              amount: row.monthlySalary || undefined,
              // 健康保険料、介護保険料、厚生年金保険料（月額）を従業員負担分のみで保存
              healthInsuranceMonthly:
                (row.healthEmployeeMonthly || 0) > 0
                  ? row.healthEmployeeMonthly
                  : undefined,
              careInsuranceMonthly:
                (row.nursingEmployeeMonthly || 0) > 0
                  ? row.nursingEmployeeMonthly
                  : undefined,
              pensionMonthly:
                (row.welfareEmployeeMonthly || 0) > 0
                  ? row.welfareEmployeeMonthly
                  : undefined,
            };

            if (row.exemption !== undefined) {
              payrollMonthData.exemption = row.exemption;
            }

            // undefinedのフィールドを除外
            Object.keys(payrollMonthData).forEach((key) => {
              if (payrollMonthData[key] === undefined) {
                delete payrollMonthData[key];
              }
            });

            // 賞与明細データを準備（従業員負担分のみ保存）
            let bonusPaymentData: any | undefined;
            if (
              row.bonusPaymentDate &&
              row.bonusTotalPay !== undefined &&
              row.bonusTotalPay > 0
            ) {
              bonusPaymentData = {
                bonusPaidOn: row.bonusPaymentDate,
                bonusTotal: row.bonusTotalPay,
                standardHealthBonus:
                  row.standardHealthBonus > 0
                    ? row.standardHealthBonus
                    : undefined,
                standardWelfareBonus:
                  row.standardWelfareBonus > 0
                    ? row.standardWelfareBonus
                    : undefined,
                // 健康保険料、介護保険料、厚生年金保険料（賞与）を従業員負担分のみで保存
                healthInsuranceBonus:
                  (row.healthEmployeeBonus || 0) > 0
                    ? row.healthEmployeeBonus
                    : undefined,
                careInsuranceBonus:
                  (row.nursingEmployeeBonus || 0) > 0
                    ? row.nursingEmployeeBonus
                    : undefined,
                pensionBonus:
                  (row.welfareEmployeeBonus || 0) > 0
                    ? row.welfareEmployeeBonus
                    : undefined,
              };

              // undefinedのフィールドを除外
              Object.keys(bonusPaymentData).forEach((key) => {
                if (bonusPaymentData[key] === undefined) {
                  delete bonusPaymentData[key];
                }
              });
            }

            // 保存するデータの詳細をログ出力
            console.log(
              `給与データを保存します: 社員番号=${row.employeeNo}, 年月=${yearMonth}`,
              {
                payrollMonthData,
                bonusPaymentData,
                // 保険料の詳細も表示（月額・賞与ともに従業員負担分のみ保存）
                '健康保険料（月額・従業員負担）':
                  payrollMonthData.healthInsuranceMonthly || '未設定',
                '介護保険料（月額・従業員負担）':
                  payrollMonthData.careInsuranceMonthly || '未設定',
                '厚生年金保険料（月額・従業員負担）':
                  payrollMonthData.pensionMonthly || '未設定',
                '健康保険料（賞与・従業員負担）':
                  bonusPaymentData?.healthInsuranceBonus || '未設定',
                '介護保険料（賞与・従業員負担）':
                  bonusPaymentData?.careInsuranceBonus || '未設定',
                '厚生年金保険料（賞与・従業員負担）':
                  bonusPaymentData?.pensionBonus || '未設定',
              },
            );

            // 新しい構造で保存（Transaction使用）
            await this.employeesService.addOrUpdatePayrollMonth(
              employeeId,
              yearMonth,
              payrollMonthData,
              bonusPaymentData,
            );
            console.log(`給与データの保存完了: 社員番号=${row.employeeNo}`);

            const updatePayload: Partial<ShahoEmployee> = {};
            // 標準報酬月額計算の場合、0以外の値（0も含む）を保存する
            // ただし、undefinedやnullの場合は保存しない
            if (
              row.healthStandardMonthly !== undefined &&
              row.healthStandardMonthly !== null
            ) {
              updatePayload.healthStandardMonthly = row.healthStandardMonthly;
            }
            if (
              row.welfareStandardMonthly !== undefined &&
              row.welfareStandardMonthly !== null
            ) {
              updatePayload.welfareStandardMonthly = row.welfareStandardMonthly;
            }
            if (Object.keys(updatePayload).length > 0) {
              console.log(
                `標準報酬月額を更新します: 社員番号=${row.employeeNo}`,
                updatePayload,
              );
              await this.employeesService.updateEmployee(
                employeeId,
                updatePayload,
              );
              console.log(`標準報酬月額の更新完了: 社員番号=${row.employeeNo}`);
            } else {
              console.log(
                `標準報酬月額の更新スキップ: 社員番号=${row.employeeNo} (更新データなし)`,
              );
            }

            return { success: true, employeeNo: row.employeeNo };
          } catch (error) {
            console.error(
              `社員番号 ${row.employeeNo} の保存に失敗しました:`,
              error,
            );
            return {
              success: false,
              employeeNo: row.employeeNo,
              error: error instanceof Error ? error.message : '不明なエラー',
            };
          }
        });

      const results = await Promise.allSettled(savePromises);
      const successCount = results.filter(
        (r) => r.status === 'fulfilled' && r.value?.success,
      ).length;
      const failureCount = results.filter(
        (r) =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && !r.value?.success),
      ).length;

      console.log(
        `社員情報の保存結果: 成功=${successCount}件, 失敗=${failureCount}件`,
      );

      if (failureCount > 0) {
        const failures = results
          .filter(
            (r) =>
              r.status === 'rejected' ||
              (r.status === 'fulfilled' && !r.value?.success),
          )
          .map((r) => {
            if (r.status === 'rejected') {
              return `不明なエラー: ${r.reason}`;
            }
            const value = r.value as {
              success: boolean;
              employeeNo: string;
              error?: string;
            };
            return `社員番号 ${value.employeeNo}: ${value.error || '不明なエラー'}`;
          });
        console.warn('保存に失敗した社員:', failures);
      }

      const calculationTypeLabels: Record<string, string> = {
        standard: '標準報酬月額',
        bonus: '標準賞与額',
        insurance: '社会保険料',
      };
      const calculationTypeLabel =
        calculationTypeLabels[query.type] || query.type.toUpperCase();

      console.log(
        `計算履歴を保存します: 種別=${calculationTypeLabel}, 行数=${validRows.filter((row) => !row.error).length}`,
      );
      await this.calculationDataService.saveCalculationHistory(
        query,
        validRows.filter((row) => !row.error),
        {
          title: calculationTypeLabel,
        },
      );
      console.log('計算履歴の保存完了');
    } catch (error) {
      console.error('計算結果の保存エラー:', error);
      throw error;
    }
  }
  private hasDependentData(dep: Partial<DependentData>): boolean {
    return Object.values(dep).some(
      (value) =>
        value !== '' &&
        value !== null &&
        value !== false &&
        value !== undefined,
    );
  }

  private async syncDependents(
    employeeId: string,
    hasDependent: boolean | undefined,
    dependents: DependentData[],
  ): Promise<void> {
    const filteredDependents = dependents.filter((dep) =>
      this.hasDependentData(dep),
    );
    const hasDependentEntries = dependents.length > 0;
    const hasMeaningfulDependents = filteredDependents.length > 0;
    const hasOnlyEmptyDependents =
      hasDependentEntries && !hasMeaningfulDependents;

    const deleteExistingDependents = async (): Promise<void> => {
      const existingDependents = await firstValueFrom(
        this.employeesService.getDependents(employeeId).pipe(take(1)),
      );
      for (const existing of existingDependents) {
        if (existing.id) {
          await this.employeesService.deleteDependent(employeeId, existing.id);
        }
      }
    };

    // 「扶養の有無」がfalseの場合は既存の扶養情報をすべて削除
    if (hasDependent === false) {
      await deleteExistingDependents();
      return;
    }

    // CSVに扶養欄はあるが、データが空の場合も削除対象とする
    if (
      hasDependent === undefined &&
      (dependents.length === 0 || hasOnlyEmptyDependents)
    ) {
      await deleteExistingDependents();
      return;
    }

    // CSVに扶養情報がある場合、既存の扶養情報を取得して比較
    const existingDependents = await firstValueFrom(
      this.employeesService.getDependents(employeeId).pipe(take(1)),
    );

    // CSVの扶養情報を処理（既存のものは更新、新しいものは追加）
    for (const dependentData of filteredDependents) {
      // 氏名(漢字)で既存の扶養情報を検索
      const csvNameKanji = dependentData.nameKanji?.trim() || '';
      let matchedExisting: DependentData | undefined;

      if (csvNameKanji) {
        const normalizedCsvName = normalizeNameForComparison(csvNameKanji);
        matchedExisting = existingDependents.find((existing) => {
          if (!existing.nameKanji) return false;
          const normalizedExistingName = normalizeNameForComparison(
            existing.nameKanji,
          );
          return normalizedExistingName === normalizedCsvName;
        });
      }

      if (matchedExisting && matchedExisting.id) {
        // 既存の扶養情報を更新
        await this.employeesService.addOrUpdateDependent(
          employeeId,
          dependentData,
          matchedExisting.id,
        );
      } else {
        // 新しい扶養情報を追加
        await this.employeesService.addOrUpdateDependent(
          employeeId,
          dependentData,
        );
      }
    }
  }

  /**
   * 基礎年金番号をマスクして表示（下4桁のみ表示、それ以外は*でマスク）
   * 形式: ****-**7890
   */
  formatBasicPensionNumber(value: string | null | undefined): string {
    if (!value) return '—';
    // 数字以外の文字を除去
    const digitsOnly = value.replace(/[^\d]/g, '');
    // 10桁でない場合はそのまま返す
    if (digitsOnly.length !== 10) return value;
    // 下4桁のみ表示、それ以外は*でマスク
    const last4Digits = digitsOnly.slice(6, 10);
    return `****-**${last4Digits}`;
  }

  /**
   * フィールド値の表示用フォーマット（基礎年金番号の場合はマスク処理）
   */
  formatFieldValue(field: string, value: string | null | undefined): string {
    if (field === '基礎年金番号' || field === '扶養 基礎年金番号') {
      return this.formatBasicPensionNumber(value);
    }
    return value || '—';
  }
}
