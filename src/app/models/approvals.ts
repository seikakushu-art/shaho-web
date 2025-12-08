import { Timestamp } from '@angular/fire/firestore';

type ApprovalCategory = '新規' | '個別更新' | '一括更新';

export type ApprovalRequestStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'remanded'
  | 'expired';

export type ApprovalStepStatus = 'waiting' | 'approved' | 'remanded' | 'skipped';

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