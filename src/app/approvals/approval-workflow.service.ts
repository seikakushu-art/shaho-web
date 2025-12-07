import { inject, Injectable } from '@angular/core';
import { collection, collectionData, doc, deleteDoc, addDoc, Firestore, serverTimestamp, setDoc, Timestamp } from '@angular/fire/firestore';
import { BehaviorSubject, combineLatest, map, Observable, of, tap } from 'rxjs';
import {
  ApprovalFlow,
  ApprovalNotification,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalHistory,
  ApprovalAttachmentMetadata,
  ApprovalStepState,
  ApprovalStepStatus,
} from '../models/approvals';

interface ApprovalActionResult {
  request: ApprovalRequest;
  nextAssignees: string[];
}

@Injectable({ providedIn: 'root' })
export class ApprovalWorkflowService {
  private firestore = inject(Firestore);
  private flowsRef = collection(this.firestore, 'approval_flows');
  private requestsRef = collection(this.firestore, 'approval_requests');

  private flowsSubject = new BehaviorSubject<ApprovalFlow[]>([]);
  private requestsSubject = new BehaviorSubject<ApprovalRequest[]>([]);

  readonly flows$ = this.flowsSubject.asObservable();
  readonly requests$ = this.requestsSubject.asObservable();

  constructor() {
    this.syncFlows();
    this.syncRequests();
    this.startExpirationWatcher();
  }

  private syncFlows() {
    collectionData(this.flowsRef, { idField: 'id' })
      .pipe(
        map((rows) => rows as ApprovalFlow[]),
        tap((flows) => this.flowsSubject.next(flows)),
      )
      .subscribe();
  }

  private syncRequests() {
    combineLatest([
      collectionData(this.requestsRef, { idField: 'id' }).pipe(
        map((rows) => rows as ApprovalRequest[]),
      ),
      this.flows$,
    ])
      .pipe(
        tap(([requests, flows]) => {
            const normalized = requests.map((req) =>
                req.flowSnapshot ? req : { ...req, flowSnapshot: flows.find((f) => f.id === req.flowId) },
              );
              this.requestsSubject.next(normalized);
        }),
      )
      .subscribe();
  }

  getRequest(id: string | null): Observable<ApprovalRequest | undefined> {
    if (!id) return of(undefined);
    return this.requests$.pipe(map((requests) => requests.find((item) => item.id === id)));
  }

  getNotificationsFor(recipientId: string): Observable<ApprovalNotification[]> {
    return of(this.createNotificationsSnapshot(recipientId));
  }

  async saveFlow(flow: ApprovalFlow): Promise<void> {
    const payload: ApprovalFlow = {
      ...flow,
      steps: flow.steps.slice(0, 5),
      maxSteps: 5,
      updatedAt: serverTimestamp() as Timestamp,
      createdAt: flow.createdAt ?? (serverTimestamp() as Timestamp),
    };

    if (payload.id) {
      const ref = doc(this.flowsRef, payload.id);
      await setDoc(ref, payload, { merge: true });
      return;
    }

    await addDoc(this.flowsRef, payload);
  }

  async deleteFlow(id: string): Promise<void> {
    const ref = doc(this.flowsRef, id);
    await deleteDoc(ref);
  }

  async saveRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    const payload: ApprovalRequest = {
      ...request,
      steps: request.steps.slice(0, 5),
      currentStep:
        request.status === 'approved' || request.status === 'expired'
          ? undefined
          : request.currentStep,
      updatedAt: serverTimestamp() as Timestamp,
      createdAt: request.createdAt ?? (serverTimestamp() as Timestamp),
    };

    if (payload.id) {
      const ref = doc(this.requestsRef, payload.id);
      await setDoc(ref, payload, { merge: true });
      this.refreshLocal(payload);
      return payload;
    }

    const ref = doc(this.requestsRef);
    const created: ApprovalRequest = { ...payload, id: ref.id };
    await setDoc(ref, created, { merge: true });
    this.refreshLocal(created);
    return created;
  }

  async approve(
    id: string,
    approverId: string,
    approverName: string,
    comment?: string,
    attachments: ApprovalAttachmentMetadata[] = [],
  ) {
    const result = await this.applyAction(
      id,
      approverId,
      approverName,
      'approve',
      comment,
      attachments,
    );
    return result;
  }

  async remand(
    id: string,
    approverId: string,
    approverName: string,
    comment?: string,
    attachments: ApprovalAttachmentMetadata[] = [],
  ) {
    const result = await this.applyAction(
      id,
      approverId,
      approverName,
      'remand',
      comment,
      attachments,
    );
    return result;
  }

  async expire(request: ApprovalRequest): Promise<void> {
    const expired: ApprovalRequest = {
      ...request,
      status: 'expired',
      currentStep: undefined,
      histories: [
        ...(request.histories ?? []),
        this.buildHistoryEntry('expired', 'system', '期限切れ', '期限超過で自動失効', [], 'expired'),
      ],
    };
    await this.saveRequest(expired);
  }

  private async applyAction(
    id: string,
    approverId: string,
    approverName: string,
    action: 'approve' | 'remand',
    comment?: string,
    attachments: ApprovalAttachmentMetadata[] = [],
  ): Promise<ApprovalActionResult | undefined> {
    const request = this.requestsSubject.value.find((item) => item.id === id);
    if (!request || !request.flowSnapshot) return;

    const steps = [...request.steps];
    const currentIndex = steps.findIndex((step) => step.stepOrder === request.currentStep);
    if (currentIndex === -1) return;

    const step = steps[currentIndex];
    const newStatus: ApprovalStepStatus = action === 'approve' ? 'approved' : 'remanded';
    steps[currentIndex] = {
      ...step,
      status: newStatus,
      approverId,
      approverName,
      comment,
      approvedAt: Timestamp.fromDate(new Date()),
    };

    const nextStep = steps[currentIndex + 1];
    const isFinalStep = !nextStep;

    const status: ApprovalRequestStatus =
      action === 'remand' ? 'remanded' : isFinalStep ? 'approved' : 'pending';

    const histories: ApprovalHistory[] = [
      ...(request.histories ?? []),
      this.buildHistoryEntry(action, approverId, approverName, comment, attachments, status),
    ];

    const updatedRequest: ApprovalRequest = {
      ...request,
      steps,
      status,
      currentStep: status === 'pending' ? nextStep.stepOrder : undefined,
      updatedAt: Timestamp.fromDate(new Date()),
      attachments: [...(request.attachments ?? []), ...attachments],
      histories,
    };

    const saved = await this.saveRequest(updatedRequest);

    const nextAssignees =
      status === 'pending'
        ? nextStep?.approverId
          ? [nextStep.approverId]
          : request.flowSnapshot.steps[currentIndex + 1]?.candidates.map((c) => c.id) ?? []
        : [];

    return { request: saved, nextAssignees };
  }

  private buildHistoryEntry(
    action: ApprovalHistory['action'],
    actorId: string,
    actorName: string,
    comment: string | undefined,
    attachments: ApprovalAttachmentMetadata[],
    statusAfter?: ApprovalRequestStatus,
  ): ApprovalHistory {
    return {
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      statusAfter: statusAfter ?? 'pending',
      action,
      actorId,
      actorName,
      comment,
      attachments,
      createdAt: Timestamp.fromDate(new Date()),
    };
  }

  private refreshLocal(request: ApprovalRequest) {
    const current = this.requestsSubject.value;
    const index = current.findIndex((item) => item.id === request.id);
    if (index >= 0) {
      current[index] = request;
    } else {
      current.unshift(request);
    }
    this.requestsSubject.next([...current]);
  }

  private createDemoHistories(
    requestId: string,
    status: ApprovalRequestStatus,
    applicantId: string,
    applicantName: string,
  ): ApprovalHistory[] {
    const applyAttachments = this.createDemoAttachments(requestId, applicantId, applicantName);
    const histories: ApprovalHistory[] = [
      {
        id: `hist-${requestId}-apply`,
        statusAfter: 'pending',
        action: 'apply',
        actorId: applicantId,
        actorName: applicantName,
        comment: '申請時に差分一覧と証跡を添付しています。',
        attachments: applyAttachments,
        createdAt: Timestamp.fromDate(new Date('2025-01-25T12:00:00Z')),
      },
    ];

    if (status === 'approved') {
      const approvalAttachment = this.createDemoAttachmentMeta(
        requestId,
        '承認チェックリスト.pdf',
        'application/pdf',
        48_234,
        'approver-sato',
        '佐藤 花子',
        '2025-01-30T03:15:00Z',
      );
      histories.push({
        id: `hist-${requestId}-approve`,
        statusAfter: 'approved',
        action: 'approve',
        actorId: 'approver-sato',
        actorName: '佐藤 花子',
        comment: '確認済み。承認チェックリストを添付しました。',
        attachments: [approvalAttachment],
        createdAt: Timestamp.fromDate(new Date('2025-01-30T03:20:00Z')),
      });
    }

    if (status === 'remanded') {
      const remandAttachment = this.createDemoAttachmentMeta(
        requestId,
        '差戻し指摘一覧.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        34_122,
        'manager-yamamoto',
        '山本 美咲',
        '2025-01-28T06:00:00Z',
      );
      histories.push({
        id: `hist-${requestId}-remand`,
        statusAfter: 'remanded',
        action: 'remand',
        actorId: 'manager-yamamoto',
        actorName: '山本 美咲',
        comment: '差戻し理由を添付しています。',
        attachments: [remandAttachment],
        createdAt: Timestamp.fromDate(new Date('2025-01-28T06:05:00Z')),
      });
    }

    return histories;
  }

  private createDemoAttachments(
    requestId: string,
    uploaderId: string,
    uploaderName: string,
  ): ApprovalAttachmentMetadata[] {
    return [
      this.createDemoAttachmentMeta(
        requestId,
        '差分一覧.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        22_034,
        uploaderId,
        uploaderName,
        '2025-01-25T12:00:00Z',
      ),
      this.createDemoAttachmentMeta(
        requestId,
        '証跡.pdf',
        'application/pdf',
        125_678,
        uploaderId,
        uploaderName,
        '2025-01-25T12:05:00Z',
      ),
    ];
  }

  private createDemoAttachmentMeta(
    requestId: string,
    name: string,
    contentType: string,
    size: number,
    uploaderId: string,
    uploaderName: string,
    uploadedAt: string,
  ): ApprovalAttachmentMetadata {
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    const encodedName = encodeURIComponent(name);
    return {
      id: `att-${requestId}-${encodedName}`,
      name,
      size,
      contentType,
      extension,
      downloadUrl: `https://storage.googleapis.com/demo/${requestId}/${encodedName}`,
      uploadedAt: Timestamp.fromDate(new Date(uploadedAt)),
      uploaderId,
      uploaderName,
      storagePath: `demo/${requestId}/${name}`,
    };
  }

  private collectAttachments(histories: ApprovalHistory[]): ApprovalAttachmentMetadata[] {
    const map = new Map<string, ApprovalAttachmentMetadata>();
    histories.forEach((history) => {
      history.attachments.forEach((attachment) => {
        map.set(attachment.id, attachment);
      });
    });
    return Array.from(map.values());
  }


  private createNotificationsSnapshot(recipientId: string): ApprovalNotification[] {
    const now = new Date();
    return [
      {
        id: 'ntf-1',
        requestId: 'APL-20250201-001',
        recipientId,
        message: 'APL-20250201-001 の一次承認依頼が届いています',
        unread: true,
        createdAt: new Date(now.getTime() - 15 * 60 * 1000),
        type: 'info',
      },
      {
        id: 'ntf-2',
        requestId: 'APL-20250130-002',
        recipientId,
        message: 'APL-20250130-002 が承認済みになりました',
        unread: false,
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        type: 'success',
      },
    ];
  }

  private startExpirationWatcher() {
    setInterval(() => {
      const now = new Date();
      this.requestsSubject.value
        .filter((req) => req.status === 'pending' && req.dueDate)
        .forEach((req) => {
          const dueDate = (req.dueDate as Timestamp).toDate();
          if (dueDate.getTime() < now.getTime()) {
            this.expire(req);
          }
        });
    }, 60_000);
  }
}