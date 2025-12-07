import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, map, take } from 'rxjs';
import { RoleKey } from '../models/roles';
import { AuthService } from './auth.service';

export const roleGuard = (required: RoleKey | RoleKey[]): CanActivateFn => {
  return (_route, state) => {
    const router = inject(Router);
    const authService = inject(AuthService);
    const requiredRoles = Array.isArray(required) ? required : [required];

    return combineLatest([authService.user$, authService.userRoles$]).pipe(
      take(1),
      map(([user, roles]) => {
        if (!user) {
          return router.createUrlTree(['/login'], {
            queryParams: { redirect: state.url },
          });
        }

        const hasPermission = requiredRoles.some((role) => roles.includes(role));
        return hasPermission ? true : router.createUrlTree(['/dashboard']);
      }),
    );
  };
};