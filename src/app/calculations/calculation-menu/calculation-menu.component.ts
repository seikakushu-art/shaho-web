import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { CalculationType } from '../calculation-types';
import {
  CalculationDataService,
  CalculationResultHistory,
} from '../calculation-data.service';

interface CalculationMenuItem {
  key: 'standard' | 'bonus' | 'insurance';
  title: string;
  description: string;
}

@Component({
  selector: 'app-calculation-menu',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './calculation-menu.component.html',
  styleUrl: './calculation-menu.component.scss',
})
export class CalculationMenuComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  items: CalculationMenuItem[] = [
    {
      key: 'standard',
      title: '標準報酬月額計算',
      description: '月額報酬の計算対象を指定し、保険種別ごとに計算するメニューです。',
    },
    {
      key: 'bonus',
      title: '標準賞与額計算',
      description: '賞与計算用の対象指定に対応し、支給確定前の試算も行えます。',
    },
    {
      key: 'insurance',
      title: '社会保険料計算',
      description: '標準報酬と賞与を組み合わせた保険料算定の結果を確認できます。',
    },
  ];

  historyEntries: CalculationResultHistory[] = [];

  readonly calculationTypes: Record<CalculationType, string> = {
    standard: '標準報酬月額計算',
    bonus: '標準賞与額計算',
    insurance: '社会保険料計算',
  };

  constructor(
    private calculationDataService: CalculationDataService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.calculationDataService
      .getCalculationHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe((history) => (this.historyEntries = history));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getHistoryTargetDisplay(history: CalculationResultHistory): string {
    const { type, targetMonth, bonusPaidOn } = history.query;
    if (type === 'standard') {
      return (targetMonth ?? '').split('-')[0] || targetMonth || '';
    }
    if (type === 'bonus') {
      return bonusPaidOn || targetMonth || '';
    }
    return targetMonth ?? '';
  }

  getHistoryTargetLabel(history: CalculationResultHistory): string {
    return history.query.type === 'bonus' ? '賞与支給日' : '対象';
  }

  goToHistory(history: CalculationResultHistory) {
    const query = history.query;
    this.router.navigate(['/calculations/results'], {
      queryParams: {
        type: query.type,
        targetMonth: query.targetMonth,
        method: query.method,
        standardMethod: query.standardMethod,
        bonusPaidOn: query.bonusPaidOn,
        includeBonusInMonth: query.includeBonusInMonth,
        department: query.department,
        location: query.location,
        employeeNo: query.employeeNo,
        insurances: query.insurances.join(',') || undefined,
        historyId: history.id,
      },
    });
  }
}