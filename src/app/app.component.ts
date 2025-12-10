import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AsyncPipe, NgIf } from '@angular/common';
import { combineLatest, map } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { User } from '@angular/fire/auth';
import { HasRoleDirective } from './auth/has-role.directive';
import { RoleKey, type RoleDefinition } from './models/roles';
import { UserDirectoryService } from './auth/user-directory.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, AsyncPipe, NgIf, HasRoleDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private authService = inject(AuthService);
  private userDirectory = inject(UserDirectoryService);
  private router = inject(Router);

  readonly user$ = this.authService.user$;
  readonly role$ = this.authService.roleDefinition$;

  readonly roleDefinitions$ = this.authService.roleDefinitions$;
  readonly RoleKey = RoleKey;
  readonly guestNavigable$ = this.authService.hasAnyRole([
    RoleKey.SystemAdmin,
    RoleKey.Approver,
    RoleKey.Operator,
    RoleKey.Guest,
  ]);

  readonly userDisplayName$ = combineLatest([
    this.user$,
    this.userDirectory.getUsers(),
  ]).pipe(
    map(([user, users]) => {
      if (!user?.email) return '';
      const userMap = new Map(users.map(u => [u.email.toLowerCase(), u.displayName || u.email]));
      const displayName = userMap.get(user.email.toLowerCase());
      if (displayName) return displayName;
      // フォールバック: Firebase AuthのdisplayNameまたはメールアドレスのローカル部分
      return user.displayName || user.email.split('@')[0] || 'ユーザー';
    }),
  );

  getRoleNames(roleDefinitions: readonly RoleDefinition[] | null | undefined): string {
    if (!roleDefinitions?.length) return '';
    return roleDefinitions.map((role) => role.name).join(' / ');
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }

  login() {
    this.router.navigate(['/login']);
  }
}
