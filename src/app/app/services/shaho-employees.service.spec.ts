import { TestBed } from '@angular/core/testing';
import { initializeApp, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { ShahoEmployeesService } from './shaho-employees.service';
import { UserDirectoryService } from '../../auth/user-directory.service';

// Firebaseアプリのテスト用設定
const firebaseConfig = {
  apiKey: 'test-api-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'test-project',
  storageBucket: 'test.appspot.com',
  messagingSenderId: '123456789',
  appId: 'test-app-id',
};

const mockUserDirectoryService = {
  getUsers: jasmine.createSpy('getUsers').and.returnValue(of([])),
  getUserByEmail: jasmine.createSpy('getUserByEmail').and.returnValue(of(undefined)),
};

describe('ShahoEmployeesService', () => {
  let service: ShahoEmployeesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ShahoEmployeesService,
        { provide: UserDirectoryService, useValue: mockUserDirectoryService },
        provideFirebaseApp(() => initializeApp(firebaseConfig)),
        provideAuth(() => getAuth(getApp())),
        provideFirestore(() => initializeFirestore(getApp(), {})),
      ],
    });
    service = TestBed.inject(ShahoEmployeesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
