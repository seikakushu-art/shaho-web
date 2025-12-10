import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { authGuard } from './auth/auth.guard';
import { roleGuard } from './auth/role.guard';
import { EmployeeDetailComponent } from './employees/employee-detail.component';
import { EmployeeListComponent } from './employees/employee-list/employee-list.component';
import { EmployeeCreateComponent } from './employees/employee-create/employee-create.component';
import { EmployeeImportComponent } from './employees/employee-import/employee-import.component';
import { ApprovalListComponent } from './approvals/approval-list/approval-list.component';
import { ApprovalDetailComponent } from './approvals/approval-detail.component';
import { CorporateInfoComponent } from './corporate-info/corporate-info.component';
import { InsuranceRatesComponent } from './insurance-rates/insurance-rates.component';
import { CalculationMenuComponent } from './calculations/calculation-menu/calculation-menu.component';
import { CalculationTargetComponent } from './calculations/calculation-target/calculation-target.component';
import { CalculationResultComponent } from './calculations/calculation-result/calculation-result.component';
import { CsvExportComponent } from './employees/emloyee-export/csv-export.component';
import { UserManagementComponent } from './user-management/user-management.component';
import { RoleKey } from './models/roles';
import { FlowManagementComponent } from './approvals/flow-management/flow-management.component';

const adminOnly = [RoleKey.SystemAdmin];
const operators = [RoleKey.SystemAdmin, RoleKey.Approver, RoleKey.Operator];
const approvalParticipants = operators;
const guestViewers = [RoleKey.SystemAdmin, RoleKey.Approver, RoleKey.Operator, RoleKey.Guest];

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
    canActivate: [authGuard, roleGuard(guestViewers)],
    title: '社員一覧',
  },
  {
    path: 'employees/new',
    component: EmployeeCreateComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: '新規社員登録',
  },
  {
    path: 'csv-export',
    component: CsvExportComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: 'CSVエクスポート',
  },
  {
    path: 'employees/import',
    component: EmployeeImportComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: 'CSVインポート',
  },
  {
    path: 'employees/:id/edit',
    component: EmployeeCreateComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: '社員編集',
  },
  {
    path: 'employees/:id',
    component: EmployeeDetailComponent,
    canActivate: [authGuard, roleGuard(guestViewers)],
    title: '社員詳細',
  },
  {
    path: 'approvals',
    component: ApprovalListComponent,
    canActivate: [authGuard, roleGuard(approvalParticipants)],
    title: '承認一覧',
  },
  {
    path: 'approvals/:id',
    component: ApprovalDetailComponent,
    canActivate: [authGuard, roleGuard(approvalParticipants)],
    title: '承認詳細',
  },
  {
    path: 'approval-flows',
    component: FlowManagementComponent,
    canActivate: [authGuard, roleGuard(adminOnly)],
    title: '承認フロー管理',
  },
  {
    path: 'corporate-info',
    component: CorporateInfoComponent,
    canActivate: [authGuard, roleGuard(guestViewers)],
    title: '法人情報',
  },
  {
    path: 'insurance-rates',
    component: InsuranceRatesComponent,
    canActivate: [authGuard, roleGuard(guestViewers)],
    title: '保険料率設定',
  },
  {
    path: 'user-management',
    component: UserManagementComponent,
    canActivate: [authGuard, roleGuard(adminOnly)],
    title: 'ユーザー管理',
  },
  {
    path: 'calculations',
    component: CalculationMenuComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: '計算メニュー',
  },
  {
    path: 'calculations/target',
    component: CalculationTargetComponent,
    canActivate: [authGuard, roleGuard(operators)],
    title: '計算対象選択',
  },
  {
    path: 'calculations/results',
    component: CalculationResultComponent,
    canActivate: [authGuard, roleGuard(approvalParticipants)],
    title: '計算結果',
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
