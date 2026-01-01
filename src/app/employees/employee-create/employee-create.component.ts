import { CommonModule } from '@angular/common';
import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import {
  Subject,
  switchMap,
  takeUntil,
  of,
  firstValueFrom,
  combineLatest,
  map,
  take,
  filter,
  timeout,
  catchError,
} from 'rxjs';
import {
  ShahoEmployee,
  ShahoEmployeesService,
  DependentData,
} from '../../app/services/shaho-employees.service';
import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';
import {
  ApprovalFlow,
  ApprovalHistory,
  ApprovalRequest,
  ApprovalEmployeeDiff,
  ApprovalNotification,
  ApprovalAttachmentMetadata,
} from '../../models/approvals';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { ApprovalNotificationService } from '../../approvals/approval-notification.service';
import { ApprovalAttachmentService } from '../../approvals/approval-attachment.service';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth.service';
import { RoleKey } from '../../models/roles';
import { UserDirectoryService } from '../../auth/user-directory.service';
import { calculateCareSecondInsured } from '../../app/services/care-insurance.utils';

@Component({
  selector: 'app-employee-create',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, FlowSelectorComponent],
  templateUrl: './employee-create.component.html',
  styleUrl: './employee-create.component.scss',
})
export class EmployeeCreateComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private employeesService = inject(ShahoEmployeesService);
  private cdr = inject(ChangeDetectorRef);
  private approvalWorkflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private authService = inject(AuthService);
  private userDirectory = inject(UserDirectoryService);
  readonly attachmentService = inject(ApprovalAttachmentService);
  private destroy$ = new Subject<void>();

  editMode = true;
  submitAttempted = false;
  isEditMode = false;
  employeeId: string | null = null;
  originalEmployee: ShahoEmployee | null = null; // 編集前の既存データを保存
  originalDependentInfos: Array<{
    relationship: string;
    nameKanji: string;
    nameKana: string;
    birthDate: string;
    gender: string;
    personalNumber: string;
    basicPensionNumber: string;
    cohabitationType: string;
    address: string;
    occupation: string;
    annualIncome: number | null;
    dependentStartDate: string;
    thirdCategoryFlag: boolean;
  }> = []; // 編集前の扶養情報を保存（複数件対応）
  isLoading = false;
  sendingApproval = false;
  approvalMessage = '';
  selectedFlowId: string | null = null;
  selectedFlow?: ApprovalFlow;
  applicantId = '';
  applicantName = '';
  isViewModeFromApproval = false; // 承認詳細から遷移した閲覧モードかどうか
  requestComment = '';
  selectedFiles: File[] = [];
  validationErrors: string[] = [];
  dependentValidationError: string | null = null;
  employeeNoDuplicateError: string | null = null;
  checkingDuplicate = false;

  // 今日の日付をYYYY-MM-DD形式で取得（生年月日の最大値として使用）
  get todayDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  basicInfo: {
    employeeNo: string;
    name: string;
    kana: string;
    gender: string;
    birthDate: string;
    department: string;
    workPrefecture: string;
    myNumber: string;
    basicPensionNumber: string;
    hasDependent?: boolean;
    postalCode: string;
    address: string;
    currentAddress: string;
    isCurrentAddressSameAsResident: boolean;
  } = {
    employeeNo: '',
    name: '',
    kana: '',
    gender: '',
    birthDate: '',
    department: '',
    workPrefecture: '',
    myNumber: '',
    basicPensionNumber: '',
    hasDependent: undefined,
    postalCode: '',
    address: '',
    currentAddress: '',
    isCurrentAddressSameAsResident: true,
  };

  socialInsurance = {
    pensionOffice: '',
    officeName: '',
    healthCumulative: 0,
    healthStandardMonthly: 0,
    welfareStandardMonthly: 0,
    healthInsuredNumber: '',
    pensionInsuredNumber: '',
    careSecondInsured: false,
    healthAcquisition: '',
    pensionAcquisition: '',
    currentLeaveStatus: '',
    currentLeaveStartDate: '',
    currentLeaveEndDate: '',
    exemption: false,
  };

  dependentInfos: Array<{
    relationship: string;
    nameKanji: string;
    nameKana: string;
    birthDate: string;
    gender: string;
    personalNumber: string;
    basicPensionNumber: string;
    cohabitationType: string;
    address: string;
    occupation: string;
    annualIncome: number | null;
    dependentStartDate: string;
    thirdCategoryFlag: boolean;
  }> = [];

  ngOnInit(): void {
    // ユーザー情報を取得
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.applicantId = user?.email ?? 'requester';
      this.applicantName = user?.displayName ?? user?.email ?? '担当者';
    });

    // クエリパラメータとパラメータを組み合わせて処理
    combineLatest([this.route.queryParams, this.route.paramMap])
      .pipe(
        takeUntil(this.destroy$),
        switchMap(([queryParams, params]) => {
          const approvalId = queryParams['approvalId'];
          const employeeId = params.get('id');

          this.employeeId = employeeId;
          this.isEditMode = !!employeeId;

          // 承認IDがある場合は、承認リクエストから一時保存データを読み込む
          if (approvalId) {
            this.isViewModeFromApproval = true; // 承認詳細から遷移した閲覧モード
            this.isLoading = true;
            // requests$を直接監視して、データが読み込まれるまで待つ
            return this.approvalWorkflowService.requests$.pipe(
              map((requests) => {
                const approval = requests.find((req) => req.id === approvalId);
                console.log('承認リクエストを取得:', approval);
                console.log('employeeData:', approval?.employeeData);
                console.log('全リクエスト数:', requests.length);
                if (approval) {
                  console.log(
                    '承認リクエストの全フィールド:',
                    Object.keys(approval),
                  );
                }
                return { type: 'approval' as const, data: approval };
              }),
              // データが見つかるまで待つ（undefinedでない場合のみ通過）
              filter((result) => result.data !== undefined),
              timeout(10000), // 10秒でタイムアウト
              catchError((error) => {
                console.error('承認リクエストの取得エラー:', error);
                return of({ type: 'approval' as const, data: undefined });
              }),
              take(1),
            );
          }

          // 社員IDがある場合は、既存社員データを読み込む
          if (employeeId) {
            this.isLoading = true;
            return this.employeesService.getEmployeeById(employeeId).pipe(
              switchMap(async (employee) => {
                if (employee) {
                  await this.loadEmployeeData(employee);
                }
                return { type: 'employee' as const, data: employee };
              }),
            );
          }

          // 新規作成モード
          return of({ type: 'new' as const, data: null });
        }),
      )
      .subscribe((result) => {
        this.isLoading = false;

        if (result.type === 'approval') {
          console.log('承認リクエストの結果:', result);
          if (result.data?.employeeData) {
            console.log('employeeDataを読み込み:', result.data.employeeData);
            // 承認リクエストから一時保存データを読み込む
            const basicInfoData = result.data.employeeData.basicInfo;
            this.basicInfo = {
              ...basicInfoData,
              hasDependent: basicInfoData?.hasDependent ?? undefined,
              postalCode: basicInfoData?.postalCode ?? '',
              currentAddress: basicInfoData?.currentAddress ?? '',
              isCurrentAddressSameAsResident:
                basicInfoData?.isCurrentAddressSameAsResident ??
                (!basicInfoData?.currentAddress ||
                  basicInfoData?.currentAddress === basicInfoData?.address),
            };
            const incomingInsurance = result.data.employeeData.socialInsurance;
            const healthStandardMonthly =
              incomingInsurance.healthStandardMonthly ?? 0;
            const welfareStandardMonthly =
              incomingInsurance.welfareStandardMonthly ?? 0;
            // 介護保険第2号被保険者フラグは生年月日から自動判定
            const careSecondInsured = basicInfoData?.birthDate
              ? calculateCareSecondInsured(basicInfoData.birthDate)
              : (incomingInsurance.careSecondInsured ?? false);
            this.socialInsurance = {
              ...incomingInsurance,
              healthStandardMonthly,
              welfareStandardMonthly,
              careSecondInsured,
            };
            // 承認リクエストの扶養情報を読み込み（複数件に対応）
            const dependentInfosFromRequest =
              result.data.employeeData.dependentInfos;
            if (
              dependentInfosFromRequest &&
              dependentInfosFromRequest.length > 0
            ) {
              this.dependentInfos = dependentInfosFromRequest.map((dep) => ({
                relationship: dep.relationship ?? '',
                nameKanji: dep.nameKanji ?? '',
                nameKana: dep.nameKana ?? '',
                birthDate: dep.birthDate ?? '',
                gender: dep.gender ?? '',
                personalNumber: dep.personalNumber ?? '',
                basicPensionNumber: dep.basicPensionNumber ?? '',
                cohabitationType: dep.cohabitationType ?? '',
                address: dep.address ?? '',
                occupation: dep.occupation ?? '',
                annualIncome: dep.annualIncome ?? null,
                dependentStartDate: dep.dependentStartDate ?? '',
                thirdCategoryFlag: dep.thirdCategoryFlag ?? false,
              }));
            } else if (result.data.employeeData.dependentInfo) {
              // 後方互換：従来の単一オブジェクト形式を配列に変換
              this.dependentInfos = [
                {
                  relationship:
                    result.data.employeeData.dependentInfo.relationship ?? '',
                  nameKanji:
                    result.data.employeeData.dependentInfo.nameKanji ?? '',
                  nameKana:
                    result.data.employeeData.dependentInfo.nameKana ?? '',
                  birthDate:
                    result.data.employeeData.dependentInfo.birthDate ?? '',
                  gender: result.data.employeeData.dependentInfo.gender ?? '',
                  personalNumber:
                    result.data.employeeData.dependentInfo.personalNumber ?? '',
                  basicPensionNumber:
                    result.data.employeeData.dependentInfo.basicPensionNumber ??
                    '',
                  cohabitationType:
                    result.data.employeeData.dependentInfo.cohabitationType ??
                    '',
                  address: result.data.employeeData.dependentInfo.address ?? '',
                  occupation:
                    result.data.employeeData.dependentInfo.occupation ?? '',
                  annualIncome:
                    result.data.employeeData.dependentInfo.annualIncome ?? null,
                  dependentStartDate:
                    result.data.employeeData.dependentInfo.dependentStartDate ??
                    '',
                  thirdCategoryFlag:
                    result.data.employeeData.dependentInfo.thirdCategoryFlag ??
                    false,
                },
              ];
            } else {
              this.dependentInfos = [];
            }
            this.editMode = false; // 閲覧モードで表示
            this.isViewModeFromApproval = true; // 承認詳細から遷移した閲覧モード
            console.log('読み込んだbasicInfo:', this.basicInfo);
            console.log('読み込んだsocialInsurance:', this.socialInsurance);
            this.cdr.detectChanges();
          } else {
            console.warn(
              'employeeDataが見つかりませんでした。承認リクエスト:',
              result.data,
            );
          }
        } else if (result.type === 'employee' && result.data) {
          // 既存社員データは既にloadEmployeeDataで読み込まれている
          this.cdr.detectChanges();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadEmployeeData(employee: ShahoEmployee) {
    // 既存データを保存
    this.originalEmployee = { ...employee };

    // 性別のマッピング（データベースの「男」「女」をフォームの「男性」「女性」に変換）
    const normalizeGenderForForm = (gender?: string): string => {
      if (!gender) return '';
      const normalized = gender.trim();
      if (
        normalized === '男' ||
        normalized === '男性' ||
        normalized.toLowerCase() === 'male'
      ) {
        return '男性';
      }
      if (
        normalized === '女' ||
        normalized === '女性' ||
        normalized.toLowerCase() === 'female'
      ) {
        return '女性';
      }
      return normalized;
    };

    // 基本情報を設定
    const currentAddress = employee.currentAddress || '';
    this.basicInfo = {
      employeeNo: employee.employeeNo || '',
      name: employee.name || '',
      kana: employee.kana || '',
      gender: normalizeGenderForForm(employee.gender),
      birthDate: this.formatDateForInput(employee.birthDate) || '',
      department: employee.department || '',
      workPrefecture: employee.workPrefecture || '',
      myNumber: employee.personalNumber || '',
      basicPensionNumber: employee.basicPensionNumber || '',
      hasDependent: employee.hasDependent ?? undefined,
      postalCode: employee.postalCode || '',
      address: employee.address || '',
      currentAddress: currentAddress,
      isCurrentAddressSameAsResident:
        !currentAddress || currentAddress === employee.address,
    };

    // 社会保険情報を設定（詳細画面と同じロジック）
    const healthStandardMonthly = employee.healthStandardMonthly ?? 0;
    const welfareStandardMonthly = employee.welfareStandardMonthly ?? 0;
    // 介護保険第2号被保険者フラグは生年月日から自動判定
    const careSecondInsured = employee.birthDate
      ? calculateCareSecondInsured(employee.birthDate)
      : (employee.careSecondInsured ?? false);
    this.socialInsurance = {
      ...this.socialInsurance,
      pensionOffice: '',
      officeName: '',
      healthStandardMonthly,
      welfareStandardMonthly,
      healthCumulative: employee.standardBonusAnnualTotal ?? 0,
      healthInsuredNumber:
        employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
      pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
      careSecondInsured,
      healthAcquisition:
        this.formatDateForInput(employee.healthAcquisition) || '',
      pensionAcquisition:
        this.formatDateForInput(employee.pensionAcquisition) || '',
      currentLeaveStatus: employee.currentLeaveStatus || '',
      currentLeaveStartDate:
        this.formatDateForInput(employee.currentLeaveStartDate) || '',
      currentLeaveEndDate:
        this.formatDateForInput(employee.currentLeaveEndDate) || '',
      exemption: employee.exemption ?? this.socialInsurance.exemption,
    };

    // 扶養情報をdependentsサブコレクションから読み込む
    if (employee.id) {
      try {
        const dependents = await firstValueFrom(
          this.employeesService.getDependents(employee.id).pipe(take(1)),
        );
        this.dependentInfos = dependents.map((dependent) => ({
          relationship: dependent.relationship ?? '',
          nameKanji: dependent.nameKanji ?? '',
          nameKana: dependent.nameKana ?? '',
          birthDate: this.formatDateForInput(dependent.birthDate) || '',
          gender: dependent.gender ?? '',
          personalNumber: dependent.personalNumber ?? '',
          basicPensionNumber: dependent.basicPensionNumber ?? '',
          cohabitationType: dependent.cohabitationType ?? '',
          address: dependent.address ?? '',
          occupation: dependent.occupation ?? '',
          annualIncome: dependent.annualIncome ?? null,
          dependentStartDate:
            this.formatDateForInput(dependent.dependentStartDate) || '',
          thirdCategoryFlag: dependent.thirdCategoryFlag ?? false,
        }));
        // 元の扶養情報を保存（配列のコピー）
        this.originalDependentInfos = this.dependentInfos.map((dep) => ({
          ...dep,
        }));
      } catch (error) {
        console.error('扶養情報の読み込みに失敗しました:', error);
        this.dependentInfos = [];
        this.originalDependentInfos = [];
      }
    } else {
      this.dependentInfos = [];
      this.originalDependentInfos = [];
    }
  }

  /**
   * 年齢を計算
   */
  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * 日付をYYYY-MM-DD形式に変換（input type="date"用）
   */
  private formatDateForInput(date: string | Date | undefined): string {
    if (!date) return '';

    // 既にYYYY-MM-DD形式の文字列の場合はそのまま返す
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }

    // Dateオブジェクトまたは日付文字列を変換
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 生年月日変更時に介護保険第2号被保険者フラグを自動判定
   */
  onBirthDateChange(): void {
    if (this.basicInfo.birthDate) {
      this.socialInsurance.careSecondInsured = calculateCareSecondInsured(
        this.basicInfo.birthDate,
      );
    } else {
      this.socialInsurance.careSecondInsured = false;
    }
  }

  /**
   * 現在の休業状態が有効かどうかをチェック（空文字列または「なし」の場合は無効）
   */
  isCurrentLeaveStatusValid(): boolean {
    const status = this.socialInsurance.currentLeaveStatus;
    return status !== '' && status !== 'なし';
  }

  /**
   * 現在の休業状態変更時の処理
   */
  onCurrentLeaveStatusChange(): void {
    // 休業状態が空文字列または「なし」の場合は、日付フィールドをクリア
    if (!this.isCurrentLeaveStatusValid()) {
      this.socialInsurance.currentLeaveStartDate = '';
      this.socialInsurance.currentLeaveEndDate = '';
    }
  }

  /**
   * 郵便番号キー入力制御：数字とハイフンのみ許可
   */
  onPostalCodeKeypress(event: KeyboardEvent): void {
    // 特殊キー（Backspace、Delete、Tab、矢印キーなど）は許可
    if (
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      event.key === 'Tab' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      (event.ctrlKey && (event.key === 'a' || event.key === 'c' || event.key === 'v' || event.key === 'x'))
    ) {
      return;
    }

    // 数字（0-9）またはハイフン（-）のみ許可
    if (!/[\d-]/.test(event.key)) {
      event.preventDefault();
      return;
    }
  }

  /**
   * 郵便番号IME入力制御：IME入力を防ぐ
   */
  onPostalCodeCompositionStart(event: Event): void {
    event.preventDefault();
  }

  /**
   * 郵便番号入力制御：ハイフン有無に関わらず数字7桁までに制限
   */
  onPostalCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value;

    // 数字とハイフン以外の文字を除去
    const cleanedValue = value.replace(/[^\d-]/g, '');

    // ハイフンを除去して数字のみを取得
    const digitsOnly = cleanedValue.replace(/-/g, '');

    // 7桁を超える場合は7桁までに制限
    const limitedDigits = digitsOnly.slice(0, 7);

    // ハイフンを含む形式に変換（3桁-4桁）
    let formattedValue = limitedDigits;
    if (limitedDigits.length > 3) {
      formattedValue = `${limitedDigits.slice(0, 3)}-${limitedDigits.slice(3)}`;
    }

    // 入力要素の値を直接更新（即座に反映）
    input.value = formattedValue;
    
    // モデルの値も更新
    this.basicInfo.postalCode = formattedValue;
  }

  handleProceedApproval(form: NgForm) {
    this.submitAttempted = true;
    if (form.invalid) return;
    if (this.employeeNoDuplicateError) return;
    void this.sendApprovalRequest();
  }

  /**
   * 社員番号の重複チェック
   */
  async checkEmployeeNoDuplicate(): Promise<void> {
    const employeeNo = this.basicInfo.employeeNo?.trim();

    // 空の場合はチェックしない
    if (!employeeNo) {
      this.employeeNoDuplicateError = null;
      return;
    }

    // 編集モードで、現在の社員番号と同じ場合はチェックしない
    if (this.isEditMode && this.originalEmployee?.employeeNo === employeeNo) {
      this.employeeNoDuplicateError = null;
      return;
    }

    this.checkingDuplicate = true;
    this.employeeNoDuplicateError = null;

    try {
      // 既存の社員番号をチェック
      const employees = await firstValueFrom(
        this.employeesService.getEmployees().pipe(take(1)),
      );

      const duplicate = employees.find(
        (emp) =>
          emp.employeeNo?.trim() === employeeNo && emp.id !== this.employeeId,
      );

      if (duplicate) {
        this.employeeNoDuplicateError = 'この社員番号は既に使用されています。';
        this.checkingDuplicate = false;
        this.cdr.detectChanges();
        return;
      }

      // 承認待ちの新規社員登録リクエストの社員番号をチェック
      const requests = await firstValueFrom(
        this.approvalWorkflowService.requests$.pipe(take(1)),
      );

      const pendingNewEmployeeRequest = requests.find((request) => {
        // 承認待ち状態でない場合はスキップ
        if (request.status !== 'pending') {
          return false;
        }

        // 新規社員登録のカテゴリのみチェック
        if (request.category !== '新規社員登録') {
          return false;
        }

        // employeeDiffsの社員番号をチェック
        const diffs = request.employeeDiffs || [];
        const hasDuplicateInDiffs = diffs.some(
          (diff) => diff.employeeNo?.trim() === employeeNo,
        );

        if (hasDuplicateInDiffs) {
          return true;
        }

        // employeeDataの社員番号もチェック（念のため）
        const requestEmployeeNo =
          request.employeeData?.basicInfo?.employeeNo?.trim();
        if (requestEmployeeNo === employeeNo) {
          return true;
        }

        return false;
      });

      if (pendingNewEmployeeRequest) {
        this.employeeNoDuplicateError =
          'この社員番号は承認待ちの新規社員登録申請で既に使用されています。';
      } else {
        this.employeeNoDuplicateError = null;
      }
    } catch (error) {
      console.error('社員番号の重複チェックに失敗しました:', error);
      // エラーが発生してもユーザーをブロックしない
      this.employeeNoDuplicateError = null;
    } finally {
      this.checkingDuplicate = false;
      this.cdr.detectChanges();
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

  private async sendApprovalRequest(): Promise<void> {
    const roles = await firstValueFrom(this.authService.userRoles$);
    const canApply = roles.some((role) =>
      [RoleKey.Operator, RoleKey.Approver, RoleKey.SystemAdmin].includes(role),
    );

    if (!canApply) {
      this.approvalMessage =
        '承認依頼の起票権限がありません。担当者/承認者/システム管理者のみ起票できます。';
      return;
    }

    if (!this.selectedFlow) {
      this.approvalMessage = '承認フローを選択してください。';
      return;
    }

    // 編集モードの場合、同じ社員に対する承認待ちリクエストが既に存在するかチェック
    const isEdit = this.isEditMode && this.originalEmployee && this.employeeId;
    const employeeNo = this.basicInfo.employeeNo || null;
    
    if (isEdit) {
      const existingPendingRequest = this.approvalWorkflowService.getPendingRequestForEmployee(
        this.employeeId,
        employeeNo,
      );

      if (existingPendingRequest) {
        const requestTitle = existingPendingRequest.title || '承認待ちの申請';
        this.approvalMessage = `この社員には既に承認待ちの申請が存在します（${requestTitle}）。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。`;
        return;
      }
    } else {
      // 新規登録モードの場合、同じ社員番号の承認待ちリクエストが既に存在するかチェック
      if (employeeNo) {
        const existingPendingRequest = this.approvalWorkflowService.getPendingRequestForEmployee(
          null,
          employeeNo,
        );

        if (existingPendingRequest) {
          const requestTitle = existingPendingRequest.title || '承認待ちの申請';
          this.approvalMessage = `この社員番号は承認待ちの新規社員登録申請で既に使用されています（${requestTitle}）。既存の申請が承認または差し戻しされるまで、新しい申請を作成できません。`;
          return;
        }
      }
    }

    const validation = this.attachmentService.validateFiles(this.selectedFiles);
    this.validationErrors = validation.errors;
    this.dependentValidationError = null;

    if (!validation.valid && this.selectedFiles.length) {
      alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
      return;
    }

    const filledDependentInfos = this.filterDependentsWithData(
      this.dependentInfos,
    );
    if (
      this.basicInfo.hasDependent === true &&
      filledDependentInfos.length === 0
    ) {
      this.dependentValidationError =
        '扶養の有無を「有」にした場合は、扶養情報を1件以上入力してください。';
      return;
    }

    // 扶養の有無が「有」の場合、各扶養情報について続柄と氏名（漢字）が必須
    if (this.basicInfo.hasDependent === true) {
      for (let i = 0; i < this.dependentInfos.length; i++) {
        const dep = this.dependentInfos[i];
        // 何らかのデータが入力されている場合のみチェック
        const hasAnyData = this.hasDependentData(dep);
        if (hasAnyData) {
          if (!dep.relationship || dep.relationship.trim() === '') {
            this.dependentValidationError = `扶養情報${i + 1}の続柄は必須です。`;
            return;
          }
          if (!dep.nameKanji || dep.nameKanji.trim() === '') {
            this.dependentValidationError = `扶養情報${i + 1}の氏名（漢字）は必須です。`;
            return;
          }
        }
      }
    }

    this.sendingApproval = true;
    this.approvalMessage = '';

    try {
      const steps = this.selectedFlow.steps.map((step) => ({
        stepOrder: step.order,
        status: 'waiting' as const,
      }));

      const displayName =
        this.basicInfo.name || this.basicInfo.employeeNo || '新規社員';
      const isEdit =
        this.isEditMode && this.originalEmployee && this.employeeId;

      // 差分情報を作成（編集モードの場合は既存データとの差分を計算）
      const employeeDiffs: ApprovalEmployeeDiff[] = [
        {
          employeeNo: this.basicInfo.employeeNo || '',
          name: this.basicInfo.name || '',
          status: 'ok',
          isNew: !isEdit,
          existingEmployeeId:
            isEdit && this.employeeId ? this.employeeId : undefined,
          changes: isEdit
            ? this.createEmployeeChangesFromDiff()
            : this.createEmployeeChanges(),
        },
      ];

      // 一時保存用の社員データ
      // dependentInfoは後方互換性のため残すが、dependentInfos配列も保存
      const healthStandardMonthly =
        this.socialInsurance.healthStandardMonthly || 0;
      const welfareStandardMonthly =
        this.socialInsurance.welfareStandardMonthly || 0;
      const dependentInfosForRequest =
      this.basicInfo.hasDependent === false
      ? []
      : filledDependentInfos.length > 0
        ? filledDependentInfos
        : [];
      const employeeData = {
        basicInfo: { ...this.basicInfo },
        socialInsurance: {
          ...this.socialInsurance,
          healthStandardMonthly,
          welfareStandardMonthly,
        },
        dependentInfo:
        filledDependentInfos.length > 0
        ? { ...filledDependentInfos[0] }
        : undefined,
    // dependentInfos は hasDependent=false の場合は空配列、入力済みがあれば配列を渡す（空配列は「変更なし」扱い）
        dependentInfos: dependentInfosForRequest,
      } as any;

      console.log(
        '承認リクエスト作成時のemployeeData:',
        JSON.stringify(employeeData, null, 2),
      );
      console.log(
        'this.dependentInfos:',
        JSON.stringify(this.dependentInfos, null, 2),
      );
      console.log('this.basicInfo.hasDependent:', this.basicInfo.hasDependent);

      const createdAt = new Date();
      const dueDate = new Date(createdAt);
      dueDate.setDate(dueDate.getDate() + 14);

      const request: ApprovalRequest = {
        title: isEdit
          ? `社員情報更新（${displayName}）`
          : `社員新規登録（${displayName}）`,
        category: isEdit ? '社員情報更新' : '新規社員登録',
        targetCount: 1,
        applicantId: this.applicantId,
        applicantName: this.applicantName,
        flowId: this.selectedFlow.id ?? 'employee-create-flow',
        flowSnapshot: this.selectedFlow,
        status: 'pending',
        currentStep: this.selectedFlow.steps[0]?.order,
        comment:
          this.requestComment ||
          (isEdit
            ? '入力内容を承認後に更新します。'
            : '入力内容を承認後に登録します。'),
        steps,
        histories: [],
        attachments: [],
        employeeDiffs,
        employeeData,
        createdAt: Timestamp.fromDate(createdAt),
        dueDate: Timestamp.fromDate(dueDate),
      };

      console.log('保存するrequest:', request);
      console.log('request.employeeData:', request.employeeData);

      const savedBase = await this.approvalWorkflowService.saveRequest(request);

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

      // 承認プロセスを開始
      // 注意: 反映処理は承認側（approval-detail.component.ts）で実行されるため、
      // ここでは反映処理を行わない（二重実行を防ぐため）
      const result = await this.approvalWorkflowService.startApprovalProcess({
        request: { ...saved, id: saved.id },
        onApproved: async () => {
          // 承認完了時の通知のみ（反映処理は承認側で実行）
          console.log('承認が完了しました。反映処理は承認側で実行されます。');
        },
        onFailed: () => {
          this.approvalMessage = '承認が完了しませんでした。';
        },
        setMessage: (message) => (this.approvalMessage = message),
        setLoading: (loading) => (this.sendingApproval = loading),
      });

      if (result) {
        this.approvalMessage = '承認依頼を送信しました。';

        // 通知を送信
        this.pushApprovalNotifications({ ...saved, id: result.requestId });

        // メッセージを表示してから少し待ってから遷移
        setTimeout(() => {
          if (this.isEditMode && this.employeeId) {
            // 編集モードの場合は社員詳細画面に遷移
            this.router.navigate(['/employees', this.employeeId]);
          } else {
            // 新規登録モードの場合は社員一覧画面に遷移
            this.router.navigate(['/employees']);
          }
        }, 1000);
      } else {
        this.approvalMessage =
          '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
      }
    } catch (error) {
      console.error(error);
      this.approvalMessage =
        '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.sendingApproval = false;
    }
  }

  onFlowSelected(flow?: ApprovalFlow): void {
    this.selectedFlow = flow ?? undefined;
    this.selectedFlowId = flow?.id ?? null;
  }

  /**
   * 新しい扶養情報を追加
   */
  addDependentInfo(): void {
    this.dependentInfos.push({
      relationship: '',
      nameKanji: '',
      nameKana: '',
      birthDate: '',
      gender: '',
      personalNumber: '',
      basicPensionNumber: '',
      cohabitationType: '',
      address: '',
      occupation: '',
      annualIncome: null,
      dependentStartDate: '',
      thirdCategoryFlag: false,
    });
  }

  /**
   * 扶養情報を削除
   */
  removeDependentInfo(index: number): void {
    this.dependentInfos.splice(index, 1);
  }

  /**
   * 現住所チェックボックスの変更時の処理
   */
  onCurrentAddressCheckboxChange(): void {
    if (this.basicInfo.isCurrentAddressSameAsResident) {
      // チェックが入った場合、現住所をクリア
      this.basicInfo.currentAddress = '';
    }
  }

  private removeUndefinedFields<T extends Record<string, unknown>>(
    obj: T,
  ): Partial<T> {
    const cleaned: Partial<T> = {};
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      // undefined と空文字列を除外
      if (value !== undefined && value !== '') {
        cleaned[key as keyof T] = value as T[keyof T];
      }
    });
    return cleaned;
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

  private filterDependentsWithData(
    dependents: Array<Partial<DependentData>>,
  ): Array<Partial<DependentData>> {
    return dependents.filter((dep) => this.hasDependentData(dep));
  }

  private formatHasDependent(value?: boolean): string {
    if (value === undefined) return '未入力';
    return value ? '有' : '無';
  }

  onFlowsUpdated(flows: ApprovalFlow[]): void {
    if (!this.selectedFlow && flows[0]) {
      this.selectedFlow = flows[0];
      this.selectedFlowId = flows[0].id ?? null;
    }
  }

  /**
   * フォームの入力値を差分情報のchanges配列に変換
   */
  private createEmployeeChanges(): {
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }[] {
    const changes: {
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }[] = [];

    // 基本情報
    if (this.basicInfo.employeeNo) {
      changes.push({
        field: '社員番号',
        oldValue: null,
        newValue: this.basicInfo.employeeNo,
      });
    }
    if (this.basicInfo.name) {
      changes.push({
        field: '氏名(漢字)',
        oldValue: null,
        newValue: this.basicInfo.name,
      });
    }
    if (this.basicInfo.kana) {
      changes.push({
        field: '氏名(カナ)',
        oldValue: null,
        newValue: this.basicInfo.kana,
      });
    }
    if (this.basicInfo.gender) {
      changes.push({
        field: '性別',
        oldValue: null,
        newValue: this.basicInfo.gender,
      });
    }
    if (this.basicInfo.birthDate) {
      changes.push({
        field: '生年月日',
        oldValue: null,
        newValue: this.basicInfo.birthDate,
      });
    }
    if (this.basicInfo.department) {
      changes.push({
        field: '部署',
        oldValue: null,
        newValue: this.basicInfo.department,
      });
    }
    if (this.basicInfo.workPrefecture) {
      changes.push({
        field: '勤務都道府県',
        oldValue: null,
        newValue: this.basicInfo.workPrefecture,
      });
    }
    if (this.basicInfo.myNumber) {
      changes.push({
        field: 'マイナンバー',
        oldValue: null,
        newValue: this.basicInfo.myNumber,
      });
    }
    if (this.basicInfo.basicPensionNumber) {
      changes.push({
        field: '基礎年金番号',
        oldValue: null,
        newValue: this.basicInfo.basicPensionNumber,
      });
    }
    changes.push({
      field: '扶養の有無',
      oldValue: null,
      newValue: this.formatHasDependent(this.basicInfo.hasDependent),
    });
    if (this.basicInfo.postalCode) {
      changes.push({
        field: '郵便番号',
        oldValue: null,
        newValue: this.basicInfo.postalCode,
      });
    }
    if (this.basicInfo.address) {
      changes.push({
        field: '住民票住所',
        oldValue: null,
        newValue: this.basicInfo.address,
      });
    }
    if (
      !this.basicInfo.isCurrentAddressSameAsResident &&
      this.basicInfo.currentAddress
    ) {
      changes.push({
        field: '現住所',
        oldValue: null,
        newValue: this.basicInfo.currentAddress,
      });
    }

    // 社会保険情報
    if (this.socialInsurance.pensionOffice) {
      changes.push({
        field: '年金事務所',
        oldValue: null,
        newValue: this.socialInsurance.pensionOffice,
      });
    }
    if (this.socialInsurance.officeName) {
      changes.push({
        field: '事業所名',
        oldValue: null,
        newValue: this.socialInsurance.officeName,
      });
    }
    if (this.socialInsurance.healthStandardMonthly !== 0) {
      changes.push({
        field: '健保標準報酬月額',
        oldValue: null,
        newValue: String(this.socialInsurance.healthStandardMonthly),
      });
    }
    if (this.socialInsurance.welfareStandardMonthly !== 0) {
      changes.push({
        field: '厚年標準報酬月額',
        oldValue: null,
        newValue: String(this.socialInsurance.welfareStandardMonthly),
      });
    }
    if (this.socialInsurance.healthCumulative !== 0) {
      changes.push({
        field: '標準賞与額累計',
        oldValue: null,
        newValue: String(this.socialInsurance.healthCumulative),
      });
    }
    if (this.socialInsurance.healthInsuredNumber) {
      changes.push({
        field: '健康保険被保険者番号',
        oldValue: null,
        newValue: this.socialInsurance.healthInsuredNumber,
      });
    }
    if (this.socialInsurance.pensionInsuredNumber) {
      changes.push({
        field: '厚生年金被保険者番号',
        oldValue: null,
        newValue: this.socialInsurance.pensionInsuredNumber,
      });
    }
    changes.push({
      field: '介護保険第2号被保険者',
      oldValue: null,
      newValue: this.socialInsurance.careSecondInsured ? 'はい' : 'いいえ',
    });
    if (this.socialInsurance.healthAcquisition) {
      changes.push({
        field: '健康保険取得年月日',
        oldValue: null,
        newValue: this.socialInsurance.healthAcquisition,
      });
    }
    if (this.socialInsurance.pensionAcquisition) {
      changes.push({
        field: '厚生年金取得年月日',
        oldValue: null,
        newValue: this.socialInsurance.pensionAcquisition,
      });
    }
    if (this.socialInsurance.currentLeaveStatus) {
      changes.push({
        field: '現在の休業状態',
        oldValue: null,
        newValue: this.socialInsurance.currentLeaveStatus,
      });
    }
    if (this.socialInsurance.currentLeaveStartDate) {
      changes.push({
        field: '現在の休業開始日',
        oldValue: null,
        newValue: this.socialInsurance.currentLeaveStartDate,
      });
    }
    if (this.socialInsurance.currentLeaveEndDate) {
      changes.push({
        field: '現在の休業予定終了日',
        oldValue: null,
        newValue: this.socialInsurance.currentLeaveEndDate,
      });
    }
    changes.push({
      field: '保険料免除',
      oldValue: null,
      newValue: this.socialInsurance.exemption ? 'はい' : 'いいえ',
    });

    // 扶養情報
    if (this.basicInfo.hasDependent && this.dependentInfos.length > 0) {
      this.dependentInfos.forEach((dependentInfo, index) => {
        const prefix =
          this.dependentInfos.length > 1 ? `扶養${index + 1} ` : '扶養 ';
        if (dependentInfo.relationship) {
          changes.push({
            field: `${prefix}続柄`,
            oldValue: null,
            newValue: dependentInfo.relationship,
          });
        }
        if (dependentInfo.nameKanji) {
          changes.push({
            field: `${prefix}氏名(漢字)`,
            oldValue: null,
            newValue: dependentInfo.nameKanji,
          });
        }
        if (dependentInfo.nameKana) {
          changes.push({
            field: `${prefix}氏名(カナ)`,
            oldValue: null,
            newValue: dependentInfo.nameKana,
          });
        }
        if (dependentInfo.birthDate) {
          changes.push({
            field: `${prefix}生年月日`,
            oldValue: null,
            newValue: dependentInfo.birthDate,
          });
        }
        if (dependentInfo.gender) {
          changes.push({
            field: `${prefix}性別`,
            oldValue: null,
            newValue: dependentInfo.gender,
          });
        }
        if (dependentInfo.personalNumber) {
          changes.push({
            field: `${prefix}個人番号`,
            oldValue: null,
            newValue: dependentInfo.personalNumber,
          });
        }
        if (dependentInfo.basicPensionNumber) {
          changes.push({
            field: `${prefix}基礎年金番号`,
            oldValue: null,
            newValue: dependentInfo.basicPensionNumber,
          });
        }
        if (dependentInfo.cohabitationType) {
          changes.push({
            field: `${prefix}同居区分`,
            oldValue: null,
            newValue: dependentInfo.cohabitationType,
          });
        }
        if (dependentInfo.address) {
          changes.push({
            field: `${prefix}住所`,
            oldValue: null,
            newValue: dependentInfo.address,
          });
        }
        if (dependentInfo.occupation) {
          changes.push({
            field: `${prefix}職業`,
            oldValue: null,
            newValue: dependentInfo.occupation,
          });
        }
        if (dependentInfo.annualIncome !== null) {
          changes.push({
            field: `${prefix}年収`,
            oldValue: null,
            newValue: String(dependentInfo.annualIncome),
          });
        }
        if (dependentInfo.dependentStartDate) {
          changes.push({
            field: `${prefix}開始日`,
            oldValue: null,
            newValue: dependentInfo.dependentStartDate,
          });
        }
        changes.push({
          field: `${prefix}第3号被保険者`,
          oldValue: null,
          newValue: dependentInfo.thirdCategoryFlag ? 'はい' : 'いいえ',
        });
      });
    }

    return changes;
  }

  /** 編集モード用：既存データとの差分を計算 */
  private createEmployeeChangesFromDiff(): {
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }[] {
    if (!this.originalEmployee) {
      return this.createEmployeeChanges();
    }

    const changes: {
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }[] = [];
    const original = this.originalEmployee;

    // 性別の正規化関数
    const normalizeGender = (gender?: string): string => {
      if (!gender) return '';
      const normalized = gender.trim();
      if (
        normalized === '男' ||
        normalized === '男性' ||
        normalized.toLowerCase() === 'male'
      ) {
        return '男性';
      }
      if (
        normalized === '女' ||
        normalized === '女性' ||
        normalized.toLowerCase() === 'female'
      ) {
        return '女性';
      }
      return normalized;
    };

    // 基本情報の差分
    if (original.employeeNo !== this.basicInfo.employeeNo) {
      changes.push({
        field: '社員番号',
        oldValue: original.employeeNo || null,
        newValue: this.basicInfo.employeeNo || null,
      });
    }
    if (original.name !== this.basicInfo.name) {
      changes.push({
        field: '氏名(漢字)',
        oldValue: original.name || null,
        newValue: this.basicInfo.name || null,
      });
    }
    if (original.kana !== this.basicInfo.kana) {
      changes.push({
        field: '氏名(カナ)',
        oldValue: original.kana || null,
        newValue: this.basicInfo.kana || null,
      });
    }
    if (normalizeGender(original.gender) !== this.basicInfo.gender) {
      changes.push({
        field: '性別',
        oldValue: normalizeGender(original.gender) || null,
        newValue: this.basicInfo.gender || null,
      });
    }
    const originalBirthDate = this.formatDateForInput(original.birthDate);
    if (originalBirthDate !== this.basicInfo.birthDate) {
      changes.push({
        field: '生年月日',
        oldValue: originalBirthDate || null,
        newValue: this.basicInfo.birthDate || null,
      });
    }
    if (original.department !== this.basicInfo.department) {
      changes.push({
        field: '部署',
        oldValue: original.department || null,
        newValue: this.basicInfo.department || null,
      });
    }
    if (original.workPrefecture !== this.basicInfo.workPrefecture) {
      changes.push({
        field: '勤務都道府県',
        oldValue: original.workPrefecture || null,
        newValue: this.basicInfo.workPrefecture || null,
      });
    }
    if (original.personalNumber !== this.basicInfo.myNumber) {
      changes.push({
        field: 'マイナンバー',
        oldValue: original.personalNumber || null,
        newValue: this.basicInfo.myNumber || null,
      });
    }
    if (original.basicPensionNumber !== this.basicInfo.basicPensionNumber) {
      changes.push({
        field: '基礎年金番号',
        oldValue: original.basicPensionNumber || null,
        newValue: this.basicInfo.basicPensionNumber || null,
      });
    }
    if (original.postalCode !== this.basicInfo.postalCode) {
      changes.push({
        field: '郵便番号',
        oldValue: original.postalCode || null,
        newValue: this.basicInfo.postalCode || null,
      });
    }
    if (original.address !== this.basicInfo.address) {
      changes.push({
        field: '住民票住所',
        oldValue: original.address || null,
        newValue: this.basicInfo.address || null,
      });
    }
    const originalCurrentAddress = original.currentAddress || '';
    const newCurrentAddress = this.basicInfo.isCurrentAddressSameAsResident
      ? ''
      : this.basicInfo.currentAddress || '';
    if (originalCurrentAddress !== newCurrentAddress) {
      changes.push({
        field: '現住所',
        oldValue: originalCurrentAddress || null,
        newValue: newCurrentAddress || null,
      });
    }

    // 社会保険情報の差分
    const originalHealthStandardMonthly = original.healthStandardMonthly ?? 0;
    const originalWelfareStandardMonthly = original.welfareStandardMonthly ?? 0;
    const newHealthStandardMonthly =
      this.socialInsurance.healthStandardMonthly ?? 0;
    const newWelfareStandardMonthly =
      this.socialInsurance.welfareStandardMonthly ?? 0;

    if (originalHealthStandardMonthly !== newHealthStandardMonthly) {
      changes.push({
        field: '健保標準報酬月額',
        oldValue: originalHealthStandardMonthly
          ? String(originalHealthStandardMonthly)
          : null,
        newValue: newHealthStandardMonthly
          ? String(newHealthStandardMonthly)
          : null,
      });
    }
    if (originalWelfareStandardMonthly !== newWelfareStandardMonthly) {
      changes.push({
        field: '厚年標準報酬月額',
        oldValue: originalWelfareStandardMonthly
          ? String(originalWelfareStandardMonthly)
          : null,
        newValue: newWelfareStandardMonthly
          ? String(newWelfareStandardMonthly)
          : null,
      });
    }
    if (
      (original.standardBonusAnnualTotal ?? 0) !==
      this.socialInsurance.healthCumulative
    ) {
      changes.push({
        field: '標準賞与額累計',
        oldValue: original.standardBonusAnnualTotal
          ? String(original.standardBonusAnnualTotal)
          : null,
        newValue: this.socialInsurance.healthCumulative
          ? String(this.socialInsurance.healthCumulative)
          : null,
      });
    }
    const originalHealthInsuredNumber =
      original.healthInsuredNumber || original.insuredNumber || '';
    if (
      originalHealthInsuredNumber !== this.socialInsurance.healthInsuredNumber
    ) {
      changes.push({
        field: '健康保険被保険者番号',
        oldValue: originalHealthInsuredNumber || null,
        newValue: this.socialInsurance.healthInsuredNumber || null,
      });
    }
    if (
      original.pensionInsuredNumber !==
      this.socialInsurance.pensionInsuredNumber
    ) {
      changes.push({
        field: '厚生年金被保険者番号',
        oldValue: original.pensionInsuredNumber || null,
        newValue: this.socialInsurance.pensionInsuredNumber || null,
      });
    }
    if (
      (original.careSecondInsured ?? false) !==
      this.socialInsurance.careSecondInsured
    ) {
      changes.push({
        field: '介護保険第2号被保険者',
        oldValue: (original.careSecondInsured ?? false) ? 'はい' : 'いいえ',
        newValue: this.socialInsurance.careSecondInsured ? 'はい' : 'いいえ',
      });
    }
    const originalHealthAcquisition = this.formatDateForInput(
      original.healthAcquisition,
    );
    if (originalHealthAcquisition !== this.socialInsurance.healthAcquisition) {
      changes.push({
        field: '健康保険取得年月日',
        oldValue: originalHealthAcquisition || null,
        newValue: this.socialInsurance.healthAcquisition || null,
      });
    }
    const originalPensionAcquisition = this.formatDateForInput(
      original.pensionAcquisition,
    );
    if (
      originalPensionAcquisition !== this.socialInsurance.pensionAcquisition
    ) {
      changes.push({
        field: '厚生年金取得年月日',
        oldValue: originalPensionAcquisition || null,
        newValue: this.socialInsurance.pensionAcquisition || null,
      });
    }
    const originalCurrentLeaveStatus = original.currentLeaveStatus || '';
    if (
      originalCurrentLeaveStatus !== this.socialInsurance.currentLeaveStatus
    ) {
      changes.push({
        field: '現在の休業状態',
        oldValue: originalCurrentLeaveStatus || null,
        newValue: this.socialInsurance.currentLeaveStatus || null,
      });
    }
    const originalCurrentLeaveStartDate = this.formatDateForInput(
      original.currentLeaveStartDate,
    );
    if (
      originalCurrentLeaveStartDate !==
      this.socialInsurance.currentLeaveStartDate
    ) {
      changes.push({
        field: '現在の休業開始日',
        oldValue: originalCurrentLeaveStartDate || null,
        newValue: this.socialInsurance.currentLeaveStartDate || null,
      });
    }
    const originalCurrentLeaveEndDate = this.formatDateForInput(
      original.currentLeaveEndDate,
    );
    if (
      originalCurrentLeaveEndDate !== this.socialInsurance.currentLeaveEndDate
    ) {
      changes.push({
        field: '現在の休業予定終了日',
        oldValue: originalCurrentLeaveEndDate || null,
        newValue: this.socialInsurance.currentLeaveEndDate || null,
      });
    }
    if ((original.exemption ?? false) !== this.socialInsurance.exemption) {
      changes.push({
        field: '保険料免除',
        oldValue: (original.exemption ?? false) ? 'はい' : 'いいえ',
        newValue: this.socialInsurance.exemption ? 'はい' : 'いいえ',
      });
    }

    // 扶養情報の差分（複数件対応）
    const originalHasDependent = original.hasDependent;
    const newHasDependent = this.basicInfo.hasDependent;
    const hasDependentChanged = originalHasDependent !== newHasDependent;

    // 既存の扶養情報を取得（編集モードの場合）
    const originalDependents = [...this.originalDependentInfos];

    // 扶養の有無が変更された場合のみ差分を追加
    if (hasDependentChanged) {
      changes.push({
        field: '扶養の有無',
        oldValue: this.formatHasDependent(originalHasDependent),
        newValue: this.formatHasDependent(newHasDependent),
      });
    }

    // 扶養情報が存在する場合のみ、実際の変更をチェック
    const shouldCheckDependents =
      (newHasDependent ?? false) ||
      (originalHasDependent ?? false) ||
      this.dependentInfos.length > 0 ||
      originalDependents.length > 0;

    if (shouldCheckDependents) {
      // 新しい扶養情報と既存の扶養情報を比較
      const maxLength = Math.max(
        this.dependentInfos.length,
        originalDependents.length,
      );
      for (let i = 0; i < maxLength; i++) {
        const prefix = maxLength > 1 ? `扶養${i + 1} ` : '扶養 ';
        const newDep = this.dependentInfos[i];
        const oldDep = originalDependents[i];

        if (!oldDep && newDep) {
          // 新規追加：有効なデータがある場合のみ差分を追加
          const hasNewData = Object.values(newDep).some(
            (value) =>
              value !== '' &&
              value !== null &&
              value !== false &&
              value !== undefined,
          );
          if (hasNewData) {
            if (newDep.relationship)
              changes.push({
                field: `${prefix}続柄`,
                oldValue: null,
                newValue: newDep.relationship,
              });
            if (newDep.nameKanji)
              changes.push({
                field: `${prefix}氏名(漢字)`,
                oldValue: null,
                newValue: newDep.nameKanji,
              });
            if (newDep.nameKana)
              changes.push({
                field: `${prefix}氏名(カナ)`,
                oldValue: null,
                newValue: newDep.nameKana,
              });
            if (newDep.birthDate)
              changes.push({
                field: `${prefix}生年月日`,
                oldValue: null,
                newValue: newDep.birthDate,
              });
            if (newDep.gender)
              changes.push({
                field: `${prefix}性別`,
                oldValue: null,
                newValue: newDep.gender,
              });
            if (newDep.personalNumber)
              changes.push({
                field: `${prefix}個人番号`,
                oldValue: null,
                newValue: newDep.personalNumber,
              });
            if (newDep.basicPensionNumber)
              changes.push({
                field: `${prefix}基礎年金番号`,
                oldValue: null,
                newValue: newDep.basicPensionNumber,
              });
            if (newDep.cohabitationType)
              changes.push({
                field: `${prefix}同居区分`,
                oldValue: null,
                newValue: newDep.cohabitationType,
              });
            if (newDep.address)
              changes.push({
                field: `${prefix}住所`,
                oldValue: null,
                newValue: newDep.address,
              });
            if (newDep.occupation)
              changes.push({
                field: `${prefix}職業`,
                oldValue: null,
                newValue: newDep.occupation,
              });
            if (
              newDep.annualIncome !== null &&
              newDep.annualIncome !== undefined
            ) {
              changes.push({
                field: `${prefix}年収`,
                oldValue: null,
                newValue: String(newDep.annualIncome),
              });
            }
            if (newDep.dependentStartDate)
              changes.push({
                field: `${prefix}開始日`,
                oldValue: null,
                newValue: newDep.dependentStartDate,
              });
            changes.push({
              field: `${prefix}第3号被保険者`,
              oldValue: null,
              newValue: newDep.thirdCategoryFlag ? 'はい' : 'いいえ',
            });
          }
        } else if (oldDep && !newDep) {
          // 削除：有効なデータがあった場合のみ差分を追加
          const hasOldData = Object.values(oldDep).some(
            (value) =>
              value !== '' &&
              value !== null &&
              value !== false &&
              value !== undefined,
          );
          if (hasOldData) {
            changes.push({
              field: `${prefix}削除`,
              oldValue: oldDep.nameKanji || 'あり',
              newValue: null,
            });
          }
        } else if (oldDep && newDep) {
          // 変更：実際に値が異なる場合のみ差分を追加
          if (oldDep.relationship !== newDep.relationship) {
            changes.push({
              field: `${prefix}続柄`,
              oldValue: oldDep.relationship || null,
              newValue: newDep.relationship || null,
            });
          }
          if (oldDep.nameKanji !== newDep.nameKanji) {
            changes.push({
              field: `${prefix}氏名(漢字)`,
              oldValue: oldDep.nameKanji || null,
              newValue: newDep.nameKanji || null,
            });
          }
          if (oldDep.nameKana !== newDep.nameKana) {
            changes.push({
              field: `${prefix}氏名(カナ)`,
              oldValue: oldDep.nameKana || null,
              newValue: newDep.nameKana || null,
            });
          }
          const oldBirthDate = this.formatDateForInput(oldDep.birthDate);
          if (oldBirthDate !== newDep.birthDate) {
            changes.push({
              field: `${prefix}生年月日`,
              oldValue: oldBirthDate || null,
              newValue: newDep.birthDate || null,
            });
          }
          if (oldDep.gender !== newDep.gender) {
            changes.push({
              field: `${prefix}性別`,
              oldValue: oldDep.gender || null,
              newValue: newDep.gender || null,
            });
          }
          if (oldDep.personalNumber !== newDep.personalNumber) {
            changes.push({
              field: `${prefix}個人番号`,
              oldValue: oldDep.personalNumber || null,
              newValue: newDep.personalNumber || null,
            });
          }
          if (oldDep.basicPensionNumber !== newDep.basicPensionNumber) {
            changes.push({
              field: `${prefix}基礎年金番号`,
              oldValue: oldDep.basicPensionNumber || null,
              newValue: newDep.basicPensionNumber || null,
            });
          }
          if (oldDep.cohabitationType !== newDep.cohabitationType) {
            changes.push({
              field: `${prefix}同居区分`,
              oldValue: oldDep.cohabitationType || null,
              newValue: newDep.cohabitationType || null,
            });
          }
          if (oldDep.address !== newDep.address) {
            changes.push({
              field: `${prefix}住所`,
              oldValue: oldDep.address || null,
              newValue: newDep.address || null,
            });
          }
          if (oldDep.occupation !== newDep.occupation) {
            changes.push({
              field: `${prefix}職業`,
              oldValue: oldDep.occupation || null,
              newValue: newDep.occupation || null,
            });
          }
          if ((oldDep.annualIncome ?? null) !== newDep.annualIncome) {
            changes.push({
              field: `${prefix}年収`,
              oldValue:
                oldDep.annualIncome !== null
                  ? String(oldDep.annualIncome)
                  : null,
              newValue:
                newDep.annualIncome !== null
                  ? String(newDep.annualIncome)
                  : null,
            });
          }
          const oldStartDate = this.formatDateForInput(
            oldDep.dependentStartDate,
          );
          if (oldStartDate !== newDep.dependentStartDate) {
            changes.push({
              field: `${prefix}開始日`,
              oldValue: oldStartDate || null,
              newValue: newDep.dependentStartDate || null,
            });
          }
          if (
            (oldDep.thirdCategoryFlag ?? false) !== newDep.thirdCategoryFlag
          ) {
            changes.push({
              field: `${prefix}第3号被保険者`,
              oldValue: (oldDep.thirdCategoryFlag ?? false) ? 'はい' : 'いいえ',
              newValue: newDep.thirdCategoryFlag ? 'はい' : 'いいえ',
            });
          }
        }
      }
    }

    return changes;
  }

  private pushApprovalNotifications(request: ApprovalRequest): void {
    const notifications: ApprovalNotification[] = [];

    const applicantNotification: ApprovalNotification = {
      id: `ntf-${Date.now()}`,
      requestId: request.id ?? request.title,
      recipientId: request.applicantId,
      message: `${request.title} を起票しました（${request.targetCount}件）。`,
      unread: true,
      createdAt: new Date(),
      type: 'info',
    };
    notifications.push(applicantNotification);

    const currentStep = request.steps.find(
      (step) => step.stepOrder === request.currentStep,
    );
    const candidates = currentStep
      ? (request.flowSnapshot?.steps.find(
          (step) => step.order === currentStep.stepOrder,
        )?.candidates ?? [])
      : [];

    candidates.forEach((candidate) => {
      notifications.push({
        id: `ntf-${Date.now()}-${candidate.id}`,
        requestId: request.id ?? request.title,
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
}
