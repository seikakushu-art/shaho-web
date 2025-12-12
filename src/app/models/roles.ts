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
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: RoleKey.SystemAdmin,
    name: 'システム管理者',
    summary: 'ユーザー・ロールの全権管理と法人情報・保険料率の管理',
  },
  {
    key: RoleKey.Approver,
    name: '承認者',
    summary: '計算結果・マスタ変更の承認、必要に応じて申請起票',
  },
  {
    key: RoleKey.Operator,
    name: '担当者',
    summary: '社員データの入力・保険料計算、承認依頼の起票を実施',
  },
  {
    key: RoleKey.Guest,
    name: 'ゲスト',
    summary: 'データ閲覧のみ可能な閲覧専用ロール',
  },
];
