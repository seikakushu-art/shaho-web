import { inject, Injectable } from '@angular/core';
import { collection, collectionData, doc, deleteDoc, addDoc, Firestore, serverTimestamp, setDoc, Timestamp } from '@angular/fire/firestore';
import { BehaviorSubject, Subscription, combineLatest, map, Observable, of, tap } from 'rxjs';
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

  async startApprovalProcess(options: {
    request: ApprovalRequest;
    onApproved: () => Promise<void>;
    onFailed?: () => void;
    setMessage?: (message: string) => void;
    setLoading?: (loading: boolean) => void;
  }): Promise<{ requestId: string; subscription: Subscription } | undefined> {
    const { request, onApproved, onFailed, setMessage, setLoading } = options;

    setLoading?.(true);
    setMessage?.('承認依頼を送信しています…');

    try {
      const savedRequest = await this.saveRequest(request);
      const requestId = savedRequest.id ?? doc(this.requestsRef).id;
      setMessage?.('承認依頼を送信しました。承認完了後に自動で反映されます。');
      setLoading?.(false);

      const subscription = this.getRequest(requestId).subscribe(async (latest) => {
        if (!latest) return;

        if (latest.status === 'approved') {
          setLoading?.(true);
          setMessage?.('承認完了。反映処理を実行しています…');
          try {
            await onApproved();
            setMessage?.('承認済みの内容を反映しました。');
          } catch (error) {
            console.error('承認後の反映に失敗しました', error);
            setMessage?.('承認後の反映に失敗しました。時間をおいて再度お試しください。');
          } finally {
            setLoading?.(false);
            subscription.unsubscribe();
          }
        }

        if (latest.status === 'remanded' || latest.status === 'expired') {
          setMessage?.('承認が完了しませんでした。内容を確認してください。');
          onFailed?.();
          subscription.unsubscribe();
        }
      });

      return { requestId, subscription };
    } catch (error) {
      console.error('承認依頼の送信に失敗しました', error);
      setMessage?.('承認依頼の送信に失敗しました。時間をおいて再度お試しください。');
      setLoading?.(false);
      return undefined;
    }
  }

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
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/b404053e-2227-4d5b-b69e-e2b3fab0c7ea',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'approval-workflow.service.ts:111',message:'syncRequests updating requests$',data:{totalRequests:normalized.length,statuses:normalized.map(r=>({id:r.id,status:r.status}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              this.requestsSubject.next(normalized);
        }),
      )
      .subscribe();
  }

  getRequest(id: string | null): Observable<ApprovalRequest | undefined> {
    if (!id) return of(undefined);
    return this.requests$.pipe(map((requests) => requests.find((item) => item.id === id)));
  }

  /**
   * 特定の社員に対する承認待ちリクエストが存在するかチェック
   * @param employeeId 社員ID（編集モードの場合）
   * @param employeeNo 社員番号
   * @returns 承認待ちリクエストが存在する場合、そのリクエストを返す。存在しない場合はundefined
   */
  getPendingRequestForEmployee(employeeId: string | null, employeeNo: string | null): ApprovalRequest | undefined {
    if (!employeeId && !employeeNo) {
      return undefined;
    }

    const requests = this.requestsSubject.value;
    return requests.find((request) => {
      // 承認待ち状態でない場合はスキップ
      if (request.status !== 'pending') {
        return false;
      }

      // 社員情報更新、新規社員登録、社員情報一括更新、社員削除のカテゴリのみチェック
      if (
        request.category !== '社員情報更新' &&
        request.category !== '新規社員登録' &&
        request.category !== '社員情報一括更新' &&
        request.category !== '社員削除'
      ) {
        return false;
      }

      const diffs = request.employeeDiffs || [];
      return diffs.some((diff) => {
        // 社員IDでマッチ
        if (employeeId && diff.existingEmployeeId === employeeId) {
          return true;
        }
        // 社員番号でマッチ
        if (employeeNo && diff.employeeNo && diff.employeeNo === employeeNo) {
          return true;
        }
        return false;
      });
    });
  }

  /**
   * 法人情報更新に対する承認待ちリクエストが存在するかチェック
   * @returns 承認待ちリクエストが存在する場合、そのリクエストを返す。存在しない場合はundefined
   */
  getPendingRequestForCorporateInfo(): ApprovalRequest | undefined {
    const requests = this.requestsSubject.value;
    return requests.find((request) => {
      // 承認待ち状態でない場合はスキップ
      if (request.status !== 'pending') {
        return false;
      }

      // 法人情報更新のカテゴリのみチェック
      return request.category === '法人情報更新';
    });
  }

  /**
   * 保険料率更新に対する承認待ちリクエストが存在するかチェック
   * @returns 承認待ちリクエストが存在する場合、そのリクエストを返す。存在しない場合はundefined
   */
  getPendingRequestForInsuranceRates(): ApprovalRequest | undefined {
    const requests = this.requestsSubject.value;
    return requests.find((request) => {
      // 承認待ち状態でない場合はスキップ
      if (request.status !== 'pending') {
        return false;
      }

      // 保険料率更新のカテゴリのみチェック
      return request.category === '保険料率更新';
    });
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
    console.log('saveRequest - payload.employeeDiffs:', payload.employeeDiffs);
    console.log('saveRequest - payload.employeeDiffs[0]?.changes:', payload.employeeDiffs?.[0]?.changes);
    console.log('saveRequest - cleanedPayload.employeeDiffs:', cleanedPayload['employeeDiffs']);
    console.log('saveRequest - cleanedPayload.employeeDiffs[0]?.changes:', (cleanedPayload['employeeDiffs'] as any)?.[0]?.changes);

    if (payload.id) {
      const ref = doc(this.requestsRef, payload.id);
      await setDoc(ref, cleanedPayload, { merge: true });
      this.refreshLocal(payload);
      return payload;
    }

    const ref = doc(this.requestsRef);
    const created: ApprovalRequest = { ...payload, id: ref.id };
    const cleanedCreated = this.removeUndefinedFields(created as unknown as Record<string, unknown>);
    console.log('saveRequest - created.employeeData:', created.employeeData);
    console.log('saveRequest - cleanedCreated.employeeData:', cleanedCreated['employeeData']);
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

  async resubmit(id: string, applicantId: string, applicantName: string, comment?: string): Promise<ApprovalRequest | undefined> {
    const request = this.requestsSubject.value.find((item) => item.id === id);
    if (!request || !request.flowSnapshot) return undefined;

    // 申請者本人かどうかを確認
    if (request.applicantId.toLowerCase() !== applicantId.toLowerCase()) {
      throw new Error('申請者本人のみ再申請できます');
    }

    // 差し戻し状態でない場合は再申請不可
    if (request.status !== 'remanded') {
      throw new Error('差し戻しされた申請のみ再申請できます');
    }

    // 同じ社員情報に対する承認待ち中の依頼が存在するかチェック
    // employeeDiffsがある場合（社員情報更新、社員情報一括更新）
    if (request.employeeDiffs && request.employeeDiffs.length > 0) {
      for (const diff of request.employeeDiffs) {
        const pendingRequest = this.getPendingRequestForEmployee(
          diff.existingEmployeeId || null,
          diff.employeeNo || null,
        );
        // 現在のリクエスト以外で、承認待ち中の依頼が存在する場合
        if (pendingRequest && pendingRequest.id !== id) {
          throw new Error(
            `社員番号 ${diff.employeeNo}（${diff.name}）に対する承認待ち中の依頼が既に存在します。先にその依頼の処理を完了してください。`,
          );
        }
      }
    }
    // employeeDataがある場合（新規社員登録など）
    if (request.employeeData?.basicInfo?.employeeNo) {
      const employeeNo = request.employeeData.basicInfo.employeeNo;
      const employeeName = request.employeeData.basicInfo.name;
      const pendingRequest = this.getPendingRequestForEmployee(null, employeeNo);
      // 現在のリクエスト以外で、承認待ち中の依頼が存在する場合
      if (pendingRequest && pendingRequest.id !== id) {
        throw new Error(
          `社員番号 ${employeeNo}（${employeeName}）に対する承認待ち中の依頼が既に存在します。先にその依頼の処理を完了してください。`,
        );
      }
    }
    // importEmployeeDataがある場合（CSVインポート）
    if (request.importEmployeeData && request.importEmployeeData.length > 0) {
      for (const importData of request.importEmployeeData) {
        const employeeNo = importData.employeeNo;
        const pendingRequest = this.getPendingRequestForEmployee(
          importData.existingEmployeeId || null,
          employeeNo || null,
        );
        // 現在のリクエスト以外で、承認待ち中の依頼が存在する場合
        if (pendingRequest && pendingRequest.id !== id) {
          throw new Error(
            `社員番号 ${employeeNo} に対する承認待ち中の依頼が既に存在します。先にその依頼の処理を完了してください。`,
          );
        }
      }
    }

    // 最初のステップを取得
    const firstStep = request.flowSnapshot.steps[0];
    if (!firstStep) {
      throw new Error('承認フローにステップが設定されていません');
    }

    // ステップを最初からやり直す
    const resetSteps: ApprovalStepState[] = request.flowSnapshot.steps.map((step) => ({
      stepOrder: step.order,
      status: 'waiting' as ApprovalStepStatus,
    }));

    // 再申請の履歴を追加
    const resubmitHistory: ApprovalHistory = {
      id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      statusAfter: 'pending',
      action: 'apply',
      actorId: applicantId,
      actorName: applicantName,
      comment: comment || '差し戻しされた申請を再申請しました',
      attachments: [],
      createdAt: Timestamp.fromDate(new Date()),
    };

    const updatedRequest: ApprovalRequest = {
      ...request,
      status: 'pending',
      currentStep: firstStep.order,
      steps: resetSteps,
      comment: comment || request.comment,
      histories: [
        ...(request.histories ?? []),
        resubmitHistory,
      ],
      updatedAt: Timestamp.fromDate(new Date()),
    };

    const saved = await this.saveRequest(updatedRequest);
    return saved;
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

    // 最終ステップかどうかをflowSnapshot.stepsの長さで判定
    const flowSteps = request.flowSnapshot.steps;
    const currentFlowStepIndex = flowSteps.findIndex((s) => s.order === request.currentStep);
    const isFinalStep = currentFlowStepIndex >= 0 && currentFlowStepIndex === flowSteps.length - 1;

    // 次のステップをflowSnapshotから取得
    const nextFlowStep = currentFlowStepIndex >= 0 && currentFlowStepIndex < flowSteps.length - 1
      ? flowSteps[currentFlowStepIndex + 1]
      : undefined;
    
    // 次のステップのステップ状態を取得
    const nextStep = nextFlowStep
      ? steps.find((s) => s.stepOrder === nextFlowStep.order)
      : undefined;

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
      currentStep: status === 'pending' && nextFlowStep ? nextFlowStep.order : undefined,
      updatedAt: Timestamp.fromDate(new Date()),
      attachments: [...(request.attachments ?? []), ...attachments],
      histories,
    };

    const saved = await this.saveRequest(updatedRequest);

    const nextAssignees =
      status === 'pending' && nextFlowStep
        ? nextStep?.approverId
          ? [nextStep.approverId]
          : nextFlowStep.candidates.map((c) => c.id) ?? []
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