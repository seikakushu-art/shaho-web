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
    summary: 'ユーザー・ロールの全権管理を担当',
    responsibilities: [
      'ユーザー管理（アカウント登録、ロール付与／剥奪）',
      'セキュリティポリシー・監査ログの管理',
      'システム設定・メンテナンスの実施',
    ],
  },
  {
    key: RoleKey.Approver,
    name: '承認者',
    summary: '計算・マスタ変更の承認フローを統括',
    responsibilities: [
      '社員マスタ変更の承認／差戻し',
      '保険料率変更の承認／差戻し',
      '大量計算・データ更新の承認／差戻し',
    ],
  },
  {
    key: RoleKey.Operator,
    name: '担当者',
    summary: '日常の入力・計算と承認依頼の起票を実施',
    responsibilities: [
      'データ入力・インポート・計算実行の案（下書き）作成',
      '承認依頼の起票',
      '承認済み結果の確認・出力',
    ],
  },
  {
    key: RoleKey.Guest,
    name: 'ゲスト',
    summary: 'データ閲覧のみ可能な閲覧専用ロール',
    responsibilities: ['アプリ上のデータ閲覧'],
    restrictions: ['編集・承認・設定変更は不可'],
  },
];