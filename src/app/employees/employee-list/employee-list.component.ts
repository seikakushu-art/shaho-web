import { CommonModule, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

interface EmployeeListItem {
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
export class EmployeeListComponent {
  constructor(private router: Router) {}

  departments = ['営業企画部', '人事総務部', '情報システム部', '大阪支社', '札幌支店'];

  employees: EmployeeListItem[] = [
    {
      employeeNo: 'E202501',
      name: '佐藤 花子',
      birthDate: '1990-07-12',
      department: '営業企画部',
      workPrefecture: '東京都',
      standardMonthly: 420000,
    },
    {
      employeeNo: 'E202502',
      name: '田中 一郎',
      birthDate: '1987-03-04',
      department: '人事総務部',
      workPrefecture: '神奈川県',
      standardMonthly: 395000,
    },
    {
      employeeNo: 'E202503',
      name: '鈴木 次郎',
      birthDate: '1985-10-21',
      department: '情報システム部',
      workPrefecture: '大阪府',
      standardMonthly: 480000,
    },
    {
      employeeNo: 'E202504',
      name: '高橋 三奈',
      birthDate: '1992-01-16',
      department: '大阪支社',
      workPrefecture: '大阪府',
      standardMonthly: 365000,
    },
    {
      employeeNo: 'E202505',
      name: '山本 美咲',
      birthDate: '1995-09-08',
      department: '札幌支店',
      workPrefecture: '北海道',
      standardMonthly: 332000,
    },
    {
      employeeNo: 'E202506',
      name: '小林 健',
      birthDate: '1983-05-30',
      department: '営業企画部',
      workPrefecture: '愛知県',
      standardMonthly: 450000,
    },
    {
      employeeNo: 'E202507',
      name: '加藤 真由',
      birthDate: '1991-12-11',
      department: '情報システム部',
      workPrefecture: '東京都',
      standardMonthly: 410000,
    },
    {
      employeeNo: 'E202508',
      name: '伊藤 拓海',
      birthDate: '1988-06-25',
      department: '人事総務部',
      workPrefecture: '福岡県',
      standardMonthly: 370000,
    },
    {
      employeeNo: 'E202509',
      name: '中村 さくら',
      birthDate: '1993-02-18',
      department: '大阪支社',
      workPrefecture: '京都府',
      standardMonthly: 355000,
    },
    {
      employeeNo: 'E202510',
      name: '松本 颯太',
      birthDate: '1996-11-02',
      department: '営業企画部',
      workPrefecture: '東京都',
      standardMonthly: 305000,
    },
    {
      employeeNo: 'E202511',
      name: '林 奏',
      birthDate: '1989-08-14',
      department: '札幌支店',
      workPrefecture: '北海道',
      standardMonthly: 298000,
    },
    {
      employeeNo: 'E202512',
      name: '渡辺 光',
      birthDate: '1984-04-03',
      department: '情報システム部',
      workPrefecture: '東京都',
      standardMonthly: 520000,
    },
  ];

  searchCondition: SearchCondition = {
    employeeNo: '',
    name: '',
    department: '',
  };

  pageSizeOptions = [10, 25, 50];
  pageSize = 10;
  currentPage = 1;

  filteredEmployees = [...this.employees];

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

  clear() {
    this.searchCondition = {
      employeeNo: '',
      name: '',
      department: '',
    };
    this.filteredEmployees = [...this.employees];
    this.currentPage = 1;
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
    this.router.navigate(['/employees', employee.employeeNo]);
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

  trackByEmployee(index: number, employee: EmployeeListItem) {
    return employee.employeeNo;
  }

  getPageRangeLabel() {
    if (!this.filteredEmployees.length) {
      return '0件';
    }
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalCount);
    return `${start} - ${end} / ${this.totalCount}件`;
  }
}