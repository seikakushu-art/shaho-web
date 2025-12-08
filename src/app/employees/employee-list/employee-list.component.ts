import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { RoleKey } from '../../models/roles';
import {
  ShahoEmployee,
  ShahoEmployeesService,
  ExternalSyncResult,
} from '../../app/services/shaho-employees.service';

interface EmployeeListItem {
    id: string;
  employeeNo: string;
  name: string;
  birthDate: string;
  department: string;
  workPrefecture: string;
  standardMonthly: number;
}

interface SearchCondition {
  employeeNo: string;
  name: string;
  department: string;
}

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIf, NgFor, DatePipe],
  templateUrl: './employee-list.component.html',
  styleUrl: './employee-list.component.scss',
})
export class EmployeeListComponent implements OnInit, OnDestroy {
    private router = inject(Router);
    private employeesService = inject(ShahoEmployeesService);
    private authService = inject(AuthService);
    private destroy$ = new Subject<void>();
    // 承認者もCSV出力を実行できるよう許可対象に含める
    readonly canManage$ = this.authService.hasAnyRole([
      RoleKey.SystemAdmin,
      RoleKey.Operator,
      RoleKey.Approver,
    ]);

  departments: string[] = [];

  employees: EmployeeListItem[] = [];

  searchCondition: SearchCondition = {
    employeeNo: '',
    name: '',
    department: '',
  };

  pageSizeOptions = [10, 25, 50];
  pageSize = 10;
  currentPage = 1;

  isLoading = true;
  isSyncingExternal = false;

  filteredEmployees = [...this.employees];
  externalSyncResult?: ExternalSyncResult;
  externalSyncError?: string;

  ngOnInit() {
    this.employeesService
      .getEmployees()
      .pipe(takeUntil(this.destroy$))
      .subscribe((employees) => {
        this.employees = employees.map((item) => this.toListItem(item));
        this.extractDepartments();
        this.applyFilters();
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get paginatedEmployees() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredEmployees.slice(start, start + this.pageSize);
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.filteredEmployees.length / this.pageSize));
  }

  get totalCount() {
    return this.filteredEmployees.length;
  }

  search() {
    this.applyFilters();
  }

  clear() {
    this.searchCondition = {
      employeeNo: '',
      name: '',
      department: '',
    };
    this.applyFilters();
  }

  changePageSize(size: number) {
    this.pageSize = size;
    this.currentPage = 1;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage += 1;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage -= 1;
    }
  }

  onRowClick(employee: EmployeeListItem) {
    this.router.navigate(['/employees', employee.id]);
  }

  onViewDetail(event: Event, employee: EmployeeListItem) {
    event.stopPropagation();
    this.onRowClick(employee);
  }

  goToCreate() {
    this.router.navigate(['/employees/new']);
  }

  goToImport() {
    this.router.navigate(['/employees/import']);
  }

  goToCsvExport() {
    this.router.navigate(['/csv-export']);
  }

  async syncExternalData() {
    this.isSyncingExternal = true;
    this.externalSyncError = undefined;
    try {
      this.externalSyncResult = await this.employeesService.syncEmployeesFromExternalSource();
    } catch (error) {
      this.externalSyncError =
        error instanceof Error ? error.message : '外部データ連携に失敗しました';
    } finally {
      this.isSyncingExternal = false;
    }
  }

  trackByEmployee(index: number, employee: EmployeeListItem) {
    return employee.id;
  }

  getPageRangeLabel() {
    if (!this.filteredEmployees.length) {
      return '0件';
    }
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalCount);
    return `${start} - ${end} / ${this.totalCount}件`;
  }
  private applyFilters() {
    const { employeeNo, name, department } = this.searchCondition;
    const normalizedName = name.trim().toLowerCase();

    this.filteredEmployees = this.employees.filter((employee) => {
      const matchesEmployeeNo = employeeNo
        ? employee.employeeNo === employeeNo.trim()
        : true;
      const matchesName = normalizedName
        ? employee.name.toLowerCase().includes(normalizedName)
        : true;
      const matchesDepartment = department
        ? employee.department === department
        : true;

      return matchesEmployeeNo && matchesName && matchesDepartment;
    });

    this.currentPage = 1;
  }

  private extractDepartments() {
    const departmentSet = new Set<string>();
    this.employees.forEach((employee) => {
      if (employee.department && employee.department.trim()) {
        departmentSet.add(employee.department);
      }
    });
    this.departments = Array.from(departmentSet).sort();
  }

  private toListItem(employee: ShahoEmployee): EmployeeListItem {
    return {
      id: employee.id ?? employee.employeeNo,
      employeeNo: employee.employeeNo,
      name: employee.name,
      birthDate: employee.birthDate ?? '',
      department: employee.department ?? '',
      workPrefecture: employee.workPrefecture ?? '',
      standardMonthly: employee.standardMonthly ?? 0,
    };
  }
}