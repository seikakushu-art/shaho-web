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
      description: '算定方法を決めて、標準報酬月額を計算できるメニューです。',
    },
    {
      key: 'bonus',
      title: '標準賞与額計算',
      description: '標準賞与額の試算を行うメニューです。',
    },
    {
      key: 'insurance',
      title: '社会保険料計算',
      description: '社会保険料を計算するメニューです。',
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