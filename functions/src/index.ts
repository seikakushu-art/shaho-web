import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

// 型定義（フロントエンドと共通）
type ExternalPayrollRecord = {
  yearMonth: string; // 2025-04 形式
  amount?: number; // 月給支払額
  workedDays?: number; // 支払基礎日数
  bonusPaidOn?: string; // 賞与支給日（YYYY-MM-DD形式）
  bonusTotal?: number; // 賞与総支給額
  standardBonus?: number; // 標準賞与額（後方互換性のため）
  standardHealthBonus?: number; // 標準賞与額（健・介）
  standardWelfareBonus?: number; // 標準賞与額（厚生年金）
};

type ExternalDependentRecord = {
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

type ExternalEmployeeRecord = {
  employeeNo: string;
  name: string;
  kana?: string;
  gender?: string;
  birthDate?: string;
  postalCode?: string;
  address?: string;
  currentAddress?: string;
  department?: string;
  workPrefecture?: string;
  personalNumber?: string;
  basicPensionNumber?: string;
  healthStandardMonthly?: number | string;
  welfareStandardMonthly?: number | string;
  healthInsuredNumber?: string;
  pensionInsuredNumber?: string;
  healthAcquisition?: string;
  pensionAcquisition?: string;
  currentLeaveStatus?: string;
  currentLeaveStartDate?: string;
  currentLeaveEndDate?: string;
  careSecondInsured?: boolean | string;
  exemption?: boolean | string;
  hasDependent?: boolean | string | number; // 扶養の有無
  dependents?: ExternalDependentRecord[]; // 扶養家族情報配列
  payrolls?: ExternalPayrollRecord[]; // 給与データ配列
};

type ExternalSyncError = {
  index: number;
  employeeNo?: string;
  message: string;
};

type ExternalSyncResult = {
  total: number;
  processed: number;
  created: number;
  updated: number;
  errors: ExternalSyncError[];
};

interface ShahoEmployee {
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
  healthStandardMonthly?: number | string;
  welfareStandardMonthly?: number | string;
  standardBonusAnnualTotal?: number;
  healthInsuredNumber?: string;
  pensionInsuredNumber?: string;
  insuredNumber?: string;
  careSecondInsured?: boolean;
  healthAcquisition?: string;
  pensionAcquisition?: string;
  currentLeaveStatus?: string;
  currentLeaveStartDate?: string;
  currentLeaveEndDate?: string;
  exemption?: boolean;
  hasDependent?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

/**
 * 月次給与ドキュメント（集計・表示用）
 * shaho_employees/{empId}/payrollMonths/{YYYYMM}
 */
interface PayrollMonth {
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
interface BonusPayment {
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
interface PayrollData {
  id?: string;
  yearMonth: string;
  workedDays?: number;
  amount?: number;
  healthInsuranceMonthly?: number;
  careInsuranceMonthly?: number;
  pensionMonthly?: number;
  bonusPaidOn?: string;
  bonusTotal?: number;
  standardBonus?: number; // 後方互換性のためのフィールド（非推奨）
  standardHealthBonus?: number; // 標準賞与額（健・介）
  standardWelfareBonus?: number; // 標準賞与額（厚生年金）
  healthInsuranceBonus?: number;
  careInsuranceBonus?: number;
  pensionBonus?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
}

interface DependentData {
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

// APIキーの検証（環境変数から取得）
const API_KEY = functions.config().api?.key || "";

/**
 * APIキーを検証する関数
 */
function validateApiKey(request: functions.https.Request): boolean {
  const apiKey = request.headers["x-api-key"] || request.headers["authorization"];
  
  if (!API_KEY) {
    // APIキーが設定されていない場合は警告を出して許可
    console.warn("警告: APIキーが設定されていません");
    return true;
  }

  if (!apiKey) {
    return false;
  }

  // Bearerトークンの形式をサポート
  const token = typeof apiKey === "string" && apiKey.startsWith("Bearer ")
    ? apiKey.substring(7)
    : apiKey;

  return token === API_KEY;
}

/**
 * 外部レコードを検証する関数
 */
function validateExternalRecord(
  record: ExternalEmployeeRecord
): string | undefined {
  if (!record.employeeNo || `${record.employeeNo}`.trim() === "") {
    return "社員番号が入力されていません";
  }

  if (!record.name || record.name.trim() === "") {
    return "氏名が入力されていません";
  }

  // 生年月日の未来日付チェック
  if (record.birthDate) {
    const birthDateStr = record.birthDate.trim();
    if (birthDateStr) {
      const date = new Date(birthDateStr.replace(/-/g, "/"));
      if (!isNaN(date.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        date.setHours(0, 0, 0, 0);
        if (date.getTime() > today.getTime()) {
          return "生年月日は未来の日付は入力できません";
        }
      }
    }
  }

  if (
    record.healthStandardMonthly !== undefined &&
    record.healthStandardMonthly !== null &&
    isNaN(Number(record.healthStandardMonthly))
  ) {
    return "標準報酬月額（健保）が数値ではありません";
  }

  if (
    record.welfareStandardMonthly !== undefined &&
    record.welfareStandardMonthly !== null &&
    isNaN(Number(record.welfareStandardMonthly))
  ) {
    return "標準報酬月額（厚年）が数値ではありません";
  }

  // 郵便番号の検証（7桁の数字、ハイフンは任意）
  if (record.postalCode) {
    const postalCodeStr = record.postalCode.trim();
    if (postalCodeStr) {
      // ハイフンを除去して数字のみを取得
      const normalized = postalCodeStr.replace(/-/g, "");
      // 7桁の数字であることを確認
      if (!/^\d{7}$/.test(normalized)) {
        return "郵便番号は7桁の数字で入力してください（例：123-4567 または 1234567）";
      }
      // ハイフンがある場合は3桁-4桁の形式のみ許可
      if (postalCodeStr.includes("-") && !/^\d{3}-\d{4}$/.test(postalCodeStr)) {
        return "郵便番号は123-4567形式で入力してください";
      }
    }
  }

  // 住所の検証（最大80文字）
  if (record.address) {
    const addressStr = record.address.trim();
    if (addressStr && addressStr.length > 80) {
      return `住民票住所は最大80文字まで入力できます（現在${addressStr.length}文字）`;
    }
  }

  // 現住所の検証（最大80文字）
  if (record.currentAddress) {
    const currentAddressStr = record.currentAddress.trim();
    if (currentAddressStr && currentAddressStr.length > 80) {
      return `現住所は最大80文字まで入力できます（現在${currentAddressStr.length}文字）`;
    }
  }

  // 現在の休業状態のチェック
  const currentLeaveStatus = record.currentLeaveStatus?.trim();
  const currentLeaveStartDate = record.currentLeaveStartDate?.trim();
  const currentLeaveEndDate = record.currentLeaveEndDate?.trim();

  // 現在の休業状態が空文字列または「なし」の場合、日付フィールドは入力不可
  const isLeaveStatusValid = currentLeaveStatus && currentLeaveStatus !== "" && currentLeaveStatus !== "なし";
  
  if (!isLeaveStatusValid) {
    // 休業状態が無効な場合、日付フィールドが入力されているとエラー
    if (currentLeaveStartDate && currentLeaveStartDate !== "") {
      return "現在の休業状態が選択されていない、または「なし」の場合は、現在の休業開始日を入力できません";
    }
    if (currentLeaveEndDate && currentLeaveEndDate !== "") {
      return "現在の休業状態が選択されていない、または「なし」の場合は、現在の休業予定終了日を入力できません";
    }
  }

  // 現在の休業開始日と現在の休業予定終了日の関係チェック
  if (currentLeaveStartDate && currentLeaveEndDate) {
    const startDateStr = currentLeaveStartDate;
    const endDateStr = currentLeaveEndDate;
    
    if (startDateStr && endDateStr) {
      const startDate = new Date(startDateStr.replace(/-/g, "/"));
      const endDate = new Date(endDateStr.replace(/-/g, "/"));

      // 日付が有効かチェック
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        // 終了日が開始日より前の場合はエラー
        if (endDate < startDate) {
          return "現在の休業予定終了日は現在の休業開始日より後の日付である必要があります";
        }
      }
    }
  }

  // 扶養の有無を正規化
  const normalizeHasDependent = (value?: boolean | string | number): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === "boolean") return value;
    const str = String(value).trim().toLowerCase();
    return str === "1" || str === "on" || str === "true" || str === "yes" || str === "有";
  };

  const hasDependent = normalizeHasDependent(record.hasDependent);

  // 扶養の有無が「有」の場合、扶養情報が1件以上必要
  if (hasDependent) {
    if (!record.dependents || !Array.isArray(record.dependents) || record.dependents.length === 0) {
      return "扶養の有無が「有」の場合、扶養情報を1件以上入力してください";
    }
  }

  // 扶養家族情報のバリデーション
  if (record.dependents && Array.isArray(record.dependents)) {
    for (let i = 0; i < record.dependents.length; i++) {
      const dependent = record.dependents[i];
      
      // 扶養の有無が「有」の場合、続柄と氏名（漢字）が必須
      if (hasDependent) {
        if (!dependent.relationship || dependent.relationship.trim() === "") {
          return `扶養家族${i + 1}の続柄は必須です`;
        }
        if (!dependent.nameKanji || dependent.nameKanji.trim() === "") {
          return `扶養家族${i + 1}の氏名（漢字）は必須です`;
        }
      }

      // 扶養家族の年収が数値かチェック
      if (
        dependent.annualIncome !== undefined &&
        dependent.annualIncome !== null &&
        isNaN(Number(dependent.annualIncome))
      ) {
        return `扶養家族${i + 1}の年収が数値ではありません`;
      }

      // 扶養家族の生年月日の未来日付チェック
      if (dependent.birthDate) {
        const birthDateStr = dependent.birthDate.trim();
        if (birthDateStr) {
          const date = new Date(birthDateStr.replace(/-/g, "/"));
          if (!isNaN(date.getTime())) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            date.setHours(0, 0, 0, 0);
            if (date.getTime() > today.getTime()) {
              return `扶養家族${i + 1}の生年月日は未来の日付は入力できません`;
            }
          }
        }
      }

      // 扶養家族の住所の検証（最大80文字）
      if (dependent.address) {
        const addressStr = dependent.address.trim();
        if (addressStr && addressStr.length > 80) {
          return `扶養家族${i + 1}の住所は最大80文字まで入力できます（現在${addressStr.length}文字）`;
        }
      }
    }
  }

  return undefined;
}

/**
 * オブジェクトからundefinedと空文字列のフィールドを除外するヘルパー関数
 */
function removeUndefinedFields<T extends Record<string, any>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    // undefinedとnull、空文字列を除外
    if (value !== undefined && value !== null && value !== "") {
      result[key as keyof T] = value;
    }
  }
  return result;
}

/**
 * 外部システムから社員データを受け取るAPIエンドポイント
 * POST /api/employees/webhook
 */
export const receiveEmployees = functions.https.onRequest(
  async (request, response) => {
    // 関数開始ログ
    console.log("=== receiveEmployees関数が呼び出されました ===");
    console.log("リクエストメソッド:", request.method);
    console.log("リクエストURL:", request.url);
    console.log("リクエストヘッダー:", JSON.stringify(request.headers, null, 2));
    
    // CORS設定
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");

    // OPTIONSリクエストの処理
    if (request.method === "OPTIONS") {
      console.log("OPTIONSリクエストを処理します");
      response.status(204).send("");
      return;
    }

    // POSTメソッドのみ許可
    if (request.method !== "POST") {
      console.error("POSTメソッドではありません。メソッド:", request.method);
      response.status(405).json({
        error: "Method not allowed. Only POST is supported.",
      });
      return;
    }
    
    console.log("POSTリクエストを処理します");

    // APIキーの検証
    console.log("APIキーの検証を開始");
    const apiKeyValid = validateApiKey(request);
    console.log("APIキーの検証結果:", apiKeyValid);
    if (!apiKeyValid) {
      console.error("APIキーの検証に失敗しました");
      response.status(401).json({
        error: "Unauthorized. Invalid or missing API key.",
      });
      return;
    }
    console.log("APIキーの検証成功");

    try {
      // リクエストボディの検証
      console.log("リクエストメソッド:", request.method);
      console.log("Content-Type:", request.headers["content-type"]);
      console.log("リクエストボディの型:", typeof request.body);
      console.log("リクエストボディ（生）:", request.body);
      
      let bodyData: any = request.body;
      
      // リクエストボディが文字列の場合、JSONとしてパースを試みる
      if (typeof bodyData === "string") {
        console.log("リクエストボディが文字列です。JSONとしてパースします。");
        try {
          bodyData = JSON.parse(bodyData);
          console.log("パース成功:", JSON.stringify(bodyData, null, 2));
        } catch (parseError) {
          console.error("JSONパースエラー:", parseError);
          response.set("Content-Type", "application/json; charset=utf-8");
          response.status(400).json({
            error: "Bad Request",
            message: "リクエストボディのJSON形式が無効です。",
            details: parseError instanceof Error ? parseError.message : "Unknown error",
            code: "INVALID_JSON_FORMAT",
          });
          return;
        }
      }
      
      if (!bodyData) {
        console.error("リクエストボディが空です");
        response.set("Content-Type", "application/json; charset=utf-8");
        response.status(400).json({
          error: "Bad Request",
          message: "リクエストボディが空です。社員データの配列を送信してください。",
          code: "EMPTY_REQUEST_BODY",
        });
        return;
      }
      
      if (!Array.isArray(bodyData)) {
        console.error("リクエストボディが配列ではありません。型:", typeof bodyData);
        response.set("Content-Type", "application/json; charset=utf-8");
        response.status(400).json({
          error: "Bad Request",
          message: "リクエストボディは社員データの配列である必要があります。",
          details: `受信したデータの型: ${typeof bodyData}`,
          code: "INVALID_REQUEST_BODY_TYPE",
          receivedType: typeof bodyData,
        });
        return;
      }

      const records = bodyData as ExternalEmployeeRecord[];
      
      // デバッグログ: 受信したデータを確認
      console.log("受信したレコード数:", records.length);
      console.log("受信したデータ:", JSON.stringify(records, null, 2));
      const db = admin.firestore();
      const colRef = db.collection("shaho_employees");
      const now = new Date().toISOString();
      const userId = "外部API連携";

      // 社員番号を正規化（全ての空白文字を削除）
      const normalizeEmployeeNoForComparison = (employeeNo: string): string => {
        if (!employeeNo) return "";
        // 全ての空白文字（半角スペース、全角スペース、タブ、改行など）を削除
        return employeeNo.replace(/\s+/g, "").trim();
      };

      // 社員名を正規化（全ての空白文字を削除）
      const normalizeNameForComparison = (name: string): string => {
        if (!name) return "";
        // 全ての空白文字（半角スペース、全角スペース、タブ、改行など）を削除
        return name.replace(/\s+/g, "").trim();
      };

      // 社員番号と社員名の組み合わせでキーを生成
      const createEmployeeKey = (employeeNo: string, name: string): string => {
        const normalizedNo = normalizeEmployeeNoForComparison(employeeNo);
        const normalizedName = normalizeNameForComparison(name);
        return `${normalizedNo}_${normalizedName}`;
      };

      // 既存の社員データを取得
      const snapshot = await colRef.get();
      // 社員番号+社員名の組み合わせで検索するMap（更新判定用）
      const existingMap = new Map<string, { id: string; data: ShahoEmployee }>();
      // 社員番号のみで検索するMap（重複チェック用）
      const existingByEmployeeNoMap = new Map<string, { id: string; data: ShahoEmployee }>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as ShahoEmployee;
        if (data.employeeNo && data.name) {
          // 正規化した社員番号と社員名の組み合わせをキーとして使用
          const key = createEmployeeKey(data.employeeNo, data.name);
          existingMap.set(key, { id: docSnap.id, data });
          // 社員番号のみでも登録（重複チェック用）
          const normalizedNo = normalizeEmployeeNoForComparison(data.employeeNo);
          existingByEmployeeNoMap.set(normalizedNo, { id: docSnap.id, data });
        }
      });

      // 承認待ちの新規社員登録申請の社員番号を取得
      const approvalRequestsRef = db.collection("approval_requests");
      const pendingNewEmployeeRequestsSnapshot = await approvalRequestsRef
        .where("status", "==", "pending")
        .where("category", "==", "新規社員登録")
        .get();
      
      // 承認待ち中の社員番号セットを作成
      const pendingEmployeeNos = new Set<string>();
      pendingNewEmployeeRequestsSnapshot.forEach((docSnap) => {
        const request = docSnap.data();
        // employeeDiffsの社員番号をチェック
        const diffs = request.employeeDiffs || [];
        diffs.forEach((diff: any) => {
          if (diff.employeeNo) {
            const normalizedNo = normalizeEmployeeNoForComparison(diff.employeeNo);
            if (normalizedNo) {
              pendingEmployeeNos.add(normalizedNo);
            }
          }
        });
        // employeeDataの社員番号もチェック（念のため）
        const requestEmployeeNo = request.employeeData?.basicInfo?.employeeNo;
        if (requestEmployeeNo) {
          const normalizedNo = normalizeEmployeeNoForComparison(requestEmployeeNo);
          if (normalizedNo) {
            pendingEmployeeNos.add(normalizedNo);
          }
        }
      });

      const batch = db.batch();
      const errors: ExternalSyncError[] = [];
      let created = 0;
      let updated = 0;
      const payrollDataToProcess: Array<{
        employeeNo: string;
        employeeId: string;
        payrollRecord: ExternalPayrollRecord;
      }> = [];
      const dependentDataToProcess: Array<{
        employeeNo: string;
        employeeId: string;
        dependentRecords: ExternalDependentRecord[];
        hasDependent: boolean;
      }> = [];

      // 取り込みデータ内での社員番号の重複チェック
      const importEmployeeNoSet = new Map<string, number>(); // 社員番号 -> 最初に出現したインデックス
      console.log("=== 重複チェック開始 ===");
      records.forEach((record, index) => {
        const normalizedNo = normalizeEmployeeNoForComparison(`${record.employeeNo}`);
        console.log(`インデックス ${index}: 社員番号=${record.employeeNo}, 正規化後=${normalizedNo}`);
        if (normalizedNo) {
          if (importEmployeeNoSet.has(normalizedNo)) {
            const firstIndex = importEmployeeNoSet.get(normalizedNo)!;
            const errorMessage = `取り込みデータ内で社員番号 ${record.employeeNo} が重複しています。最初の出現位置: インデックス ${firstIndex}、現在の位置: インデックス ${index}。`;
            console.log(`重複エラー検出: ${errorMessage}`);
            errors.push({
              index,
              employeeNo: record.employeeNo,
              message: errorMessage,
            });
          } else {
            importEmployeeNoSet.set(normalizedNo, index);
          }
        }
      });
      console.log(`重複チェック完了: エラー数=${errors.length}`);

      // 重複エラーがある場合は、その後の処理をスキップ
      if (errors.length > 0) {
        console.log(`重複エラーが ${errors.length}件検出されました。エラーレスポンスを返します。`);
        // エラーがある場合は、バリデーションエラーも含めて返す
        const validationErrors: ExternalSyncError[] = records
          .map((record, index) => {
            const validationError = validateExternalRecord(record);
            if (validationError) {
              return {
                index,
                employeeNo: record.employeeNo,
                message: validationError,
              } as ExternalSyncError;
            }
            return null;
          })
          .filter((error): error is ExternalSyncError => error !== null);
        
        // 重複エラーとバリデーションエラーをマージ
        const allErrors = [...errors, ...validationErrors];
        
        const errorMessage = allErrors.length === 1
          ? allErrors[0].message
          : `${allErrors.length}件のエラーが発生しました。詳細はerrors配列を確認してください。`;
        
        const errorResponse = {
          error: "Bad Request",
          message: errorMessage,
          total: records.length,
          processed: 0,
          created: 0,
          updated: 0,
          errors: allErrors,
        };
        
        console.log("=== エラーレスポンス ===");
        console.log(JSON.stringify(errorResponse, null, 2));
        console.log("response.headersSent:", response.headersSent);
        
        // Content-Typeヘッダーを明示的に設定
        if (!response.headersSent) {
          response.set("Content-Type", "application/json; charset=utf-8");
          response.status(400);
          response.json(errorResponse);
          response.end();
        } else {
          console.error("警告: レスポンスヘッダーが既に送信されています");
        }
        return;
      }

      // 扶養の有無を正規化する関数（レコード処理ループの外で定義）
      const normalizeHasDependent = (value?: boolean | string | number): boolean => {
        if (value === undefined || value === null) return false;
        if (typeof value === "boolean") return value;
        const str = String(value).trim().toLowerCase();
        return str === "1" || str === "on" || str === "true" || str === "yes" || str === "有";
      };

      // 各レコードを処理
      records.forEach((record, index) => {
        const validationError = validateExternalRecord(record);
        if (validationError) {
          errors.push({
            index,
            employeeNo: record.employeeNo,
            message: validationError,
          });
          return;
        }

        // 性別の正規化
        const normalizeGender = (gender?: string): string | undefined => {
          if (!gender) return undefined;
          const normalized = gender.trim();
          if (normalized === "男" || normalized === "男性" || normalized.toLowerCase() === "male") {
            return "男";
          }
          if (normalized === "女" || normalized === "女性" || normalized.toLowerCase() === "female") {
            return "女";
          }
          return normalized;
        };

        // フラグ値の正規化
        const normalizeBoolean = (value?: boolean | string): boolean | undefined => {
          if (value === undefined || value === null) return undefined;
          if (typeof value === "boolean") return value;
          const str = String(value).trim().toLowerCase();
          return str === "1" || str === "on" || str === "true" || str === "yes";
        };

        // 文字列フィールドの正規化（空文字列をundefinedに変換）
        const normalizeString = (value?: string): string | undefined => {
          if (value === undefined || value === null) return undefined;
          const trimmed = value.trim();
          return trimmed === "" ? undefined : trimmed;
        };

        // 社員番号を正規化（全ての空白文字を削除）
        const normalizedEmployeeNo = normalizeEmployeeNoForComparison(`${record.employeeNo}`);
        // 社員名を正規化（全ての空白文字を削除）
        const normalizedName = normalizeNameForComparison(record.name);
        // 社員番号と社員名の組み合わせでキーを生成
        const employeeKey = createEmployeeKey(`${record.employeeNo}`, record.name);

        const normalized: ShahoEmployee = {
          employeeNo: normalizedEmployeeNo,
          name: normalizedName,
          kana: normalizeString(record.kana),
          gender: normalizeGender(record.gender),
          birthDate: normalizeString(record.birthDate),
          postalCode: normalizeString(record.postalCode),
          address: normalizeString(record.address),
          department: normalizeString(record.department),
          workPrefecture: normalizeString(record.workPrefecture),
          personalNumber: normalizeString(record.personalNumber),
          basicPensionNumber: normalizeString(record.basicPensionNumber),
          healthStandardMonthly:
          record.healthStandardMonthly !== undefined && record.healthStandardMonthly !== null
          ? Number(record.healthStandardMonthly)
              : undefined,
              welfareStandardMonthly:
              record.welfareStandardMonthly !== undefined &&
              record.welfareStandardMonthly !== null
                ? Number(record.welfareStandardMonthly)
              : undefined,
          healthInsuredNumber: normalizeString(record.healthInsuredNumber),
          pensionInsuredNumber: normalizeString(record.pensionInsuredNumber),
          healthAcquisition: normalizeString(record.healthAcquisition),
          pensionAcquisition: normalizeString(record.pensionAcquisition),
          currentLeaveStatus: normalizeString(record.currentLeaveStatus),
          currentLeaveStartDate: normalizeString(record.currentLeaveStartDate),
          currentLeaveEndDate: normalizeString(record.currentLeaveEndDate),
          careSecondInsured: normalizeBoolean(record.careSecondInsured),
          exemption: normalizeBoolean(record.exemption),
          hasDependent: normalizeHasDependent(record.hasDependent),
        };

        const cleanedData = removeUndefinedFields(normalized);
        
        // デバッグログ: 正規化後のデータを確認
        console.log(`社員番号 ${normalizedEmployeeNo}、社員名 ${normalizedName} の正規化後データ:`, JSON.stringify(cleanedData, null, 2));
        
        // まず社員番号のみで既存データを検索（重複チェック）
        const existingByEmployeeNo = existingByEmployeeNoMap.get(normalizedEmployeeNo);
        
        if (existingByEmployeeNo) {
          // 社員番号が存在する場合、社員名も一致するかチェック
          const existingNormalizedName = normalizeNameForComparison(existingByEmployeeNo.data.name || "");
          
          if (normalizedName !== existingNormalizedName) {
            // 社員番号は一致するが社員名が異なる場合はエラー
            errors.push({
              index,
              employeeNo: record.employeeNo,
              message: `社員番号 ${record.employeeNo} は既に登録されていますが、社員名が異なります。既存の社員名: ${existingByEmployeeNo.data.name}、取込データの社員名: ${record.name}。同じ社員番号の社員は同時に存在できません。`,
            });
            return;
          }
          
          // 社員番号と社員名が両方一致する場合は更新処理へ進む
        }

        // 社員番号と社員名の組み合わせで既存データを検索（更新処理）
        const existing = existingMap.get(employeeKey);

        if (existing) {
          const targetRef = colRef.doc(existing.id);
          
          // デバッグログ: 更新前の既存データを確認
          console.log(`社員番号 ${normalizedEmployeeNo}、社員名 ${normalizedName} の既存データ:`, JSON.stringify(existing.data, null, 2));
          
          // 更新データを準備（merge: trueを使用するため、送信されたフィールドのみを更新）
          const updateData = {
            ...cleanedData,
            updatedAt: now,
            updatedBy: userId,
            approvedBy: "外部API連携",
          };
          
          // デバッグログ: 更新データを確認
          console.log(`社員番号 ${normalizedEmployeeNo}、社員名 ${normalizedName} の更新データ:`, JSON.stringify(updateData, null, 2));
          
          batch.set(
            targetRef,
            updateData,
            { merge: true }
          );
          updated += 1;

          // 給与データを処理
          if (
            record.payrolls &&
            Array.isArray(record.payrolls) &&
            record.payrolls.length > 0
          ) {
            record.payrolls.forEach((payrollRecord) => {
              // 月給データがあるかどうか（amountまたはworkedDaysが存在する）
              const hasMonthlyData = payrollRecord.amount !== undefined || payrollRecord.workedDays !== undefined;
              
              // 賞与データがあるかどうか（bonusPaidOn、bonusTotalのいずれかが存在する）
              const hasBonusData = !!(payrollRecord.bonusPaidOn || payrollRecord.bonusTotal);
              
              // 月給データの年月を取得
              let monthlyYearMonth: string | undefined = payrollRecord.yearMonth;
              
              // 賞与データの年月を取得（bonusPaidOnから抽出）
              let bonusYearMonth: string | undefined;
              if (payrollRecord.bonusPaidOn) {
                try {
                  const bonusDate = new Date(payrollRecord.bonusPaidOn.replace(/\//g, "-"));
                  if (!isNaN(bonusDate.getTime())) {
                    const year = bonusDate.getFullYear();
                    const month = String(bonusDate.getMonth() + 1).padStart(2, "0");
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
                  message: "月給データがありますが、yearMonthが指定されていません",
                });
              }
              
              // 賞与データがある場合、bonusPaidOnが必須
              if (hasBonusData && !bonusYearMonth) {
                errors.push({
                  index,
                  employeeNo: record.employeeNo,
                  message: "賞与データがありますが、bonusPaidOnが指定されていないか、無効な日付です",
                });
              }
              
              // 月給データも賞与データもない場合はスキップ
              if (!hasMonthlyData && !hasBonusData) {
                return;
              }
              
              // 月給データを保存
              if (hasMonthlyData && monthlyYearMonth) {
                payrollDataToProcess.push({
                  employeeNo: normalizedEmployeeNo,
                  employeeId: existing.id,
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
                  employeeNo: normalizedEmployeeNo,
                  employeeId: existing.id,
                  payrollRecord: {
                    yearMonth: bonusYearMonth,
                    bonusPaidOn: payrollRecord.bonusPaidOn,
                    bonusTotal: payrollRecord.bonusTotal,
                    standardHealthBonus: payrollRecord.standardHealthBonus,
                    standardWelfareBonus: payrollRecord.standardWelfareBonus,
                    // 月給データは含めない
                  },
                });
              }
            });
          }

          // 扶養情報を処理
          const hasDependent = normalizeHasDependent(record.hasDependent);
          if (record.dependents && Array.isArray(record.dependents) && record.dependents.length > 0) {
            dependentDataToProcess.push({
              employeeNo: normalizedEmployeeNo,
              employeeId: existing.id,
              dependentRecords: record.dependents,
              hasDependent,
            });
          } else if (hasDependent === false) {
            // 扶養の有無が明示的にfalseの場合は、既存の扶養情報を削除するために追加
            dependentDataToProcess.push({
              employeeNo: normalizedEmployeeNo,
              employeeId: existing.id,
              dependentRecords: [],
              hasDependent: false,
            });
          }
        } else {
          // 新規登録の場合：承認待ちの新規社員登録申請の社員番号をチェック
          if (pendingEmployeeNos.has(normalizedEmployeeNo)) {
            errors.push({
              index,
              employeeNo: record.employeeNo,
              message: `社員番号 ${record.employeeNo} は承認待ちの新規社員登録申請で既に使用されています。既存の申請が承認または差し戻しされるまで、新しい登録はできません。`,
            });
            return;
          }

          const targetRef = colRef.doc();
          batch.set(targetRef, {
            ...cleanedData,
            createdAt: now,
            updatedAt: now,
            createdBy: userId,
            updatedBy: userId,
            approvedBy: "外部API連携",
          });
          created += 1;

          // 新規作成の場合は、給与データを後で処理するために保存
          if (
            record.payrolls &&
            Array.isArray(record.payrolls) &&
            record.payrolls.length > 0
          ) {
            record.payrolls.forEach((payrollRecord) => {
              // 月給データがあるかどうか（amountまたはworkedDaysが存在する）
              const hasMonthlyData = payrollRecord.amount !== undefined || payrollRecord.workedDays !== undefined;
              
              // 賞与データがあるかどうか（bonusPaidOn、bonusTotalのいずれかが存在する）
              const hasBonusData = !!(payrollRecord.bonusPaidOn || payrollRecord.bonusTotal);
              
              // 月給データの年月を取得
              let monthlyYearMonth: string | undefined = payrollRecord.yearMonth;
              
              // 賞与データの年月を取得（bonusPaidOnから抽出）
              let bonusYearMonth: string | undefined;
              if (payrollRecord.bonusPaidOn) {
                try {
                  const bonusDate = new Date(payrollRecord.bonusPaidOn.replace(/\//g, "-"));
                  if (!isNaN(bonusDate.getTime())) {
                    const year = bonusDate.getFullYear();
                    const month = String(bonusDate.getMonth() + 1).padStart(2, "0");
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
                  message: "月給データがありますが、yearMonthが指定されていません",
                });
              }
              
              // 賞与データがある場合、bonusPaidOnが必須
              if (hasBonusData && !bonusYearMonth) {
                errors.push({
                  index,
                  employeeNo: record.employeeNo,
                  message: "賞与データがありますが、bonusPaidOnが指定されていないか、無効な日付です",
                });
              }
              
              // 月給データも賞与データもない場合はスキップ
              if (!hasMonthlyData && !hasBonusData) {
                return;
              }
              
              // 月給データを保存
              if (hasMonthlyData && monthlyYearMonth) {
                payrollDataToProcess.push({
                  employeeNo: normalizedEmployeeNo,
                  employeeId: targetRef.id,
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
                  employeeNo: normalizedEmployeeNo,
                  employeeId: targetRef.id,
                  payrollRecord: {
                    yearMonth: bonusYearMonth,
                    bonusPaidOn: payrollRecord.bonusPaidOn,
                    bonusTotal: payrollRecord.bonusTotal,
                    standardHealthBonus: payrollRecord.standardHealthBonus,
                    standardWelfareBonus: payrollRecord.standardWelfareBonus,
                    // 月給データは含めない
                  },
                });
              }
            });
          }

          // 扶養情報を処理
          const hasDependent = normalizeHasDependent(record.hasDependent);
          if (record.dependents && Array.isArray(record.dependents) && record.dependents.length > 0) {
            dependentDataToProcess.push({
              employeeNo: normalizedEmployeeNo,
              employeeId: targetRef.id,
              dependentRecords: record.dependents,
              hasDependent,
            });
          } else if (hasDependent === false) {
            // 扶養の有無が明示的にfalseの場合は、既存の扶養情報を削除するために追加
            dependentDataToProcess.push({
              employeeNo: normalizedEmployeeNo,
              employeeId: targetRef.id,
              dependentRecords: [],
              hasDependent: false,
            });
          }
        }
      });

      // 社員データをコミット
      if (created + updated > 0) {
        console.log(`コミット前: created=${created}, updated=${updated}`);
        await batch.commit();
        console.log("コミット完了");

        // コミット後に保存されたデータを確認
        const updatedRecords = records.filter((record) => {
          const validationError = validateExternalRecord(record);
          return !validationError;
        });
        
        for (const record of updatedRecords) {
          const normalizedEmployeeNo = normalizeEmployeeNoForComparison(`${record.employeeNo}`);
          const normalizedName = normalizeNameForComparison(record.name);
          // 正規化した社員番号と社員名で検索（DBに保存されている値も正規化されている前提）
          const employeeDoc = await colRef
            .where("employeeNo", "==", normalizedEmployeeNo)
            .where("name", "==", normalizedName)
            .limit(1)
            .get();
          if (!employeeDoc.empty) {
            const savedData = employeeDoc.docs[0].data() as ShahoEmployee;
            console.log(`社員番号 ${normalizedEmployeeNo}、社員名 ${normalizedName} の保存後データ:`, JSON.stringify(savedData, null, 2));
          }
        }

        // 新規作成した社員のIDを取得
        if (created > 0) {
          const updatedSnapshot = await colRef.get();
          updatedSnapshot.forEach((docSnap) => {
            const data = docSnap.data() as ShahoEmployee;
            if (data.employeeNo && data.name) {
              const key = createEmployeeKey(data.employeeNo, data.name);
              if (!existingMap.has(key)) {
                existingMap.set(key, {
                  id: docSnap.id,
                  data,
                });
              }
            }
          });
        }
      }

      // 給与データを保存（新しい構造を使用）
      const payrollPromises: Promise<any>[] = [];
      payrollDataToProcess.forEach(({ employeeId, payrollRecord }) => {
        payrollPromises.push(
          (async () => {
            const db = admin.firestore();
            const yyyymm = payrollRecord.yearMonth.replace("-", ""); // 2025-04 -> 202504

            await db.runTransaction(async (transaction) => {
              // 月次ドキュメントの参照
              const payrollMonthRef = db
                .collection("shaho_employees")
                .doc(employeeId)
                .collection("payrollMonths")
                .doc(yyyymm);

              // 既存の月次ドキュメントを取得
              const payrollMonthSnap = await transaction.get(payrollMonthRef);
              const existingPayrollMonth = payrollMonthSnap.exists
                ? (payrollMonthSnap.data() as PayrollMonth)
                : undefined;

              // 賞与データがある場合
              if (payrollRecord.bonusPaidOn && payrollRecord.bonusTotal !== undefined) {
                // 既存の賞与明細を取得してID生成に使用
                const bonusPaymentsRef = db
                  .collection("shaho_employees")
                  .doc(employeeId)
                  .collection("payrollMonths")
                  .doc(yyyymm)
                  .collection("bonusPayments");
                const bonusPaymentsSnap = await bonusPaymentsRef.get();
                const existingBonusIds = bonusPaymentsSnap.docs.map((d) => d.id);

                // bonusPaymentIdを生成
                const bonusPaymentId = generateBonusPaymentId(
                  undefined, // sourcePaymentIdは外部APIから来ない想定
                  payrollRecord.bonusPaidOn,
                  payrollRecord.bonusTotal,
                  existingBonusIds,
                );

                // 賞与明細ドキュメントの参照
                const bonusPaymentRef = bonusPaymentsRef.doc(bonusPaymentId);

                // 既存の賞与明細を取得
                const bonusPaymentSnap = await transaction.get(bonusPaymentRef);
                const existingBonusPayment = bonusPaymentSnap.exists
                  ? (bonusPaymentSnap.data() as BonusPayment)
                  : undefined;

                // 賞与明細を保存
                const bonusPayment: any = {
                  id: bonusPaymentId,
                  bonusPaidOn: payrollRecord.bonusPaidOn,
                  bonusTotal: payrollRecord.bonusTotal,
                  updatedAt: now,
                  updatedBy: userId,
                  createdAt: existingBonusPayment?.createdAt || now,
                  createdBy: existingBonusPayment?.createdBy || userId,
                  approvedBy: "外部API連携",
                };

                // undefinedのフィールドを除外
                if (payrollRecord.standardHealthBonus !== undefined && payrollRecord.standardHealthBonus !== null) {
                  bonusPayment.standardHealthBonus = payrollRecord.standardHealthBonus;
                }
                if (payrollRecord.standardWelfareBonus !== undefined && payrollRecord.standardWelfareBonus !== null) {
                  bonusPayment.standardWelfareBonus = payrollRecord.standardWelfareBonus;
                }

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
                  existingBonusTotal - oldBonusTotal + payrollRecord.bonusTotal;
                const newStandardHealthBonusTotal =
                  existingStandardHealthBonusTotal -
                  oldStandardHealthBonus +
                  (payrollRecord.standardHealthBonus || 0);
                const newStandardWelfareBonusTotal =
                  existingStandardWelfareBonusTotal -
                  oldStandardWelfareBonus +
                  (payrollRecord.standardWelfareBonus || 0);

                // 月次ドキュメントを保存
                const payrollMonth: any = {
                  id: yyyymm,
                  yearMonth: payrollRecord.yearMonth,
                  monthlyBonusTotal: newBonusTotal,
                  monthlyStandardHealthBonusTotal: newStandardHealthBonusTotal,
                  monthlyStandardWelfareBonusTotal: newStandardWelfareBonusTotal,
                  monthlyStandardBonusTotal:
                    newStandardHealthBonusTotal + newStandardWelfareBonusTotal,
                  updatedAt: now,
                  updatedBy: userId,
                  createdAt: existingPayrollMonth?.createdAt || now,
                  createdBy: existingPayrollMonth?.createdBy || userId,
                  approvedBy: "外部API連携",
                };

                // undefinedのフィールドを除外
                if (payrollRecord.amount !== undefined && payrollRecord.amount !== null) {
                  payrollMonth.amount = payrollRecord.amount;
                }
                if (payrollRecord.workedDays !== undefined && payrollRecord.workedDays !== null) {
                  payrollMonth.workedDays = payrollRecord.workedDays;
                }

                transaction.set(payrollMonthRef, payrollMonth, { merge: true });
              } else {
                // 月給データのみの場合
                const payrollMonth: any = {
                  id: yyyymm,
                  yearMonth: payrollRecord.yearMonth,
                  updatedAt: now,
                  updatedBy: userId,
                  createdAt: existingPayrollMonth?.createdAt || now,
                  createdBy: existingPayrollMonth?.createdBy || userId,
                  approvedBy: "外部API連携",
                };

                // undefinedのフィールドを除外
                if (payrollRecord.amount !== undefined && payrollRecord.amount !== null) {
                  payrollMonth.amount = payrollRecord.amount;
                }
                if (payrollRecord.workedDays !== undefined && payrollRecord.workedDays !== null) {
                  payrollMonth.workedDays = payrollRecord.workedDays;
                }

                transaction.set(payrollMonthRef, payrollMonth, { merge: true });
              }
            });
          })(),
        );
      });

      if (payrollPromises.length > 0) {
        await Promise.all(payrollPromises);
      }

      // 扶養情報を保存
      const dependentPromises: Promise<any>[] = [];
      dependentDataToProcess.forEach(({ employeeId, dependentRecords, hasDependent }) => {
        dependentPromises.push(
          (async () => {
            const db = admin.firestore();
            const dependentsRef = db
              .collection("shaho_employees")
              .doc(employeeId)
              .collection("dependents");

            // 既存の扶養家族情報を削除
            const existingDependentsSnap = await dependentsRef.get();
            const deletePromises = existingDependentsSnap.docs.map((doc) => doc.ref.delete());
            await Promise.all(deletePromises);

            // 扶養の有無がfalseの場合は削除のみで終了
            if (hasDependent === false || dependentRecords.length === 0) {
              return;
            }

            // 新しい扶養家族情報を追加
            const addPromises = dependentRecords.map((dependentRecord) => {
              // ブール値変換ヘルパー関数
              const toBoolean = (
                value: boolean | string | number | undefined,
              ): boolean | undefined => {
                if (value === undefined || value === null) return undefined;
                if (typeof value === "boolean") return value;
                const normalized = String(value).toLowerCase().trim();
                if (
                  normalized === "1" ||
                  normalized === "true" ||
                  normalized === "on" ||
                  normalized === "yes" ||
                  normalized === "有"
                ) {
                  return true;
                }
                if (
                  normalized === "0" ||
                  normalized === "false" ||
                  normalized === "off" ||
                  normalized === "no" ||
                  normalized === "無"
                ) {
                  return false;
                }
                return undefined;
              };

              // 文字列フィールドの正規化
              const normalizeString = (value?: string): string | undefined => {
                if (value === undefined || value === null) return undefined;
                const trimmed = value.trim();
                return trimmed === "" ? undefined : trimmed;
              };

              // 数値フィールドの正規化
              const normalizeNumber = (value?: number | string): number | undefined => {
                if (value === undefined || value === null) return undefined;
                if (typeof value === "number") return value;
                const num = Number(value);
                return isNaN(num) ? undefined : num;
              };

              const dependentData: any = {
                relationship: normalizeString(dependentRecord.relationship),
                nameKanji: normalizeString(dependentRecord.nameKanji),
                nameKana: normalizeString(dependentRecord.nameKana),
                birthDate: normalizeString(dependentRecord.birthDate),
                gender: normalizeString(dependentRecord.gender),
                personalNumber: normalizeString(dependentRecord.personalNumber),
                basicPensionNumber: normalizeString(dependentRecord.basicPensionNumber),
                cohabitationType: normalizeString(dependentRecord.cohabitationType),
                address: normalizeString(dependentRecord.address),
                occupation: normalizeString(dependentRecord.occupation),
                annualIncome: normalizeNumber(dependentRecord.annualIncome),
                dependentStartDate: normalizeString(dependentRecord.dependentStartDate),
                thirdCategoryFlag: toBoolean(dependentRecord.thirdCategoryFlag),
                createdAt: now,
                updatedAt: now,
                createdBy: userId,
                updatedBy: userId,
                approvedBy: "外部API連携",
              };

              // undefinedのフィールドを除外
              const cleanedDependent = removeUndefinedFields(dependentData);

              return dependentsRef.add(cleanedDependent);
            });

            await Promise.all(addPromises);
          })(),
        );
      });

      if (dependentPromises.length > 0) {
        await Promise.all(dependentPromises);
      }

      const result: ExternalSyncResult = {
        total: records.length,
        processed: created + updated,
        created,
        updated,
        errors,
      };

      console.log("=== 処理完了 ===");
      console.log("結果:", JSON.stringify(result, null, 2));
      
      // エラーがある場合は部分的な成功として200を返すが、エラーメッセージを含める
      if (errors.length > 0) {
        const errorMessage = errors.length === 1
          ? errors[0].message
          : `${errors.length}件のエラーが発生しましたが、一部のデータは処理されました。詳細はerrors配列を確認してください。`;
        response.status(200).json({
          ...result,
          message: errorMessage,
          hasErrors: true,
        });
      } else {
        response.status(200).json({
          ...result,
          message: "すべてのデータが正常に処理されました。",
          hasErrors: false,
        });
      }
    } catch (error) {
      console.error("=== エラーが発生しました ===");
      console.error("エラータイプ:", typeof error);
      console.error("エラーオブジェクト:", error);
      if (error instanceof Error) {
        console.error("エラーメッセージ:", error.message);
        console.error("エラースタック:", error.stack);
      }
      response.status(500).json({
        error: "Internal Server Error",
        message: "サーバー内部でエラーが発生しました。",
        details: error instanceof Error ? error.message : "Unknown error",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  }
);

/**
 * bonusPaymentIdを生成（決定的ID）
 */
function generateBonusPaymentId(
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
  const dateStr = bonusPaidOn.replace(/\//g, "-").split("T")[0]; // YYYY-MM-DD形式を想定
  const yyyymmdd = dateStr.replace(/-/g, "").substring(0, 8); // YYYYMMDD

  // 既存のIDから同日のIDを抽出してseqを決定
  const sameDayIds = existingIds.filter((id) => id.startsWith(yyyymmdd));
  const seq = sameDayIds.length + 1;

  // YYYYMMDD-{amount}-{seq} 形式
  return `${yyyymmdd}-${bonusTotal}-${seq}`;
}

/**
 * 指定範囲の給与データを取得するヘルパー（後方互換性のため）
 * 新しい構造から取得を試み、なければ古い構造から取得
 */
async function fetchPayrolls(
  employeeId: string,
  startMonth?: string,
  endMonth?: string
): Promise<PayrollData[]> {
  const db = admin.firestore();
  
  // 新しい構造から取得を試みる
  const payrollMonthsRef = db
    .collection("shaho_employees")
    .doc(employeeId)
    .collection("payrollMonths");

  let payrollMonthsQuery:
    | admin.firestore.Query<admin.firestore.DocumentData>
    | admin.firestore.CollectionReference<admin.firestore.DocumentData> = payrollMonthsRef;

  // 範囲指定がある場合はIDでソート＋絞り込み
  if (startMonth || endMonth) {
    payrollMonthsQuery = payrollMonthsQuery.orderBy("id");
    if (startMonth) {
      const startYYYYMM = startMonth.replace("-", "");
      payrollMonthsQuery = payrollMonthsQuery.where("id", ">=", startYYYYMM);
    }
    if (endMonth) {
      const endYYYYMM = endMonth.replace("-", "");
      payrollMonthsQuery = payrollMonthsQuery.where("id", "<=", endYYYYMM);
    }
  }

  const payrollMonthsSnapshot = await payrollMonthsQuery.get();
  
  if (!payrollMonthsSnapshot.empty) {
    // 新しい構造から取得
    const payrollDataPromises = payrollMonthsSnapshot.docs.map(async (docSnap) => {
      const payrollMonth = docSnap.data() as PayrollMonth;
      
      // 賞与明細を取得
      const bonusPaymentsRef = docSnap.ref.collection("bonusPayments");
      const bonusPaymentsSnapshot = await bonusPaymentsRef.orderBy("bonusPaidOn", "desc").get();
      const firstBonus = bonusPaymentsSnapshot.docs.length > 0
        ? bonusPaymentsSnapshot.docs[0].data() as BonusPayment
        : undefined;

      // PayrollData形式に変換
      const payrollData: PayrollData = {
        id: payrollMonth.id,
        yearMonth: payrollMonth.yearMonth,
        workedDays: payrollMonth.workedDays,
        amount: payrollMonth.amount,
        healthInsuranceMonthly: payrollMonth.healthInsuranceMonthly,
        careInsuranceMonthly: payrollMonth.careInsuranceMonthly,
        pensionMonthly: payrollMonth.pensionMonthly,
        bonusPaidOn: firstBonus?.bonusPaidOn,
        bonusTotal: firstBonus?.bonusTotal,
        standardHealthBonus: firstBonus?.standardHealthBonus,
        standardWelfareBonus: firstBonus?.standardWelfareBonus,
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
    });

    return Promise.all(payrollDataPromises);
  }

  // 新しい構造にない場合は古い構造から取得
  const payrollRef = db
    .collection("shaho_employees")
    .doc(employeeId)
    .collection("payrolls");

  let payrollQuery:
    | admin.firestore.Query<admin.firestore.DocumentData>
    | admin.firestore.CollectionReference<admin.firestore.DocumentData> = payrollRef;

  // 範囲指定がある場合は年月でソート＋絞り込み
  if (startMonth || endMonth) {
    payrollQuery = payrollQuery.orderBy("yearMonth");
    if (startMonth) {
      payrollQuery = payrollQuery.where("yearMonth", ">=", startMonth);
    }
    if (endMonth) {
      payrollQuery = payrollQuery.where("yearMonth", "<=", endMonth);
    }
  }

  const snapshot = await payrollQuery.get();
  return snapshot.docs.map(
    (docSnap: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>) => {
      const data = docSnap.data() as PayrollData;
      return {
        ...data,
        id: docSnap.id,
      };
    }
  );
}

/**
 * 扶養家族情報を取得するヘルパー
 */
async function fetchDependents(
  employeeId: string
): Promise<DependentData[]> {
  const db = admin.firestore();
  const dependentsRef = db
    .collection("shaho_employees")
    .doc(employeeId)
    .collection("dependents")
    .orderBy("createdAt", "asc");

  const snapshot = await dependentsRef.get();
  return snapshot.docs.map(
    (docSnap: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>) => {
      const data = docSnap.data() as DependentData;
      return {
        ...data,
        id: docSnap.id,
      };
    }
  );
}

/**
 * CSV出力相当のデータをJSONで提供するエンドポイント
 * GET /api/export/csv-data
 * クエリ: department, workPrefecture, payrollStartMonth, payrollEndMonth,
 *        includeCalculation=true|false, calculationId, calculationLimit
 */
export const exportCsvData = functions.https.onRequest(
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.set(
      "Access-Control-Allow-Headers",
      "Content-Type, X-API-Key, Authorization"
    );

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (request.method !== "GET") {
      response.status(405).json({
        error: "Method not allowed. Only GET is supported.",
      });
      return;
    }

    // APIキー検証（既存と同じヘッダーを使用）
    const apiKeyValid = validateApiKey(request);
    if (!apiKeyValid) {
      response.status(401).json({
        error: "Unauthorized. Invalid or missing API key.",
      });
      return;
    }

    // フィルタパラメータ
    const department = request.query.department as string | undefined;
    const workPrefecture = request.query.workPrefecture as string | undefined;
    const payrollStartMonth = request.query
      .payrollStartMonth as string | undefined;
    const payrollEndMonth = request.query.payrollEndMonth as string | undefined;

    // 計算結果の含有制御
    const includeCalculation =
      (request.query.includeCalculation as string | undefined)?.toLowerCase() ===
      "true";
    const calculationId = request.query.calculationId as string | undefined;
    const calculationLimit = Math.min(
      Number.isNaN(Number(request.query.calculationLimit))
        ? 10
        : Number(request.query.calculationLimit ?? 10),
      50
    ); // 過大レスポンス抑制

    try {
      const db = admin.firestore();
      const employeesSnapshot = await db.collection("shaho_employees").get();

      const employeesWithPayrolls: Array<
        ShahoEmployee & { payrolls: PayrollData[]; dependents: DependentData[] }
      > = [];

      for (const docSnap of employeesSnapshot.docs) {
        const data = docSnap.data() as ShahoEmployee;

        // 部署／勤務地フィルタ（空や"__ALL__"は素通し）
        if (
          department &&
          department !== "__ALL__" &&
          data.department !== department
        ) {
          continue;
        }
        if (
          workPrefecture &&
          workPrefecture !== "__ALL__" &&
          data.workPrefecture !== workPrefecture
        ) {
          continue;
        }

        const payrolls = await fetchPayrolls(
          docSnap.id,
          payrollStartMonth,
          payrollEndMonth
        );

        const dependents = await fetchDependents(docSnap.id);

        employeesWithPayrolls.push({
          ...data,
          id: docSnap.id,
          payrolls,
          dependents,
        });
      }

      // 計算結果履歴（必要な場合のみ）
      let calculationHistory:
        | admin.firestore.DocumentData[]
        | undefined = undefined;

      if (includeCalculation) {
        if (calculationId) {
          const docRef = db
            .collection("calculation_result_history")
            .doc(calculationId);
          const snap = await docRef.get();
          if (snap.exists) {
            calculationHistory = [{ id: snap.id, ...snap.data() }];
          } else {
            calculationHistory = [];
          }
        } else {
          const historyQuery = db
            .collection("calculation_result_history")
            .orderBy("createdAt", "desc")
            .limit(Math.max(calculationLimit, 1));
          const snap = await historyQuery.get();
          calculationHistory = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
        }
      }

      response.status(200).json({
        employees: employeesWithPayrolls,
        calculationHistory,
      });
    } catch (error) {
      console.error("exportCsvData error", error);
      response.status(500).json({
        error: "Internal Server Error",
        message: "サーバー内部でエラーが発生しました。",
        details: error instanceof Error ? error.message : "Unknown error",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  }
);
