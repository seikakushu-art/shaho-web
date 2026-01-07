import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { ApprovalDetailComponent } from './approval-detail.component';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { ApprovalNotificationService } from './approval-notification.service';
import { AuthService } from '../auth/auth.service';
import { UserDirectoryService } from '../auth/user-directory.service';
import { InsuranceRatesService } from '../app/services/insurance-rates.service';
import { CorporateInfoService } from '../app/services/corporate-info.service';
import {
  DependentData,
  ShahoEmployeesService,
} from '../app/services/shaho-employees.service';
import { CalculationDataService } from '../calculations/calculation-data.service';

describe('ApprovalDetailComponent - syncDependents', () => {
  let component: ApprovalDetailComponent;
  const mockEmployeesService = {
    getDependents: jasmine
      .createSpy('getDependents')
      .and.returnValue(of([{ id: 'dep1', nameKanji: '既存扶養' } as DependentData])),
    deleteDependent: jasmine
      .createSpy('deleteDependent')
      .and.returnValue(Promise.resolve()),
    addOrUpdateDependent: jasmine
      .createSpy('addOrUpdateDependent')
      .and.returnValue(Promise.resolve()),
    updateEmployee: jasmine.createSpy('updateEmployee'),
  } as Partial<ShahoEmployeesService>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ApprovalDetailComponent, RouterTestingModule],
      providers: [
        { provide: ApprovalWorkflowService, useValue: { getRequest: () => of(null) } },
        { provide: ApprovalNotificationService, useValue: {} },
        { provide: AuthService, useValue: { hasAnyRole: () => of(false), user$: of(null) } },
        { provide: UserDirectoryService, useValue: { getUsers: () => of([]) } },
        { provide: InsuranceRatesService, useValue: {} },
        { provide: CorporateInfoService, useValue: {} },
        { provide: ShahoEmployeesService, useValue: mockEmployeesService },
        { provide: CalculationDataService, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'test-id' })) },
        },
      ],
    });

    component = TestBed.createComponent(ApprovalDetailComponent).componentInstance;
  });

  afterEach(() => {
    (mockEmployeesService.getDependents as jasmine.Spy)?.calls.reset();
    (mockEmployeesService.deleteDependent as jasmine.Spy)?.calls.reset();
    (mockEmployeesService.addOrUpdateDependent as jasmine.Spy)?.calls.reset();
  });

  it('hasDependent が undefined で扶養配列が空の場合、既存扶養を削除する', async () => {
    await (component as any).syncDependents('emp1', undefined, []);

    expect(mockEmployeesService.getDependents).toHaveBeenCalledWith('emp1');
    expect(mockEmployeesService.deleteDependent).toHaveBeenCalledWith('emp1', 'dep1');
    expect(mockEmployeesService.addOrUpdateDependent).not.toHaveBeenCalled();
  });

  it('扶養レコードが全フィールド空でも削除対象として扱う', async () => {
    await (component as any).syncDependents('emp1', undefined, [{} as DependentData]);

    expect(mockEmployeesService.getDependents).toHaveBeenCalledWith('emp1');
    expect(mockEmployeesService.deleteDependent).toHaveBeenCalledWith('emp1', 'dep1');
    expect(mockEmployeesService.addOrUpdateDependent).not.toHaveBeenCalled();
  });
});