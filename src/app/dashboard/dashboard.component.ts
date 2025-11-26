import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth/auth.service';
import { ROLE_DEFINITIONS, RoleDefinition, RoleKey } from '../models/roles';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ShahoEmployeesService, ShahoEmployee } from '../app/services/shaho-employees.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, AsyncPipe, NgIf, NgFor, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private authService = inject(AuthService);
  private employeesService = inject(ShahoEmployeesService);

  readonly user$ = this.authService.user$;
  readonly role$ = this.authService.roleDefinition$;
  readonly allRoles: RoleDefinition[] = ROLE_DEFINITIONS;
  readonly employees$: Observable<ShahoEmployee[]> = this.employeesService.getEmployees();

  readonly RoleKey = RoleKey;
}