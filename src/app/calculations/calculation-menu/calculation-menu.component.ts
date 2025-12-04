import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

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
export class CalculationMenuComponent {
  items: CalculationMenuItem[] = [
    {
      key: 'standard',
      title: '標準報酬月額計算',
      description: '月額報酬の計算対象を指定し、保険種別ごとに計算するメニューです。',
    },
    {
      key: 'bonus',
      title: '賞与額計算',
      description: '賞与計算用の対象指定に対応し、支給確定前の試算も行えます。',
    },
    {
      key: 'insurance',
      title: '社会保険料計算',
      description: '標準報酬と賞与を組み合わせた保険料算定の結果を確認できます。',
    },
  ];
}