import { TestBed } from '@angular/core/testing';

import { ShahoEmployeesService } from './shaho-employees.service';

describe('ShahoEmployeesService', () => {
  let service: ShahoEmployeesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ShahoEmployeesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
