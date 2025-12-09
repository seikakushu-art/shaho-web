import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { Subject, switchMap, takeUntil, of, firstValueFrom, combineLatest, map, take, filter, timeout, catchError } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService } from '../../app/services/shaho-employees.service';
import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';
import { ApprovalFlow, ApprovalHistory, ApprovalRequest, ApprovalEmployeeDiff } from '../../models/approvals';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth.service';
import { RoleKey } from '../../models/roles';

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
    private authService = inject(AuthService);
    private destroy$ = new Subject<void>();

    editMode = true;
    submitAttempted = false;
    isEditMode = false;
    employeeId: string | null = null;
    isLoading = false;
    sendingApproval = false;
    approvalMessage = '';
    selectedFlowId: string | null = null;
    selectedFlow?: ApprovalFlow;
    applicantId = '';
    applicantName = '';
    isViewModeFromApproval = false; // 承認詳細から遷移した閲覧モードかどうか
  
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
      address: '',
    };
  
    socialInsurance = {
      pensionOffice: '',
      officeName: '',
      standardMonthly: 0,
      healthCumulative: 0,
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
                map((employee) => ({ type: 'employee' as const, data: employee })),
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
              this.basicInfo = { ...result.data.employeeData.basicInfo };
              this.socialInsurance = { ...result.data.employeeData.socialInsurance };
              this.editMode = false; // 閲覧モードで表示
              this.isViewModeFromApproval = true; // 承認詳細から遷移した閲覧モード
              console.log('読み込んだbasicInfo:', this.basicInfo);
              console.log('読み込んだsocialInsurance:', this.socialInsurance);
              this.cdr.detectChanges();
            } else {
              console.warn('employeeDataが見つかりませんでした。承認リクエスト:', result.data);
            }
          } else if (result.type === 'employee' && result.data) {
            // 既存社員データを読み込む
            this.loadEmployeeData(result.data);
            this.cdr.detectChanges();
          }
        });
    }

    ngOnDestroy(): void {
      this.destroy$.next();
      this.destroy$.complete();
    }

    private loadEmployeeData(employee: ShahoEmployee) {
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
        address: employee.address || '',
      };

      // 社会保険情報を設定
      this.socialInsurance = {
        pensionOffice: '',
        officeName: '',
        standardMonthly: employee.standardMonthly ?? 0,
        healthCumulative: employee.standardBonusAnnualTotal ?? 0,
        healthInsuredNumber: employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
        pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
        careSecondInsured: employee.careSecondInsured ?? false,
        healthAcquisition: this.formatDateForInput(employee.healthAcquisition) || '',
        pensionAcquisition: this.formatDateForInput(employee.pensionAcquisition) || '',
        childcareLeaveStart: this.formatDateForInput(employee.childcareLeaveStart) || '',
        childcareLeaveEnd: this.formatDateForInput(employee.childcareLeaveEnd) || '',
        maternityLeaveStart: this.formatDateForInput(employee.maternityLeaveStart) || '',
        maternityLeaveEnd: this.formatDateForInput(employee.maternityLeaveEnd) || '',
        exemption: employee.exemption ?? false,
      };
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

    toggleEditMode() {
      this.editMode = !this.editMode;
    }
  
    handleSaveDraft(form: NgForm) {
      this.submitAttempted = true;
      if (form.invalid) return;
      alert('一時保存しました（ダミー動作）');
    }
  
    handleProceedApproval(form: NgForm) {
      this.submitAttempted = true;
      if (form.invalid) return;
      void this.sendApprovalRequest();
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

      this.sendingApproval = true;
      this.approvalMessage = '';

      try {
        const steps = this.selectedFlow.steps.map((step) => ({
          stepOrder: step.order,
          status: 'waiting' as const,
        }));

        const history: ApprovalHistory = {
          id: `hist-${Date.now()}`,
          statusAfter: 'pending',
          action: 'apply',
          actorId: this.applicantId,
          actorName: this.applicantName,
          comment: '社員新規登録の承認を依頼します。',
          attachments: [],
          createdAt: Timestamp.fromDate(new Date()),
        };

        const displayName = this.basicInfo.name || this.basicInfo.employeeNo || '新規社員';

        // 新規社員登録の差分情報を作成
        const employeeDiffs: ApprovalEmployeeDiff[] = [
          {
            employeeNo: this.basicInfo.employeeNo || '',
            name: this.basicInfo.name || '',
            status: 'ok',
            isNew: true,
            changes: this.createEmployeeChanges(),
          },
        ];

        // 一時保存用の社員データ
        const employeeData = {
          basicInfo: { ...this.basicInfo },
          socialInsurance: { ...this.socialInsurance },
        };

        const request: ApprovalRequest = {
          title: `社員新規登録（${displayName}）`,
          category: '新規社員登録',
          targetCount: 1,
          applicantId: this.applicantId,
          applicantName: this.applicantName,
          flowId: this.selectedFlow.id ?? 'employee-create-flow',
          flowSnapshot: this.selectedFlow,
          status: 'pending',
          currentStep: this.selectedFlow.steps[0]?.order,
          comment: '入力内容を承認後に登録します。',
          steps,
          histories: [history],
          attachments: [],
          employeeDiffs,
          employeeData,
          createdAt: Timestamp.fromDate(new Date()),
        };

        console.log('保存するrequest:', request);
        console.log('request.employeeData:', request.employeeData);

        await this.approvalWorkflowService.saveRequest(request);
        this.approvalMessage = '承認依頼を送信しました。承認完了までお待ちください。';
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
      if (this.socialInsurance.standardMonthly !== 0) {
        changes.push({ field: '標準報酬月額', oldValue: null, newValue: String(this.socialInsurance.standardMonthly) });
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

      return changes;
    }
  }