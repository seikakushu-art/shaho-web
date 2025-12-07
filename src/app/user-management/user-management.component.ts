import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { UserDirectoryService, AppUser } from '../auth/user-directory.service';
import { Observable } from 'rxjs';
import { RouterLink } from '@angular/router';

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

  readonly users$: Observable<AppUser[]> = this.userDirectory.getUsers();
  readonly roleDefinitions: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly RoleKey = RoleKey;

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required]],
    roles: this.fb.control<RoleKey[]>([]),
  });

  statusMessage = '';
  selectedUser?: AppUser;

  selectUser(user: AppUser) {
    this.selectedUser = user;
    this.form.setValue({
      email: user.email,
      displayName: user.displayName ?? '',
      roles: user.roles ?? [],
    });
    this.statusMessage = `選択中: ${user.email}`;
  }

  resetForm() {
    this.selectedUser = undefined;
    this.form.reset({ email: '', displayName: '', roles: [] });
    this.statusMessage = '';
  }

  async saveUser() {
    if (this.form.invalid) {
      this.statusMessage = 'メール・表示名・ロールを正しく入力してください';
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
}