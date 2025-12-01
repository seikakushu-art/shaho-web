import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { ShahoEmployeesService, ShahoEmployee } from '../../app/services/shaho-employees.service';

const REMUNERATION_TABLE = [
  { grade: '1', min: 0, max: 98000, amount: 98000 },
  { grade: '2', min: 98001, max: 122000, amount: 122000 },
  { grade: '3', min: 122001, max: 150000, amount: 150000 },
  { grade: '4', min: 150001, max: 170000, amount: 170000 },
  { grade: '5', min: 170001, max: 190000, amount: 190000 },
  { grade: '6', min: 190001, max: 210000, amount: 210000 },
  { grade: '7', min: 210001, max: 230000, amount: 230000 },
  { grade: '8', min: 230001, max: 250000, amount: 250000 },
  { grade: '9', min: 250001, max: 270000, amount: 270000 },
  { grade: '10', min: 270001, max: 300000, amount: 300000 },
  { grade: '11', min: 300001, max: 330000, amount: 330000 },
  { grade: '12', min: 330001, max: 360000, amount: 360000 },
  { grade: '13', min: 360001, max: 390000, amount: 390000 },
  { grade: '14', min: 390001, max: 420000, amount: 420000 },
  { grade: '15', min: 420001, max: 450000, amount: 450000 },
  { grade: '16', min: 450001, max: 480000, amount: 480000 },
  { grade: '17', min: 480001, max: 510000, amount: 510000 },
  { grade: '18', min: 510001, max: 540000, amount: 540000 },
  { grade: '19', min: 540001, max: 570000, amount: 570000 },
  { grade: '20', min: 570001, max: 600000, amount: 600000 },
  { grade: '21', min: 600001, max: 630000, amount: 630000 },
  { grade: '22', min: 630001, max: 660000, amount: 660000 },
  { grade: '23', min: 660001, max: 690000, amount: 690000 },
  { grade: '24', min: 690001, max: 720000, amount: 720000 },
  { grade: '25', min: 720001, max: 750000, amount: 750000 },
];


type ProcedureType = '定時決定' | '賞与算定';
type StepKey = 'step0' | 'step1' | 'step2' | 'step3' | 'step4' | 'step5';
type StepStatus =
  | '未着手'
  | '下書き'
  | '完了'
  | '取込済'
  | '算定済'
  | '確認完了'
  | '承認中'
  | '承認済'
  | '確定';

type ReviewFilter = 'all' | 'changed' | 'excluded';

type ApprovalStatus = '未依頼' | '承認中' | '承認済' | '差戻し';

type CalculationJudgement = '増額' | '減額' | '変更なし' | '対象外';

interface ProcedureRecord {
  id: string;
  type: ProcedureType;
  status: '下書き' | '算定済' | '確認中' | '承認中' | '承認済' | '確定';
  location: string;
  fiscalYear?: string;
  bonusMonth?: string;
  bonusName?: string;
  createdAt: string;
  stepStates: Record<StepKey, StepStatus>;
}

interface ImportSummary {
  total: number;
  errors: number;
  importedAt?: Date;
  user?: string;
  errorDetails: string[];
}

interface PayrollImportRow {
  employeeNo: string;
  fiscalYear: string;
  aprilAmount: number;
  aprilDays: number;
  mayAmount: number;
  mayDays: number;
  juneAmount: number;
  juneDays: number;
}

interface BonusImportRow {
  employeeNo: string;
  bonusDate: string;
  bonusYear: string;
  bonusAmount: number;
  bonusName?: string;
}

interface BaseCalcResult {
  employeeNo: string;
  name: string;
  department: string;
  judgement: CalculationJudgement;
  confirmed?: boolean;
  adjustReason?: string;
}

interface RegularCalcResult extends BaseCalcResult {
  type: '定時決定';
  previousStandard?: number;
  newStandard?: number;
  newGrade?: string;
  averageReward?: number;
  monthlyDetails: {
    month: string;
    amount: number;
    days: number;
  }[];
  manualOverride?: boolean;
}

interface BonusCalcResult extends BaseCalcResult {
  type: '賞与算定';
  bonusDate: string;
  bonusName?: string;
  paidAmount: number;
  standardBonus?: number;
  healthInsuranceAmount?: number;
  pensionAmount?: number;
  manualOverride?: boolean;
}

type CalculationResult = RegularCalcResult | BonusCalcResult;

interface ApprovalRequest {
  title: string;
  comment?: string;
  status: ApprovalStatus;
  createdAt: Date;
  attachments: string[];
}

@Component({
  selector: 'app-standard-remuneration',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './standard-remuneration.component.html',
  styleUrl: './standard-remuneration.component.scss',
})
export class StandardRemunerationComponent implements OnInit {
  private employeesService = inject(ShahoEmployeesService);
  private auth = inject(Auth);
  employeeMaster: ShahoEmployee[] = [];
  
  procedureTypes: ProcedureType[] = ['定時決定', '賞与算定'];
  
  // 年度リストを生成（現在年から前後5年）
  fiscalYears: string[] = (() => {
    const currentYear = new Date().getFullYear();
    const years: string[] = [];
    for (let i = -5; i <= 5; i++) {
      years.push(`${currentYear + i}年度`);
    }
    return years;
  })();
  
  creationForm = {
    type: '定時決定' as ProcedureType,
    fiscalYear: '2025年度',
    location: '本社',
    bonusMonth: '2025-07', // YYYY-MM形式
    bonusName: '',
  };
  
  // 賞与支給年月を表示用フォーマットに変換（YYYY-MM → YYYY年M月）
  formatBonusMonth(monthStr?: string): string {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    if (!year || !month) return monthStr;
    return `${year}年${parseInt(month, 10)}月`;
  }

  procedure?: ProcedureRecord;
  importSummary: ImportSummary = { total: 0, errors: 0, errorDetails: [] };
  importRows: (PayrollImportRow | BonusImportRow)[] = [];
  importErrors: string[] = [];
  selectedFileName?: string;

  calculationResults: CalculationResult[] = [];
  calculationSummary = { targets: 0, excluded: 0, errors: 0, executedAt: undefined as Date | undefined };

  showResultsList = false;
  reviewFilter: ReviewFilter = 'all';
  editingRecord?: CalculationResult;

  approvalRequest?: ApprovalRequest;
  approvalComment = '';

  async ngOnInit() {
    // 社員マスタデータを取得
    this.employeeMaster = await firstValueFrom(this.employeesService.getEmployees());
  }

  readonly filteredResults = computed(() => {
    return this.calculationResults.filter((result) => {
      if (this.reviewFilter === 'changed') {
        return result.judgement !== '対象外' && result.judgement !== '変更なし';
      }
      if (this.reviewFilter === 'excluded') {
        return result.judgement === '対象外';
      }
      return true;
    });
  });

  get stepStates(): Record<StepKey, StepStatus> {
    return (
      this.procedure?.stepStates || {
        step0: '未着手',
        step1: '未着手',
        step2: '未着手',
        step3: '未着手',
        step4: '未着手',
        step5: '未着手',
      }
    );
  }

  private updateStepState(step: StepKey, status: StepStatus) {
    if (!this.procedure) return;
    this.procedure = {
      ...this.procedure,
      stepStates: {
        ...this.procedure.stepStates,
        [step]: status,
      },
    };
  }

  private resetStatesAfterCreation() {
    this.importSummary = { total: 0, errors: 0, errorDetails: [] };
    this.importRows = [];
    this.importErrors = [];
    this.calculationResults = [];
    this.calculationSummary = { targets: 0, excluded: 0, errors: 0, executedAt: undefined };
    this.showResultsList = false;
    this.reviewFilter = 'all';
    this.editingRecord = undefined;
    this.approvalRequest = undefined;
  }

  // フォームのバリデーション
  get isFormValid(): boolean {
    if (!this.creationForm.type) return false;
    if (!this.creationForm.location || this.creationForm.location.trim() === '') return false;
    
    if (this.creationForm.type === '定時決定') {
      if (!this.creationForm.fiscalYear) return false;
    } else if (this.creationForm.type === '賞与算定') {
      if (!this.creationForm.bonusMonth) return false;
      if (!this.creationForm.bonusName || this.creationForm.bonusName.trim() === '') return false;
    }
    
    return true;
  }

  createProcedure() {
    if (!this.isFormValid) return;
    
    const now = new Date();
    const id = `${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}-${Math.floor(Math.random() * 9999)}`;
    const baseStepState: Record<StepKey, StepStatus> = {
      step0: '完了',
      step1: '未着手',
      step2: '未着手',
      step3: '未着手',
      step4: '未着手',
      step5: '未着手',
    };

    this.procedure = {
      id,
      type: this.creationForm.type,
      status: '下書き',
      location: this.creationForm.location,
      fiscalYear: this.creationForm.type === '定時決定' ? this.creationForm.fiscalYear : undefined,
      bonusMonth: this.creationForm.type === '賞与算定' ? this.creationForm.bonusMonth : undefined,
      bonusName: this.creationForm.type === '賞与算定' ? this.creationForm.bonusName : undefined,
      createdAt: now.toISOString(),
      stepStates: baseStepState,
    };

    this.resetStatesAfterCreation();
  }

  downloadSampleCsv() {
    const headers =
      this.procedure?.type === '賞与算定'
        ? '社員番号,賞与総支給額'
        : '社員番号,4月報酬額,4月支払基礎日数,5月報酬額,5月支払基礎日数,6月報酬額,6月支払基礎日数';
    const content = headers;
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.procedure?.type || 'サンプル'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    this.selectedFileName = file?.name;
  }

  async uploadCsv(input: HTMLInputElement) {
    if (!this.procedure) return;
    const file = input.files?.[0];
    if (!file) {
      this.importErrors = ['ファイルが選択されていません'];
      return;
    }

    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line);

    if (!lines.length) {
      this.importErrors = ['CSVにデータがありません'];
      return;
    }

    const headers = lines[0].split(',').map((h) => h.trim());
    const requiredHeaders =
      this.procedure.type === '賞与算定'
        ? ['社員番号', '賞与総支給額']
        : ['社員番号', '4月報酬額', '4月支払基礎日数', '5月報酬額', '5月支払基礎日数', '6月報酬額', '6月支払基礎日数'];

    const missing = requiredHeaders.filter((header) => !headers.includes(header));
    if (missing.length) {
      this.importErrors = [`必須項目が不足しています: ${missing.join(', ')}`];
      return;
    }

    const errors: string[] = [];
    const records: (PayrollImportRow | BonusImportRow)[] = [];
    lines.slice(1).forEach((line, index) => {
      const cols = line.split(',').map((value) => value.trim());
      const rowNumber = index + 2;
      const get = (key: string) => cols[headers.indexOf(key)] ?? '';
      const employeeNo = get('社員番号');
      if (!employeeNo) {
        errors.push(`${rowNumber}行目: 社員番号が空です`);
        return;
      }
      const employee = this.employeeMaster.find((item) => item.employeeNo === employeeNo);
      if (!employee) {
        errors.push(`${rowNumber}行目: 社員番号 ${employeeNo} が社員マスタに存在しません`);
        return;
      }

      if (this.procedure?.type === '賞与算定') {
        const bonusAmount = Number(get('賞与総支給額'));
        if (!bonusAmount || Number.isNaN(bonusAmount)) {
          errors.push(`${rowNumber}行目: 賞与総支給額が不正です`);
          return;
        }
        // 賞与支給日は手続きのbonusMonthから生成（月末日とする）
        const bonusMonth = this.procedure.bonusMonth;
        let bonusDate = '';
        if (bonusMonth) {
          const [year, month] = bonusMonth.split('-');
          if (year && month) {
            const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
            bonusDate = `${year}-${month.padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
          }
        }
        // 賞与支給年度は手続きのbonusMonthから取得
        const bonusYear = bonusMonth ? bonusMonth.split('-')[0] : '';
        records.push({
          employeeNo,
          bonusDate: bonusDate || new Date().toISOString().split('T')[0],
          bonusYear: bonusYear || new Date().getFullYear().toString(),
          bonusAmount,
          bonusName: this.procedure.bonusName || this.creationForm.bonusName,
        });
      } else {
        const aprilAmount = Number(get('4月報酬額'));
        const aprilDays = Number(get('4月支払基礎日数'));
        const mayAmount = Number(get('5月報酬額'));
        const mayDays = Number(get('5月支払基礎日数'));
        const juneAmount = Number(get('6月報酬額'));
        const juneDays = Number(get('6月支払基礎日数'));

        const invalid = [
          [aprilAmount, '4月報酬額'],
          [aprilDays, '4月支払基礎日数'],
          [mayAmount, '5月報酬額'],
          [mayDays, '5月支払基礎日数'],
          [juneAmount, '6月報酬額'],
          [juneDays, '6月支払基礎日数'],
        ].filter(([value]) => value === undefined || value === null || Number.isNaN(Number(value)));

        if (invalid.length) {
          errors.push(`${rowNumber}行目: ${invalid.map(([, label]) => label).join(', ')} が不正です`);
          return;
        }

        records.push({
          employeeNo,
          fiscalYear: this.procedure?.fiscalYear || '',
          aprilAmount: Number(aprilAmount),
          aprilDays: Number(aprilDays),
          mayAmount: Number(mayAmount),
          mayDays: Number(mayDays),
          juneAmount: Number(juneAmount),
          juneDays: Number(juneDays),
        });
      }
    });

    this.importErrors = errors;
    if (!errors.length) {
      this.importRows = records;
      const currentUser = this.auth.currentUser;
      const userId = currentUser?.displayName || currentUser?.email || currentUser?.uid || 'system';
      this.importSummary = {
        total: records.length,
        errors: 0,
        importedAt: new Date(),
        user: userId,
        errorDetails: [],
      };
      this.updateStepState('step1', '取込済');
    } else {
      const currentUser = this.auth.currentUser;
      const userId = currentUser?.displayName || currentUser?.email || currentUser?.uid || 'system';
      this.importSummary = {
        total: records.length,
        errors: errors.length,
        importedAt: new Date(),
        user: userId,
        errorDetails: errors,
      };
    }
  }

  private pickStandard(amount: number) {
    const table = REMUNERATION_TABLE.find((row) => amount >= row.min && amount <= row.max);
    if (table) return table;
    return REMUNERATION_TABLE[REMUNERATION_TABLE.length - 1];
  }

  runCalculation() {
    if (!this.procedure) return;
    if (!this.importRows.length) {
      this.importErrors = ['取込データがありません'];
      return;
    }

    const results: CalculationResult[] = [];
    let excluded = 0;
    this.importRows.forEach((row) => {
      const employee = this.employeeMaster.find((item) => item.employeeNo === row.employeeNo);
      if (!employee) return;

      if (this.procedure?.type === '賞与算定') {
        const bonusRow = row as BonusImportRow;
        const standardBonus = Math.min(Math.floor((bonusRow.bonusAmount || 0) / 1000) * 1000, 6000000);
        const judgement: CalculationJudgement = bonusRow.bonusAmount > 0 ? '変更なし' : '対象外';
        if (judgement === '対象外') excluded += 1;
        results.push({
          type: '賞与算定',
          employeeNo: employee.employeeNo,
          name: employee.name,
          department: employee.department || '',
          bonusDate: bonusRow.bonusDate,
          bonusName: bonusRow.bonusName,
          paidAmount: bonusRow.bonusAmount,
          standardBonus,
          healthInsuranceAmount: standardBonus,
          pensionAmount: Math.min(standardBonus, 1500000),
          judgement,
        });
      } else {
        const payrollRow = row as PayrollImportRow;
        // 支払基礎日数が17日以上の月のみを対象にする
        const validMonths: { amount: number; days: number }[] = [];
        if (payrollRow.aprilDays >= 17) {
          validMonths.push({ amount: payrollRow.aprilAmount, days: payrollRow.aprilDays });
        }
        if (payrollRow.mayDays >= 17) {
          validMonths.push({ amount: payrollRow.mayAmount, days: payrollRow.mayDays });
        }
        if (payrollRow.juneDays >= 17) {
          validMonths.push({ amount: payrollRow.juneAmount, days: payrollRow.juneDays });
        }
        
        // 有効な月が0の場合は平均を0とする
        const average = validMonths.length > 0
          ? Math.round(validMonths.reduce((sum, m) => sum + m.amount, 0) / validMonths.length)
          : 0;
        
        let judgement: CalculationJudgement = '変更なし';
        let standard: { grade: string; min: number; max: number; amount: number } | undefined;
        
        if (!average || validMonths.length === 0) {
          judgement = '対象外';
          excluded += 1;
        } else {
          standard = this.pickStandard(average);
          if ((employee.standardMonthly || 0) < standard.amount) {
            judgement = '増額';
          } else if ((employee.standardMonthly || 0) > standard.amount) {
            judgement = '減額';
          }
        }

        results.push({
          type: '定時決定',
          employeeNo: employee.employeeNo,
          name: employee.name,
          department: employee.department || '',
          previousStandard: employee.standardMonthly,
          newStandard: standard?.amount,
          newGrade: standard?.grade,
          averageReward: average,
          judgement,
          monthlyDetails: [
            { month: '4月', amount: payrollRow.aprilAmount, days: payrollRow.aprilDays },
            { month: '5月', amount: payrollRow.mayAmount, days: payrollRow.mayDays },
            { month: '6月', amount: payrollRow.juneAmount, days: payrollRow.juneDays },
          ],
        });
      }
    });

    this.calculationResults = results;
    this.calculationSummary = {
      targets: results.length,
      excluded,
      errors: 0,
      executedAt: new Date(),
    };
    this.updateStepState('step2', '算定済');
    this.procedure = { ...this.procedure, status: '算定済' };
  }

  changeFilter(filter: ReviewFilter) {
    this.reviewFilter = filter;
  }

  openResultsList() {
    this.showResultsList = true;
  }

  editRecord(record: CalculationResult) {
    this.editingRecord = { ...record } as CalculationResult;
  }

  saveEdit() {
    if (!this.editingRecord) return;
    const index = this.calculationResults.findIndex(
      (item) => item.employeeNo === this.editingRecord?.employeeNo,
    );
    if (index !== -1) {
      this.calculationResults[index] = this.editingRecord;
    }
    this.editingRecord = undefined;
  }

  markConfirmed(record: CalculationResult, confirmed: boolean) {
    record.confirmed = confirmed;
    const allConfirmed = this.calculationResults.length > 0 && this.calculationResults.every((item) => item.confirmed);
    if (allConfirmed) {
      this.updateStepState('step3', '確認完了');
      if (this.procedure) {
        this.procedure = { ...this.procedure, status: '確認中' };
      }
    }
  }

  get reviewSummary() {
    const changed = this.calculationResults.filter((r) => r.judgement !== '変更なし' && r.judgement !== '対象外').length;
    const noChange = this.calculationResults.filter((r) => r.judgement === '変更なし').length;
    const excluded = this.calculationResults.filter((r) => r.judgement === '対象外').length;
    return { changed, noChange, excluded };
  }

  requestApproval(comment?: string) {
    if (!this.procedure) return;
    const title =
      this.procedure.type === '賞与算定'
        ? `${this.formatBonusMonth(this.procedure.bonusMonth)} ${this.procedure.bonusName || '賞与'} 標準賞与額算定（${this.procedure.location}）`
        : `${this.procedure.fiscalYear} 定時決定（${this.procedure.location}）`;
    this.approvalRequest = {
      title,
      comment,
      status: '承認中',
      createdAt: new Date(),
      attachments: ['算定結果一覧.csv'],
    };
    this.updateStepState('step4', '承認中');
    this.procedure = { ...this.procedure, status: '承認中' };
    this.approvalComment = '';
  }

  approveRequest() {
    if (!this.approvalRequest || !this.procedure) return;
    this.approvalRequest = { ...this.approvalRequest, status: '承認済' };
    this.updateStepState('step4', '承認済');
    this.procedure = { ...this.procedure, status: '承認済' };
  }

  remandRequest() {
    if (!this.approvalRequest || !this.procedure) return;
    this.approvalRequest = { ...this.approvalRequest, status: '差戻し' };
    this.updateStepState('step4', '未着手');
    this.updateStepState('step3', '未着手');
    this.procedure = { ...this.procedure, status: '算定済' };
  }

  holdRequest() {
    if (!this.approvalRequest) return;
    this.approvalRequest = { ...this.approvalRequest, status: '承認中' };
  }

  exportCsv() {
    const headers =
      this.procedure?.type === '賞与算定'
        ? ['社員番号', '氏名', '部署', '賞与支給日', '賞与名称', '賞与支給額', '標準賞与額']
        : ['社員番号', '氏名', '部署', '従前標準報酬月額', '新標準報酬月額', '判定', '3か月平均'];
    const body = this.calculationResults
      .map((row) => {
        if (row.type === '賞与算定') {
          return [
            row.employeeNo,
            row.name,
            row.department,
            row.bonusDate,
            row.bonusName,
            row.paidAmount,
            row.standardBonus,
          ].join(',');
        }
        return [
          row.employeeNo,
          row.name,
          row.department,
          row.previousStandard,
          row.newStandard,
          row.judgement,
          row.averageReward,
        ].join(',');
      })
      .join('\n');
    const content = `${headers.join(',')}\n${body}`;
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.procedure?.type || '算定結果'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  finalizeProcedure() {
    if (!this.procedure) return;
    this.updateStepState('step5', '確定');
    this.procedure = { ...this.procedure, status: '確定' };
  }
}