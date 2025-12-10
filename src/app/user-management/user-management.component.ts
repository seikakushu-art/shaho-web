import { Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators, AsyncValidatorFn } from '@angular/forms';
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
    displayName: ['', [Validators.required], [this.displayNameUniqueValidator()]],
    role: this.fb.control<RoleKey>(RoleKey.Guest, [Validators.required]),
  });

  statusMessage = '';
  submitted = false;
  isExistingUser = false;

  constructor() {
    this.setupEmailPrefill();
  }

  resetForm() {
    this.form.reset({ email: '', displayName: '', role: RoleKey.Guest });
    this.isExistingUser = false;
    this.submitted = false;
    this.statusMessage = '';
    // 表示名フィールドを有効化
    const displayControl = this.form.get('displayName');
    if (displayControl) {
      displayControl.enable();
    }
  }

  async saveUser() {
    this.submitted = true;
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー情報を更新できます';
      return;
    }

    // バリデーションを実行
    const displayControl = this.form.get('displayName');
    if (displayControl) {
      displayControl.markAsTouched();
      await displayControl.updateValueAndValidity();
    }

    if (this.form.invalid || !this.form.value.role) {
      if (displayControl?.hasError('displayNameDuplicate')) {
        this.statusMessage = 'この表示名は既に使用されています';
      } else {
        this.statusMessage = 'メール・表示名を正しく入力してください';
      }
      return;
    }

    const email = this.form.value.email?.trim().toLowerCase();
    const existingUser = await firstValueFrom(this.userDirectory.getUserByEmail(email));

    // 新規登録の場合、表示名の重複を再チェック
    if (!existingUser) {
      const users = await firstValueFrom(this.users$);
      const displayName = this.form.value.displayName?.trim();
      const duplicateUser = users.find(
        (user) => user.displayName && user.displayName.trim() === displayName
      );
      if (duplicateUser) {
        this.statusMessage = 'この表示名は既に使用されています';
        return;
      }
    }

    // 既存ユーザーの場合、表示名は変更しない（既存のdisplayNameを保持）
    const payload: AppUser = {
      email: this.form.value.email?.trim().toLowerCase(),
      displayName: existingUser?.displayName || this.form.value.displayName,
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
    this.isExistingUser = false;
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
    this.isExistingUser = false;
    this.submitted = false;
    // 表示名フィールドを有効化
    const displayControl = this.form.get('displayName');
    if (displayControl) {
      displayControl.enable();
    }
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

  /** 表示名の重複チェック用バリデーター */
  private displayNameUniqueValidator(): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      // 既存ユーザーの場合はバリデーションをスキップ
      if (this.isExistingUser) {
        return of(null);
      }

      const displayName = control.value?.trim();
      if (!displayName) {
        return of(null);
      }

      return this.users$.pipe(
        debounceTime(300),
        map((users) => {
          // 現在編集中のユーザー（メールアドレスで判定）を除外
          const emailControl = this.form.get('email');
          const currentEmail = emailControl?.value?.trim().toLowerCase();
          
          const existingDisplayNames = users
            .filter((user) => {
              // 現在編集中のユーザーは除外
              if (currentEmail && user.email.toLowerCase() === currentEmail) {
                return false;
              }
              return user.displayName && user.displayName.trim() === displayName;
            })
            .map((user) => user.displayName);

          if (existingDisplayNames.length > 0) {
            return { displayNameDuplicate: { message: 'この表示名は既に使用されています' } };
          }
          return null;
        }),
      );
    };
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
        this.isExistingUser = !!user;
        if (user?.displayName) {
          displayControl.setValue(user.displayName);
          // 既存ユーザーの場合、表示名フィールドを無効化
          if (this.isExistingUser) {
            displayControl.disable();
          } else {
            displayControl.enable();
          }
        } else {
          // 新規ユーザーの場合、表示名フィールドを有効化
          displayControl.enable();
        }
        // バリデーションを再実行
        displayControl.updateValueAndValidity();
      });
  }
}