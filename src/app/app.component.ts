import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AsyncPipe, NgIf } from '@angular/common';
import { AuthService } from './auth/auth.service';
import { User } from '@angular/fire/auth';
import { HasRoleDirective } from './auth/has-role.directive';
import { RoleKey, type RoleDefinition } from './models/roles';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, AsyncPipe, NgIf, HasRoleDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private authService = inject(AuthService);

  readonly user$ = this.authService.user$;
  readonly role$ = this.authService.roleDefinition$;

  readonly roleDefinitions$ = this.authService.roleDefinitions$;
  readonly RoleKey = RoleKey;

  getRoleNames(roleDefinitions: readonly RoleDefinition[] | null | undefined): string {
    if (!roleDefinitions?.length) return '';
    return roleDefinitions.map((role) => role.name).join(' / ');
  }

  getUserDisplayName(user: User | null): string {
    if (!user) return '';
    
    // displayNameがあればそれを使用
    if (user.displayName) {
      return user.displayName;
    }
    
    // メールアドレスのローカル部分（@より前）を使用
    if (user.email) {
      return user.email.split('@')[0];
    }
    
    return 'ユーザー';
  }

  logout() {
    return this.authService.logout();
  }
}
