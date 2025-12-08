import { Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { UserDirectoryService, AppUser } from '../auth/user-directory.service';
import { debounceTime, distinctUntilChanged, firstValueFrom, map, Observable, of, Subject, switchMap, takeUntil } from 'rxjs';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss',
})
export class UserManagementComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private userDirectory = inject(UserDirectoryService);
  private authService = inject(AuthService);
  private destroy$ = new Subject<void>();

  readonly users$: Observable<AppUser[]> = this.userDirectory.getUsers();
  readonly roleDefinitions: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly RoleKey = RoleKey;
  readonly canEdit$ = this.authService.hasAnyRole([RoleKey.SystemAdmin]);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required]],
    role: this.fb.control<RoleKey>(RoleKey.Guest, [Validators.required]),
  });

  statusMessage = '';
  submitted = false;

  constructor() {
    this.setupEmailPrefill();
  }

  resetForm() {
    this.form.reset({ email: '', displayName: '', role: RoleKey.Guest });
    this.submitted = false;
    this.statusMessage = '';
  }

  async saveUser() {
    this.submitted = true;
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー情報を更新できます';
      return;
    }

    if (this.form.invalid || !this.form.value.role) {
      this.statusMessage = 'メール・表示名を正しく入力してください';
      return;
    }

    const email = this.form.value.email?.trim().toLowerCase();
    const existingUser = await firstValueFrom(this.userDirectory.getUserByEmail(email));

    const payload: AppUser = {
      ...this.form.value,
      roles: [this.form.value.role ?? RoleKey.Guest],
    } as AppUser;

    await this.userDirectory.saveUser(payload);
    
    if (existingUser) {
      this.statusMessage = `${payload.email} を更新しました`;
    } else {
      this.statusMessage = `${payload.email} を新規登録しました`;
    }
    
    // フォームのみリセット（メッセージは残す）
    this.form.reset({ email: '', displayName: '', role: RoleKey.Guest });
    this.submitted = false;
  }

  async deleteUser(user: AppUser) {
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー削除が可能です';
      return;
    }
    await this.userDirectory.deleteUser(user.email);
    this.statusMessage = `${user.email} を削除しました`;
  }

  async deleteByEmailInput() {
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー削除が可能です';
      return;
    }

    const emailControl = this.form.get('email');
    const email = emailControl?.value?.trim().toLowerCase();

    if (!email || emailControl?.invalid) {
      this.statusMessage = '削除するメールアドレスを正しく入力してください';
      return;
    }

    const existingUser = await firstValueFrom(this.userDirectory.getUserByEmail(email));
    if (!existingUser) {
      this.statusMessage = `${email} のアカウントは見つかりませんでした`;
      return;
    }

    await this.userDirectory.deleteUser(email);
    this.statusMessage = `${email} を削除しました`;
    this.form.reset({ email: '', displayName: '', role: RoleKey.Guest });
    this.submitted = false;
  }

  getRoleNames(roles: RoleKey[] | null | undefined): string {
    const effectiveRoles = roles?.length ? roles : [RoleKey.Guest];
    return effectiveRoles
      .map((role) => this.roleDefinitions.find((r) => r.key === role)?.name ?? role)
      .join(' / ');
  }

  getRoleLabel(role: RoleKey): string {
    return this.roleDefinitions.find((r) => r.key === role)?.name ?? role;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupEmailPrefill() {
    const emailControl = this.form.get('email');
    const displayControl = this.form.get('displayName');
    if (!emailControl || !displayControl) return;

    emailControl.valueChanges
      .pipe(
        debounceTime(300),
        map((value) => (value || '').trim().toLowerCase()),
        distinctUntilChanged(),
        switchMap((email) => (email ? this.userDirectory.getUserByEmail(email) : of(undefined))),
        takeUntil(this.destroy$),
      )
      .subscribe((user) => {
        if (user?.displayName && !displayControl.value) {
          displayControl.setValue(user.displayName);
        }
      });
  }
}