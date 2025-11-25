import { Component, OnInit } from '@angular/core';
import { ShahoEmployeesService, ShahoEmployee } from './app/services/shaho-employees.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <h1>shaho employees</h1>

    <button (click)="addDummy()">ダミー社員追加</button>

    <ul>
      <li *ngFor="let e of employees$ | async">
        {{ e.employeeNo }} : {{ e.name }}
      </li>
    </ul>
  `,
})
export class AppComponent implements OnInit {
  employees$!: Observable<ShahoEmployee[]>;

  constructor(private readonly service: ShahoEmployeesService) {}

  ngOnInit() {
    this.employees$ = this.service.getEmployees();
  }

  addDummy() {
    this.service.addEmployee({
      employeeNo: 'E001',
      name: '山田太郎',
    });
  }
}
