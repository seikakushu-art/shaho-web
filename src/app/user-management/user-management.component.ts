import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl } from '@angular/forms';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { UserDirectoryService, AppUser } from '../auth/user-directory.service';
import { firstValueFrom, Observable } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss',
})
export class UserManagementComponent {
  private fb = inject(FormBuilder);
  private userDirectory = inject(UserDirectoryService);
  private authService = inject(AuthService);

  readonly users$: Observable<AppUser[]> = this.userDirectory.getUsers();
  readonly roleDefinitions: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly RoleKey = RoleKey;
  readonly canEdit$ = this.authService.hasAnyRole([RoleKey.SystemAdmin]);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required]],
    roles: this.fb.control<RoleKey[]>([RoleKey.Guest], [this.requireAtLeastOneRole]),
  });

  statusMessage = '';
  selectedUser?: AppUser;

  private requireAtLeastOneRole(control: AbstractControl<RoleKey[] | null>) {
    const roles = control.value ?? [];
    return roles.length ? null : { roleRequired: true };
  }

  selectUser(user: AppUser) {
    this.selectedUser = user;
    this.form.setValue({
      email: user.email,
      displayName: user.displayName ?? '',
      roles: user.roles?.length ? user.roles : [RoleKey.Guest],
    });
    this.statusMessage = `選択中: ${user.email}`;
  }

  resetForm() {
    this.selectedUser = undefined;
    this.form.reset({ email: '', displayName: '', roles: [RoleKey.Guest] });
    this.statusMessage = '';
  }

  async saveUser() {
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー情報を更新できます';
      return;
    }

    if (this.form.invalid || !this.form.value.roles?.length) {
      this.statusMessage = 'メール・表示名・ロールを正しく入力し、1件以上のロールを付与してください';
      return;
    }

    const payload: AppUser = {
      ...this.form.value,
      roles: this.form.value.roles?.length ? this.form.value.roles : [RoleKey.Guest],
    } as AppUser;

    await this.userDirectory.saveUser(payload);
    this.statusMessage = `${payload.email} を保存しました`;
    this.resetForm();
  }

  async deleteUser(user: AppUser) {
    const canEdit = await firstValueFrom(this.canEdit$);
    if (!canEdit) {
      this.statusMessage = 'システム管理者のみユーザー削除が可能です';
      return;
    }
    await this.userDirectory.deleteUser(user.email);
    this.statusMessage = `${user.email} を削除しました`;
    if (this.selectedUser?.email === user.email) {
      this.resetForm();
    }
  }

  isRoleSelected(role: RoleKey): boolean {
    return this.form.value.roles?.includes(role) ?? false;
  }

  toggleRole(role: RoleKey) {
    const roles: RoleKey[] = this.form.value.roles ?? [];
    if (roles.includes(role)) {
        if (roles.length === 1) {
            this.statusMessage = '最低1つのロールを付与してください';
            return;
          }
      this.form.patchValue({ roles: roles.filter((r) => r !== role) });
    } else {
      this.form.patchValue({ roles: [...roles, role] });
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
}