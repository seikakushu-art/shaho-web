import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { Subject, switchMap, takeUntil, of, firstValueFrom, combineLatest, map, take, filter, timeout, catchError } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService, DependentData } from '../../app/services/shaho-employees.service';
import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';
import { ApprovalFlow, ApprovalHistory, ApprovalRequest, ApprovalEmployeeDiff, ApprovalNotification, ApprovalAttachmentMetadata } from '../../models/approvals';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { ApprovalNotificationService } from '../../approvals/approval-notification.service';
import { ApprovalAttachmentService } from '../../approvals/approval-attachment.service';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth.service';
import { RoleKey } from '../../models/roles';
import { UserDirectoryService } from '../../auth/user-directory.service';

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
    employeeNoDuplicateError: string | null = null;
    checkingDuplicate = false;
  
    basicInfo = {
      employeeNo: '',
      name: '',
      kana: '',
      gender: '',
      birthDate: '',
      department: '',
      workPrefecture: '',
      myNumber: '',
      basicPensionNumber: '',
      hasDependent: false,
      postalCode: '',
      address: '',
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
      childcareLeaveStart: '',
      childcareLeaveEnd: '',
      maternityLeaveStart: '',
      maternityLeaveEnd: '',
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
      this.authService.user$
        .pipe(takeUntil(this.destroy$))
        .subscribe((user) => {
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
                    console.log('承認リクエストの全フィールド:', Object.keys(approval));
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
              this.basicInfo = { 
                ...result.data.employeeData.basicInfo,
                hasDependent: result.data.employeeData.basicInfo?.hasDependent ?? false,
                postalCode: result.data.employeeData.basicInfo?.postalCode ?? '',
              };
              const incomingInsurance = result.data.employeeData.socialInsurance;
              const healthStandardMonthly = incomingInsurance.healthStandardMonthly ?? 0;
                const welfareStandardMonthly = incomingInsurance.welfareStandardMonthly ?? 0;
              this.socialInsurance = {
                ...incomingInsurance,
                healthStandardMonthly,
                welfareStandardMonthly,
              };
              // 承認リクエストの扶養情報を読み込み（複数件に対応）
              const dependentInfosFromRequest = result.data.employeeData.dependentInfos;
              if (dependentInfosFromRequest && dependentInfosFromRequest.length > 0) {
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
                this.dependentInfos = [{
                  relationship: result.data.employeeData.dependentInfo.relationship ?? '',
                  nameKanji: result.data.employeeData.dependentInfo.nameKanji ?? '',
                  nameKana: result.data.employeeData.dependentInfo.nameKana ?? '',
                  birthDate: result.data.employeeData.dependentInfo.birthDate ?? '',
                  gender: result.data.employeeData.dependentInfo.gender ?? '',
                  personalNumber: result.data.employeeData.dependentInfo.personalNumber ?? '',
                  basicPensionNumber: result.data.employeeData.dependentInfo.basicPensionNumber ?? '',
                  cohabitationType: result.data.employeeData.dependentInfo.cohabitationType ?? '',
                  address: result.data.employeeData.dependentInfo.address ?? '',
                  occupation: result.data.employeeData.dependentInfo.occupation ?? '',
                  annualIncome: result.data.employeeData.dependentInfo.annualIncome ?? null,
                  dependentStartDate: result.data.employeeData.dependentInfo.dependentStartDate ?? '',
                  thirdCategoryFlag: result.data.employeeData.dependentInfo.thirdCategoryFlag ?? false,
                }];
              } else {
                this.dependentInfos = [];
              }
              this.editMode = false; // 閲覧モードで表示
              this.isViewModeFromApproval = true; // 承認詳細から遷移した閲覧モード
              console.log('読み込んだbasicInfo:', this.basicInfo);
              console.log('読み込んだsocialInsurance:', this.socialInsurance);
              this.cdr.detectChanges();
            } else {
              console.warn('employeeDataが見つかりませんでした。承認リクエスト:', result.data);
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
        if (normalized === '男' || normalized === '男性' || normalized.toLowerCase() === 'male') {
          return '男性';
        }
        if (normalized === '女' || normalized === '女性' || normalized.toLowerCase() === 'female') {
          return '女性';
        }
        return normalized;
      };

      // 基本情報を設定
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
        hasDependent: employee.hasDependent ?? false,
        postalCode: employee.postalCode || '',
        address: employee.address || '',
      };

      // 社会保険情報を設定（詳細画面と同じロジック）
      const healthStandardMonthly = employee.healthStandardMonthly ?? 0;
      const welfareStandardMonthly = employee.welfareStandardMonthly ?? 0;
      this.socialInsurance = {
        ...this.socialInsurance,
        pensionOffice: '',
        officeName: '',
        healthStandardMonthly,
        welfareStandardMonthly,
        healthCumulative: employee.standardBonusAnnualTotal ?? 0,
        healthInsuredNumber: employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
        pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
        careSecondInsured: employee.careSecondInsured ?? this.socialInsurance.careSecondInsured,
        healthAcquisition: this.formatDateForInput(employee.healthAcquisition) || '',
        pensionAcquisition: this.formatDateForInput(employee.pensionAcquisition) || '',
        childcareLeaveStart: this.formatDateForInput(employee.childcareLeaveStart) || '',
        childcareLeaveEnd: this.formatDateForInput(employee.childcareLeaveEnd) || '',
        maternityLeaveStart: this.formatDateForInput(employee.maternityLeaveStart) || '',
        maternityLeaveEnd: this.formatDateForInput(employee.maternityLeaveEnd) || '',
        exemption: employee.exemption ?? this.socialInsurance.exemption,
      };
    
      // 扶養情報をdependentsサブコレクションから読み込む
      if (employee.id) {
        try {
          const dependents = await firstValueFrom(
            this.employeesService.getDependents(employee.id).pipe(take(1))
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
            dependentStartDate: this.formatDateForInput(dependent.dependentStartDate) || '',
            thirdCategoryFlag: dependent.thirdCategoryFlag ?? false,
          }));
          // 元の扶養情報を保存（配列のコピー）
          this.originalDependentInfos = this.dependentInfos.map(dep => ({ ...dep }));
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
        const employees = await firstValueFrom(
          this.employeesService.getEmployees().pipe(take(1))
        );
        
        const duplicate = employees.find(
          (emp) => emp.employeeNo?.trim() === employeeNo && emp.id !== this.employeeId
        );

        if (duplicate) {
          this.employeeNoDuplicateError = 'この社員番号は既に使用されています。';
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
        this.approvalMessage = '承認依頼の起票権限がありません。担当者/承認者/システム管理者のみ起票できます。';
        return;
      }

      if (!this.selectedFlow) {
        this.approvalMessage = '承認フローを選択してください。';
        return;
      }

      const validation = this.attachmentService.validateFiles(this.selectedFiles);
      this.validationErrors = validation.errors;

      if (!validation.valid && this.selectedFiles.length) {
        alert(validation.errors[0] ?? '添付ファイルの条件を確認してください。');
        return;
      }

      this.sendingApproval = true;
      this.approvalMessage = '';

      try {
        const steps = this.selectedFlow.steps.map((step) => ({
          stepOrder: step.order,
          status: 'waiting' as const,
        }));

        const displayName = this.basicInfo.name || this.basicInfo.employeeNo || '新規社員';
        const isEdit = this.isEditMode && this.originalEmployee && this.employeeId;

        // 差分情報を作成（編集モードの場合は既存データとの差分を計算）
        const employeeDiffs: ApprovalEmployeeDiff[] = [
          {
            employeeNo: this.basicInfo.employeeNo || '',
            name: this.basicInfo.name || '',
            status: 'ok',
            isNew: !isEdit,
            existingEmployeeId: isEdit && this.employeeId ? this.employeeId : undefined,
            changes: isEdit ? this.createEmployeeChangesFromDiff() : this.createEmployeeChanges(),
          },
        ];

        // 一時保存用の社員データ
        // dependentInfoは後方互換性のため残すが、dependentInfos配列も保存
        const healthStandardMonthly = this.socialInsurance.healthStandardMonthly || 0;
        const welfareStandardMonthly = this.socialInsurance.welfareStandardMonthly || 0;
        const employeeData = {
          basicInfo: { ...this.basicInfo },
          socialInsurance: {
            ...this.socialInsurance,
            healthStandardMonthly,
            welfareStandardMonthly,
          },
          dependentInfo: this.dependentInfos.length > 0 ? { ...this.dependentInfos[0] } : undefined,
          // dependentInfosは空の配列でも保存する（undefinedではなく空配列として保存）
          dependentInfos: this.dependentInfos.length > 0 ? this.dependentInfos : (this.basicInfo.hasDependent ? [] : undefined),
        } as any;
        
        console.log('承認リクエスト作成時のemployeeData:', JSON.stringify(employeeData, null, 2));
        console.log('this.dependentInfos:', JSON.stringify(this.dependentInfos, null, 2));
        console.log('this.basicInfo.hasDependent:', this.basicInfo.hasDependent);

        const createdAt = new Date();
        const dueDate = new Date(createdAt);
        dueDate.setDate(dueDate.getDate() + 14);

        const request: ApprovalRequest = {
          title: isEdit ? `社員情報更新（${displayName}）` : `社員新規登録（${displayName}）`,
          category: isEdit ? '社員情報更新' : '新規社員登録',
          targetCount: 1,
          applicantId: this.applicantId,
          applicantName: this.applicantName,
          flowId: this.selectedFlow.id ?? 'employee-create-flow',
          flowSnapshot: this.selectedFlow,
          status: 'pending',
          currentStep: this.selectedFlow.steps[0]?.order,
          comment: this.requestComment || (isEdit ? '入力内容を承認後に更新します。' : '入力内容を承認後に登録します。'),
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
        const result = await this.approvalWorkflowService.startApprovalProcess({
          request: { ...saved, id: saved.id },
          onApproved: async () => {
            // 承認完了時に社員データを保存
            if (!saved.id) return;
            
            // 承認依頼から最新のデータを取得
            const approvedRequest = await firstValueFrom(
              this.approvalWorkflowService.getRequest(saved.id).pipe(take(1))
            );
            
            if (!approvedRequest?.employeeData) {
              console.error('承認依頼にemployeeDataが見つかりません');
              return;
            }

            const { basicInfo, socialInsurance, dependentInfo, dependentInfos } = approvedRequest.employeeData;
            const healthStandardMonthly = socialInsurance.healthStandardMonthly ?? 0;
            const welfareStandardMonthly = socialInsurance.welfareStandardMonthly ?? 0;

            // employeeDataをShahoEmployee形式に変換
            const employeeData: ShahoEmployee = {
              employeeNo: basicInfo.employeeNo || '',
              name: basicInfo.name || '',
              kana: basicInfo.kana || undefined,
              gender: basicInfo.gender || undefined,
              birthDate: basicInfo.birthDate || undefined,
              postalCode: basicInfo.postalCode || undefined,
              address: basicInfo.address || undefined,
              department: basicInfo.department || undefined,
              workPrefecture: basicInfo.workPrefecture || undefined,
              personalNumber: basicInfo.myNumber || undefined,
              basicPensionNumber: basicInfo.basicPensionNumber || undefined,
              hasDependent: basicInfo.hasDependent || false,
              healthStandardMonthly: healthStandardMonthly || undefined,
              welfareStandardMonthly: welfareStandardMonthly || undefined,
              healthInsuredNumber: socialInsurance.healthInsuredNumber || undefined,
              pensionInsuredNumber: socialInsurance.pensionInsuredNumber || undefined,
              careSecondInsured: socialInsurance.careSecondInsured || false,
              healthAcquisition: socialInsurance.healthAcquisition || undefined,
              pensionAcquisition: socialInsurance.pensionAcquisition || undefined,
              childcareLeaveStart: socialInsurance.childcareLeaveStart || undefined,
              childcareLeaveEnd: socialInsurance.childcareLeaveEnd || undefined,
              maternityLeaveStart: socialInsurance.maternityLeaveStart || undefined,
              maternityLeaveEnd: socialInsurance.maternityLeaveEnd || undefined,
              exemption: socialInsurance.exemption || false,
            };

            // undefinedのフィールドを除外
            const cleanedData = this.removeUndefinedFields(employeeData as unknown as Record<string, unknown>);

            // 編集モードかどうかを判定
            const isEdit = this.isEditMode && this.employeeId;
            const updateData: Partial<ShahoEmployee> = cleanedData as unknown as Partial<ShahoEmployee>;

            // 承認履歴から最新の承認者を取得
            let approverDisplayName: string | undefined;
            if (approvedRequest.histories) {
              const approvalHistories = approvedRequest.histories.filter(
                (h) => h.action === 'approve',
              );
              
              if (approvalHistories.length > 0) {
                // 最新の承認履歴を取得
                const latestHistory = approvalHistories.sort((a, b) => {
                  const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
                  const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
                  return bTime - aTime;
                })[0];
                
                // app_usersから承認者のdisplayNameを取得
                if (latestHistory.actorId) {
                  try {
                    const approver = await firstValueFrom(
                      this.userDirectory.getUserByEmail(latestHistory.actorId)
                    );
                    approverDisplayName = approver?.displayName || latestHistory.actorId;
                  } catch (error) {
                    console.error('承認者情報の取得に失敗しました:', error);
                    // エラーが発生しても処理は続行
                  }
                }
              }
            }

            let employeeId: string | undefined;
            if (isEdit && this.employeeId) {
              // 編集モード：既存社員を更新
              employeeId = this.employeeId;
              if (approverDisplayName) {
                updateData.approvedBy = approverDisplayName;
              }
              await this.employeesService.updateEmployee(this.employeeId, updateData);
              this.approvalMessage = '承認が完了しました。社員データを更新しました。';
            } else {
              // 新規登録モード：新規社員を追加
              const result = await this.employeesService.addEmployee(cleanedData as unknown as ShahoEmployee);
              employeeId = result.id;
              
              // approvedByを更新
              if (result.id && approverDisplayName) {
                await this.employeesService.updateEmployee(result.id, {
                  approvedBy: approverDisplayName,
                });
              }
              
              this.approvalMessage = '承認が完了しました。社員データを登録しました。';
            }

            // 扶養情報をdependentsサブコレクションに保存（複数件対応）
            // 承認リクエストから扶養情報を取得（dependentInfos配列を優先、なければdependentInfoから配列を作成）
            // dependentInfosが存在する場合はそれを使用（空配列でも可）、なければdependentInfoから配列を作成
            let dependentInfosToSave: Array<any> = [];
            if (dependentInfos && Array.isArray(dependentInfos)) {
              // dependentInfosが配列として存在する場合はそれを使用（空配列でも可）
              dependentInfosToSave = dependentInfos;
            } else if (dependentInfo) {
              // dependentInfoが存在する場合は配列に変換
              dependentInfosToSave = [dependentInfo];
            }
            
            console.log('承認完了時の扶養情報保存処理開始');
            console.log('employeeId:', employeeId);
            console.log('basicInfo.hasDependent:', basicInfo.hasDependent);
            console.log('dependentInfosToSave:', JSON.stringify(dependentInfosToSave, null, 2));
            console.log('dependentInfos:', JSON.stringify(dependentInfos, null, 2));
            console.log('dependentInfo:', JSON.stringify(dependentInfo, null, 2));
            
            if (employeeId) {
              // 既存の扶養情報を取得
              const existingDependents = await firstValueFrom(
                this.employeesService.getDependents(employeeId).pipe(take(1))
              );
              console.log('既存の扶養情報:', existingDependents);
              
              // 既存の扶養情報をすべて削除
              for (const existing of existingDependents) {
                if (existing.id) {
                  console.log('既存の扶養情報を削除:', existing.id);
                  await this.employeesService.deleteDependent(employeeId, existing.id);
                }
              }
              
              // 新しい扶養情報を保存
              // dependentInfosToSaveにデータがある場合は、hasDependentの値に関わらず保存する
              if (dependentInfosToSave.length > 0) {
                console.log('新しい扶養情報を保存します。件数:', dependentInfosToSave.length);
                for (const depInfo of dependentInfosToSave) {
                  const hasDependentData = Object.values(depInfo).some(
                    (value) => value !== '' && value !== null && value !== false && value !== undefined
                  );
                  
                  console.log('扶養情報データ:', JSON.stringify(depInfo, null, 2));
                  console.log('hasDependentData:', hasDependentData);
                  
                  if (hasDependentData) {
                    const dependentData: DependentData = {
                      relationship: depInfo.relationship || undefined,
                      nameKanji: depInfo.nameKanji || undefined,
                      nameKana: depInfo.nameKana || undefined,
                      birthDate: depInfo.birthDate || undefined,
                      gender: depInfo.gender || undefined,
                      personalNumber: depInfo.personalNumber || undefined,
                      basicPensionNumber: depInfo.basicPensionNumber || undefined,
                      cohabitationType: depInfo.cohabitationType || undefined,
                      address: depInfo.address || undefined,
                      occupation: depInfo.occupation || undefined,
                      annualIncome: depInfo.annualIncome ?? undefined,
                      dependentStartDate: depInfo.dependentStartDate || undefined,
                      thirdCategoryFlag: depInfo.thirdCategoryFlag || false,
                    };
                    
                    console.log('保存する扶養情報:', JSON.stringify(dependentData, null, 2));
                    await this.employeesService.addOrUpdateDependent(employeeId, dependentData);
                    console.log('扶養情報を保存しました');
                  } else {
                    console.log('扶養情報に有効なデータがないためスキップ');
                  }
                }
              } else {
                console.log('dependentInfosToSaveが空のため、扶養情報は保存しません');
              }
            } else {
              console.error('employeeIdが取得できませんでした');
            }
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
          
          // 編集モードの場合は社員詳細画面に遷移
          if (this.isEditMode && this.employeeId) {
            // メッセージを表示してから少し待ってから遷移
            setTimeout(() => {
              this.router.navigate(['/employees', this.employeeId]);
            }, 1000);
          }
        } else {
          this.approvalMessage = '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
        }
      } catch (error) {
        console.error(error);
        this.approvalMessage = '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
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

    private removeUndefinedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
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

    onFlowsUpdated(flows: ApprovalFlow[]): void {
      if (!this.selectedFlow && flows[0]) {
        this.selectedFlow = flows[0];
        this.selectedFlowId = flows[0].id ?? null;
      }
    }

    /**
     * フォームの入力値を差分情報のchanges配列に変換
     */
    private createEmployeeChanges(): { field: string; oldValue: string | null; newValue: string | null }[] {
      const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];

      // 基本情報
      if (this.basicInfo.employeeNo) {
        changes.push({ field: '社員番号', oldValue: null, newValue: this.basicInfo.employeeNo });
      }
      if (this.basicInfo.name) {
        changes.push({ field: '氏名(漢字)', oldValue: null, newValue: this.basicInfo.name });
      }
      if (this.basicInfo.kana) {
        changes.push({ field: '氏名(カナ)', oldValue: null, newValue: this.basicInfo.kana });
      }
      if (this.basicInfo.gender) {
        changes.push({ field: '性別', oldValue: null, newValue: this.basicInfo.gender });
      }
      if (this.basicInfo.birthDate) {
        changes.push({ field: '生年月日', oldValue: null, newValue: this.basicInfo.birthDate });
      }
      if (this.basicInfo.department) {
        changes.push({ field: '部署', oldValue: null, newValue: this.basicInfo.department });
      }
      if (this.basicInfo.workPrefecture) {
        changes.push({ field: '勤務都道府県', oldValue: null, newValue: this.basicInfo.workPrefecture });
      }
      if (this.basicInfo.myNumber) {
        changes.push({ field: 'マイナンバー', oldValue: null, newValue: this.basicInfo.myNumber });
      }
      if (this.basicInfo.basicPensionNumber) {
        changes.push({ field: '基礎年金番号', oldValue: null, newValue: this.basicInfo.basicPensionNumber });
      }
      changes.push({ field: '扶養の有無', oldValue: null, newValue: this.basicInfo.hasDependent ? '有' : '無' });
      if (this.basicInfo.postalCode) {
        changes.push({ field: '郵便番号', oldValue: null, newValue: this.basicInfo.postalCode });
      }
      if (this.basicInfo.address) {
        changes.push({ field: '住所', oldValue: null, newValue: this.basicInfo.address });
      }

      // 社会保険情報
      if (this.socialInsurance.pensionOffice) {
        changes.push({ field: '年金事務所', oldValue: null, newValue: this.socialInsurance.pensionOffice });
      }
      if (this.socialInsurance.officeName) {
        changes.push({ field: '事業所名', oldValue: null, newValue: this.socialInsurance.officeName });
      }
      if (this.socialInsurance.healthStandardMonthly !== 0) {
        changes.push({ field: '健保標準報酬月額', oldValue: null, newValue: String(this.socialInsurance.healthStandardMonthly) });
      }
      if (this.socialInsurance.welfareStandardMonthly !== 0) {
        changes.push({ field: '厚年標準報酬月額', oldValue: null, newValue: String(this.socialInsurance.welfareStandardMonthly) });
      }
      if (this.socialInsurance.healthCumulative !== 0) {
        changes.push({ field: '標準賞与額累計', oldValue: null, newValue: String(this.socialInsurance.healthCumulative) });
      }
      if (this.socialInsurance.healthInsuredNumber) {
        changes.push({ field: '健康保険被保険者番号', oldValue: null, newValue: this.socialInsurance.healthInsuredNumber });
      }
      if (this.socialInsurance.pensionInsuredNumber) {
        changes.push({ field: '厚生年金被保険者番号', oldValue: null, newValue: this.socialInsurance.pensionInsuredNumber });
      }
      changes.push({ field: '介護保険第2号被保険者', oldValue: null, newValue: this.socialInsurance.careSecondInsured ? 'はい' : 'いいえ' });
      if (this.socialInsurance.healthAcquisition) {
        changes.push({ field: '健康保険取得年月日', oldValue: null, newValue: this.socialInsurance.healthAcquisition });
      }
      if (this.socialInsurance.pensionAcquisition) {
        changes.push({ field: '厚生年金取得年月日', oldValue: null, newValue: this.socialInsurance.pensionAcquisition });
      }
      if (this.socialInsurance.childcareLeaveStart) {
        changes.push({ field: '育児休業開始日', oldValue: null, newValue: this.socialInsurance.childcareLeaveStart });
      }
      if (this.socialInsurance.childcareLeaveEnd) {
        changes.push({ field: '育児休業終了日', oldValue: null, newValue: this.socialInsurance.childcareLeaveEnd });
      }
      if (this.socialInsurance.maternityLeaveStart) {
        changes.push({ field: '産前産後休業開始日', oldValue: null, newValue: this.socialInsurance.maternityLeaveStart });
      }
      if (this.socialInsurance.maternityLeaveEnd) {
        changes.push({ field: '産前産後休業終了日', oldValue: null, newValue: this.socialInsurance.maternityLeaveEnd });
      }
      changes.push({ field: '保険料免除', oldValue: null, newValue: this.socialInsurance.exemption ? 'はい' : 'いいえ' });
    
      // 扶養情報
      if (this.basicInfo.hasDependent && this.dependentInfos.length > 0) {
        this.dependentInfos.forEach((dependentInfo, index) => {
          const prefix = this.dependentInfos.length > 1 ? `扶養${index + 1} ` : '扶養 ';
          if (dependentInfo.relationship) {
            changes.push({ field: `${prefix}続柄`, oldValue: null, newValue: dependentInfo.relationship });
        }
          if (dependentInfo.nameKanji) {
            changes.push({ field: `${prefix}氏名(漢字)`, oldValue: null, newValue: dependentInfo.nameKanji });
        }
          if (dependentInfo.nameKana) {
            changes.push({ field: `${prefix}氏名(カナ)`, oldValue: null, newValue: dependentInfo.nameKana });
        }
          if (dependentInfo.birthDate) {
            changes.push({ field: `${prefix}生年月日`, oldValue: null, newValue: dependentInfo.birthDate });
        }
          if (dependentInfo.gender) {
            changes.push({ field: `${prefix}性別`, oldValue: null, newValue: dependentInfo.gender });
        }
          if (dependentInfo.personalNumber) {
            changes.push({ field: `${prefix}個人番号`, oldValue: null, newValue: dependentInfo.personalNumber });
        }
          if (dependentInfo.basicPensionNumber) {
            changes.push({ field: `${prefix}基礎年金番号`, oldValue: null, newValue: dependentInfo.basicPensionNumber });
        }
          if (dependentInfo.cohabitationType) {
            changes.push({ field: `${prefix}同居区分`, oldValue: null, newValue: dependentInfo.cohabitationType });
        }
          if (dependentInfo.address) {
            changes.push({ field: `${prefix}住所`, oldValue: null, newValue: dependentInfo.address });
        }
          if (dependentInfo.occupation) {
            changes.push({ field: `${prefix}職業`, oldValue: null, newValue: dependentInfo.occupation });
        }
          if (dependentInfo.annualIncome !== null) {
            changes.push({ field: `${prefix}年収`, oldValue: null, newValue: String(dependentInfo.annualIncome) });
        }
          if (dependentInfo.dependentStartDate) {
            changes.push({ field: `${prefix}開始日`, oldValue: null, newValue: dependentInfo.dependentStartDate });
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
    private createEmployeeChangesFromDiff(): { field: string; oldValue: string | null; newValue: string | null }[] {
      if (!this.originalEmployee) {
        return this.createEmployeeChanges();
      }

      const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
      const original = this.originalEmployee;

      // 性別の正規化関数
      const normalizeGender = (gender?: string): string => {
        if (!gender) return '';
        const normalized = gender.trim();
        if (normalized === '男' || normalized === '男性' || normalized.toLowerCase() === 'male') {
          return '男性';
        }
        if (normalized === '女' || normalized === '女性' || normalized.toLowerCase() === 'female') {
          return '女性';
        }
        return normalized;
      };

      // 基本情報の差分
      if (original.employeeNo !== this.basicInfo.employeeNo) {
        changes.push({ field: '社員番号', oldValue: original.employeeNo || null, newValue: this.basicInfo.employeeNo || null });
      }
      if (original.name !== this.basicInfo.name) {
        changes.push({ field: '氏名(漢字)', oldValue: original.name || null, newValue: this.basicInfo.name || null });
      }
      if (original.kana !== this.basicInfo.kana) {
        changes.push({ field: '氏名(カナ)', oldValue: original.kana || null, newValue: this.basicInfo.kana || null });
      }
      if (normalizeGender(original.gender) !== this.basicInfo.gender) {
        changes.push({ field: '性別', oldValue: normalizeGender(original.gender) || null, newValue: this.basicInfo.gender || null });
      }
      const originalBirthDate = this.formatDateForInput(original.birthDate);
      if (originalBirthDate !== this.basicInfo.birthDate) {
        changes.push({ field: '生年月日', oldValue: originalBirthDate || null, newValue: this.basicInfo.birthDate || null });
      }
      if (original.department !== this.basicInfo.department) {
        changes.push({ field: '部署', oldValue: original.department || null, newValue: this.basicInfo.department || null });
      }
      if (original.workPrefecture !== this.basicInfo.workPrefecture) {
        changes.push({ field: '勤務都道府県', oldValue: original.workPrefecture || null, newValue: this.basicInfo.workPrefecture || null });
      }
      if (original.personalNumber !== this.basicInfo.myNumber) {
        changes.push({ field: 'マイナンバー', oldValue: original.personalNumber || null, newValue: this.basicInfo.myNumber || null });
      }
      if (original.basicPensionNumber !== this.basicInfo.basicPensionNumber) {
        changes.push({ field: '基礎年金番号', oldValue: original.basicPensionNumber || null, newValue: this.basicInfo.basicPensionNumber || null });
      }
      if ((original.hasDependent ?? false) !== this.basicInfo.hasDependent) {
        changes.push({ field: '扶養の有無', oldValue: (original.hasDependent ?? false) ? '有' : '無', newValue: this.basicInfo.hasDependent ? '有' : '無' });
      }
      if (original.postalCode !== this.basicInfo.postalCode) {
        changes.push({ field: '郵便番号', oldValue: original.postalCode || null, newValue: this.basicInfo.postalCode || null });
      }
      if (original.address !== this.basicInfo.address) {
        changes.push({ field: '住所', oldValue: original.address || null, newValue: this.basicInfo.address || null });
      }

      // 社会保険情報の差分
      const originalHealthStandardMonthly = original.healthStandardMonthly ?? 0;
      const originalWelfareStandardMonthly = original.welfareStandardMonthly ?? 0;
      const newHealthStandardMonthly = this.socialInsurance.healthStandardMonthly ?? 0;
      const newWelfareStandardMonthly = this.socialInsurance.welfareStandardMonthly ?? 0;

      if (originalHealthStandardMonthly !== newHealthStandardMonthly) {
        changes.push({
          field: '健保標準報酬月額',
          oldValue: originalHealthStandardMonthly ? String(originalHealthStandardMonthly) : null,
          newValue: newHealthStandardMonthly ? String(newHealthStandardMonthly) : null,
        });
      }
      if (originalWelfareStandardMonthly !== newWelfareStandardMonthly) {
        changes.push({
          field: '厚年標準報酬月額',
          oldValue: originalWelfareStandardMonthly ? String(originalWelfareStandardMonthly) : null,
          newValue: newWelfareStandardMonthly ? String(newWelfareStandardMonthly) : null,
        });
      }
      if ((original.standardBonusAnnualTotal ?? 0) !== this.socialInsurance.healthCumulative) {
        changes.push({ field: '標準賞与額累計', oldValue: original.standardBonusAnnualTotal ? String(original.standardBonusAnnualTotal) : null, newValue: this.socialInsurance.healthCumulative ? String(this.socialInsurance.healthCumulative) : null });
      }
      const originalHealthInsuredNumber = original.healthInsuredNumber || original.insuredNumber || '';
      if (originalHealthInsuredNumber !== this.socialInsurance.healthInsuredNumber) {
        changes.push({ field: '健康保険被保険者番号', oldValue: originalHealthInsuredNumber || null, newValue: this.socialInsurance.healthInsuredNumber || null });
      }
      if (original.pensionInsuredNumber !== this.socialInsurance.pensionInsuredNumber) {
        changes.push({ field: '厚生年金被保険者番号', oldValue: original.pensionInsuredNumber || null, newValue: this.socialInsurance.pensionInsuredNumber || null });
      }
      if ((original.careSecondInsured ?? false) !== this.socialInsurance.careSecondInsured) {
        changes.push({ field: '介護保険第2号被保険者', oldValue: (original.careSecondInsured ?? false) ? 'はい' : 'いいえ', newValue: this.socialInsurance.careSecondInsured ? 'はい' : 'いいえ' });
      }
      const originalHealthAcquisition = this.formatDateForInput(original.healthAcquisition);
      if (originalHealthAcquisition !== this.socialInsurance.healthAcquisition) {
        changes.push({ field: '健康保険取得年月日', oldValue: originalHealthAcquisition || null, newValue: this.socialInsurance.healthAcquisition || null });
      }
      const originalPensionAcquisition = this.formatDateForInput(original.pensionAcquisition);
      if (originalPensionAcquisition !== this.socialInsurance.pensionAcquisition) {
        changes.push({ field: '厚生年金取得年月日', oldValue: originalPensionAcquisition || null, newValue: this.socialInsurance.pensionAcquisition || null });
      }
      const originalChildcareLeaveStart = this.formatDateForInput(original.childcareLeaveStart);
      if (originalChildcareLeaveStart !== this.socialInsurance.childcareLeaveStart) {
        changes.push({ field: '育児休業開始日', oldValue: originalChildcareLeaveStart || null, newValue: this.socialInsurance.childcareLeaveStart || null });
      }
      const originalChildcareLeaveEnd = this.formatDateForInput(original.childcareLeaveEnd);
      if (originalChildcareLeaveEnd !== this.socialInsurance.childcareLeaveEnd) {
        changes.push({ field: '育児休業終了日', oldValue: originalChildcareLeaveEnd || null, newValue: this.socialInsurance.childcareLeaveEnd || null });
      }
      const originalMaternityLeaveStart = this.formatDateForInput(original.maternityLeaveStart);
      if (originalMaternityLeaveStart !== this.socialInsurance.maternityLeaveStart) {
        changes.push({ field: '産前産後休業開始日', oldValue: originalMaternityLeaveStart || null, newValue: this.socialInsurance.maternityLeaveStart || null });
      }
      const originalMaternityLeaveEnd = this.formatDateForInput(original.maternityLeaveEnd);
      if (originalMaternityLeaveEnd !== this.socialInsurance.maternityLeaveEnd) {
        changes.push({ field: '産前産後休業終了日', oldValue: originalMaternityLeaveEnd || null, newValue: this.socialInsurance.maternityLeaveEnd || null });
      }
      if ((original.exemption ?? false) !== this.socialInsurance.exemption) {
        changes.push({ field: '保険料免除', oldValue: (original.exemption ?? false) ? 'はい' : 'いいえ', newValue: this.socialInsurance.exemption ? 'はい' : 'いいえ' });
      }

      // 扶養情報の差分（複数件対応）
      const originalHasDependent = original.hasDependent ?? false;
      const newHasDependent = this.basicInfo.hasDependent;
      const hasDependentChanged = originalHasDependent !== newHasDependent;

      // 既存の扶養情報を取得（編集モードの場合）
      const originalDependents = [...this.originalDependentInfos];

      // 扶養の有無が変更された場合のみ差分を追加
      if (hasDependentChanged) {
        changes.push({ field: '扶養の有無', oldValue: originalHasDependent ? '有' : '無', newValue: newHasDependent ? '有' : '無' });
      }

      // 扶養情報が存在する場合のみ、実際の変更をチェック
      if (newHasDependent || originalHasDependent) {
        // 新しい扶養情報と既存の扶養情報を比較
        const maxLength = Math.max(this.dependentInfos.length, originalDependents.length);
        for (let i = 0; i < maxLength; i++) {
          const prefix = maxLength > 1 ? `扶養${i + 1} ` : '扶養 ';
          const newDep = this.dependentInfos[i];
          const oldDep = originalDependents[i];

          if (!oldDep && newDep) {
            // 新規追加：有効なデータがある場合のみ差分を追加
            const hasNewData = Object.values(newDep).some(
              (value) => value !== '' && value !== null && value !== false && value !== undefined
            );
            if (hasNewData) {
              if (newDep.relationship) changes.push({ field: `${prefix}続柄`, oldValue: null, newValue: newDep.relationship });
              if (newDep.nameKanji) changes.push({ field: `${prefix}氏名(漢字)`, oldValue: null, newValue: newDep.nameKanji });
              if (newDep.nameKana) changes.push({ field: `${prefix}氏名(カナ)`, oldValue: null, newValue: newDep.nameKana });
              if (newDep.birthDate) changes.push({ field: `${prefix}生年月日`, oldValue: null, newValue: newDep.birthDate });
              if (newDep.gender) changes.push({ field: `${prefix}性別`, oldValue: null, newValue: newDep.gender });
              if (newDep.personalNumber) changes.push({ field: `${prefix}個人番号`, oldValue: null, newValue: newDep.personalNumber });
              if (newDep.basicPensionNumber) changes.push({ field: `${prefix}基礎年金番号`, oldValue: null, newValue: newDep.basicPensionNumber });
              if (newDep.cohabitationType) changes.push({ field: `${prefix}同居区分`, oldValue: null, newValue: newDep.cohabitationType });
              if (newDep.address) changes.push({ field: `${prefix}住所`, oldValue: null, newValue: newDep.address });
              if (newDep.occupation) changes.push({ field: `${prefix}職業`, oldValue: null, newValue: newDep.occupation });
              if (newDep.annualIncome !== null && newDep.annualIncome !== undefined) {
                changes.push({ field: `${prefix}年収`, oldValue: null, newValue: String(newDep.annualIncome) });
              }
              if (newDep.dependentStartDate) changes.push({ field: `${prefix}開始日`, oldValue: null, newValue: newDep.dependentStartDate });
              changes.push({
                field: `${prefix}第3号被保険者`,
                oldValue: null,
                newValue: newDep.thirdCategoryFlag ? 'はい' : 'いいえ',
              });
            }
          } else if (oldDep && !newDep) {
            // 削除：有効なデータがあった場合のみ差分を追加
            const hasOldData = Object.values(oldDep).some(
              (value) => value !== '' && value !== null && value !== false && value !== undefined
            );
            if (hasOldData) {
              changes.push({ field: `${prefix}削除`, oldValue: oldDep.nameKanji || 'あり', newValue: null });
            }
          } else if (oldDep && newDep) {
            // 変更：実際に値が異なる場合のみ差分を追加
            if (oldDep.relationship !== newDep.relationship) {
              changes.push({ field: `${prefix}続柄`, oldValue: oldDep.relationship || null, newValue: newDep.relationship || null });
            }
            if (oldDep.nameKanji !== newDep.nameKanji) {
              changes.push({ field: `${prefix}氏名(漢字)`, oldValue: oldDep.nameKanji || null, newValue: newDep.nameKanji || null });
            }
            if (oldDep.nameKana !== newDep.nameKana) {
              changes.push({ field: `${prefix}氏名(カナ)`, oldValue: oldDep.nameKana || null, newValue: newDep.nameKana || null });
            }
            const oldBirthDate = this.formatDateForInput(oldDep.birthDate);
            if (oldBirthDate !== newDep.birthDate) {
              changes.push({ field: `${prefix}生年月日`, oldValue: oldBirthDate || null, newValue: newDep.birthDate || null });
            }
            if (oldDep.gender !== newDep.gender) {
              changes.push({ field: `${prefix}性別`, oldValue: oldDep.gender || null, newValue: newDep.gender || null });
            }
            if (oldDep.personalNumber !== newDep.personalNumber) {
              changes.push({ field: `${prefix}個人番号`, oldValue: oldDep.personalNumber || null, newValue: newDep.personalNumber || null });
            }
            if (oldDep.basicPensionNumber !== newDep.basicPensionNumber) {
              changes.push({ field: `${prefix}基礎年金番号`, oldValue: oldDep.basicPensionNumber || null, newValue: newDep.basicPensionNumber || null });
            }
            if (oldDep.cohabitationType !== newDep.cohabitationType) {
              changes.push({ field: `${prefix}同居区分`, oldValue: oldDep.cohabitationType || null, newValue: newDep.cohabitationType || null });
            }
            if (oldDep.address !== newDep.address) {
              changes.push({ field: `${prefix}住所`, oldValue: oldDep.address || null, newValue: newDep.address || null });
            }
            if (oldDep.occupation !== newDep.occupation) {
              changes.push({ field: `${prefix}職業`, oldValue: oldDep.occupation || null, newValue: newDep.occupation || null });
            }
            if ((oldDep.annualIncome ?? null) !== newDep.annualIncome) {
              changes.push({ field: `${prefix}年収`, oldValue: oldDep.annualIncome !== null ? String(oldDep.annualIncome) : null, newValue: newDep.annualIncome !== null ? String(newDep.annualIncome) : null });
            }
            const oldStartDate = this.formatDateForInput(oldDep.dependentStartDate);
            if (oldStartDate !== newDep.dependentStartDate) {
              changes.push({ field: `${prefix}開始日`, oldValue: oldStartDate || null, newValue: newDep.dependentStartDate || null });
            }
            if ((oldDep.thirdCategoryFlag ?? false) !== newDep.thirdCategoryFlag) {
              changes.push({ field: `${prefix}第3号被保険者`, oldValue: (oldDep.thirdCategoryFlag ?? false) ? 'はい' : 'いいえ', newValue: newDep.thirdCategoryFlag ? 'はい' : 'いいえ' });
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

      const currentStep = request.steps.find((step) => step.stepOrder === request.currentStep);
      const candidates = currentStep
        ? request.flowSnapshot?.steps.find((step) => step.order === currentStep.stepOrder)?.candidates ?? []
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