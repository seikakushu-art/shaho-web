import { inject, Injectable } from '@angular/core';
import {
  doc,
  docSnapshots,
  Firestore,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { map, Observable } from 'rxjs';

export type HealthInsuranceType = '協会けんぽ' | '組合健保' | '';

export interface CorporateInfo {
  id?: string;
  officeName?: string;
  address?: string;
  ownerName?: string;
  phoneNumber?: string;
  healthInsuranceType?: HealthInsuranceType;
  healthInsuranceOfficeCode?: string;
  pensionOfficeCode?: string;
  sharedOfficeNumber?: string;
  insurerNumber?: string;
  registeredAt?: string;
  updatedAt?: string;
  registeredBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

export type CorporateInfoPayload = Omit<
  CorporateInfo,
  'id' | 'registeredAt' | 'updatedAt' | 'registeredBy' | 'updatedBy'
>;

@Injectable({ providedIn: 'root' })
export class CorporateInfoService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private docRef = doc(this.firestore, 'corporate_information', 'settings');

  /** デモ用の法人情報を作成（未登録時のみ） */
  async ensureDemoData(): Promise<void> {
    const snapshot = await getDoc(this.docRef);
    if (snapshot.exists()) {
      return;
    }

    const now = new Date().toISOString();
    const demoData: CorporateInfo = {
      officeName: 'シャホー社会保険労務士事務所',
      address: '東京都千代田区丸の内1-1-1 シャホービル5F',
      ownerName: '社会 保子',
      phoneNumber: '03-1234-5678',
      healthInsuranceType: '協会けんぽ',
      healthInsuranceOfficeCode: '12-345678',
      pensionOfficeCode: '12-345678',
      sharedOfficeNumber: '1234567890',
      insurerNumber: '12345678',
      registeredAt: now,
      updatedAt: now,
      registeredBy: 'デモユーザー',
      updatedBy: 'デモユーザー',
      approvedBy: '承認 太郎',
    };

    await setDoc(this.docRef, demoData);
  }

  /** 法人情報を購読する（存在しなければ null を返す） */
  getCorporateInfo(): Observable<CorporateInfo | null> {
    return docSnapshots(this.docRef).pipe(
      map((snapshot) => {
        if (!snapshot.exists()) {
          return null;
        }
        return { id: snapshot.id, ...(snapshot.data() as CorporateInfo) };
      }),
    );
  }

  /** ユーザーの表示名を取得する */
  private getUserDisplayName(): string {
    const user = this.auth.currentUser;
    if (!user) return 'システム';
    
    // displayNameがあればそれを使用
    if (user.displayName) {
      return user.displayName;
    }
    
    // メールアドレスのローカル部分（@より前）を使用
    if (user.email) {
      return user.email.split('@')[0];
    }
    
    return 'ユーザー';
  }

  /** 法人情報を新規登録または更新する */
  async saveCorporateInfo(payload: CorporateInfoPayload): Promise<void> {
    const now = new Date().toISOString();
    const currentUserName = this.getUserDisplayName();

    const snapshot = await getDoc(this.docRef);
    const existing = snapshot.exists()
      ? (snapshot.data() as CorporateInfo)
      : undefined;

    const data: CorporateInfo = {
      ...existing,
      ...payload,
      registeredAt: existing?.registeredAt ?? now,
      registeredBy: existing?.registeredBy ?? currentUserName,
      updatedAt: now,
      updatedBy: currentUserName,
    };

    await setDoc(this.docRef, data);
  }
}