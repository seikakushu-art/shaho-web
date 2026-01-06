import { Timestamp } from '@angular/fire/firestore';
import { HealthInsuranceType, CorporateInfoPayload } from '../app/services/corporate-info.service';
import { InsuranceRatePayload } from '../app/services/insurance-rates.service';

type ApprovalCategory =
  | '新規社員登録'
  | '社員情報更新'
  | '保険料率更新'
  | '法人情報更新'
  | '社員情報一括更新'
  | '社員削除'
  | '計算結果保存';

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'remanded'
  | 'expired';

export type ApprovalStepStatus = 'waiting' | 'approved' | 'remanded';

export interface ApprovalAttachmentMetadata {
    id: string;
    name: string;
    size: number;
    contentType: string;
    downloadUrl: string;
    extension?: string;
    uploadedAt?: Timestamp;
    uploaderId?: string;
    uploaderName?: string;
    storagePath?: string;
  }
  
  export interface ApprovalHistory {
    id: string;
    statusAfter: ApprovalRequestStatus;
    action: 'apply' | 'approve' | 'remand' | 'expired';
    actorId: string;
    actorName: string;
    comment?: string;
    attachments: ApprovalAttachmentMetadata[];
    createdAt: Timestamp;
  }

export interface ApprovalCandidate {
  id: string;
  displayName: string;
}

export interface ApprovalFlowStep {
  order: number;
  name: string;
  candidates: ApprovalCandidate[];
}

export interface ApprovalFlow {
  id?: string;
  name: string;
  steps: ApprovalFlowStep[];
  maxSteps?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ApprovalStepState {
  stepOrder: number;
  status: ApprovalStepStatus;
  approverId?: string;
  approverName?: string;
  comment?: string;
  approvedAt?: Timestamp;
}

export interface ApprovalEmployeeDiff {
  employeeNo: string;
  name: string;
  status: 'ok' | 'warning' | 'error';
  changes: {
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }[];
  isNew?: boolean;
  existingEmployeeId?: string;
}

export interface ApprovalRequest {
  id?: string;
  title: string;
  category: ApprovalCategory;
  targetCount: number;
  applicantId: string;
  applicantName: string;
  flowId: string;
  flowSnapshot?: ApprovalFlow;
  status: ApprovalRequestStatus;
  currentStep?: number;
  comment?: string;
  diffSummary?: string;
  employeeDiffs?: ApprovalEmployeeDiff[];
  dueDate?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  steps: ApprovalStepState[];
  attachments?: ApprovalAttachmentMetadata[];
  histories?: ApprovalHistory[];
  calculationQueryParams?: {
    type?: string;
    targetMonth?: string;
    method?: string;
    standardMethod?: string;
    insurances?: string[];
    includeBonusInMonth?: boolean;
    bonusOnly?: boolean;
    department?: string;
    location?: string;
    employeeNo?: string;
    bonusPaidOn?: string;
  };
  calculationResultRows?: Array<{
    employeeNo: string;
    name: string;
    department: string;
    location: string;
    month: string;
    monthlySalary: number;
    healthStandardMonthly?: number;
    welfareStandardMonthly?: number;
    healthEmployeeMonthly: number;
    healthEmployerMonthly: number;
    nursingEmployeeMonthly: number;
    nursingEmployerMonthly: number;
    welfareEmployeeMonthly: number;
    welfareEmployerMonthly: number;
    bonusPaymentDate: string;
    bonusTotalPay: number;
    healthEmployeeBonus: number;
    healthEmployerBonus: number;
    nursingEmployeeBonus: number;
    nursingEmployerBonus: number;
    welfareEmployeeBonus: number;
    welfareEmployerBonus: number;
    standardHealthBonus: number;
    standardWelfareBonus: number;
    exemption?: boolean;
    error?: string;
  }>;
  employeeData?: {
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
      postalCode?: string;
      address: string;
      currentAddress?: string;
      isCurrentAddressSameAsResident?: boolean;
    };
    socialInsurance: {
      pensionOffice: string;
      officeName: string;
      healthStandardMonthly?: number;
      welfareStandardMonthly?: number;
      healthCumulative: number;
      healthInsuredNumber: string;
      pensionInsuredNumber: string;
      careSecondInsured: boolean;
      healthAcquisition: string;
      pensionAcquisition: string;
      currentLeaveStatus: string;
      currentLeaveStartDate: string;
      currentLeaveEndDate: string;
    };
    dependentInfo?: {
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
    };
    // 複数扶養に対応するための配列（dependentInfoは後方互換用に保持）
    dependentInfos?: Array<{
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
    }>;
  };
  insuranceRateData?: InsuranceRatePayload;
  corporateInfoData?: CorporateInfoPayload;
  importEmployeeData?: Array<{
    employeeNo: string;
    csvData: Record<string, string>;
    isNew: boolean;
    existingEmployeeId?: string;
    templateType: string;
  }>;
}

export interface ApprovalNotification {
  id: string;
  requestId: string;
  recipientId: string;
  message: string;
  unread: boolean;
  createdAt: Date;
  type: 'info' | 'success' | 'warning';
}