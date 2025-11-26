import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { authGuard } from './auth/auth.guard';

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
      path: '',
      pathMatch: 'full',
      redirectTo: 'login',
    },
    {
      path: '**',
      redirectTo: 'login',
    },
  ];
