import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { UserDirectoryService } from './auth/user-directory.service';
import { RoleKey, ROLE_DEFINITIONS } from './models/roles';

describe('AppComponent', () => {
  const mockAuthService = {
    user$: of(null),
    roleDefinition$: of(ROLE_DEFINITIONS.find(r => r.key === RoleKey.Guest)!),
    roleDefinitions$: of([ROLE_DEFINITIONS.find(r => r.key === RoleKey.Guest)!]),
    hasAnyRole: jasmine.createSpy('hasAnyRole').and.returnValue(of(true)),
    logout: jasmine.createSpy('logout').and.returnValue(Promise.resolve()),
  };

  const mockUserDirectoryService = {
    getUsers: jasmine.createSpy('getUsers').and.returnValue(of([])),
  };

  const mockRouter = {
    navigate: jasmine.createSpy('navigate'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UserDirectoryService, useValue: mockUserDirectoryService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
