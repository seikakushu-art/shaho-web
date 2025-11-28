import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  doc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface ShahoEmployee {
  id?: string;
  name: string;
  employeeNo: string;
  insuredNumber?: string; // 被保険者番号
}

@Injectable({ providedIn: 'root' })
export class ShahoEmployeesService {
  private firestore = inject(Firestore);
  private colRef = collection(this.firestore, 'shaho_employees');

  getEmployees(): Observable<ShahoEmployee[]> {
    return collectionData(this.colRef, { idField: 'id' }) as Observable<
      ShahoEmployee[]
    >;
  }

  addEmployee(data: ShahoEmployee) {
    return addDoc(this.colRef, data);
  }

  updateEmployee(id: string, data: Partial<ShahoEmployee>) {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    return updateDoc(docRef, data);
  }
}
