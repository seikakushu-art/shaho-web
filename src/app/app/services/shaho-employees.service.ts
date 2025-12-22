import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  doc,
  docData,
  deleteDoc,
  updateDoc,
  setDoc,
  query,
  orderBy,
  getDocs,
  writeBatch,
  runTransaction,
  getDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable, combineLatest, map, of, switchMap, firstValueFrom, take } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserDirectoryService } from '../../auth/user-directory.service';

export interface ShahoEmployee {
  id?: string;
  name: string;
  employeeNo: string;
  kana?: string;
  gender?: string;
  birthDate?: string;
  postalCode?: string;
  address?: string; // 住民票住所
  currentAddress?: string; // 現住所
  department?: string;
  departmentCode?: string;
  workPrefecture?: string;
  workPrefectureCode?: string;
  personalNumber?: string;
  basicPensionNumber?: string;
  hasDependent?: boolean;
  healthStandardMonthly?: number;
  welfareStandardMonthly?: number;
  standardBonusAnnualTotal?: number;
  healthInsuredNumber?: string;
  pensionInsuredNumber?: string;
  insuredNumber?: string; // 被保険者番号
  careSecondInsured?: boolean;
  healthAcquisition?: string;
  pensionAcquisition?: string;
  currentLeaveStatus?: string;
  currentLeaveStartDate?: string;
  currentLeaveEndDate?: string;
  exemption?: boolean;
  // 監査情報
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

export type ExternalPayrollRecord = {
  yearMonth: string; // 2025-04 形式
  amount?: number; // 月給支払額
  workedDays?: number; // 支払基礎日数
  bonusPaidOn?: string; // 賞与支給日（YYYY-MM-DD形式）
  bonusTotal?: number; // 賞与総支給額
  standardBonus?: number; // 標準賞与額
};

export type ExternalDependentRecord = {
  relationship?: string; // 扶養 続柄
  nameKanji?: string; // 扶養 氏名(漢字)
  nameKana?: string; // 扶養 氏名(カナ)
  birthDate?: string; // 扶養 生年月日
  gender?: string; // 扶養 性別
  personalNumber?: string; // 扶養 個人番号
  basicPensionNumber?: string; // 扶養 基礎年金番号
  cohabitationType?: string; // 扶養 同居区分
  address?: string; // 扶養 住所（別居の場合のみ入力）
  occupation?: string; // 扶養 職業
  annualIncome?: number | string; // 扶養 年収（見込みでも可）
  dependentStartDate?: string; // 扶養 被扶養者になった日
  thirdCategoryFlag?: boolean | string | number; // 扶養 国民年金第3号被保険者該当フラグ
};

export type ExternalEmployeeRecord = {
  employeeNo: string;
  name: string;
  kana?: string;
  gender?: string; // 性別
  birthDate?: string;
  postalCode?: string; // 郵便番号
  address?: string; // 住民票住所
  currentAddress?: string; // 現住所
  department?: string;
  workPrefecture?: string;
  personalNumber?: string; // 個人番号
  basicPensionNumber?: string; // 基礎年金番号
  healthStandardMonthly?: number | string;
  welfareStandardMonthly?: number | string;
  healthInsuredNumber?: string; // 被保険者番号（健康保険)
  pensionInsuredNumber?: string; // 被保険者番号（厚生年金）
  healthAcquisition?: string; // 健康保険 資格取得日
  pensionAcquisition?: string; // 厚生年金 資格取得日
  careSecondInsured?: boolean | string | number; // 介護保険第2号被保険者フラグ
  currentLeaveStatus?: string; // 現在の休業状態（なし／産前産後／育児）
  currentLeaveStartDate?: string; // 現在の休業開始日
  currentLeaveEndDate?: string; // 現在の休業予定終了日
  hasDependent?: boolean | string | number; // 扶養の有無
  dependents?: ExternalDependentRecord[]; // 扶養家族情報配列
  payrolls?: ExternalPayrollRecord[]; // 給与データ配列
};

export type ExternalSyncError = {
  index: number;
  employeeNo?: string;
  message: string;
};

export type ExternalSyncResult = {
  total: number;
  processed: number;
  created: number;
  updated: number;
  errors: ExternalSyncError[];
};


/**
 * 月次給与ドキュメント（集計・表示用）
 * shaho_employees/{empId}/payrollMonths/{YYYYMM}
 */
export interface PayrollMonth {
  id?: string; // FirestoreドキュメントID（YYYYMM形式）
  yearMonth: string; // 2025-04 形式（後方互換性のため）
  // 月給関連
  workedDays?: number; // 支払基礎日数
  amount?: number; // 報酬額（月給支払額）
  healthStandardMonthly?: number;
  welfareStandardMonthly?: number;
  healthInsuranceMonthly?: number;
  careInsuranceMonthly?: number;
  pensionMonthly?: number;
  // 賞与集計値
  monthlyBonusTotal?: number; // 同月内の賞与総支給額の合計
  monthlyStandardBonusTotal?: number; // 同月内の標準賞与額の合計
  monthlyStandardHealthBonusTotal?: number; // 同月内の標準賞与額（健・介）の合計
  monthlyStandardWelfareBonusTotal?: number; // 同月内の標準賞与額（厚生年金）の合計
  premiumTotalToDate?: number; // 累計保険料（必要に応じて）
  // 監査情報
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string; // 承認者
}

/**
 * 賞与明細（支給回ごと）
 * shaho_employees/{empId}/payrollMonths/{YYYYMM}/bonusPayments/{bonusPaymentId}
 */
export interface BonusPayment {
  id?: string; // FirestoreドキュメントID（bonusPaymentId）
  sourcePaymentId?: string; // 基幹システムの支給ID（あれば）
  bonusPaidOn: string; // 賞与支給日（YYYY-MM-DD形式）
  bonusTotal: number; // 賞与総支給額
  standardHealthBonus?: number; // 標準賞与額（健・介）
  standardWelfareBonus?: number; // 標準賞与額（厚生年金）
  standardBonus?: number; // 後方互換性のためのフィールド（非推奨）
  healthInsuranceBonus?: number;
  careInsuranceBonus?: number;
  pensionBonus?: number;
  // 監査情報
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string; // 承認者
}

/**
 * 後方互換性のための既存インターフェース（非推奨）
 * @deprecated PayrollMonth と BonusPayment を使用してください
 */
export interface PayrollData {
  id?: string; // FirestoreドキュメントID
  yearMonth: string; // 2025-04 形式
  workedDays?: number; // 支払基礎日数（賞与データの場合は不要）
  amount?: number; // 報酬額（月給支払額、オプション）
  healthStandardMonthly?: number;
  welfareStandardMonthly?: number;
  healthInsuranceMonthly?: number;
  careInsuranceMonthly?: number;
  pensionMonthly?: number;
  // 賞与関連フィールド
  bonusPaidOn?: string; // 賞与支給日（YYYY-MM-DD形式）
  bonusTotal?: number; // 賞与総支給額
  standardBonus?: number; // 後方互換性のためのフィールド（非推奨）
  standardHealthBonus?: number; // 標準賞与額（健・介）
  standardWelfareBonus?: number; // 標準賞与額（厚生年金）
  healthInsuranceBonus?: number;
  careInsuranceBonus?: number;
  pensionBonus?: number;
  // その他の給与明細フィールドをここに追加可能
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string; // 承認者
}

export interface DependentData {
  id?: string; // FirestoreドキュメントID
  relationship?: string; // 続柄
  nameKanji?: string; // 氏名(漢字)
  nameKana?: string; // 氏名(カナ)
  birthDate?: string; // 生年月日
  gender?: string; // 性別
  personalNumber?: string; // 個人番号
  basicPensionNumber?: string; // 基礎年金番号
  cohabitationType?: string; // 同居区分
  address?: string; // 住所
  occupation?: string; // 職業
  annualIncome?: number | null; // 年収
  dependentStartDate?: string; // 被扶養者になった日
  thirdCategoryFlag?: boolean; // 第3号被保険者フラグ
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string; // 承認者
}

@Injectable({ providedIn: 'root' })
export class ShahoEmployeesService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private userDirectory = inject(UserDirectoryService);
  private colRef = collection(this.firestore, 'shaho_employees');

  getEmployees(): Observable<ShahoEmployee[]> {
    return collectionData(this.colRef, { idField: 'id' }) as Observable<
      ShahoEmployee[]
    >;
  }

  async deleteEmployee(id: string): Promise<void> {
    const ref = doc(this.colRef, id);
    await deleteDoc(ref);
  }

  getEmployeesWithPayrolls(): Observable<
    (ShahoEmployee & { payrolls: PayrollData[] })[]
  > {
    return this.getEmployees().pipe(
      switchMap((employees) => {
        if (!employees.length) return of([]);

        const employeesWithPayrolls$ = employees.map((employee) => {
          const payrolls$ = employee.id
            ? this.getPayrolls(employee.id)
            : of<PayrollData[]>([]);

          return payrolls$.pipe(
            map((payrolls) => ({
              ...employee,
              payrolls: payrolls ?? [],
            })),
          );
        });

        return combineLatest(employeesWithPayrolls$);
      }),
    );
  }

  /**
   * 外部人事システムから受け取ったデータをまとめて upsert します。
   * @param url JSON 配列の URL（デフォルト: 環境変数で設定されたエンドポイントURL）
   * @param method HTTPメソッド（デフォルト: GET）
   * @param requestBody POST/PUT/PATCH の場合のリクエストボディ（オプション）
   */
  async syncEmployeesFromExternalSource(
    url = environment.externalEmployeesApiUrl,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
    requestBody?: any,
  ): Promise<ExternalSyncResult> {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // POST/PUT/PATCH の場合はリクエストボディを追加
    if (method !== 'GET' && requestBody !== undefined) {
      fetchOptions.body = JSON.stringify(requestBody);
    }

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error('外部データの取得に失敗しました');
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('外部データの形式が不正です（配列ではありません）');
    }

    return this.importExternalEmployees(payload as ExternalEmployeeRecord[]);
  }

  private validateExternalRecord(
    record: ExternalEmployeeRecord,
  ): string | undefined {
    if (!record.employeeNo || `${record.employeeNo}`.trim() === '') {
      return '社員番号が入力されていません';
    }

    if (!record.name || record.name.trim() === '') {
      return '氏名が入力されていません';
    }

    if (
      record.healthStandardMonthly !== undefined &&
      record.healthStandardMonthly !== null &&
      isNaN(Number(record.healthStandardMonthly))
    ) {
      return '標準報酬月額（健保）が数値ではありません';
    }

    if (
      record.welfareStandardMonthly !== undefined &&
      record.welfareStandardMonthly !== null &&
      isNaN(Number(record.welfareStandardMonthly))
    ) {
      return '標準報酬月額（厚年）が数値ではありません';
    }

    // 扶養家族情報のバリデーション
    if (record.dependents && Array.isArray(record.dependents)) {
      for (let i = 0; i < record.dependents.length; i++) {
        const dependent = record.dependents[i];
        if (
          dependent.annualIncome !== undefined &&
          dependent.annualIncome !== null &&
          isNaN(Number(dependent.annualIncome))
        ) {
          return `扶養家族${i + 1}の年収が数値ではありません`;
        }
      }
    }

    return undefined;
  }

  /**
   * オブジェクトからundefinedのフィールドを除外するヘルパー関数
   */
  private removeUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
    const result: Partial<T> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key as keyof T] = value;
      }
    }
    return result;
  }

  private async importExternalEmployees(
    records: ExternalEmployeeRecord[],
  ): Promise<ExternalSyncResult> {
    const now = new Date().toISOString();
    // app_usersのdisplayNameを取得
    const userDisplayName = await this.getUserDisplayName();

    const snapshot = await getDocs(this.colRef);
    const existingMap = new Map<string, { id: string; data: ShahoEmployee }>();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as ShahoEmployee;
      if (data.employeeNo) {
        existingMap.set(data.employeeNo, { id: docSnap.id, data });
      }
    });

    const batch = writeBatch(this.firestore);
    const errors: ExternalSyncError[] = [];
    let created = 0;
    let updated = 0;
    const payrollDataToProcess: Array<{
      employeeNo: string;
      payrollRecord: ExternalPayrollRecord;
    }> = [];
    const dependentDataToProcess: Array<{
      employeeNo: string;
      dependentRecords: ExternalDependentRecord[];
    }> = [];

    records.forEach((record, index) => {
      const validationError = this.validateExternalRecord(record);
      if (validationError) {
        errors.push({
          index,
          employeeNo: record.employeeNo,
          message: validationError,
        });
        return;
      }

      // ブール値変換ヘルパー関数
      const toBoolean = (
        value: boolean | string | number | undefined,
      ): boolean | undefined => {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'boolean') return value;
        const normalized = String(value).toLowerCase().trim();
        if (
          normalized === '1' ||
          normalized === 'true' ||
          normalized === 'on' ||
          normalized === 'yes' ||
          normalized === '有'
        ) {
          return true;
        }
        if (
          normalized === '0' ||
          normalized === 'false' ||
          normalized === 'off' ||
          normalized === 'no' ||
          normalized === '無'
        ) {
          return false;
        }
        return undefined;
      };

      const normalized: ShahoEmployee = {
        employeeNo: `${record.employeeNo}`.trim(),
        name: record.name.trim(),
        kana: record.kana?.trim(),
        gender: record.gender?.trim(),
        birthDate: record.birthDate?.trim(),
        postalCode: record.postalCode?.trim(),
        address: record.address?.trim(),
        currentAddress: record.currentAddress?.trim(),
        department: record.department?.trim(),
        workPrefecture: record.workPrefecture?.trim(),
        personalNumber: record.personalNumber?.trim(),
        basicPensionNumber: record.basicPensionNumber?.trim(),
        healthStandardMonthly:
          record.healthStandardMonthly !== undefined
            ? Number(record.healthStandardMonthly)
            : undefined,
        welfareStandardMonthly:
          record.welfareStandardMonthly !== undefined
            ? Number(record.welfareStandardMonthly)
            : undefined,
        healthInsuredNumber: record.healthInsuredNumber?.trim(),
        pensionInsuredNumber: record.pensionInsuredNumber?.trim(),
        healthAcquisition: record.healthAcquisition?.trim(),
        pensionAcquisition: record.pensionAcquisition?.trim(),
        careSecondInsured: toBoolean(record.careSecondInsured),
        currentLeaveStatus: record.currentLeaveStatus?.trim(),
        currentLeaveStartDate: record.currentLeaveStartDate?.trim(),
        currentLeaveEndDate: record.currentLeaveEndDate?.trim(),
        hasDependent: toBoolean(record.hasDependent),
      };

      // undefinedのフィールドを除外
      const cleanedData = this.removeUndefinedFields(normalized);

      const existing = existingMap.get(normalized.employeeNo);
      
      if (existing) {
        const targetRef = doc(this.colRef, existing.id);
        batch.set(
          targetRef,
          {
            ...cleanedData,
            updatedAt: now,
            updatedBy: userDisplayName,
            approvedBy: '外部データ連携',
          },
          { merge: true },
        );
        updated += 1;
      } else {
        const targetRef = doc(this.colRef);
        batch.set(targetRef, {
          ...cleanedData,
          createdAt: now,
          updatedAt: now,
          createdBy: userDisplayName,
          updatedBy: userDisplayName,
          approvedBy: '外部データ連携',
        });
        created += 1;
      }

      // 扶養家族情報（dependents）を後で処理するために保存
      if (record.dependents && Array.isArray(record.dependents) && record.dependents.length > 0) {
        dependentDataToProcess.push({
          employeeNo: normalized.employeeNo,
          dependentRecords: record.dependents,
        });
      }

      // 給与データ（payrolls）を後で処理するために保存
      if (record.payrolls && Array.isArray(record.payrolls) && record.payrolls.length > 0) {
        record.payrolls.forEach((payrollRecord) => {
          // 月給データがあるかどうか（amountまたはworkedDaysが存在する）
          const hasMonthlyData = payrollRecord.amount !== undefined || payrollRecord.workedDays !== undefined;
          
          // 賞与データがあるかどうか（bonusPaidOn、bonusTotal、standardBonusのいずれかが存在する）
          const hasBonusData = !!(payrollRecord.bonusPaidOn || payrollRecord.bonusTotal || payrollRecord.standardBonus);
          
          // 月給データの年月を取得
          let monthlyYearMonth: string | undefined = payrollRecord.yearMonth;
          
          // 賞与データの年月を取得（bonusPaidOnから抽出）
          let bonusYearMonth: string | undefined;
          if (payrollRecord.bonusPaidOn) {
            try {
              const bonusDate = new Date(payrollRecord.bonusPaidOn.replace(/\//g, '-'));
              if (!isNaN(bonusDate.getTime())) {
                const year = bonusDate.getFullYear();
                const month = String(bonusDate.getMonth() + 1).padStart(2, '0');
                bonusYearMonth = `${year}-${month}`;
              }
            } catch {
              // 日付の解析に失敗した場合はスキップ
            }
          }
          
          // 月給データがある場合、yearMonthが必須
          if (hasMonthlyData && !monthlyYearMonth) {
            errors.push({
              index,
              employeeNo: record.employeeNo,
              message: `月給データがありますが、yearMonthが指定されていません`,
            });
          }
          
          // 賞与データがある場合、bonusPaidOnが必須
          if (hasBonusData && !bonusYearMonth) {
            errors.push({
              index,
              employeeNo: record.employeeNo,
              message: `賞与データがありますが、bonusPaidOnが指定されていないか、無効な日付です`,
            });
          }
          
          // 月給データも賞与データもない場合はスキップ
          if (!hasMonthlyData && !hasBonusData) {
            return;
          }
          
          // 月給データを保存
          if (hasMonthlyData && monthlyYearMonth) {
            payrollDataToProcess.push({
              employeeNo: normalized.employeeNo,
              payrollRecord: {
                yearMonth: monthlyYearMonth,
                amount: payrollRecord.amount,
                workedDays: payrollRecord.workedDays,
                // 賞与データは含めない
              },
            });
          }
          
          // 賞与データを保存
          if (hasBonusData && bonusYearMonth) {
            payrollDataToProcess.push({
              employeeNo: normalized.employeeNo,
              payrollRecord: {
                yearMonth: bonusYearMonth,
                bonusPaidOn: payrollRecord.bonusPaidOn,
                bonusTotal: payrollRecord.bonusTotal,
                standardBonus: payrollRecord.standardBonus,
                // 月給データは含めない
              },
            });
          }
        });
      }
    });

    // 社員データを先にコミット
    if (created + updated > 0) {
      await batch.commit();
      
      // 新規作成した社員のIDを取得
      if (created > 0) {
        const updatedSnapshot = await getDocs(this.colRef);
        updatedSnapshot.forEach((docSnap) => {
          const data = docSnap.data() as ShahoEmployee;
          if (data.employeeNo && !existingMap.has(data.employeeNo)) {
            existingMap.set(data.employeeNo, { id: docSnap.id, data });
          }
        });
      }
    }

    // 扶養家族情報を保存
    const dependentPromises: Promise<void>[] = [];
    dependentDataToProcess.forEach(({ employeeNo, dependentRecords }) => {
      const employee = existingMap.get(employeeNo);
      if (!employee) {
        errors.push({
          index: -1,
          employeeNo,
          message: `社員番号 ${employeeNo} の社員が見つかりません（扶養家族データの保存に失敗）`,
        });
        return;
      }

      // 既存の扶養家族情報を削除（更新の場合）
      dependentPromises.push(
        (async () => {
          const existingDependents: DependentData[] = await firstValueFrom(
            this.getDependents(employee.id).pipe(take(1)),
          );
          for (const existing of existingDependents) {
            if (existing.id) {
              await this.deleteDependent(employee.id, existing.id);
            }
          }

          // 新しい扶養家族情報を追加
          for (const dependentRecord of dependentRecords) {
            // ブール値変換ヘルパー関数
            const toBoolean = (
              value: boolean | string | number | undefined,
            ): boolean | undefined => {
              if (value === undefined || value === null) return undefined;
              if (typeof value === 'boolean') return value;
              const normalized = String(value).toLowerCase().trim();
              if (
                normalized === '1' ||
                normalized === 'true' ||
                normalized === 'on' ||
                normalized === 'yes' ||
                normalized === '有'
              ) {
                return true;
              }
              if (
                normalized === '0' ||
                normalized === 'false' ||
                normalized === 'off' ||
                normalized === 'no' ||
                normalized === '無'
              ) {
                return false;
              }
              return undefined;
            };

            const dependentData: Partial<DependentData> = {
              relationship: dependentRecord.relationship?.trim(),
              nameKanji: dependentRecord.nameKanji?.trim(),
              nameKana: dependentRecord.nameKana?.trim(),
              birthDate: dependentRecord.birthDate?.trim(),
              gender: dependentRecord.gender?.trim(),
              personalNumber: dependentRecord.personalNumber?.trim(),
              basicPensionNumber: dependentRecord.basicPensionNumber?.trim(),
              cohabitationType: dependentRecord.cohabitationType?.trim(),
              address: dependentRecord.address?.trim(),
              occupation: dependentRecord.occupation?.trim(),
              annualIncome:
                dependentRecord.annualIncome !== undefined &&
                dependentRecord.annualIncome !== null
                  ? Number(dependentRecord.annualIncome)
                  : undefined,
              dependentStartDate: dependentRecord.dependentStartDate?.trim(),
              thirdCategoryFlag: toBoolean(dependentRecord.thirdCategoryFlag),
              approvedBy: '外部データ連携',
            };

            // undefinedのフィールドを除外
            const cleanedDependentData = this.removeUndefinedFields(dependentData);

            // 扶養家族情報にデータがあるかチェック
            const hasDependentData = Object.values(cleanedDependentData).some(
              (value) =>
                value !== undefined &&
                value !== null &&
                value !== false &&
                value !== '',
            );

            if (hasDependentData) {
              await this.addOrUpdateDependent(
                employee.id,
                cleanedDependentData as DependentData,
              );
            }
          }
        })(),
      );
    });

    if (dependentPromises.length > 0) {
      await Promise.all(dependentPromises);
    }

    // 給与データを保存
    const payrollPromises: Promise<void>[] = [];
    payrollDataToProcess.forEach(({ employeeNo, payrollRecord }) => {
      const employee = existingMap.get(employeeNo);
      if (!employee) {
        errors.push({
          index: -1,
          employeeNo,
          message: `社員番号 ${employeeNo} の社員が見つかりません（給与データの保存に失敗）`,
        });
        return;
      }

      // 月給データと賞与データは既に分離されているので、そのまま保存
      const payrollData: Partial<PayrollData> = {
        yearMonth: payrollRecord.yearMonth,
        amount: payrollRecord.amount,
        workedDays: payrollRecord.workedDays,
        bonusPaidOn: payrollRecord.bonusPaidOn,
        bonusTotal: payrollRecord.bonusTotal,
        standardBonus: payrollRecord.standardBonus,
        approvedBy: '外部データ連携',
      };

      // undefinedのフィールドを除外
      const cleanedPayrollData = this.removeUndefinedFields(payrollData);

      // 給与データを保存（既存の場合はマージ）
      payrollPromises.push(
        this.addOrUpdatePayroll(employee.id, payrollRecord.yearMonth, cleanedPayrollData as PayrollData),
      );
    });

    if (payrollPromises.length > 0) {
      await Promise.all(payrollPromises);
    }

    return {
      total: records.length,
      processed: created + updated,
      created,
      updated,
      errors,
    };
  }

  /** app_usersコレクションからdisplayNameを取得 */
  private async getUserDisplayName(): Promise<string> {
    const currentUser = this.auth.currentUser;
    if (!currentUser?.email) {
      return 'system';
    }

    try {
      const user = await firstValueFrom(
        this.userDirectory.getUserByEmail(currentUser.email)
      );
      // app_usersのdisplayNameを優先的に使用（なければメールアドレス）
      return user?.displayName || currentUser.email;
    } catch (error) {
      console.error('ユーザー情報の取得に失敗しました:', error);
      return currentUser.email;
    }
  }

  async addEmployee(
    data: ShahoEmployee,
    options?: { createdBy?: string; approvedBy?: string },
  ) {
    const now = new Date().toISOString();
    // app_usersのdisplayNameを取得
    const userDisplayName = await this.getUserDisplayName();

    const employeeData: ShahoEmployee = {
      ...data,
      createdAt: now,
      updatedAt: now,
      createdBy: options?.createdBy || userDisplayName,
      updatedBy: userDisplayName,
      approvedBy: options?.approvedBy,
    };

    return addDoc(this.colRef, employeeData);
  }

  async updateEmployee(id: string, data: Partial<ShahoEmployee>) {
    const docRef = doc(this.firestore, 'shaho_employees', id);
    const now = new Date().toISOString();
    // app_usersのdisplayNameを取得
    const userDisplayName = await this.getUserDisplayName();

    const updateData: Partial<ShahoEmployee> = {
      ...data,
      updatedAt: now,
      updatedBy: userDisplayName,
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
   * bonusPaymentIdを生成（決定的ID）
   * @param sourcePaymentId 基幹システムの支給ID（あれば）
   * @param bonusPaidOn 賞与支給日（YYYY-MM-DD形式）
   * @param bonusTotal 賞与総支給額
   * @param existingIds 既存のIDリスト（重複チェック用）
   */
  private generateBonusPaymentId(
    sourcePaymentId: string | undefined,
    bonusPaidOn: string,
    bonusTotal: number,
    existingIds: string[] = [],
  ): string {
    // 基幹システムの支給IDがあればそれを優先
    if (sourcePaymentId && sourcePaymentId.trim()) {
      return sourcePaymentId.trim();
    }

    // YYYYMMDD形式に変換
    const dateStr = bonusPaidOn.replace(/\//g, '-').split('T')[0]; // YYYY-MM-DD形式を想定
    const yyyymmdd = dateStr.replace(/-/g, '').substring(0, 8); // YYYYMMDD

    // 既存のIDから同日のIDを抽出してseqを決定
    const sameDayIds = existingIds.filter((id) => id.startsWith(yyyymmdd));
    const seq = sameDayIds.length + 1;

    // YYYYMMDD-{amount}-{seq} 形式
    return `${yyyymmdd}-${bonusTotal}-${seq}`;
  }

  /**
   * 年月をYYYYMM形式に変換（2025-04 -> 202504）
   */
  private yearMonthToYYYYMM(yearMonth: string): string {
    return yearMonth.replace('-', '');
  }

  /**
   * YYYYMM形式を年月に変換（202504 -> 2025-04）
   */
  private yyyymmToYearMonth(yyyymm: string): string {
    if (yyyymm.length === 6) {
      return `${yyyymm.substring(0, 4)}-${yyyymm.substring(4, 6)}`;
    }
    return yyyymm; // 既に2025-04形式の場合はそのまま
  }

  /**
   * 月次給与データと賞与明細を追加または更新（Transaction使用）
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   * @param payrollMonthData 月次給与データ
   * @param bonusPaymentData 賞与明細データ（オプション）
   */
  async addOrUpdatePayrollMonth(
    employeeId: string,
    yearMonth: string,
    payrollMonthData: Partial<PayrollMonth>,
    bonusPaymentData?: Partial<BonusPayment>,
  ): Promise<void> {
    const yyyymm = this.yearMonthToYYYYMM(yearMonth);
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    const userId =
      currentUser?.displayName ||
      currentUser?.email ||
      currentUser?.uid ||
      'system';

    await runTransaction(this.firestore, async (transaction) => {
      // 月次ドキュメントの参照
      const payrollMonthRef = doc(
        this.firestore,
        'shaho_employees',
        employeeId,
        'payrollMonths',
        yyyymm,
      );

      // 既存の月次ドキュメントを取得
      const payrollMonthSnap = await transaction.get(payrollMonthRef);
      const existingPayrollMonth = payrollMonthSnap.exists()
        ? (payrollMonthSnap.data() as PayrollMonth)
        : undefined;

      // 賞与明細を追加する場合
      if (bonusPaymentData && bonusPaymentData.bonusPaidOn && bonusPaymentData.bonusTotal !== undefined) {
        // 既存の賞与明細を取得してID生成に使用
        const bonusPaymentsRef = collection(
          this.firestore,
          'shaho_employees',
          employeeId,
          'payrollMonths',
          yyyymm,
          'bonusPayments',
        );
        const bonusPaymentsSnap = await getDocs(bonusPaymentsRef);
        const existingBonusIds = bonusPaymentsSnap.docs.map((d) => d.id);

        // bonusPaymentIdを生成
        const bonusPaymentId = this.generateBonusPaymentId(
          bonusPaymentData.sourcePaymentId,
          bonusPaymentData.bonusPaidOn,
          bonusPaymentData.bonusTotal,
          existingBonusIds,
        );

        // 賞与明細ドキュメントの参照
        const bonusPaymentRef = doc(
          this.firestore,
          'shaho_employees',
          employeeId,
          'payrollMonths',
          yyyymm,
          'bonusPayments',
          bonusPaymentId,
        );

        // 既存の賞与明細を取得
        const bonusPaymentSnap = await transaction.get(bonusPaymentRef);
        const existingBonusPayment = bonusPaymentSnap.exists()
          ? (bonusPaymentSnap.data() as BonusPayment)
          : undefined;

        // 賞与明細を保存
        const bonusPayment: BonusPayment = {
          ...bonusPaymentData,
          id: bonusPaymentId,
          bonusPaidOn: bonusPaymentData.bonusPaidOn,
          bonusTotal: bonusPaymentData.bonusTotal,
          updatedAt: now,
          updatedBy: userId,
          createdAt: existingBonusPayment?.createdAt || now,
          createdBy: existingBonusPayment?.createdBy || userId,
        };

        transaction.set(bonusPaymentRef, bonusPayment, { merge: true });

        // 月次集計値を更新
        const existingBonusTotal = existingPayrollMonth?.monthlyBonusTotal || 0;
        const existingStandardHealthBonusTotal =
          existingPayrollMonth?.monthlyStandardHealthBonusTotal || 0;
        const existingStandardWelfareBonusTotal =
          existingPayrollMonth?.monthlyStandardWelfareBonusTotal || 0;

        // 既存の賞与明細の値を差し引く
        const oldBonusTotal = existingBonusPayment?.bonusTotal || 0;
        const oldStandardHealthBonus = existingBonusPayment?.standardHealthBonus || 0;
        const oldStandardWelfareBonus = existingBonusPayment?.standardWelfareBonus || 0;

        // 新しい値を加算
        const newBonusTotal =
          existingBonusTotal - oldBonusTotal + bonusPaymentData.bonusTotal;
        const newStandardHealthBonusTotal =
          existingStandardHealthBonusTotal -
          oldStandardHealthBonus +
          (bonusPaymentData.standardHealthBonus || 0);
        const newStandardWelfareBonusTotal =
          existingStandardWelfareBonusTotal -
          oldStandardWelfareBonus +
          (bonusPaymentData.standardWelfareBonus || 0);

        payrollMonthData.monthlyBonusTotal = newBonusTotal;
        payrollMonthData.monthlyStandardHealthBonusTotal =
          newStandardHealthBonusTotal;
        payrollMonthData.monthlyStandardWelfareBonusTotal =
          newStandardWelfareBonusTotal;
        payrollMonthData.monthlyStandardBonusTotal =
          newStandardHealthBonusTotal + newStandardWelfareBonusTotal;
      }

      // 月次ドキュメントを保存（既存データをマージ）
      const payrollMonth: PayrollMonth = {
        ...existingPayrollMonth, // 既存データを保持
        ...payrollMonthData, // 新しいデータで上書き
        id: yyyymm,
        yearMonth: yearMonth,
        updatedAt: now,
        updatedBy: userId,
        createdAt: existingPayrollMonth?.createdAt || now,
        createdBy: existingPayrollMonth?.createdBy || userId,
      };

      transaction.set(payrollMonthRef, payrollMonth, { merge: true });
    });
  }

  /**
   * 月次給与データを取得
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   */
  getPayrollMonth(
    employeeId: string,
    yearMonth: string,
  ): Observable<PayrollMonth | undefined> {
    const yyyymm = this.yearMonthToYYYYMM(yearMonth);
    const payrollMonthRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrollMonths',
      yyyymm,
    );
    return docData(payrollMonthRef, { idField: 'id' }) as Observable<
      PayrollMonth | undefined
    >;
  }

  /**
   * 月次給与データ一覧を取得
   * @param employeeId 社員ID
   */
  getPayrollMonths(employeeId: string): Observable<PayrollMonth[]> {
    const payrollMonthsRef = collection(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrollMonths',
    );
    const q = query(payrollMonthsRef, orderBy('id', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<PayrollMonth[]>;
  }

  /**
   * 賞与明細を取得
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   * @param bonusPaymentId 賞与明細ID
   */
  getBonusPayment(
    employeeId: string,
    yearMonth: string,
    bonusPaymentId: string,
  ): Observable<BonusPayment | undefined> {
    const yyyymm = this.yearMonthToYYYYMM(yearMonth);
    const bonusPaymentRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrollMonths',
      yyyymm,
      'bonusPayments',
      bonusPaymentId,
    );
    return docData(bonusPaymentRef, { idField: 'id' }) as Observable<
      BonusPayment | undefined
    >;
  }

  /**
   * 賞与明細一覧を取得
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   */
  getBonusPayments(
    employeeId: string,
    yearMonth: string,
  ): Observable<BonusPayment[]> {
    const yyyymm = this.yearMonthToYYYYMM(yearMonth);
    const bonusPaymentsRef = collection(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrollMonths',
      yyyymm,
      'bonusPayments',
    );
    const q = query(bonusPaymentsRef, orderBy('bonusPaidOn', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<
      BonusPayment[]
    >;
  }

  /**
   * 給与データを追加または更新（後方互換性のため残す）
   * 新しい構造（payrollMonths/bonusPayments）に変換して保存
   * @deprecated addOrUpdatePayrollMonth を使用してください
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   * @param payrollData 給与データ
   */
  async addOrUpdatePayroll(
    employeeId: string,
    yearMonth: string,
    payrollData: PayrollData,
  ) {
    // 月次データと賞与データを分離
    const payrollMonthData: Partial<PayrollMonth> = {
      workedDays: payrollData.workedDays,
      amount: payrollData.amount,
      healthStandardMonthly: payrollData.healthStandardMonthly,
      welfareStandardMonthly: payrollData.welfareStandardMonthly,
      healthInsuranceMonthly: payrollData.healthInsuranceMonthly,
      careInsuranceMonthly: payrollData.careInsuranceMonthly,
      pensionMonthly: payrollData.pensionMonthly,
      approvedBy: payrollData.approvedBy,
    };

    // 賞与データがある場合
    let bonusPaymentData: Partial<BonusPayment> | undefined;
    if (payrollData.bonusPaidOn && payrollData.bonusTotal !== undefined) {
      bonusPaymentData = {
        bonusPaidOn: payrollData.bonusPaidOn,
        bonusTotal: payrollData.bonusTotal,
        standardHealthBonus: payrollData.standardHealthBonus,
        standardWelfareBonus: payrollData.standardWelfareBonus,
        standardBonus: payrollData.standardBonus,
        healthInsuranceBonus: payrollData.healthInsuranceBonus,
        careInsuranceBonus: payrollData.careInsuranceBonus,
        pensionBonus: payrollData.pensionBonus,
        approvedBy: payrollData.approvedBy,
      };
    }

    // 新しい構造で保存
    await this.addOrUpdatePayrollMonth(
      employeeId,
      yearMonth,
      payrollMonthData,
      bonusPaymentData,
    );

    // 後方互換性のため、古い構造にも保存（非推奨）
    const payrollRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'payrolls',
      yearMonth,
    );
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    const userId =
      currentUser?.displayName ||
      currentUser?.email ||
      currentUser?.uid ||
      'system';

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
   * 特定の月の給与データを取得（後方互換性のため）
   * 新しい構造から取得を試み、なければ古い構造から取得
   * @param employeeId 社員ID
   * @param yearMonth 年月（2025-04形式）
   */
  getPayroll(
    employeeId: string,
    yearMonth: string,
  ): Observable<PayrollData | undefined> {
    // 新しい構造から取得を試みる
    return this.getPayrollMonth(employeeId, yearMonth).pipe(
      switchMap((payrollMonth) => {
        if (payrollMonth) {
          // 賞与明細も取得
          return this.getBonusPayments(employeeId, yearMonth).pipe(
            map((bonusPayments) => {
              // 最初の賞与明細を取得（後方互換性のため）
              const firstBonus = bonusPayments.length > 0 ? bonusPayments[0] : undefined;
              
              // PayrollData形式に変換
              const payrollData: PayrollData = {
                id: payrollMonth.id,
                yearMonth: payrollMonth.yearMonth,
                workedDays: payrollMonth.workedDays,
                amount: payrollMonth.amount,
                healthStandardMonthly: payrollMonth.healthStandardMonthly,
                welfareStandardMonthly: payrollMonth.welfareStandardMonthly,
                healthInsuranceMonthly: payrollMonth.healthInsuranceMonthly,
                careInsuranceMonthly: payrollMonth.careInsuranceMonthly,
                pensionMonthly: payrollMonth.pensionMonthly,
                bonusPaidOn: firstBonus?.bonusPaidOn,
                bonusTotal: firstBonus?.bonusTotal,
                standardHealthBonus: firstBonus?.standardHealthBonus,
                standardWelfareBonus: firstBonus?.standardWelfareBonus,
                standardBonus: firstBonus?.standardBonus,
                healthInsuranceBonus: firstBonus?.healthInsuranceBonus,
                careInsuranceBonus: firstBonus?.careInsuranceBonus,
                pensionBonus: firstBonus?.pensionBonus,
                createdAt: payrollMonth.createdAt,
                updatedAt: payrollMonth.updatedAt,
                createdBy: payrollMonth.createdBy,
                updatedBy: payrollMonth.updatedBy,
                approvedBy: payrollMonth.approvedBy,
              };
              return payrollData;
            }),
          );
        }
        
        // 新しい構造にない場合は古い構造から取得
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
      }),
    );
  }

  /**
   * 社員の給与データ一覧を取得（後方互換性のため）
   * 新しい構造から取得を試み、なければ古い構造から取得
   * @param employeeId 社員ID
   */
  getPayrolls(employeeId: string): Observable<PayrollData[]> {
    // 新しい構造から取得を試みる
    return this.getPayrollMonths(employeeId).pipe(
      switchMap((payrollMonths) => {
        if (payrollMonths && payrollMonths.length > 0) {
          // 各月次データに対して賞与明細を取得
          const payrollDataPromises = payrollMonths.map((payrollMonth) =>
            this.getBonusPayments(employeeId, payrollMonth.yearMonth).pipe(
              map((bonusPayments) => {
                // 最初の賞与明細を取得（後方互換性のため）
                const firstBonus = bonusPayments.length > 0 ? bonusPayments[0] : undefined;
                
                // PayrollData形式に変換
                const payrollData: PayrollData = {
                  id: payrollMonth.id,
                  yearMonth: payrollMonth.yearMonth,
                  workedDays: payrollMonth.workedDays,
                  amount: payrollMonth.amount,
                  healthStandardMonthly: payrollMonth.healthStandardMonthly,
                  welfareStandardMonthly: payrollMonth.welfareStandardMonthly,
                  healthInsuranceMonthly: payrollMonth.healthInsuranceMonthly,
                  careInsuranceMonthly: payrollMonth.careInsuranceMonthly,
                  pensionMonthly: payrollMonth.pensionMonthly,
                  bonusPaidOn: firstBonus?.bonusPaidOn,
                  bonusTotal: firstBonus?.bonusTotal,
                  standardHealthBonus: firstBonus?.standardHealthBonus,
                  standardWelfareBonus: firstBonus?.standardWelfareBonus,
                  standardBonus: firstBonus?.standardBonus,
                  healthInsuranceBonus: firstBonus?.healthInsuranceBonus,
                  careInsuranceBonus: firstBonus?.careInsuranceBonus,
                  pensionBonus: firstBonus?.pensionBonus,
                  createdAt: payrollMonth.createdAt,
                  updatedAt: payrollMonth.updatedAt,
                  createdBy: payrollMonth.createdBy,
                  updatedBy: payrollMonth.updatedBy,
                  approvedBy: payrollMonth.approvedBy,
                };
                return payrollData;
              }),
            ),
          );
          return combineLatest(payrollDataPromises);
        }
        
        // 新しい構造にない場合は古い構造から取得
        const payrollsRef = collection(
          this.firestore,
          'shaho_employees',
          employeeId,
          'payrolls',
        );
        const q = query(payrollsRef, orderBy('yearMonth', 'desc'));
        return collectionData(q, { idField: 'id' }) as Observable<PayrollData[]>;
      }),
    );
  }

  // 扶養情報（dependents）の操作メソッド

  /**
   * 扶養情報を追加または更新
   * @param employeeId 社員ID
   * @param dependentId 扶養情報ID（指定しない場合は自動生成）
   * @param dependentData 扶養情報データ
   */
  async addOrUpdateDependent(
    employeeId: string,
    dependentData: DependentData,
    dependentId?: string,
  ) {
    const dependentRef = dependentId
      ? doc(
          this.firestore,
          'shaho_employees',
          employeeId,
          'dependents',
          dependentId,
        )
      : doc(
          collection(
            this.firestore,
            'shaho_employees',
            employeeId,
            'dependents',
          ),
        );
    const now = new Date().toISOString();
    const currentUser = this.auth.currentUser;
    // ユーザーが設定したID（displayName）を優先的に使用
    const userId =
      currentUser?.displayName ||
      currentUser?.email ||
      currentUser?.uid ||
      'system';

    const data: DependentData = {
      ...dependentData,
      updatedAt: now,
      updatedBy: userId,
      createdAt: dependentData.createdAt || now,
      createdBy: dependentData.createdBy || userId,
    };

    // undefinedのフィールドを除外（Firestoreはundefinedを許可しない）
    const cleanedData = this.removeUndefinedFields(data);

    return setDoc(dependentRef, cleanedData, { merge: true });
  }

  /**
   * 特定の扶養情報を取得
   * @param employeeId 社員ID
   * @param dependentId 扶養情報ID
   */
  getDependent(
    employeeId: string,
    dependentId: string,
  ): Observable<DependentData | undefined> {
    const dependentRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'dependents',
      dependentId,
    );
    return docData(dependentRef, { idField: 'id' }) as Observable<
      DependentData | undefined
    >;
  }

  /**
   * 社員の扶養情報一覧を取得
   * @param employeeId 社員ID
   */
  getDependents(employeeId: string): Observable<DependentData[]> {
    const dependentsRef = collection(
      this.firestore,
      'shaho_employees',
      employeeId,
      'dependents',
    );
    const q = query(dependentsRef, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<
      DependentData[]
    >;
  }

  /**
   * 扶養情報を削除
   * @param employeeId 社員ID
   * @param dependentId 扶養情報ID
   */
  async deleteDependent(employeeId: string, dependentId: string): Promise<void> {
    const dependentRef = doc(
      this.firestore,
      'shaho_employees',
      employeeId,
      'dependents',
      dependentId,
    );
    await deleteDoc(dependentRef);
  }
}
