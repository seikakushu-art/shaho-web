export enum RoleKey {
  SystemAdmin = 'systemAdmin',
  Approver = 'approver',
  Operator = 'operator',
  Guest = 'guest',
}

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  summary: string;
  responsibilities: string[];
  restrictions?: string[];
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: RoleKey.SystemAdmin,
    name: 'システム管理者',
    summary: 'ユーザー・ロールの全権管理とシステム運用を統括',
    responsibilities: [
      'ユーザー管理（アカウント登録、ロール付与／剥奪）の承認と実行',
      '法人情報・保険料率などシステム設定／マスタの更新',
      '承認フロー定義の管理と代行承認・再実行',
      '監査ログ・セキュリティポリシーの維持',
    ],
    restrictions: ['なし（全操作可能）'],
  },
  {
    key: RoleKey.Approver,
    name: '承認者',
    summary: '計算・マスタ変更の承認フローを統括',
    responsibilities: [
      '社員マスタ・計算結果・設定変更の承認／差戻し',
      '添付資料・履歴を確認したうえでの意思決定',
      '承認結果の通知と後続ステップへの引き継ぎ',
    ],
    restrictions: [
      '新規申請・データ更新の実行は不可',
      'ユーザー管理やマスタ設定の変更は不可',
    ],
  },
  {
    key: RoleKey.Operator,
    name: '担当者',
    summary: '日常の入力・計算と承認依頼の起票を実施',
    responsibilities: [
      '社員データの入力・インポート・計算実行の下書き作成',
      '承認依頼の起票と進捗確認',
      '承認済み結果の確認・CSV出力',
    ],
    restrictions: ['承認／差戻し操作は不可', 'システム設定・ロール管理は不可'],
  },
  {
    key: RoleKey.Guest,
    name: 'ゲスト',
    summary: 'データ閲覧のみ可能な閲覧専用ロール',
    responsibilities: ['申請一覧・社員データなど公開範囲の閲覧'],
    restrictions: ['編集・承認・設定変更・申請起票は不可'],
  },
];
