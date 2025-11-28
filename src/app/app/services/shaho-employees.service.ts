import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  doc,
  docData,
  updateDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

export interface ShahoEmployee {
  id?: string;
  name: string;
  employeeNo: string;
  kana?: string;
  gender?: string;
  birthDate?: string;
  department?: string;
  departmentCode?: string;
  workPrefecture?: string;
  workPrefectureCode?: string;
  standardMonthly?: number;
  insuredNumber?: string; // 被保険者番号
  healthAcquisition?: string;
  pensionAcquisition?: string;
  // 監査情報
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

@Injectable({ providedIn: 'root' })
export class ShahoEmployeesService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private colRef = collection(this.firestore, 'shaho_employees');

  getEmployees(): Observable<ShahoEmployee[]> {
    return collectionData(this.colRef, { idField: 'id' }) as Observable<
      ShahoEmployee[]
    >;
  }

  async addEmployee(data: ShahoEmployee) {
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    const userEmail = currentUser?.email || currentUser?.uid || 'system';

    const employeeData: ShahoEmployee = {
      ...data,
      createdAt: now,
      updatedAt: now,
      createdBy: userEmail,
      updatedBy: userEmail,
    };

    return addDoc(this.colRef, employeeData);
  }

  async updateEmployee(id: string, data: Partial<ShahoEmployee>) {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    const userEmail = currentUser?.email || currentUser?.uid || 'system';

    const updateData: Partial<ShahoEmployee> = {
      ...data,
      updatedAt: now,
      updatedBy: userEmail,
    };

    return updateDoc(docRef, updateData);
  }
  getEmployeeById(id: string): Observable<ShahoEmployee | undefined> {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    return docData(docRef, { idField: 'id' }) as Observable<
      ShahoEmployee | undefined
    >;
  }
}
