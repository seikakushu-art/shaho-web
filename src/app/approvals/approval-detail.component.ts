import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { combineLatest, Subscription, firstValueFrom, interval, map, switchMap, tap, take } from 'rxjs';
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
import { DependentData, PayrollData, ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';
import { normalizeEmployeeNoForComparison } from '../employees/employee-import/csv-import.utils';
import { CalculationDataService, CalculationRow, CalculationQueryParams } from '../calculations/calculation-data.service';
import { StandardCalculationMethod } from '../calculations/calculation-types';
import { normalizeToYearMonth } from '../calculations/calculation-utils';

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
      if (!roleAllowed || !approval?.flowSnapshot) return false;
      const email = user?.email?.toLowerCase();
      if (!email) return false;

      // いずれかのステップの承認候補者であればボタンを押せるようにする
      // 実際の承認処理で前のステップのチェックを行う
      for (const step of approval.flowSnapshot.steps) {
        const candidateIds = step.candidates?.map((c) => c.id.toLowerCase()) ?? [];
        const stepState = approval.steps.find((s) => s.stepOrder === step.order);
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
    // undefinedのフィールドを除外するヘルパー関数
    const removeUndefinedFields = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
      const cleaned: Partial<T> = {};
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (value !== undefined && value !== '') {
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
    const toBoolean = (value: string | undefined): boolean | undefined => {
      if (!value) return undefined;
      const normalized = value.toLowerCase().trim();
      if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes' || normalized === '有') {
        return true;
      }
      if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no' || normalized === '無') {
        return false;
      }
      return undefined;
    };

    try {
      // 同じ社員番号の行をグループ化（複数の扶養家族をサポート）
      const groupedByEmployeeNo = new Map<string, Array<{
        employeeNo: string;
        csvData: Record<string, string>;
        isNew: boolean;
        existingEmployeeId?: string;
        templateType: string;
      }>>();

      importData.forEach((item) => {
        const employeeNo = item.employeeNo;
        if (!groupedByEmployeeNo.has(employeeNo)) {
          groupedByEmployeeNo.set(employeeNo, []);
        }
        groupedByEmployeeNo.get(employeeNo)!.push(item);
      });

      const results = await Promise.allSettled(
        Array.from(groupedByEmployeeNo.entries()).map(async ([employeeNo, items]) => {
          // 最初の行で従業員情報を登録/更新
          const firstItem = items[0];
          const csvData = firstItem.csvData;
          const templateType = firstItem.templateType;

          // employeeIdを取得（テンプレートタイプによって異なる）
          let employeeId: string;

          if (templateType === 'payroll') {
            // payrollテンプレートの場合は既存社員のIDを取得
            const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
            const employees = await firstValueFrom(this.employeesService.getEmployees().pipe(take(1)));
            const existingEmployee = employees.find((emp) => normalizeEmployeeNoForComparison(emp.employeeNo) === normalizedEmployeeNo);

            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }

            employeeId = existingEmployee.id;
          } else {
            // その他のテンプレートの場合は社員情報を更新
            const employeeDataRaw: Partial<ShahoEmployee> = {
              employeeNo: normalizeEmployeeNoForComparison(csvData['社員番号'] || ''),
              name: csvData['氏名(漢字)'] || csvData['氏名漢字'] || '',
              kana: csvData['氏名(カナ)'] || undefined,
              gender: csvData['性別'] || undefined,
              birthDate: csvData['生年月日'] || undefined,
              postalCode: csvData['郵便番号'] || undefined,
              address: csvData['住所'] || undefined,
              department: csvData['所属部署名'] || undefined,
              workPrefecture: csvData['勤務地都道府県名'] || undefined,
              personalNumber: csvData['個人番号'] || undefined,
              basicPensionNumber: csvData['基礎年金番号'] || undefined,
              standardMonthly: toNumber(csvData['標準報酬月額']),
              healthInsuredNumber: csvData['被保険者番号（健康保険)'] || undefined,
              pensionInsuredNumber: csvData['被保険者番号（厚生年金）'] || undefined,
              healthAcquisition: csvData['健康保険 資格取得日'] || csvData['健康保険資格取得日'] || undefined,
              pensionAcquisition: csvData['厚生年金 資格取得日'] || csvData['厚生年金資格取得日'] || undefined,
              childcareLeaveStart: csvData['育休開始日'] || undefined,
              childcareLeaveEnd: csvData['育休終了日'] || undefined,
              maternityLeaveStart: csvData['産休開始日'] || undefined,
              maternityLeaveEnd: csvData['産休終了日'] || undefined,
              // 扶養情報（hasDependentのみ）
              hasDependent: toBoolean(csvData['扶養の有無']),
            };

            // undefinedのフィールドを除外
            const employeeData = removeUndefinedFields(employeeDataRaw);

            if (firstItem.isNew) {
              // 新規登録
              const result = await this.employeesService.addEmployee(employeeData as ShahoEmployee);
              employeeId = result.id;
            } else if (firstItem.existingEmployeeId) {
              // 更新
              await this.employeesService.updateEmployee(firstItem.existingEmployeeId, employeeData);
              employeeId = firstItem.existingEmployeeId;
            } else {
              throw new Error(`既存社員のIDが見つかりません: ${firstItem.employeeNo}`);
            }

            // 扶養情報をdependentsサブコレクションに保存（複数件対応）
            if (employeeId) {
              const hasDependent = toBoolean(csvData['扶養の有無']);
              
              if (hasDependent) {
                // 既存の扶養情報をすべて削除（更新の場合）
                if (!firstItem.isNew) {
                  const existingDependents = await firstValueFrom(
                    this.employeesService.getDependents(employeeId).pipe(take(1))
                  );
                  for (const existing of existingDependents) {
                    if (existing.id) {
                      await this.employeesService.deleteDependent(employeeId, existing.id);
                    }
                  }
                }

                // すべての行から扶養家族情報を収集
                const dependentDataList: DependentData[] = [];
                
                for (const item of items) {
                  const itemCsvData = item.csvData;
                  const dependentData: DependentData = {
                    relationship: itemCsvData['扶養 続柄'] || undefined,
                    nameKanji: itemCsvData['扶養 氏名(漢字)'] || undefined,
                    nameKana: itemCsvData['扶養 氏名(カナ)'] || undefined,
                    birthDate: itemCsvData['扶養 生年月日'] || undefined,
                    gender: itemCsvData['扶養 性別'] || undefined,
                    personalNumber: itemCsvData['扶養 個人番号'] || undefined,
                    basicPensionNumber: itemCsvData['扶養 基礎年金番号'] || undefined,
                    cohabitationType: itemCsvData['扶養 同居区分'] || undefined,
                    address: itemCsvData['扶養 住所（別居の場合のみ入力）'] || undefined,
                    occupation: itemCsvData['扶養 職業'] || undefined,
                    annualIncome: toNumber(itemCsvData['扶養 年収（見込みでも可）']),
                    dependentStartDate: itemCsvData['扶養 被扶養者になった日'] || undefined,
                    thirdCategoryFlag: toBoolean(itemCsvData['扶養 国民年金第3号被保険者該当フラグ']),
                  };

                  // 扶養情報にデータがあるかチェック
                  const hasDependentData = Object.values(dependentData).some(
                    (value) => value !== undefined && value !== null && value !== false && value !== ''
                  );

                  if (hasDependentData) {
                    dependentDataList.push(dependentData);
                  }
                }

                // すべての扶養家族情報を保存
                for (const dependentData of dependentDataList) {
                  await this.employeesService.addOrUpdateDependent(employeeId, dependentData);
                }
              } else {
                // 扶養の有無が「無」の場合は既存の扶養情報を削除
                const existingDependents = await firstValueFrom(
                  this.employeesService.getDependents(employeeId).pipe(take(1))
                );
                for (const existing of existingDependents) {
                  if (existing.id) {
                    await this.employeesService.deleteDependent(employeeId, existing.id);
                  }
                }
              }
            }
          }

          // 月給/賞与支払額同期用テンプレート（payrollテンプレート）の処理
          if (templateType === 'payroll') {
            const normalizedEmployeeNo = normalizeEmployeeNoForComparison(employeeNo);
            const employees = await firstValueFrom(this.employeesService.getEmployees().pipe(take(1)));
            const existingEmployee = employees.find((emp) => normalizeEmployeeNoForComparison(emp.employeeNo) === normalizedEmployeeNo);

            if (!existingEmployee || !existingEmployee.id) {
              throw new Error(`社員番号 ${employeeNo} の社員が見つかりません`);
            }

            const employeeId = existingEmployee.id;
            const payrollPromises: Promise<void>[] = [];

            // 月給支払月から年月を抽出（YYYY/MM形式をYYYY-MM形式に変換）
            const monthlyPayMonth = csvData['月給支払月'];
            const monthlyPayAmount = csvData['月給支払額'];
            const workedDays = csvData['支払基礎日数'];
            const bonusPaidOn = csvData['賞与支給日'];
            const bonusTotal = csvData['賞与総支給額'];

            // 月給データの処理
            if (monthlyPayMonth) {
              // YYYY/MM形式をYYYY-MM形式に変換
              const yearMonth = monthlyPayMonth.replace(/\//g, '-');
              // 月が1桁の場合は0埋め（例: 2025-4 → 2025-04）
              const [year, month] = yearMonth.split('-');
              const normalizedYearMonth = `${year}-${month.padStart(2, '0')}`;

              // 既存の給与データを取得（マージするため）
              let existingPayroll;
              try {
                existingPayroll = await firstValueFrom(
                  this.employeesService.getPayroll(employeeId, normalizedYearMonth).pipe(take(1))
                );
              } catch {
                // データが存在しない場合はundefinedのまま
              }

              const payrollDataRaw: Partial<PayrollData> = {
                ...existingPayroll,
                yearMonth: normalizedYearMonth,
                workedDays: workedDays ? Number(workedDays.replace(/,/g, '')) : (existingPayroll?.workedDays || 0),
                amount: monthlyPayAmount
                  ? Number(monthlyPayAmount.replace(/,/g, ''))
                  : existingPayroll?.amount,
                // 賞与データも同じ月に含まれる場合は追加
                bonusPaidOn: bonusPaidOn?.trim() || existingPayroll?.bonusPaidOn || undefined,
                bonusTotal: bonusTotal
                  ? Number(bonusTotal.replace(/,/g, ''))
                  : existingPayroll?.bonusTotal,
              };

              // undefined と空文字列のフィールドを除外
              const payrollData = removeUndefinedFields(payrollDataRaw) as PayrollData;

              payrollPromises.push(
                this.employeesService.addOrUpdatePayroll(employeeId, normalizedYearMonth, payrollData),
              );
            } else if (bonusPaidOn) {
              // 月給データがなく、賞与データのみの場合
              // 賞与支給日から年月を抽出
              const bonusDate = new Date(bonusPaidOn.replace(/\//g, '-'));
              if (!isNaN(bonusDate.getTime())) {
                const year = bonusDate.getFullYear();
                const month = String(bonusDate.getMonth() + 1).padStart(2, '0');
                const normalizedYearMonth = `${year}-${month}`;

                // 既存の給与データを取得（マージするため）
                let existingPayroll;
                try {
                  existingPayroll = await firstValueFrom(
                    this.employeesService.getPayroll(employeeId, normalizedYearMonth).pipe(take(1))
                  );
                } catch {
                  // データが存在しない場合はundefinedのまま
                }

                const payrollDataRaw: Partial<PayrollData> = {
                  ...existingPayroll,
                  yearMonth: normalizedYearMonth,
                  workedDays: existingPayroll?.workedDays || 0,
                  amount: existingPayroll?.amount,
                  bonusPaidOn: bonusPaidOn?.trim() || undefined,
                  bonusTotal: bonusTotal ? Number(bonusTotal.replace(/,/g, '')) : undefined,
                };

                // undefined と空文字列のフィールドを除外
                const payrollData = removeUndefinedFields(payrollDataRaw) as PayrollData;

                payrollPromises.push(
                  this.employeesService.addOrUpdatePayroll(employeeId, normalizedYearMonth, payrollData),
                );
              }
            }

            // すべての給与データを保存
            if (payrollPromises.length > 0) {
              await Promise.all(payrollPromises);
            }
          }

          return { success: true, employeeNo: employeeNo, action: firstItem.isNew ? '新規登録' : '更新' };
        }),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.filter((r) => r.status === 'rejected').length;

      if (failureCount === 0) {
        console.log(`${successCount}件の社員データを正常に保存しました。`);
      } else {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map((r) => (r as PromiseRejectedResult).reason?.message || '不明なエラー')
          .join('\n');
        console.error(`${successCount}件成功、${failureCount}件失敗しました。\n\nエラー:\n${errors}`);
        throw new Error(`一部のデータの保存に失敗しました: ${errors}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '承認後のデータ保存中にエラーが発生しました';
      console.error(`エラー: ${message}`, error);
      throw error;
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

    // ユーザーがどのステップの候補者かを確認
    const userEmail = user?.email?.toLowerCase();
    if (!userEmail) return;

    let userStepOrder: number | undefined;
    for (const step of this.approval.flowSnapshot?.steps ?? []) {
      const candidateIds = step.candidates?.map((c) => c.id.toLowerCase()) ?? [];
      const stepState = this.approval.steps.find((s) => s.stepOrder === step.order);
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
          const previousFlowStep = this.approval.flowSnapshot?.steps.find((s) => s.order === i);
          const stepName = previousFlowStep?.name || `ステップ${i}`;
          this.addToast(`ステップ${i}（${stepName}）が承認されていないため、ステップ${userStepOrder}を承認できません。`, 'warning');
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

      // CSVインポート（社員情報一括更新）の最終承認時に社員データを保存
      if (action === 'approve' && result.request.status === 'approved' && result.request.category === '社員情報一括更新' && result.request.importEmployeeData) {
        try {
          await this.saveApprovedImportData(result.request.importEmployeeData);
          this.addToast('承認済みのCSVインポートデータを保存しました。', 'success');
        } catch (error) {
          console.error('CSVインポートデータの保存に失敗しました', error);
          this.addToast('CSVインポートデータの保存に失敗しました。', 'warning');
        }
      }

      // 法人情報更新の承認が完了した場合、データを保存
      if (action === 'approve' && result.request.status === 'approved' && result.request.category === '法人情報更新' && result.request.corporateInfoData) {
        try {
          // 最終承認者の名前を取得
          const finalApproverHistory = result.request.histories
            ?.filter(h => h.action === 'approve')
            .sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime())[0];
          
          // ユーザー表示名を取得
          let approverDisplayName = approverName;
          if (finalApproverHistory) {
            const users = await firstValueFrom(this.userDirectory.getUsers());
            const userMap = new Map(users.map(u => [u.email.toLowerCase(), u.displayName || u.email]));
            approverDisplayName = userMap.get(finalApproverHistory.actorId.toLowerCase()) 
              || finalApproverHistory.actorName 
              || finalApproverHistory.actorId;
          }

          // 承認者名を含めて保存
          const payloadWithApprover = {
            ...result.request.corporateInfoData,
            approvedBy: approverDisplayName,
          };
          await this.corporateInfoService.saveCorporateInfo(payloadWithApprover);
          this.addToast('法人情報のデータを保存しました。', 'success');
        } catch (error) {
          console.error('法人情報の保存に失敗しました', error);
          this.addToast('法人情報の保存に失敗しました。', 'warning');
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

      // 計算結果保存の承認が完了した場合、データを保存
      if (action === 'approve' && result.request.status === 'approved' && result.request.category === '計算結果保存' && result.request.calculationResultRows && result.request.calculationQueryParams) {
        try {
          const queryParams = result.request.calculationQueryParams;
          if (!queryParams.type || (queryParams.type !== 'standard' && queryParams.type !== 'bonus' && queryParams.type !== 'insurance')) {
            throw new Error('計算種別が不正です');
          }
          const validQuery: CalculationQueryParams = {
            type: queryParams.type as 'standard' | 'bonus' | 'insurance',
            targetMonth: queryParams.targetMonth || '',
            method: queryParams.method || '',
            standardMethod: (queryParams.standardMethod as StandardCalculationMethod) || '定時決定',
            insurances: queryParams.insurances || [],
            includeBonusInMonth: queryParams.includeBonusInMonth,
            department: queryParams.department,
            location: queryParams.location,
            employeeNo: queryParams.employeeNo,
            bonusPaidOn: queryParams.bonusPaidOn,
          };
          const validRows: CalculationRow[] = result.request.calculationResultRows.map(row => ({
            employeeNo: row.employeeNo,
            name: row.name,
            department: row.department,
            location: row.location,
            month: row.month,
            monthlySalary: row.monthlySalary,
            standardMonthly: row.standardMonthly,
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
      const errorMessage = error instanceof Error ? error.message : '承認処理中にエラーが発生しました。';
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
          const employeeId = employeeMap.get(row.employeeNo);
          if (!employeeId) {
            console.warn(`社員番号 ${row.employeeNo} の社員IDが見つかりません`);
            return;
          }

          const healthMonthlyTotal =
            (row.healthEmployeeMonthly || 0) + (row.healthEmployerMonthly || 0);
          const careMonthlyTotal =
            (row.nursingEmployeeMonthly || 0) + (row.nursingEmployerMonthly || 0);
          const pensionMonthlyTotal =
            (row.welfareEmployeeMonthly || 0) + (row.welfareEmployerMonthly || 0);
          const healthBonusTotal =
            (row.healthEmployeeBonus || 0) + (row.healthEmployerBonus || 0);
          const careBonusTotal =
            (row.nursingEmployeeBonus || 0) + (row.nursingEmployerBonus || 0);
          const pensionBonusTotal =
            (row.welfareEmployeeBonus || 0) + (row.welfareEmployerBonus || 0);

          // 賞与データがある場合は、bonusPaidOnから年月を抽出してyearMonthを設定
          let yearMonth = row.month;
          if (row.bonusPaymentDate) {
            const normalized = normalizeToYearMonth(row.bonusPaymentDate);
            if (normalized) {
              yearMonth = normalized;
            }
          }

          const payrollData: any = {
            yearMonth: yearMonth,
            amount: row.monthlySalary || undefined,
            bonusPaidOn: row.bonusPaymentDate || undefined,
            bonusTotal: row.bonusTotalPay || undefined,
            standardHealthBonus:
              row.standardHealthBonus > 0 ? row.standardHealthBonus : undefined,
            standardWelfareBonus:
              row.standardWelfareBonus > 0 ? row.standardWelfareBonus : undefined,
            // 後方互換性のため、standardBonusも設定（standardHealthBonusまたはstandardWelfareBonusのいずれか）
            standardBonus:
              row.standardHealthBonus || row.standardWelfareBonus || undefined,
            healthInsuranceMonthly:
              healthMonthlyTotal > 0 ? healthMonthlyTotal : undefined,
            careInsuranceMonthly:
              careMonthlyTotal > 0 ? careMonthlyTotal : undefined,
            pensionMonthly:
              pensionMonthlyTotal > 0 ? pensionMonthlyTotal : undefined,
            healthInsuranceBonus:
              healthBonusTotal > 0 ? healthBonusTotal : undefined,
            careInsuranceBonus: careBonusTotal > 0 ? careBonusTotal : undefined,
            pensionBonus: pensionBonusTotal > 0 ? pensionBonusTotal : undefined,
          };

          Object.keys(payrollData).forEach((key) => {
            if (payrollData[key] === undefined) {
              delete payrollData[key];
            }
          });

          await this.employeesService.addOrUpdatePayroll(
            employeeId,
            yearMonth,
            payrollData,
          );

          if (row.standardMonthly && row.standardMonthly > 0) {
            await this.employeesService.updateEmployee(employeeId, {
              standardMonthly: row.standardMonthly,
            });
          }
        });

      await Promise.all(savePromises);
      
      const calculationTypeLabels: Record<string, string> = {
        standard: '標準報酬月額',
        bonus: '標準賞与額',
        insurance: '社会保険料',
      };
      const calculationTypeLabel = calculationTypeLabels[query.type] || query.type.toUpperCase();
      
      await this.calculationDataService.saveCalculationHistory(
        query,
        validRows.filter((row) => !row.error),
        {
          title: calculationTypeLabel,
        },
      );
    } catch (error) {
      console.error('計算結果の保存エラー:', error);
      throw error;
    }
  }
}