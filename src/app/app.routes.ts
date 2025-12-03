import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { authGuard } from './auth/auth.guard';
import { EmployeeDetailComponent } from './employees/employee-detail.component';
import { EmployeeListComponent } from './employees/employee-list/employee-list.component';
import { EmployeeCreateComponent } from './employees/employee-create/employee-create.component';
import { EmployeeImportComponent } from './employees/employee-import/employee-import.component';
import { ApprovalListComponent } from './approvals/approval-list/approval-list.component';
import { ApprovalDetailComponent } from './approvals/approval-detail.component';
import { StandardRemunerationComponent } from './procedures/standard-remuneration/standard-remuneration.component';
import { CorporateInfoComponent } from './corporate-info/corporate-info.component';
import { InsuranceRatesComponent } from './insurance-rates/insurance-rates.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    title: 'ログイン',
  },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
    title: 'ダッシュボード',
  },
  {
    path: 'employees',
    component: EmployeeListComponent,
    pathMatch: 'full',
    canActivate: [authGuard],
    title: '社員一覧',
  },
  {
    path: 'employees/new',
    component: EmployeeCreateComponent,
    canActivate: [authGuard],
    title: '新規社員登録',
  },
  {
    path: 'employees/import',
    component: EmployeeImportComponent,
    canActivate: [authGuard],
    title: 'CSVインポート',
  },
  {
    path: 'employees/:id',
    component: EmployeeDetailComponent,
    canActivate: [authGuard],
    title: '社員詳細',
  },
  {
    path: 'approvals',
    component: ApprovalListComponent,
    canActivate: [authGuard],
    title: '承認一覧',
  },
  {
    path: 'approvals/:id',
    component: ApprovalDetailComponent,
    canActivate: [authGuard],
    title: '承認詳細',
  },
  {
    path: 'procedures/standard-remuneration',
    component: StandardRemunerationComponent,
    canActivate: [authGuard],
    title: '標準報酬月額／標準賞与額算定',
  },
  {
    path: 'corporate-info',
    component: CorporateInfoComponent,
    canActivate: [authGuard],
    title: '法人情報',
  },
  {
    path: 'insurance-rates',
    component: InsuranceRatesComponent,
    canActivate: [authGuard],
    title: '保険料率設定',
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
