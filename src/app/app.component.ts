import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AsyncPipe, NgIf } from '@angular/common';
import { AuthService } from './auth/auth.service';
import { User } from '@angular/fire/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, AsyncPipe, NgIf],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private authService = inject(AuthService);

  readonly user$ = this.authService.user$;
  readonly role$ = this.authService.roleDefinition$;

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
