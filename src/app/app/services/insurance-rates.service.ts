import { inject, Injectable } from '@angular/core';
import {
  collection,
  collectionData,
  doc,
  Firestore,
  getDoc,
  orderBy,
  query,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { HealthInsuranceType } from './corporate-info.service';

export type InsuranceCategory = '健康保険' | '厚生年金';

export interface RateDetail {
  totalRate?: string;
  employeeRate?: string;
  effectiveFrom?: string;
}

export interface PrefectureRate extends RateDetail {
  prefecture: string;
}

export interface PensionRate extends RateDetail {}

export interface StandardCompensationGrade {
  insuranceType: InsuranceCategory;
  grade: string;
  standardMonthlyCompensation?: string;
  lowerLimit?: string;
  upperLimit?: string;
  effectiveFrom?: string;
}

export interface BonusCap {
  insuranceType: InsuranceCategory;
  yearlyCap?: string;
  yearlyCapEffectiveFrom?: string;
  monthlyCap?: string;
  monthlyCapEffectiveFrom?: string;
}

export interface InsuranceRateRecord {
  id?: string;
  healthType: HealthInsuranceType;
  insurerName?: string;
  healthInsuranceRates: PrefectureRate[];
  nursingCareRates: PrefectureRate[];
  pensionRate: PensionRate;
  standardCompensations: StandardCompensationGrade[];
  bonusCaps: BonusCap[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export type InsuranceRatePayload = Omit<
  InsuranceRateRecord,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'
> & { id?: string };

@Injectable({ providedIn: 'root' })
export class InsuranceRatesService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private collectionRef = collection(this.firestore, 'insurance_rates');

  private getUserDisplayName(): string {
    const user = this.auth.currentUser;
    if (!user) return 'システム';

    if (user.displayName) {
      return user.displayName;
    }

    if (user.email) {
      return user.email.split('@')[0];
    }

    return 'ユーザー';
  }

  getRateHistory(healthType: HealthInsuranceType): Observable<InsuranceRateRecord[]> {
    const q = query(
      this.collectionRef,
      where('healthType', '==', healthType),
      orderBy('updatedAt', 'desc'),
    );

    return collectionData(q, { idField: 'id' }) as Observable<InsuranceRateRecord[]>;
  }

  private removeUndefined<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.removeUndefined(item)) as T;
    }

    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefined(value);
      }
    }
    return cleaned as T;
  }

  async saveRates(payload: InsuranceRatePayload): Promise<string> {
    const now = new Date().toISOString();
    const currentUser = this.getUserDisplayName();

    // idをpayloadから分離（idはドキュメントパスに使用するため、データに含めない）
    const { id, ...dataWithoutId } = payload;

    if (id) {
      const docRef = doc(this.collectionRef, id);
      const snapshot = await getDoc(docRef);
      const existing = snapshot.exists() ? (snapshot.data() as InsuranceRateRecord) : undefined;

      // existingからもidを削除
      const { id: existingId, ...existingWithoutId } = existing || {};

      const docData = this.removeUndefined({
        ...existingWithoutId,
        ...dataWithoutId,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? currentUser,
        updatedAt: now,
        updatedBy: currentUser,
      });

      await setDoc(docRef, docData);

      return docRef.id;
    }

    const docRef = doc(this.collectionRef);
    const docData = this.removeUndefined({
      ...dataWithoutId,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser,
      updatedBy: currentUser,
    });

    await setDoc(docRef, docData);

    return docRef.id;
  }
}