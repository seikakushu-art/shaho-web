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
    return of([]);
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

  private removeUndefinedFields(obj: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const key in obj) {
      const value = obj[key];
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        cleaned[key] = value.map((item) =>
          typeof item === 'object' && item !== null && !(item instanceof Timestamp)
            ? this.removeUndefinedFields(item as Record<string, unknown>)
            : item,
        );
      } else if (typeof value === 'object' && value !== null && !(value instanceof Timestamp)) {
        cleaned[key] = this.removeUndefinedFields(value as Record<string, unknown>);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
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

    const cleanedPayload = this.removeUndefinedFields(payload as unknown as Record<string, unknown>);

    if (payload.id) {
      const ref = doc(this.requestsRef, payload.id);
      await setDoc(ref, cleanedPayload, { merge: true });
      this.refreshLocal(payload);
      return payload;
    }

    const ref = doc(this.requestsRef);
    const created: ApprovalRequest = { ...payload, id: ref.id };
    const cleanedCreated = this.removeUndefinedFields(created as unknown as Record<string, unknown>);
    await setDoc(ref, cleanedCreated, { merge: true });
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
    const approverIdLower = approverId.toLowerCase();
    const currentFlowStep = request.flowSnapshot.steps.find((s) => s.order === request.currentStep);
    const candidateIds = currentFlowStep?.candidates?.map((c) => c.id.toLowerCase()) ?? [];
    const assignedApproverId = step.approverId?.toLowerCase();

    if (!candidateIds.includes(approverIdLower) && assignedApproverId !== approverIdLower) {
      throw new Error('承認候補者ではありません');
    }

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

  private collectAttachments(histories: ApprovalHistory[]): ApprovalAttachmentMetadata[] {
    const map = new Map<string, ApprovalAttachmentMetadata>();
    histories.forEach((history) => {
      history.attachments.forEach((attachment) => {
        map.set(attachment.id, attachment);
      });
    });
    return Array.from(map.values());
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