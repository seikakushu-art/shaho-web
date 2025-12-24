import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { EmployeeDetailComponent } from './employee-detail.component';
import { ShahoEmployee, ShahoEmployeesService, BonusPayment, PayrollData } from '../app/services/shaho-employees.service';
import { AuthService } from '../auth/auth.service';
import { ApprovalWorkflowService } from '../approvals/approval-workflow.service';
import { UserDirectoryService } from '../auth/user-directory.service';
import { ApprovalAttachmentService } from '../approvals/approval-attachment.service';
import { ApprovalNotificationService } from '../approvals/approval-notification.service';
import { InsuranceRatesService } from '../app/services/insurance-rates.service';
import { CorporateInfoService } from '../app/services/corporate-info.service';

describe('EmployeeDetailComponent', () => {
  let fixture: ComponentFixture<EmployeeDetailComponent>;
  let component: EmployeeDetailComponent;

  const employee: ShahoEmployee = {
    id: 'emp1',
    name: 'テスト太郎',
    employeeNo: '0001',
  };

  const bonusPayments: BonusPayment[] = [
    {
      id: 'bonus1',
      bonusPaidOn: '2025-04-10',
      bonusTotal: 50000,
      standardHealthBonus: 48000,
      standardWelfareBonus: 48000,
      standardBonus: 48000,
      healthInsuranceBonus: 1200,
      careInsuranceBonus: 300,
      pensionBonus: 1600,
    },
  ];

  // getPayrollsが返すPayrollData[]を作成（getPayrollsの実装に合わせて）
  const payrolls: PayrollData[] = [
    {
      id: '202504',
      yearMonth: '2025-04',
      amount: 320000,
      workedDays: 20,
      healthInsuranceMonthly: 15000,
      careInsuranceMonthly: 2000,
      pensionMonthly: 18000,
      bonusPaidOn: '2025-04-10',
      bonusTotal: 50000,
      standardHealthBonus: 48000,
      standardWelfareBonus: 48000,
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
    getBonusPayments: jasmine.createSpy('getBonusPayments').and.returnValue(of(bonusPayments)),
    getDependents: jasmine.createSpy('getDependents').and.returnValue(of([])),
  };

  const mockAuthService = {
    user$: of(null),
    hasAnyRole: jasmine.createSpy('hasAnyRole').and.returnValue(of(false)),
  };

  const mockWorkflowService = {
    flows$: of([]),
    requests$: of([]),
  };

  const mockUserDirectoryService = {
    getUsers: jasmine.createSpy('getUsers').and.returnValue(of([])),
  };

  const mockAttachmentService = {
    validateFiles: jasmine.createSpy('validateFiles').and.returnValue({ valid: true, files: [], errors: [] }),
    upload: jasmine.createSpy('upload').and.returnValue(Promise.resolve([])),
  };

  const mockNotificationService = {
    pushBatch: jasmine.createSpy('pushBatch'),
  };

  const mockInsuranceRatesService = {
    getRateHistory: jasmine.createSpy('getRateHistory').and.returnValue(of([])),
  };

  const mockCorporateInfoService = {
    getCorporateInfo: jasmine.createSpy('getCorporateInfo').and.returnValue(of({ healthInsuranceType: '協会けんぽ' })),
  };

  const mockRouter = {
    navigate: jasmine.createSpy('navigate'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmployeeDetailComponent],
      providers: [
        { provide: ShahoEmployeesService, useValue: employeesServiceStub },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ApprovalWorkflowService, useValue: mockWorkflowService },
        { provide: UserDirectoryService, useValue: mockUserDirectoryService },
        { provide: ApprovalAttachmentService, useValue: mockAttachmentService },
        { provide: ApprovalNotificationService, useValue: mockNotificationService },
        { provide: InsuranceRatesService, useValue: mockInsuranceRatesService },
        { provide: CorporateInfoService, useValue: mockCorporateInfoService },
        { provide: Router, useValue: mockRouter },
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
    expect(employeesServiceStub.getBonusPayments).toHaveBeenCalledWith(employee.id, '2025-04');

    const history = component.socialInsuranceHistory['2025-04'];
    expect(history).toEqual({
      monthlySalary: 320000,
      workedDays: 20,
      healthInsuranceMonthly: 15000,
      careInsuranceMonthly: 2000,
      pensionMonthly: 18000,
      bonusPaidOn: '2025-04-10',
      bonusTotal: 50000,
      standardHealthBonus: 48000,
      standardWelfareBonus: 48000,
      healthInsuranceBonus: 1200,
      careInsuranceBonus: 300,
      pensionBonus: 1600,
    });
  });
});