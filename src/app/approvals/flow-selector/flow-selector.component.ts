import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApprovalFlow } from '../../models/approvals';
import { ApprovalWorkflowService } from '../approval-workflow.service';

@Component({
  selector: 'app-flow-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './flow-selector.component.html',
  styleUrl: './flow-selector.component.scss',
})
export class FlowSelectorComponent implements OnDestroy {
  private workflowService = inject(ApprovalWorkflowService);
  private subscription?: Subscription;

  @Input() label = '承認フロー';
  @Input() selectedFlowId: string | null = null;
  @Output() flowSelected = new EventEmitter<ApprovalFlow | undefined>();
  @Output() flowsUpdated = new EventEmitter<ApprovalFlow[]>();

  flows: ApprovalFlow[] = [];

  constructor() {
    this.subscription = this.workflowService.flows$.subscribe((flows) => {
      this.flows = flows;
      this.flowsUpdated.emit(flows);

      if (!this.selectedFlowId && flows[0]?.id) {
        this.selectedFlowId = flows[0].id;
      }

      this.emitSelectedFlow();
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  onFlowChange(id: string) {
    this.selectedFlowId = id;
    this.emitSelectedFlow();
  }

  private emitSelectedFlow() {
    const selected = this.flows.find((flow) => flow.id === this.selectedFlowId);
    this.flowSelected.emit(selected);
  }
}