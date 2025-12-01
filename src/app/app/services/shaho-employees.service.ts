import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  doc,
  docData,
  updateDoc,
  setDoc,
  query,
  orderBy,
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
  postalCode?: string;
  address?: string;
  department?: string;
  departmentCode?: string;
  workPrefecture?: string;
  workPrefectureCode?: string;
  personalNumber?: string;
  basicPensionNumber?: string;
  standardMonthly?: number;
  standardBonusAnnualTotal?: number;
  healthInsuredNumber?: string;
  pensionInsuredNumber?: string;
  insuredNumber?: string; // 被保険者番号
  careSecondInsured?: boolean;
  healthAcquisition?: string;
  pensionAcquisition?: string;
  childcareLeaveStart?: string;
  childcareLeaveEnd?: string;
  maternityLeaveStart?: string;
  maternityLeaveEnd?: string;
  exemption?: boolean;
  // 監査情報
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

export interface PayrollData {
  id?: string; // FirestoreドキュメントID
  yearMonth: string; // 2025-04 形式
  workedDays: number; // 支払基礎日数
  amount?: number; // 報酬額（月給支払額、オプション）
  // 賞与関連フィールド
  bonusPaidOn?: string; // 賞与支給日（YYYY-MM-DD形式）
  bonusTotal?: number; // 賞与総支給額
  // その他の給与明細フィールドをここに追加可能
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
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
    // ユーザーが設定したID（displayName）を優先的に使用
    const userId = currentUser?.displayName || currentUser?.email || currentUser?.uid || 'system';

    const employeeData: ShahoEmployee = {
      ...data,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    return addDoc(this.colRef, employeeData);
  }

  async updateEmployee(id: string, data: Partial<ShahoEmployee>) {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    // ユーザーが設定したID（displayName）を優先的に使用
    const userId = currentUser?.displayName || currentUser?.email || currentUser?.uid || 'system';

    const updateData: Partial<ShahoEmployee> = {
      ...data,
      updatedAt: now,
      updatedBy: userId,
    };

    return updateDoc(docRef, updateData);
  }
  getEmployeeById(id: string): Observable<ShahoEmployee | undefined> {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    return docData(docRef, { idField: 'id' }) as Observable<
      ShahoEmployee | undefined
    >;
  }

  // 給与データ（payrolls）の操作メソッド

  /**
   * 給与データを追加または更新
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   * @param payrollData 給与データ
   */
  async addOrUpdatePayroll(
    employeeId: string,
    yearMonth: string,
    payrollData: PayrollData,
  ) {
    const payrollRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrolls',
      yearMonth,
    );
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    // ユーザーが設定したID（displayName）を優先的に使用
    const userId = currentUser?.displayName || currentUser?.email || currentUser?.uid || 'system';

    const data: PayrollData = {
      ...payrollData,
      yearMonth,
      updatedAt: now,
      updatedBy: userId,
      createdAt: payrollData.createdAt || now,
      createdBy: payrollData.createdBy || userId,
    };

    return setDoc(payrollRef, data, { merge: true });
  }

  /**
   * 特定の月の給与データを取得
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   */
  getPayroll(
    employeeId: string,
    yearMonth: string,
  ): Observable<PayrollData | undefined> {
    const payrollRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrolls',
      yearMonth,
    );
    return docData(payrollRef, { idField: 'id' }) as Observable<
      PayrollData | undefined
    >;
  }

  /**
   * 社員の給与データ一覧を取得
   * @param employeeId 社員ID
   */
  getPayrolls(employeeId: string): Observable<PayrollData[]> {
    const payrollsRef = collection(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrolls',
    );
    const q = query(payrollsRef, orderBy('yearMonth', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<PayrollData[]>;
  }
}
