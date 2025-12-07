import { Timestamp } from '@angular/fire/firestore';

type ApprovalCategory = '新規' | '個別更新' | '一括更新';

export type ApprovalRequestStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'remanded'
  | 'expired';

export type ApprovalStepStatus = 'waiting' | 'approved' | 'remanded' | 'skipped';

export interface ApprovalCandidate {
  id: string;
  displayName: string;
}

export interface ApprovalFlowStep {
  order: number;
  name: string;
  candidates: ApprovalCandidate[];
  autoAdvance?: boolean;
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
  dueDate?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  steps: ApprovalStepState[];
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