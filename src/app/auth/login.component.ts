import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { RoleKey } from '../models/roles';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  errorMessage = '';
  infoMessage = '';
  showPassword = false;
  passwordResetEmail = '';

  readonly user$ = this.authService.user$;

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      this.errorMessage = 'メールアドレスとパスワードを入力してください';
      return;
    }
    const { email, password } = this.loginForm.value;
    try {
      await this.authService.login(email, password);
      this.errorMessage = '';
      this.infoMessage = 'ログインしました';
      await this.router.navigate(['/dashboard']);
    } catch (error: any) {
      const errorCode = error?.code;
      let errorMsg = 'ログインに失敗しました';
      
      if (errorCode === 'auth/invalid-credential') {
        errorMsg = 'メールアドレスまたはパスワードが正しくありません';
      } else if (errorCode === 'auth/wrong-password') {
        errorMsg = 'パスワードが正しくありません';
      } else if (errorCode === 'auth/user-not-found') {
        errorMsg = 'このメールアドレスは登録されていません';
      } else if (errorCode === 'auth/invalid-email') {
        errorMsg = '無効なメールアドレスです';
      } else if (errorCode === 'auth/user-disabled') {
        errorMsg = 'このアカウントは無効化されています';
      } else if (errorCode === 'auth/too-many-requests') {
        errorMsg = 'リクエストが多すぎます。しばらく待ってから再度お試しください';
      } else if (error?.message) {
        errorMsg = error.message;
      }
      
      this.errorMessage = errorMsg;
      this.infoMessage = '';
    }
  }

  async onPasswordChange() {
    console.log('onPasswordChange 関数が呼ばれました');
    this.errorMessage = '';
    this.infoMessage = '';
    
    console.log('user$ からユーザー情報を取得中...');
    const currentUser = await this.authService.user$.pipe(take(1)).toPromise();
    console.log('取得したユーザー情報:', currentUser);
    
    // ログインしている場合は現在のユーザーのメールアドレスを使用
    // ログインしていない場合は入力されたメールアドレスを使用
    const email = currentUser?.email || this.passwordResetEmail.trim();
    
    if (!email) {
      console.log('メールアドレスが指定されていません');
      this.errorMessage = 'メールアドレスを入力してください';
      return;
    }
    
    // メールアドレスの形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.errorMessage = '有効なメールアドレスを入力してください';
      return;
    }
    
    console.log('パスワード変更リクエスト:', email);
    
    try {
      console.log('sendPasswordResetEmailToAddress を呼び出します...');
      await this.authService.sendPasswordResetEmailToAddress(email);
      console.log('パスワード変更が成功しました');
      this.errorMessage = '';
      this.infoMessage = `登録メールアドレス（${email}）宛にパスワード再設定メールを送信しました。メールボックスを確認してください。`;
      this.passwordResetEmail = '';
    } catch (error: any) {
      console.error('パスワード変更エラー:', error);
      console.error('エラーの詳細:', {
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        error: error
      });
      const errorCode = error?.code;
      let errorMsg = 'パスワード変更に失敗しました';
      
      if (errorCode === 'auth/user-not-found') {
        errorMsg = 'このメールアドレスは登録されていません';
      } else if (errorCode === 'auth/invalid-email') {
        errorMsg = '無効なメールアドレスです';
      } else if (errorCode === 'auth/too-many-requests') {
        errorMsg = 'リクエストが多すぎます。しばらく待ってから再度お試しください';
      } else if (error?.message) {
        errorMsg = error.message;
      }
      
      this.errorMessage = errorMsg;
      this.infoMessage = '';
    }
  }

  protected readonly RoleKey = RoleKey;
}