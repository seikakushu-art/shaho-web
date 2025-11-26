import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { authGuard } from './auth/auth.guard';
import { EmployeeDetailComponent } from './employees/employee-detail.component';

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
