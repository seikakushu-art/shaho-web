import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil, firstValueFrom, Subscription, switchMap, map } from 'rxjs';
import {
  CalculationType,
  StandardCalculationMethod,
} from '../calculation-types';
import {
  CalculationDataService,
  CalculationQueryParams,
  CalculationRow,
  CalculationResultHistory,
} from '../calculation-data.service';
import { InsuranceKey, normalizeToYearMonth, parseRate, findPrefectureRate } from '../calculation-utils';
import { ShahoEmployeesService } from '../../app/services/shaho-employees.service';
import { CorporateInfoService } from '../../app/services/corporate-info.service';
import { InsuranceRatesService, InsuranceRateRecord } from '../../app/services/insurance-rates.service';
import { FlowSelectorComponent } from '../../approvals/flow-selector/flow-selector.component';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { ApprovalNotificationService } from '../../approvals/approval-notification.service';
import { ApprovalAttachmentService } from '../../approvals/approval-attachment.service';
import {
  ApprovalFlow,
  ApprovalHistory,
  ApprovalRequest,
  ApprovalEmployeeDiff,
  ApprovalNotification,
  ApprovalAttachmentMetadata,
} from '../../models/approvals';
import { Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth.service';
import { RoleKey } from '../../models/roles';


type ColumnKey =
  | 'employeeNo'
  | 'name'
  | 'department'
  | 'location'
  | 'month'
  | 'monthlySalary'
  | 'healthStandardMonthly'
  | 'welfareStandardMonthly'
  | 'healthEmployeeMonthly'
  | 'healthEmployerMonthly'
  | 'healthTotalMonthly'
  | 'nursingEmployeeMonthly'
  | 'nursingEmployerMonthly'
  | 'nursingTotalMonthly'
  | 'welfareEmployeeMonthly'
  | 'welfareEmployerMonthly'
  | 'welfareTotalMonthly'
  | 'bonusPaymentDate'
  | 'bonusTotalPay'
  | 'standardHealthBonus'
  | 'standardWelfareBonus'
  | 'healthEmployeeBonus'
  | 'healthEmployerBonus'
  | 'healthTotalBonus'
  | 'nursingEmployeeBonus'
  | 'nursingEmployerBonus'
  | 'nursingTotalBonus'
  | 'welfareEmployeeBonus'
  | 'welfareEmployerBonus'
  | 'welfareTotalBonus'
  | 'totalContribution';

type ColumnCategory = 'monthly' | 'bonus' | 'shared';
type ColumnFormat = 'text' | 'money' | 'date' | 'month';

interface ColumnSetting {
  key: ColumnKey;
  label: string;
  visible: boolean;
  sortable?: boolean;
  category: ColumnCategory;
  format: ColumnFormat;
}

@Component({
  selector: 'app-calculation-result',
  standalone: true,
  imports: [CommonModule, FormsModule, FlowSelectorComponent],
  templateUrl: './calculation-result.component.html',
  styleUrl: './calculation-result.component.scss',
})
export class CalculationResultComponent implements OnInit, OnDestroy {
  private calculationDataService = inject(CalculationDataService);
  private employeesService = inject(ShahoEmployeesService);
  private corporateInfoService = inject(CorporateInfoService);
  private insuranceRatesService = inject(InsuranceRatesService);
  private approvalWorkflowService = inject(ApprovalWorkflowService);
  private notificationService = inject(ApprovalNotificationService);
  private authService = inject(AuthService);
  readonly attachmentService = inject(ApprovalAttachmentService);
  private destroy$ = new Subject<void>();
  private approvalSubscription?: Subscription;
  private currentRateRecord?: InsuranceRateRecord;

  saving = false;
  approvalMessage = '';
  selectedFlowId: string | null = null;
  selectedFlow?: ApprovalFlow;
  applicantId = '';
  applicantName = '';
  isViewMode = false;
  approvalId: string | null = null;
  requestComment = '';
  selectedFiles: File[] = [];
  validationErrors: string[] = [];

  calculationType: CalculationType = 'standard';
  targetMonth = '';
  method = '';
  standardMethod: StandardCalculationMethod = '定時決定';
  activeInsurances: string[] = [];
  includeBonusInMonth = true;
  bonusOnly = false;
  departmentFilter = '';
  locationFilter = '';
  employeeNoFilter = '';
  bonusPaidOnFilter = '';
  departmentOptions: string[] = [];
  locationOptions: string[] = [];

  readonly calculationTypes: Record<CalculationType, string> = {
    standard: '標準報酬月額計算',
    bonus: '標準賞与額計算',
    insurance: '社会保険料計算',
  };

  readonly noWrapColumns = ['name', 'department', 'location'];

  get calculationTypeLabel(): string {
    return this.calculationTypes[this.calculationType];
  }

  get targetYear(): string {
    return this.targetMonth.split('-')[0] || '';
  }

  get targetYearMonthLabel(): string {
    if (this.calculationType === 'bonus') return '';
    return this.calculationType === 'standard' ? '対象年' : '対象年月';
  }

  get targetYearMonthValue(): string {
    return this.calculationType === 'standard' ? this.targetYear : this.targetMonth;
  }

  columns: ColumnSetting[] = [  
    {
      key: 'employeeNo',
      label: '社員番号',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'name',
      label: '氏名',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'department',
      label: '部署',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'location',
      label: '勤務地',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'text',
    },
    {
      key: 'month',
      label: '対象年/年月',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'month',
    },
    {
      key: 'monthlySalary',
      label: '月給支払額',
      visible: false,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthStandardMonthly',
      label: '健保標準報酬月額',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareStandardMonthly',
      label: '厚年標準報酬月額',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthEmployeeMonthly',
      label: '健康保険（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthEmployerMonthly',
      label: '健康保険（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'healthTotalMonthly',
      label: '健康保険（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingEmployeeMonthly',
      label: '介護保険（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingEmployerMonthly',
      label: '介護保険（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'nursingTotalMonthly',
      label: '介護保険（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareEmployeeMonthly',
      label: '厚生年金（個人・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareEmployerMonthly',
      label: '厚生年金（会社・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'welfareTotalMonthly',
      label: '厚生年金（合計・月例）',
      visible: true,
      sortable: true,
      category: 'monthly',
      format: 'money',
    },
    {
      key: 'bonusPaymentDate',
      label: '賞与支給日',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'date',
    },
    {
      key: 'bonusTotalPay',
      label: '賞与総支給額',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'standardHealthBonus',
      label: '標準賞与額（健・介）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'standardWelfareBonus',
      label: '標準賞与額（厚生年金）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthEmployeeBonus',
      label: '健康保険（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthEmployerBonus',
      label: '健康保険（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'healthTotalBonus',
      label: '健康保険（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingEmployeeBonus',
      label: '介護保険（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingEmployerBonus',
      label: '介護保険（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'nursingTotalBonus',
      label: '介護保険（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareEmployeeBonus',
      label: '厚生年金（個人・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareEmployerBonus',
      label: '厚生年金（会社・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'welfareTotalBonus',
      label: '厚生年金（合計・賞与）',
      visible: true,
      sortable: true,
      category: 'bonus',
      format: 'money',
    },
    {
      key: 'totalContribution',
      label: '個人＋会社 保険料合計',
      visible: true,
      sortable: true,
      category: 'shared',
      format: 'money',
    },
  ];

  rows: CalculationRow[] = [];

  sortKey: ColumnKey = 'employeeNo';
  sortDirection: 'asc' | 'desc' = 'asc';

  departmentSummaries: DepartmentSummary[] = [];
  insuranceSummaries: InsuranceSummary[] = [];
  insuranceMonthlySummaries: InsuranceMonthlySummary[] = [];

  currentHistoryId?: string;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.applicantId = user?.email ?? 'requester';
      this.applicantName = user?.displayName ?? user?.email ?? '担当者';
    });
    const params = this.route.snapshot.queryParamMap;
    this.isViewMode = params.get('viewMode') === 'true';
    this.approvalId = params.get('approvalId');
    
    // 承認依頼IDがある場合は、承認依頼から計算結果データを取得
    if (this.approvalId) {
      this.approvalWorkflowService.getRequest(this.approvalId)
        .pipe(takeUntil(this.destroy$))
        .subscribe((approval) => {
          if (!approval) {
            console.error('承認依頼が見つかりません');
            this.loadParamsFromQuery();
            return;
          }

          // 計算結果データがある場合はそれを使用
          if (approval.calculationResultRows && approval.calculationResultRows.length > 0) {
            this.rows = approval.calculationResultRows.map((row) => ({
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
              error: row.error,
            }));
            
            // 計算パラメータも設定
            if (approval.calculationQueryParams) {
              const calcParams = approval.calculationQueryParams;
              this.calculationType = (calcParams.type as CalculationType) ?? 'standard';
              this.standardMethod = (calcParams.standardMethod as StandardCalculationMethod) ?? '定時決定';
              this.targetMonth = calcParams.targetMonth ?? this.getCurrentTargetMonth(this.calculationType, this.standardMethod);
              this.method = calcParams.method ?? '自動算出';
              this.activeInsurances = calcParams.insurances ?? [];
              this.includeBonusInMonth = calcParams.includeBonusInMonth ?? true;
              this.bonusOnly = calcParams.bonusOnly ?? false;
              // 相互排他チェック: 両方がtrueの場合はincludeBonusInMonthを優先
              if (this.bonusOnly && this.includeBonusInMonth) {
                this.bonusOnly = false;
              }
              this.departmentFilter = calcParams.department ?? '';
              this.locationFilter = calcParams.location ?? '';
              this.employeeNoFilter = calcParams.employeeNo ?? '';
              this.bonusPaidOnFilter = calcParams.bonusPaidOn ?? '';
            }
            
            this.refreshVisibility(true);
            // 保険料率を取得してから集計
            this.corporateInfoService.getCorporateInfo().pipe(
              switchMap((info) =>
                this.insuranceRatesService.getRateHistory(
                  info?.healthInsuranceType ?? '協会けんぽ',
                ).pipe(
                  map((rateHistory) => {
                    this.currentRateRecord = rateHistory?.[0];
                    return this.currentRateRecord;
                  })
                )
              ),
              takeUntil(this.destroy$)
            ).subscribe(() => {
              this.calculateSummaries();
              this.updateFilterOptions();
            });
            return;
          }

          // 計算結果データがない場合は、計算パラメータから再計算
          if (approval.calculationQueryParams) {
            const calcParams = approval.calculationQueryParams;
            this.calculationType = (calcParams.type as CalculationType) ?? 'standard';
            this.standardMethod = (calcParams.standardMethod as StandardCalculationMethod) ?? '定時決定';
            this.targetMonth = calcParams.targetMonth ?? this.getCurrentTargetMonth(this.calculationType, this.standardMethod);
            this.method = calcParams.method ?? '自動算出';
            this.activeInsurances = calcParams.insurances ?? [];
            this.includeBonusInMonth = calcParams.includeBonusInMonth ?? true;
            this.bonusOnly = calcParams.bonusOnly ?? false;
            // 相互排他チェック: 両方がtrueの場合はincludeBonusInMonthを優先
            if (this.bonusOnly && this.includeBonusInMonth) {
              this.bonusOnly = false;
            }
            this.departmentFilter = calcParams.department ?? '';
            this.locationFilter = calcParams.location ?? '';
            this.employeeNoFilter = calcParams.employeeNo ?? '';
            this.bonusPaidOnFilter = calcParams.bonusPaidOn ?? '';
            this.loadRows();
            return;
          }

          // 計算パラメータもない場合は、クエリパラメータから読み込む
          this.loadParamsFromQuery();
        });
    } else {
      // 承認依頼IDがない場合は、クエリパラメータから読み込む
      this.loadParamsFromQuery();
    }
  }

  private getCurrentTargetMonth(calculationType?: CalculationType, standardMethod?: StandardCalculationMethod): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    // 標準報酬月額計算で定時決定の場合は年のみ（YYYY-01形式）
    if (calculationType === 'standard' && standardMethod === '定時決定') {
      return `${year}-01`;
    }
    return `${year}-${month}`;
  }

  private loadParamsFromQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const type = params.get('type') as CalculationType | null;
    this.calculationType = type ?? 'standard';
    const standardMethodParam = (params.get('standardMethod') as StandardCalculationMethod | null) ?? '定時決定';
    this.standardMethod = standardMethodParam;
    this.targetMonth = params.get('targetMonth') ?? this.getCurrentTargetMonth(this.calculationType, this.standardMethod);
    this.method = params.get('method') ?? '自動算出';
    this.activeInsurances = (params.get('insurances') ?? '')
      .split(',')
      .filter(Boolean);
    this.includeBonusInMonth =
      params.get('includeBonusInMonth') === 'false' ? false : true;
    this.bonusOnly = params.get('bonusOnly') === 'true' ? true : false;
    // 相互排他チェック: 両方がtrueの場合はincludeBonusInMonthを優先
    if (this.bonusOnly && this.includeBonusInMonth) {
      this.bonusOnly = false;
    }
    this.departmentFilter = params.get('department') ?? '';
    this.locationFilter = params.get('location') ?? '';
    this.employeeNoFilter = params.get('employeeNo') ?? '';
    this.bonusPaidOnFilter = params.get('bonusPaidOn') ?? '';
    const historyId = params.get('historyId');
    if (historyId) {
      void this.loadHistoryById(historyId);
      return;
    }

    this.loadRows();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.approvalSubscription?.unsubscribe();
  }

  get visibleColumns() {
    return this.columns
      .filter((c) => c.visible && this.isRelevantForType(c))
      .map((c) => {
        // 定時計算の場合、「対象年月」列のラベルを「対象年」に変更
        if (c.key === 'month' && this.calculationType === 'standard') {
          return { ...c, label: '対象年' };
        }
        // 標準報酬月額計算の場合、「月給支払額」列のラベルを「平均月給支払額」に変更
        if (c.key === 'monthlySalary' && this.calculationType === 'standard') {
          return { ...c, label: '平均月給支払額' };
        }
        return c;
      });
  }

  isColumnVisible(key: ColumnKey): boolean {
    const column = this.columns.find((c) => c.key === key);
    return !!column && column.visible && this.isRelevantForType(column);
  }

  toggleColumn(key: ColumnKey) {
    const target = this.columns.find((c) => c.key === key);
    if (target) {
      target.visible = !target.visible;
    }
  }

  autoHideIrrelevant() {
    this.refreshVisibility(true);
  }

  private isInsuranceActive(type: 'health' | 'nursing' | 'welfare') {
    const labelMap: Record<typeof type, string> = {
      health: '健康保険',
      nursing: '介護保険',
      welfare: '厚生年金',
    };

    return this.activeInsurances.includes(labelMap[type]);
  }

  private loadRows() {
    const query = this.buildQueryParams();

    this.calculationDataService
      .getCalculationRows(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe((rows) => {
        this.rows = rows;
        this.currentHistoryId = undefined;
        this.refreshVisibility(true);
        // 保険料率を取得してから集計
        this.corporateInfoService.getCorporateInfo().pipe(
          switchMap((info) =>
            this.insuranceRatesService.getRateHistory(
              info?.healthInsuranceType ?? '協会けんぽ',
            ).pipe(
              map((rateHistory) => {
                this.currentRateRecord = rateHistory?.[0];
                return this.currentRateRecord;
              })
            )
          ),
          takeUntil(this.destroy$)
        ).subscribe(() => {
          this.calculateSummaries();
          this.updateFilterOptions();
        });
      });
  }

  private buildQueryParams(): CalculationQueryParams {
    return {
      type: this.calculationType,
      targetMonth: this.targetMonth,
      method: this.method,
      standardMethod: this.standardMethod,
      insurances: this.activeInsurances,
      department: this.departmentFilter || undefined,
      location: this.locationFilter || undefined,
      employeeNo: this.employeeNoFilter || undefined,
      includeBonusInMonth: this.includeBonusInMonth,
      bonusOnly: this.bonusOnly || undefined,
      bonusPaidOn: this.bonusPaidOnFilter || undefined,
    };
  }

  sortBy(key: ColumnKey) {
    const column = this.columns.find((c) => c.key === key && c.sortable);
    if (!column) return;
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDirection = 'asc';
    }
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    this.rows = [...this.rows].sort((a, b) => {
      const valA = this.getRawValue(a, key);
      const valB = this.getRawValue(b, key);
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * direction;
      }
      return String(valA).localeCompare(String(valB), 'ja') * direction;
    });
  }

  onDepartmentFilterChange(value: string) {
    this.departmentFilter = value;
    this.loadRows();
  }

  onLocationFilterChange(value: string) {
    this.locationFilter = value;
    this.loadRows();
  }

  private updateFilterOptions() {
    const departments = new Set<string>();
    const locations = new Set<string>();

    this.rows.forEach((row) => {
      if (row.error) return;
      if (row.department) departments.add(row.department);
      if (row.location) locations.add(row.location);
    });

    this.departmentOptions = Array.from(departments).sort((a, b) =>
      a.localeCompare(b, 'ja'),
    );
    this.locationOptions = Array.from(locations).sort((a, b) =>
      a.localeCompare(b, 'ja'),
    );
  }

  getRawValue(row: CalculationRow, key: ColumnKey) {
    switch (key) {
      case 'healthStandardMonthly':
        return row.healthStandardMonthly;
      case 'welfareStandardMonthly':
        return row.welfareStandardMonthly;
      case 'month':
        return row.month;
      case 'healthTotalMonthly':
        return row.healthEmployeeMonthly + row.healthEmployerMonthly;
      case 'nursingTotalMonthly':
        return row.nursingEmployeeMonthly + row.nursingEmployerMonthly;
      case 'welfareTotalMonthly':
        return row.welfareEmployeeMonthly + row.welfareEmployerMonthly;
      case 'healthTotalBonus':
        return row.healthEmployeeBonus + row.healthEmployerBonus;
      case 'nursingTotalBonus':
        return row.nursingEmployeeBonus + row.nursingEmployerBonus;
      case 'welfareTotalBonus':
        return row.welfareEmployeeBonus + row.welfareEmployerBonus;
      case 'totalContribution': {
        const monthly =
          row.healthEmployeeMonthly +
          row.healthEmployerMonthly +
          row.nursingEmployeeMonthly +
          row.nursingEmployerMonthly +
          row.welfareEmployeeMonthly +
          row.welfareEmployerMonthly;
        const bonus =
          row.healthEmployeeBonus +
          row.healthEmployerBonus +
          row.nursingEmployeeBonus +
          row.nursingEmployerBonus +
          row.welfareEmployeeBonus +
          row.welfareEmployerBonus;
        return monthly + bonus;
      }
      default:
        return (row as unknown as Record<string, string | number>)[key];
    }
  }

  getDisplayValue(row: CalculationRow, column: ColumnSetting) {
    const value = this.getRawValue(row, column.key);
    if (value === undefined || value === null) return '-';
    if (typeof value === 'number' && column.format === 'money') {
      return value.toLocaleString('ja-JP');
    }
    if (column.format === 'date' && typeof value === 'string') {
      return this.formatDate(value);
    }
    // 定時計算の場合、「対象年月」列の表示値を年のみに変更
    if (column.key === 'month' && this.calculationType === 'standard' && typeof value === 'string') {
      return value.split('-')[0] || value;
    }
    return value;
  }

  private formatDate(dateStr: string): string {
    // YYYY-MM-DD または YYYY/MM/DD 形式を YYYY/MM/DD に統一
    const normalized = dateStr.replace(/\//g, '-');
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  private refreshVisibility(autoHide = false) {
    const hasRows = this.rows.length > 0;
    this.columns.forEach((column) => {
      const relevant = this.isRelevantForType(column);
      if (!relevant) {
        column.visible = false;
        return;
      }

      // 標準賞与額計算の場合、個人＋会社 保険料合計はデフォルトで非表示
      if (this.calculationType === 'bonus' && column.key === 'totalContribution') {
        column.visible = false;
        return;
      }

      if (autoHide && hasRows) {
        const hasValue = this.rows.some((row) => {
          if (row.error) return false; // エラーがある行はスキップ
          const value = this.getRawValue(row, column.key);
          if (typeof value === 'number') return value !== 0;
          return !!value;
        });
        // 月給支払額はユーザーがチェックするまで自動で表示しない
        if (column.key === 'monthlySalary' && column.visible === false) {
          column.visible = false;
        } else {
          column.visible = hasValue;
        }
      } else if (autoHide) {
        if (column.key === 'monthlySalary' && column.visible === false) {
          column.visible = false;
        } else {
          column.visible = true;
        }
      }
    });
  }

  private isRelevantForType(column: ColumnSetting) {
    // 対象年/年月を標準賞与額計算では非表示
    if (column.key === 'month' && this.calculationType === 'bonus') {
      return false;
    }
    if (column.category === 'monthly' && this.calculationType === 'bonus') {
      return false;
    }
    if (column.category === 'bonus' && this.calculationType === 'standard') {
      return false;
    }
    // 標準報酬月額計算の場合、健保標準報酬月額と厚年標準報酬月額は常に表示
    if (
      this.calculationType === 'standard' &&
      (column.key === 'healthStandardMonthly' || column.key === 'welfareStandardMonthly')
    ) {
      return true;
    }
    // 標準賞与額（健・介）と標準賞与額（厚生年金）は保険種別に関係なく表示
    if (column.key === 'standardHealthBonus' || column.key === 'standardWelfareBonus') {
      return true;
    }
    const insuranceType = this.getInsuranceTypeForColumn(column.key);
    if (insuranceType && !this.isInsuranceActive(insuranceType)) {
      return false;
    }
    return true;
  }

  private getInsuranceTypeForColumn(
    key: ColumnKey,
  ): 'health' | 'nursing' | 'welfare' | null {
    const insuranceMap: Partial<
      Record<ColumnKey, 'health' | 'nursing' | 'welfare'>
    > = {
      healthStandardMonthly: 'health',
      welfareStandardMonthly: 'welfare',
      standardHealthBonus: 'health',
      standardWelfareBonus: 'welfare',
      healthEmployeeMonthly: 'health',
      healthEmployerMonthly: 'health',
      healthTotalMonthly: 'health',
      healthEmployeeBonus: 'health',
      healthEmployerBonus: 'health',
      healthTotalBonus: 'health',
      nursingEmployeeMonthly: 'nursing',
      nursingEmployerMonthly: 'nursing',
      nursingTotalMonthly: 'nursing',
      nursingEmployeeBonus: 'nursing',
      nursingEmployerBonus: 'nursing',
      nursingTotalBonus: 'nursing',
      welfareEmployeeMonthly: 'welfare',
      welfareEmployerMonthly: 'welfare',
      welfareTotalMonthly: 'welfare',
      welfareEmployeeBonus: 'welfare',
      welfareEmployerBonus: 'welfare',
      welfareTotalBonus: 'welfare',
    };

    return insuranceMap[key] ?? null;
  }

  private calculateSummaries() {
    this.departmentSummaries = this.buildDepartmentSummaries();
    this.insuranceSummaries = this.buildInsuranceSummaries();
    this.insuranceMonthlySummaries = this.buildInsuranceMonthlySummaries();
  }

  private buildDepartmentSummaries(): DepartmentSummary[] {
    const summaryMap = new Map<string, DepartmentSummary>();

    this.rows.forEach((row) => {
      if (row.error) return; // エラーがある行は集計から除外
      const key = `${row.month}-${row.department}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          month: row.month,
          department: row.department,
          headcount: 0,
          monthlyPay: 0,
          bonusPay: 0,
          monthlyEmployeeShare: 0,
          monthlyEmployerShare: 0,
          bonusStandardBonus: 0,
          bonusEmployeeShare: 0,
          bonusEmployerShare: 0,
          employeeShare: 0,
          employerShare: 0,
        });
      }
      const target = summaryMap.get(key)!;
      target.headcount += 1;
      target.monthlyPay += row.monthlySalary;
      target.bonusPay += row.bonusTotalPay;

      const monthlyEmployee =
        (this.isInsuranceActive('health') ? row.healthEmployeeMonthly : 0) +
        (this.isInsuranceActive('nursing') ? row.nursingEmployeeMonthly : 0) +
        (this.isInsuranceActive('welfare') ? row.welfareEmployeeMonthly : 0);
      const monthlyEmployer =
        (this.isInsuranceActive('health') ? row.healthEmployerMonthly : 0) +
        (this.isInsuranceActive('nursing') ? row.nursingEmployerMonthly : 0) +
        (this.isInsuranceActive('welfare') ? row.welfareEmployerMonthly : 0);
      const bonusEmployee =
        (this.isInsuranceActive('health') ? row.healthEmployeeBonus : 0) +
        (this.isInsuranceActive('nursing') ? row.nursingEmployeeBonus : 0) +
        (this.isInsuranceActive('welfare') ? row.welfareEmployeeBonus : 0);
      const bonusEmployer =
        (this.isInsuranceActive('health') ? row.healthEmployerBonus : 0) +
        (this.isInsuranceActive('nursing') ? row.nursingEmployerBonus : 0) +
        (this.isInsuranceActive('welfare') ? row.welfareEmployerBonus : 0);

        const includeHealthBonusStandard =
        this.isInsuranceActive('health') || this.isInsuranceActive('nursing');
      const includeWelfareBonusStandard = this.isInsuranceActive('welfare');

      target.monthlyEmployeeShare += monthlyEmployee;
      target.monthlyEmployerShare += monthlyEmployer;
      target.bonusEmployeeShare += bonusEmployee;
      target.bonusEmployerShare += bonusEmployer;
      target.bonusStandardBonus +=
        (includeHealthBonusStandard ? row.standardHealthBonus : 0) +
        (includeWelfareBonusStandard ? row.standardWelfareBonus : 0);

      target.employeeShare += monthlyEmployee + bonusEmployee;
      target.employerShare += monthlyEmployer + bonusEmployer;
    });

    return Array.from(summaryMap.values()).map((entry) => ({
      ...entry,
      monthlyTotal: entry.monthlyEmployeeShare + entry.monthlyEmployerShare,
      bonusTotal: entry.bonusEmployeeShare + entry.bonusEmployerShare,
      total: entry.employeeShare + entry.employerShare,
    }));
  }

  private buildInsuranceSummaries(): InsuranceSummary[] {
    const summaries: InsuranceSummary[] = [];
    const summaryRefs: Partial<
      Record<'health' | 'nursing' | 'welfare', InsuranceSummary>
    > = {};

    if (this.isInsuranceActive('health')) {
      const entry = { type: '健康保険', employee: 0, employer: 0 };
      summaryRefs.health = entry;
      summaries.push(entry);
    }

    if (this.isInsuranceActive('nursing')) {
      const entry = { type: '介護保険', employee: 0, employer: 0 };
      summaryRefs.nursing = entry;
      summaries.push(entry);
    }

    if (this.isInsuranceActive('welfare')) {
      const entry = { type: '厚生年金', employee: 0, employer: 0 };
      summaryRefs.welfare = entry;
      summaries.push(entry);
    }

    // 合計欄の計算用：各社員のraw値を合計（端数処理しない）
    let rawHealthTotal = 0;
    let rawNursingTotal = 0;
    let rawWelfareTotal = 0;

    // 同じ社員の同じ月のデータを1回だけカウントするためのセット
    const processedMonthlyKeys = new Set<string>();
    const processedBonusKeys = new Set<string>();

    this.rows.forEach((row) => {
      if (row.error) return; // エラーがある行は集計から除外
      
      // 同じ社員の同じ月のデータを1回だけカウントするためのキー
      const monthlyKey = `${row.employeeNo}-${row.month}`;
      const isDuplicateMonthly = processedMonthlyKeys.has(monthlyKey);
      
      // 賞与分の保険料がある場合、同じ社員の同じ月の賞与を1回だけカウントする
      const hasBonus = row.healthEmployeeBonus > 0 || row.healthEmployerBonus > 0 ||
                       row.nursingEmployeeBonus > 0 || row.nursingEmployerBonus > 0 ||
                       row.welfareEmployeeBonus > 0 || row.welfareEmployerBonus > 0;
      const bonusKey = hasBonus ? monthlyKey : null;
      const isDuplicateBonus = bonusKey !== null && processedBonusKeys.has(bonusKey);
      
      if (summaryRefs.health) {
        // 月例分は重複を避ける
        if (!isDuplicateMonthly) {
          summaryRefs.health.employee += row.healthEmployeeMonthly;
          summaryRefs.health.employer += row.healthEmployerMonthly;
        }
        // 賞与分は重複を避ける
        if (!isDuplicateBonus) {
          summaryRefs.health.employee += row.healthEmployeeBonus;
          summaryRefs.health.employer += row.healthEmployerBonus;
        }
      }
      if (summaryRefs.nursing) {
        // 月例分は重複を避ける
        if (!isDuplicateMonthly) {
          summaryRefs.nursing.employee += row.nursingEmployeeMonthly;
          summaryRefs.nursing.employer += row.nursingEmployerMonthly;
        }
        // 賞与分は重複を避ける
        if (!isDuplicateBonus) {
          summaryRefs.nursing.employee += row.nursingEmployeeBonus;
          summaryRefs.nursing.employer += row.nursingEmployerBonus;
        }
      }
      if (summaryRefs.welfare) {
        // 月例分は重複を避ける
        if (!isDuplicateMonthly) {
          summaryRefs.welfare.employee += row.welfareEmployeeMonthly;
          summaryRefs.welfare.employer += row.welfareEmployerMonthly;
        }
        // 賞与分は重複を避ける
        if (!isDuplicateBonus) {
          summaryRefs.welfare.employee += row.welfareEmployeeBonus;
          summaryRefs.welfare.employer += row.welfareEmployerBonus;
        }
      }

      // 合計欄の計算：各社員の標準報酬月額 × 保険料率（端数処理しない）
      const rateRecord = this.currentRateRecord;
      if (rateRecord) {
        const location = row.location || '未設定';
        const healthRate = findPrefectureRate(
          rateRecord.healthInsuranceRates,
          location,
        );
        const nursingRate = findPrefectureRate(
          rateRecord.nursingCareRates,
          location,
        );

        // 健康保険の合計raw値
        if (summaryRefs.health && healthRate) {
          const totalRate = parseRate(healthRate.totalRate);
          // 月例分：実際に月例分の保険料が計算されている場合のみ（重複を避ける）
          if (!isDuplicateMonthly && (row.healthEmployeeMonthly > 0 || row.healthEmployerMonthly > 0)) {
            if (row.healthStandardMonthly) {
              rawHealthTotal += row.healthStandardMonthly * totalRate;
            }
          }
          // 賞与分：実際に賞与分の保険料が計算されている場合のみ（重複を避ける）
          if (!isDuplicateBonus && (row.healthEmployeeBonus > 0 || row.healthEmployerBonus > 0)) {
            if (row.standardHealthBonus > 0) {
              rawHealthTotal += row.standardHealthBonus * totalRate;
            }
          }
        }

        // 介護保険の合計raw値
        // 対象外の社員（第2号被保険者ではない社員）を除外するため、
        // 実際に介護保険料が計算されている場合のみ合計に含める
        if (summaryRefs.nursing && nursingRate) {
          const totalRate = parseRate(nursingRate.totalRate);
          // 月例分：介護保険料が実際に計算されている場合のみ（重複を避ける）
          if (!isDuplicateMonthly && (row.nursingEmployeeMonthly > 0 || row.nursingEmployerMonthly > 0)) {
            if (row.healthStandardMonthly) {
              rawNursingTotal += row.healthStandardMonthly * totalRate;
            }
          }
          // 賞与分：介護保険料が実際に計算されている場合のみ（重複を避ける）
          if (!isDuplicateBonus && (row.nursingEmployeeBonus > 0 || row.nursingEmployerBonus > 0)) {
            if (row.standardHealthBonus > 0) {
              rawNursingTotal += row.standardHealthBonus * totalRate;
            }
          }
        }

        // 厚生年金の合計raw値
        if (summaryRefs.welfare && rateRecord.pensionRate) {
          const totalRate = parseRate(rateRecord.pensionRate.totalRate);
          // 月例分：実際に月例分の保険料が計算されている場合のみ（重複を避ける）
          if (!isDuplicateMonthly && (row.welfareEmployeeMonthly > 0 || row.welfareEmployerMonthly > 0)) {
            if (row.welfareStandardMonthly) {
              rawWelfareTotal += row.welfareStandardMonthly * totalRate;
            }
          }
          // 賞与分：実際に賞与分の保険料が計算されている場合のみ（重複を避ける）
          if (!isDuplicateBonus && (row.welfareEmployeeBonus > 0 || row.welfareEmployerBonus > 0)) {
            if (row.standardWelfareBonus > 0) {
              rawWelfareTotal += row.standardWelfareBonus * totalRate;
            }
          }
        }
      }
      
      // 月例分を処理した場合はセットに追加
      if (!isDuplicateMonthly) {
        processedMonthlyKeys.add(monthlyKey);
      }
      // 賞与分を処理した場合はセットに追加
      if (bonusKey !== null && !isDuplicateBonus) {
        processedBonusKeys.add(bonusKey);
      }
    });

    // 合計欄を計算：合計後に1円未満切捨て
    return summaries.map((row) => {
      // 保険料率が取得できていない場合はエラー
      if (!this.currentRateRecord) {
        return {
          ...row,
          error: '保険料率が取得できません。合計を計算できません。',
        };
      }

      let total = 0;
      
      // 保険料率が取得できている場合は、raw値の合計から計算
      if (row.type === '健康保険' && summaryRefs.health) {
        total = Math.floor(rawHealthTotal + 1e-6);
      } else if (row.type === '介護保険' && summaryRefs.nursing) {
        total = Math.floor(rawNursingTotal + 1e-6);
      } else if (row.type === '厚生年金' && summaryRefs.welfare) {
        total = Math.floor(rawWelfareTotal + 1e-6);
      } else {
        // 該当する保険種別がない場合もエラー
        return {
          ...row,
          error: '保険料率が取得できません。合計を計算できません。',
        };
      }

      // 会社負担 = 合計 - 個人負担
      const employer = total - row.employee;

      return {
        ...row,
        employer,
        total,
      };
    });
  }

  private buildInsuranceMonthlySummaries(): InsuranceMonthlySummary[] {
    const summaryMap = new Map<string, InsuranceMonthlySummary>();

    this.rows.forEach((row) => {
      if (row.error) return; // エラーがある行は集計から除外
      const candidates: { key: string; label: string; type: InsuranceKey }[] = [];
      if (this.isInsuranceActive('health'))
        candidates.push({ key: 'health', label: '健康保険', type: 'health' });
      if (this.isInsuranceActive('nursing'))
        candidates.push({ key: 'nursing', label: '介護保険', type: 'nursing' });
      if (this.isInsuranceActive('welfare'))
        candidates.push({ key: 'welfare', label: '厚生年金', type: 'welfare' });

      candidates.forEach((candidate) => {
        const key = `${row.month}-${candidate.key}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            month: row.month,
            insurance: candidate.label,
            standardBonus: 0,
            monthlyEmployee: 0,
            monthlyEmployer: 0,
            bonusEmployee: 0,
            bonusEmployer: 0,
          });
        }

        const target = summaryMap.get(key)!;
        switch (candidate.type) {
          case 'health':
            target.monthlyEmployee += row.healthEmployeeMonthly;
            target.monthlyEmployer += row.healthEmployerMonthly;
            target.bonusEmployee += row.healthEmployeeBonus;
            target.bonusEmployer += row.healthEmployerBonus;
            target.standardBonus += row.standardHealthBonus;
            break;
          case 'nursing':
            target.monthlyEmployee += row.nursingEmployeeMonthly;
            target.monthlyEmployer += row.nursingEmployerMonthly;
            target.bonusEmployee += row.nursingEmployeeBonus;
            target.bonusEmployer += row.nursingEmployerBonus;
            target.standardBonus += row.standardHealthBonus;
            break;
          case 'welfare':
            target.monthlyEmployee += row.welfareEmployeeMonthly;
            target.monthlyEmployer += row.welfareEmployerMonthly;
            target.bonusEmployee += row.welfareEmployeeBonus;
            target.bonusEmployer += row.welfareEmployerBonus;
            target.standardBonus += row.standardWelfareBonus;
            break;
        }
      });
    });

    return Array.from(summaryMap.values()).map((summary) => ({
      ...summary,
      monthlyTotal: summary.monthlyEmployee + summary.monthlyEmployer,
      bonusTotal: summary.bonusEmployee + summary.bonusEmployer,
      total:
        summary.monthlyEmployee +
        summary.monthlyEmployer +
        summary.bonusEmployee +
        summary.bonusEmployer,
    }));
  }

  get showMonthlyBreakdown() {
    return this.calculationType !== 'bonus';
  }

  get showBonusBreakdown() {
    return this.calculationType !== 'standard';
  }

  get validRowsCount(): number {
    return this.rows.filter((r) => !r.error).length;
  }

  get errorRowsCount(): number {
    return this.rows.filter((r) => r.error).length;
  }

  goToApprovalFlow() {
    this.router.navigate(['/approvals'], {
      queryParams: {
        source: 'calculations',
        type: this.calculationType,
        month: this.targetMonth,
      },
    });
  }

  goToCsvExport() {
    const query = this.buildQueryParams();
    const exportRows = this.rows.filter((row) => !row.error);
    this.router.navigate(['/csv-export'], {
      queryParams: { context: 'calculation' },
      state: {
        context: 'calculation',
        calculationContext: {
          rows: exportRows,
          meta: {
            targetMonth: query.targetMonth,
            calculationType: query.type,
            activeInsurances: query.insurances,
            historyId: this.currentHistoryId,
          },
          insuranceSummaries: this.calculationType === 'insurance' ? this.insuranceSummaries : undefined,
        },
      },
    });
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

  async onSelectHistory(historyId: string) {
    const history = await this.calculationDataService.getHistoryById(historyId);
    if (!history) return;
    this.applyHistory(history);
  }

  private async loadHistoryById(historyId: string) {
    try {
      const history =
        await this.calculationDataService.getHistoryById(historyId);
      if (history) {
        this.applyHistory(history);
        return;
      }
    } catch (error) {
      console.error('履歴取得に失敗しました', error);
    }
    this.loadRows();
  }

  private applyHistory(history: CalculationResultHistory) {
    const query = history.query;
    this.calculationType = query.type;
    this.targetMonth = query.targetMonth;
    this.method = query.method;
    this.standardMethod = query.standardMethod;
    this.activeInsurances = query.insurances;
    this.includeBonusInMonth = query.includeBonusInMonth ?? true;
    this.bonusOnly = query.bonusOnly ?? false;
    // 相互排他チェック: 両方がtrueの場合はincludeBonusInMonthを優先
    if (this.bonusOnly && this.includeBonusInMonth) {
      this.bonusOnly = false;
    }
    this.departmentFilter = query.department ?? '';
    this.locationFilter = query.location ?? '';
    this.employeeNoFilter = query.employeeNo ?? '';
    this.bonusPaidOnFilter = query.bonusPaidOn ?? '';
    this.rows = history.rows;
    this.currentHistoryId = history.id;
    this.refreshVisibility(true);
    // 保険料率を取得してから集計
    this.corporateInfoService.getCorporateInfo().pipe(
      switchMap((info) =>
        this.insuranceRatesService.getRateHistory(
          info?.healthInsuranceType ?? '協会けんぽ',
        ).pipe(
          map((rateHistory) => {
            this.currentRateRecord = rateHistory?.[0];
            return this.currentRateRecord;
          })
        )
      ),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.calculateSummaries();
      this.updateFilterOptions();
    });
  }

  async saveResults() {
    if (this.isViewMode) {
      this.approvalMessage = '閲覧モードのため保存できません。';
      return;
    }
    if (this.rows.length === 0) return;

    const validRows = this.rows.filter((row) => !row.error);
    if (validRows.length === 0) {
      alert('保存できるデータがありません。');
      return;
    }

    const roles = await firstValueFrom(this.authService.userRoles$);
    const canApply = roles.some((role) =>
      [RoleKey.Operator, RoleKey.Approver, RoleKey.SystemAdmin].includes(role),
    );

    if (!canApply) {
      this.approvalMessage =
        '承認依頼の起票権限がありません。担当者/承認者/システム管理者のみ保存を申請できます。';
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

    this.saving = true;
    this.approvalMessage = '';
    const query = this.buildQueryParams();
    try {
      const steps = this.selectedFlow.steps.map((step) => ({
        stepOrder: step.order,
        status: 'waiting' as const,
      }));

      // 計算結果の差分データ（承認詳細の差分一覧に表示）
      const employeeDiffs: ApprovalEmployeeDiff[] = validRows.map((row) => {
        const changes: ApprovalEmployeeDiff['changes'] = [];

        const pushIfExists = (field: string, value: number | string | undefined | null) => {
          if (value === undefined || value === null || value === '') return;
          changes.push({
            field,
            oldValue: null,
            newValue: value.toString(),
          });
        };

        pushIfExists('健保標準報酬月額', row.healthStandardMonthly);
        pushIfExists('厚年標準報酬月額', row.welfareStandardMonthly);

        const healthTotalMonthly = (row.healthEmployeeMonthly || 0) + (row.healthEmployerMonthly || 0);
        pushIfExists('健康保険料（月額）', healthTotalMonthly > 0 ? healthTotalMonthly : null);

        const nursingTotalMonthly = (row.nursingEmployeeMonthly || 0) + (row.nursingEmployerMonthly || 0);
        pushIfExists('介護保険料（月額）', nursingTotalMonthly > 0 ? nursingTotalMonthly : null);

        const welfareTotalMonthly = (row.welfareEmployeeMonthly || 0) + (row.welfareEmployerMonthly || 0);
        pushIfExists('厚生年金保険料（月額）', welfareTotalMonthly > 0 ? welfareTotalMonthly : null);

        pushIfExists('賞与支給額', row.bonusTotalPay && row.bonusTotalPay > 0 ? row.bonusTotalPay : null);

        const healthTotalBonus = (row.healthEmployeeBonus || 0) + (row.healthEmployerBonus || 0);
        pushIfExists('健康保険料（賞与）', healthTotalBonus > 0 ? healthTotalBonus : null);

        const welfareTotalBonus = (row.welfareEmployeeBonus || 0) + (row.welfareEmployerBonus || 0);
        pushIfExists('厚生年金保険料（賞与）', welfareTotalBonus > 0 ? welfareTotalBonus : null);

        // 差分が無い場合でも行を表示するため、標準報酬月額または社員番号で1件追加
        if (changes.length === 0) {
          pushIfExists('健保標準報酬月額', row.healthStandardMonthly ?? 0);
        }

        return {
          employeeNo: row.employeeNo,
          name: row.name,
          status: 'ok',
          changes,
        };
      });

      // 計算結果データを保存用に変換
      const calculationResultRows = validRows.map((row) => ({
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
        error: row.error,
      }));

      const createdAt = new Date();
      const dueDate = new Date(createdAt);
      dueDate.setDate(dueDate.getDate() + 14);

      const request: ApprovalRequest = {
        title: '計算結果保存',
        category: '計算結果保存',
        targetCount: validRows.length,
        applicantId: this.applicantId,
        applicantName: this.applicantName,
        flowId: this.selectedFlow.id ?? 'calculation-save-flow',
        flowSnapshot: this.selectedFlow,
        status: 'pending',
        currentStep: this.selectedFlow.steps[0]?.order,
        comment: this.requestComment || `${this.targetMonth}の${this.calculationTypeLabel}を保存します。`,
        steps,
        histories: [],
        attachments: [],
        employeeDiffs,
        calculationQueryParams: {
          type: this.calculationType,
          targetMonth: this.targetMonth,
          method: this.method,
          standardMethod: this.standardMethod,
          insurances: this.activeInsurances,
          includeBonusInMonth: this.includeBonusInMonth,
          bonusOnly: this.bonusOnly,
          department: this.departmentFilter,
          location: this.locationFilter,
          employeeNo: this.employeeNoFilter,
          bonusPaidOn: this.bonusPaidOnFilter,
        },
        calculationResultRows,
        createdAt: Timestamp.fromDate(createdAt),
        dueDate: Timestamp.fromDate(dueDate),
      };

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

      this.approvalMessage = '承認依頼を送信しました。承認完了後に保存を実行します。';
      this.selectedFiles = [];
      this.validationErrors = [];
      
      // 通知を送信
      this.pushApprovalNotifications({ ...saved, id: saved.id });
      
      this.watchApproval(saved.id!, validRows, query);
      
      // メッセージを表示してから1秒後に社会保険料計算メニュー画面に遷移
      setTimeout(() => {
        this.router.navigate(['/calculations']);
      }, 1000);
    } catch (error) {
      console.error('承認依頼エラー:', error);
      this.approvalMessage = '承認依頼の送信に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.saving = false;
    }
  }

     
  private watchApproval(
    requestId: string,
    validRows: CalculationRow[],
    query: CalculationQueryParams,
  ): void {
    this.approvalSubscription?.unsubscribe();
    this.approvalSubscription = this.approvalWorkflowService.requests$.subscribe(
      (requests) => {
        const matched = requests.find((req) => req.id === requestId);
        if (!matched) return;

        if (matched.status === 'approved') {
          this.approvalMessage = '承認完了。保存を実行しています…';
          this.approvalSubscription?.unsubscribe();
          void this.persistResults(validRows, query);
        }

        if (matched.status === 'remanded' || matched.status === 'expired') {
          this.approvalMessage = '承認が完了しなかったため、保存は実行されません。';
          this.approvalSubscription?.unsubscribe();
        }
      },
    );
  }

  private async persistResults(
    validRows: CalculationRow[],
    query: CalculationQueryParams,
  ): Promise<void> {
    this.saving = true;
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

      const savePromises = validRows.map(async (row) => {
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

        // 月次データを準備
        const payrollMonthData: any = {
          amount: row.monthlySalary || undefined,
          healthInsuranceMonthly:
            healthMonthlyTotal > 0 ? healthMonthlyTotal : undefined,
          careInsuranceMonthly:
            careMonthlyTotal > 0 ? careMonthlyTotal : undefined,
          pensionMonthly:
            pensionMonthlyTotal > 0 ? pensionMonthlyTotal : undefined,
        };

        // undefinedのフィールドを除外
        Object.keys(payrollMonthData).forEach((key) => {
          if (payrollMonthData[key] === undefined) {
            delete payrollMonthData[key];
          }
        });

        // 賞与明細データを準備
        let bonusPaymentData: any | undefined;
        if (row.bonusPaymentDate && row.bonusTotalPay !== undefined && row.bonusTotalPay > 0) {
          bonusPaymentData = {
            bonusPaidOn: row.bonusPaymentDate,
            bonusTotal: row.bonusTotalPay,
            standardHealthBonus:
              row.standardHealthBonus > 0 ? row.standardHealthBonus : undefined,
            standardWelfareBonus:
              row.standardWelfareBonus > 0 ? row.standardWelfareBonus : undefined,
            standardBonus:
              row.standardHealthBonus || row.standardWelfareBonus || undefined,
            healthInsuranceBonus:
              healthBonusTotal > 0 ? healthBonusTotal : undefined,
            careInsuranceBonus: careBonusTotal > 0 ? careBonusTotal : undefined,
            pensionBonus: pensionBonusTotal > 0 ? pensionBonusTotal : undefined,
          };

          // undefinedのフィールドを除外
          Object.keys(bonusPaymentData).forEach((key) => {
            if (bonusPaymentData[key] === undefined) {
              delete bonusPaymentData[key];
            }
          });
        }

        // 新しい構造で保存（Transaction使用）
        await this.employeesService.addOrUpdatePayrollMonth(
          employeeId,
          yearMonth,
          payrollMonthData,
          bonusPaymentData,
        );
        const standardMonthlyUpdate: Record<string, number> = {};
        if (row.healthStandardMonthly && row.healthStandardMonthly > 0) {
          standardMonthlyUpdate['healthStandardMonthly'] =
            row.healthStandardMonthly;
        }
        if (row.welfareStandardMonthly && row.welfareStandardMonthly > 0) {
          standardMonthlyUpdate['welfareStandardMonthly'] =
            row.welfareStandardMonthly;
        }
        if (Object.keys(standardMonthlyUpdate).length > 0) {
          await this.employeesService.updateEmployee(
            employeeId,
            standardMonthlyUpdate,
          );
        }
      });

      await Promise.all(savePromises);
      this.currentHistoryId = await this.calculationDataService.saveCalculationHistory(
        query,
        validRows,
        {
          title: this.calculationTypeLabel,
        },
      );
      alert(`${validRows.length}件の計算結果を保存しました。`);
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました。時間をおいて再度お試しください。');
    } finally {
      this.saving = false;
    }
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

interface DepartmentSummary {
  month: string;
  department: string;
  headcount: number;
  monthlyPay: number;
  bonusPay: number;
  monthlyEmployeeShare: number;
  monthlyEmployerShare: number;
  monthlyTotal?: number;
  bonusStandardBonus: number;
  bonusEmployeeShare: number;
  bonusEmployerShare: number;
  bonusTotal?: number;
  employeeShare: number;
  employerShare: number;
  total?: number;
}

interface InsuranceSummary {
  type: string;
  employee: number;
  employer: number;
  total?: number;
  error?: string;
}

interface InsuranceMonthlySummary {
  month: string;
  insurance: string;
  standardBonus: number;
  monthlyEmployee: number;
  monthlyEmployer: number;
  monthlyTotal?: number;
  bonusEmployee: number;
  bonusEmployer: number;
  bonusTotal?: number;
  total?: number;
}
