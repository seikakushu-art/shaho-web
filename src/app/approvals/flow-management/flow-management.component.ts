import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, firstValueFrom, take } from 'rxjs';
import { UserDirectoryService } from '../../auth/user-directory.service';
import { ApprovalCandidate, ApprovalFlow, ApprovalFlowStep } from '../../models/approvals';
import { RoleKey } from '../../models/roles';
import { ApprovalWorkflowService } from '../approval-workflow.service';

type StepCandidate = ApprovalCandidate & { email?: string };

@Component({
  selector: 'app-flow-management',
  standalone: true,
  imports: [CommonModule, FormsModule, NgFor, NgIf, DatePipe],
  templateUrl: './flow-management.component.html',
  styleUrl: './flow-management.component.scss',
})
export class FlowManagementComponent implements OnInit, OnDestroy {
  private userDirectoryService = inject(UserDirectoryService);
  private workflowService = inject(ApprovalWorkflowService);
  private flowSubscription?: Subscription;

  flows: ApprovalFlow[] = [];
  users: StepCandidate[] = [];
  loading = false;
  editing?: ApprovalFlow;
  draft: ApprovalFlow = this.createEmptyFlow();
  candidateInputs: Record<number, string> = {};
  notice: string | null = null;

  readonly maxSteps = 5;

  async ngOnInit() {
    this.loading = true;
    const [users] = await Promise.all([
      firstValueFrom(this.userDirectoryService.getUsers().pipe(take(1))),
      firstValueFrom(this.workflowService.flows$.pipe(take(1))),
    ]);
    const approverRoles = [RoleKey.SystemAdmin, RoleKey.Approver];
    this.users = users
      .filter((user) => user.roles?.some((role) => approverRoles.includes(role)))
      .map((user) => ({
        id: user.id ?? user.email,
        displayName: user.displayName || user.email,
        email: user.email,
      }));
    this.loading = false;

    this.flowSubscription = this.workflowService.flows$.subscribe((flows) => {
      this.flows = [...flows].sort(
        (a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0),
      );
    });
  }

  ngOnDestroy(): void {
    this.flowSubscription?.unsubscribe();
  }

  selectFlow(flow: ApprovalFlow) {
    this.editing = flow;
    this.draft = {
      ...flow,
      steps: [...flow.steps]
        .sort((a, b) => a.order - b.order)
        .slice(0, this.maxSteps)
        .map((step) => ({ ...step, candidates: [...step.candidates] })),
    };
    this.notice = null;
  }

  resetForm() {
    this.editing = undefined;
    this.draft = this.createEmptyFlow();
    this.notice = null;
  }

  addStep() {
    if (this.draft.steps.length >= this.maxSteps) return;
    const nextOrder = this.draft.steps.length + 1;
    this.draft.steps = [
      ...this.draft.steps,
      { order: nextOrder, name: '', candidates: [] },
    ];
  }

  removeStep(index: number) {
    this.draft.steps.splice(index, 1);
    this.draft.steps = this.draft.steps.map((step, idx) => ({ ...step, order: idx + 1 }));
  }

  moveStep(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.draft.steps.length) return;
    [this.draft.steps[index], this.draft.steps[targetIndex]] = [
      this.draft.steps[targetIndex],
      this.draft.steps[index],
    ];
    this.draft.steps = this.draft.steps.map((step, idx) => ({ ...step, order: idx + 1 }));
  }

  addCandidate(step: ApprovalFlowStep, userId: string) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return;

    const exists = step.candidates.some((candidate) => candidate.id === user.id);
    if (!exists) {
      step.candidates = [...step.candidates, { id: user.id, displayName: user.displayName }];
    }
    this.candidateInputs = { ...this.candidateInputs, [step.order]: '' };
  }

  removeCandidate(step: ApprovalFlowStep, candidate: ApprovalCandidate) {
    step.candidates = step.candidates.filter((c) => c.id !== candidate.id);
  }

  async saveFlow() {
    if (!this.draft.name.trim()) {
      this.notice = 'フロー名を入力してください。';
      return;
    }

    const stepsWithoutCandidates = this.draft.steps.filter((step) => step.candidates.length === 0);
    if (stepsWithoutCandidates.length > 0) {
      const stepNumbers = stepsWithoutCandidates.map((step) => step.order).join('、');
      this.notice = `ステップ${stepNumbers}の候補者を少なくとも一人選択してください。`;
      return;
    }

    const normalizedSteps = this.draft.steps
      .slice(0, this.maxSteps)
      .map((step, idx) => ({
        order: idx + 1,
        name: step.name.trim() || `ステップ${idx + 1}`,
        candidates: step.candidates,
      }));

    const payload: ApprovalFlow = {
      ...this.draft,
      name: this.draft.name.trim(),
      steps: normalizedSteps,
      maxSteps: this.maxSteps,
    };

    this.loading = true;
    try {
      await this.workflowService.saveFlow(payload);
      this.notice = '承認フローを保存しました。';
      this.resetForm();
    } catch (error) {
      console.error(error);
      this.notice = '保存時にエラーが発生しました。';
    } finally {
      this.loading = false;
    }
  }

  async deleteFlow(flow: ApprovalFlow) {
    if (!flow.id) return;
    if (!confirm('この承認フローを削除しますか？関連申請は参照できなくなります。')) return;

    this.loading = true;
    try {
      await this.workflowService.deleteFlow(flow.id);
      if (this.editing?.id === flow.id) {
        this.resetForm();
      }
      this.notice = '承認フローを削除しました。';
    } catch (error) {
      console.error(error);
      this.notice = '削除時にエラーが発生しました。';
    } finally {
      this.loading = false;
    }
  }

  stepCandidateLabel(step: ApprovalFlowStep): string {
    return step.candidates.length
      ? step.candidates.map((c) => c.displayName).join(' / ')
      : '候補者未設定';
  }

  flowStepNames(flow: ApprovalFlow): string {
    return (flow.steps ?? []).map((s) => s.name).join(' → ');
  }

  private createEmptyFlow(): ApprovalFlow {
    return {
      name: '新しい承認フロー',
      steps: [
        {
          order: 1,
          name: '',
          candidates: [],
        },
      ],
    };
  }
}