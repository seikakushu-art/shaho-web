import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { authGuard } from './auth/auth.guard';
import { EmployeeDetailComponent } from './employees/employee-detail.component';
import { EmployeeListComponent } from './employees/employee-list/employee-list.component';
import { EmployeeCreateComponent } from './employees/employee-create/employee-create.component';
import { EmployeeImportComponent } from './employees/employee-import/employee-import.component';

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
      path: '',
      pathMatch: 'full',
      redirectTo: 'login',
    },
    {
      path: '**',
      redirectTo: 'login',
    },
  ];
