import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  serverTimestamp,
  setDoc,
  Timestamp,
} from '@angular/fire/firestore';
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

  private flowsSubject = new BehaviorSubject<ApprovalFlow[]>(this.createFallbackFlows());
  private requestsSubject = new BehaviorSubject<ApprovalRequest[]>(
    this.createFallbackRequests(this.flowsSubject.value[0]),
  );

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
        tap((flows) => {
          if (flows.length) {
            this.flowsSubject.next(flows);
          }
        }),
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
          if (requests.length) {
            const normalized = requests.map((req) =>
              req.flowSnapshot ? req : { ...req, flowSnapshot: flows.find((f) => f.id === req.flowId) },
            );
            this.requestsSubject.next(normalized);
          }
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

    const ref = await addDoc(this.requestsRef, payload);
    const created: ApprovalRequest = { ...payload, id: ref.id };
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

  private createFallbackFlows(): ApprovalFlow[] {
    return [
      {
        id: 'default-flow',
        name: '給与・社保承認フロー',
        maxSteps: 5,
        allowDirectApply: true,
        steps: [
          {
            order: 1,
            name: '一次承認',
            candidates: [
              { id: 'approver-tanaka', displayName: '田中 一郎' },
              { id: 'approver-sato', displayName: '佐藤 花子' },
            ],
          },
          {
            order: 2,
            name: '部門長承認',
            candidates: [{ id: 'manager-yamamoto', displayName: '山本 美咲' }],
          },
          {
            order: 3,
            name: '人事最終承認',
            candidates: [{ id: 'hr-final', displayName: '管理部 担当' }],
            autoAdvance: true,
          },
        ],
      },
    ];
  }

  private createFallbackRequests(flow: ApprovalFlow): ApprovalRequest[] {
    const build = (
      id: string,
      category: ApprovalRequest['category'],
      status: ApprovalRequestStatus,
      currentStep: number | undefined,
      dueDate: Date,
      applicantId: string,
      applicantName: string,
      targetCount: number,
      comment: string,
      diffSummary?: string,
    ): ApprovalRequest => {
        const histories = this.createDemoHistories(id, status, applicantId, applicantName);
        const attachments = this.collectAttachments(histories);
  
        return {
          id,
          title: `${category}申請 ${id}`,
          category,
          flowId: flow.id!,
          flowSnapshot: flow,
          status,
          targetCount,
          applicantId,
          applicantName,
          currentStep,
          comment,
          diffSummary,
          createdAt: Timestamp.fromDate(new Date('2025-01-25T09:00:00Z')),
          dueDate: Timestamp.fromDate(dueDate),
          steps: flow.steps.map((step) => ({
            stepOrder: step.order,
            status:
              status === 'remanded' && step.order === currentStep
                ? 'remanded'
                : status === 'approved' || (status === 'pending' && step.order < (currentStep ?? 1))
                  ? 'approved'
                  : 'waiting',
          })),
          attachments,
          histories,
        };
      };

    return [
      build(
        'APL-20250201-001',
        '新規',
        'pending',
        1,
        new Date('2025-02-05T00:00:00'),
        'applicant-sato',
        '佐藤 花子',
        3,
        '新入社員3名の一括登録です。標準報酬月額と健康保険区分を確認してください。',
        '雇用契約に基づく初期登録・社会保険資格取得の確認依頼',
      ),
      build(
        'APL-20250130-002',
        '個別更新',
        'approved',
        undefined,
        new Date('2025-02-02T00:00:00'),
        'applicant-tanaka',
        '田中 一郎',
        1,
        '扶養情報の更新のみです。',
      ),
      build(
        'APL-20250128-003',
        '一括更新',
        'remanded',
        1,
        new Date('2025-02-01T00:00:00'),
        'applicant-kanri',
        '管理部 担当',
        18,
        '住所変更の一括反映。差戻し理由は修正済みです。',
      ),
      build(
        'APL-20250125-004',
        '個別更新',
        'pending',
        3,
        new Date('2025-01-29T00:00:00'),
        'applicant-yamamoto',
        '山本 美咲',
        2,
        '標準報酬月額のみ見直し。',
      ),
    ];
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