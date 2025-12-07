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
import {
  BehaviorSubject,
  combineLatest,
  firstValueFrom,
  map,
  Observable,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { UserDirectoryService } from './user-directory.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private userDirectoryService = inject(UserDirectoryService);

  private roleSubject = new BehaviorSubject<RoleKey[]>([RoleKey.Guest]);

  readonly user$: Observable<User | null> = authState(this.auth);
  readonly userRoles$: Observable<RoleKey[]> = this.roleSubject.asObservable();
  readonly primaryRoleKey$: Observable<RoleKey> = this.userRoles$.pipe(
    map((roles) => roles[0] ?? RoleKey.Guest),
  );
  readonly roleDefinition$: Observable<RoleDefinition> = combineLatest([
    this.primaryRoleKey$,
  ]).pipe(
    map(([role]) => this.getRoleDefinition(role) ?? this.getRoleDefinition(RoleKey.Guest)!),
  );
  readonly roleDefinitions$: Observable<RoleDefinition[]> = this.userRoles$.pipe(
    map((roles) => (roles.length ? roles : [RoleKey.Guest])),
    map((roles) =>
      roles
        .map((role) => this.getRoleDefinition(role) ?? this.getRoleDefinition(RoleKey.Guest)!)
        .filter(Boolean) as RoleDefinition[],
    ),
  );

  constructor() {
    user(this.auth)
      .pipe(
        switchMap((firebaseUser) => {
          if (!firebaseUser?.email) {
            this.roleSubject.next([RoleKey.Guest]);
            return of(null);
          }
          const email = firebaseUser.email.toLowerCase();
          return this.userDirectoryService
            .ensureUser(email, firebaseUser.displayName ?? undefined)
            .pipe(
              tap((appUser) => {
                const roles = appUser.roles?.length ? appUser.roles : [RoleKey.Guest];
                this.roleSubject.next(roles);
              }),
            );
        }),
      )
      .subscribe();
  }

  async login(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    const normalizedEmail = credential.user.email?.toLowerCase();
    if (normalizedEmail) {
      const appUser = await firstValueFrom(
        this.userDirectoryService.ensureUser(normalizedEmail, credential.user.displayName ?? undefined),
      );
      const roles = appUser.roles?.length ? appUser.roles : [RoleKey.Guest];
      this.roleSubject.next(roles);
    } else {
      this.roleSubject.next([RoleKey.Guest]);
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.roleSubject.next([RoleKey.Guest]);
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
    return this.userRoles$.pipe(map((userRoles) => roles.some((role) => userRoles.includes(role))));
  }

  getRoleDefinition(key: RoleKey): RoleDefinition | undefined {
    return ROLE_DEFINITIONS.find((definition) => definition.key === key);
  }
}