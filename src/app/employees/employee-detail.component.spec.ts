import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { EmployeeDetailComponent } from './employee-detail.component';
import { ShahoEmployee, ShahoEmployeesService } from '../app/services/shaho-employees.service';

describe('EmployeeDetailComponent', () => {
  let fixture: ComponentFixture<EmployeeDetailComponent>;
  let component: EmployeeDetailComponent;

  const employee: ShahoEmployee = {
    id: 'emp1',
    name: 'テスト太郎',
    employeeNo: '0001',
  };

  const payrolls = [
    {
      yearMonth: '2025-04',
      amount: 320000,
      workedDays: 20,
      healthInsuranceMonthly: 15000,
      careInsuranceMonthly: 2000,
      pensionMonthly: 18000,
      bonusPaidOn: '2025-04-10',
      bonusTotal: 50000,
      standardBonus: 48000,
      healthInsuranceBonus: 1200,
      careInsuranceBonus: 300,
      pensionBonus: 1600,
    },
  ];

  const employeesServiceStub: Partial<ShahoEmployeesService> = {
    getEmployeeById: jasmine
      .createSpy('getEmployeeById')
      .and.returnValue(of(employee)),
    getPayrolls: jasmine.createSpy('getPayrolls').and.returnValue(of(payrolls)),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmployeeDetailComponent],
      providers: [
        { provide: ShahoEmployeesService, useValue: employeesServiceStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: employee.id })) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmployeeDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should load payrolls into social insurance history', () => {
    expect(employeesServiceStub.getPayrolls).toHaveBeenCalledWith(employee.id);

    const history = component.socialInsuranceHistory['2025-04'];
    expect(history).toEqual({
      monthlySalary: 320000,
      workedDays: 20,
      healthInsuranceMonthly: 15000,
      careInsuranceMonthly: 2000,
      pensionMonthly: 18000,
      bonusPaidOn: '2025-04-10',
      bonusTotal: 50000,
      standardBonus: 48000,
      healthInsuranceBonus: 1200,
      careInsuranceBonus: 300,
      pensionBonus: 1600,
    });
  });
});