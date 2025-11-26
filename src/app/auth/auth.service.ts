import { inject, Injectable } from '@angular/core';
import {
  Auth,
  authState,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
  user,
} from '@angular/fire/auth';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { ROLE_DEFINITIONS, roleDirectory, RoleDefinition, RoleKey } from '../models/roles';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  private roleSubject = new BehaviorSubject<RoleKey>(RoleKey.Guest);

  readonly user$: Observable<User | null> = authState(this.auth);
  readonly role$: Observable<RoleKey> = this.roleSubject.asObservable();
  readonly roleDefinition$: Observable<RoleDefinition> = combineLatest([
    this.role$,
  ]).pipe(
    map(([role]) =>
      ROLE_DEFINITIONS.find((definition) => definition.key === role) ||
      ROLE_DEFINITIONS[ROLE_DEFINITIONS.length - 1]
    ),
  );

  constructor() {
    user(this.auth).subscribe((firebaseUser) => {
      if (!firebaseUser?.email) {
        this.roleSubject.next(RoleKey.Guest);
        return;
      }
      const email = firebaseUser.email.toLowerCase();
      this.roleSubject.next(roleDirectory[email] ?? RoleKey.Guest);
    });
  }

  async login(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    const normalizedEmail = credential.user.email?.toLowerCase();
    const role = normalizedEmail ? roleDirectory[normalizedEmail] : undefined;
    this.roleSubject.next(role ?? RoleKey.Guest);
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.roleSubject.next(RoleKey.Guest);
  }

  async sendPasswordResetEmailToCurrentUser(): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.email) {
      throw new Error('パスワード再設定メールを送信するにはログインしてください');
    }
    console.log('パスワードリセットメール送信開始:', currentUser.email);
    try {
      await sendPasswordResetEmail(this.auth, currentUser.email);
      console.log('パスワードリセットメール送信成功:', currentUser.email);
    } catch (error: any) {
      console.error('パスワードリセットメール送信エラー:', error);
      throw error;
    }
  }

  async sendPasswordResetEmailToAddress(email: string): Promise<void> {
    console.log('=== sendPasswordResetEmailToAddress 開始 ===');
    console.log('メールアドレス:', email);
    console.log('Auth インスタンス:', this.auth);
    console.log('Auth の状態:', {
      currentUser: this.auth.currentUser?.email,
      app: this.auth.app?.name
    });
    
    try {
      console.log('sendPasswordResetEmail を呼び出します...');
      const result = await sendPasswordResetEmail(this.auth, email);
      console.log('sendPasswordResetEmail の結果:', result);
      console.log('パスワードリセットメール送信成功:', email);
      console.log('=== sendPasswordResetEmailToAddress 成功 ===');
    } catch (error: any) {
      console.error('=== sendPasswordResetEmailToAddress エラー ===');
      console.error('エラーの種類:', typeof error);
      console.error('エラーの詳細:', {
        name: error?.name,
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        error: error
      });
      throw error;
    }
  }

  hasAnyRole(roles: RoleKey[]): Observable<boolean> {
    return this.role$.pipe(map((role) => roles.includes(role)));
  }

  getRoleDefinition(key: RoleKey): RoleDefinition | undefined {
    return ROLE_DEFINITIONS.find((definition) => definition.key === key);
  }
}