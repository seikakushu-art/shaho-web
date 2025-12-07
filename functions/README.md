# Firebase Functions

外部システムから社員データを受け取るAPIエンドポイントを提供します。

## セットアップ

```bash
cd functions
npm install
```

## 開発

```bash
npm run serve
```

## デプロイ

```bash
npm run deploy
```

## APIキーの設定

Firebase Functionsの環境変数にAPIキーを設定します：

```bash
firebase functions:config:set api.key="your-api-key-here"
```

## エンドポイント

### POST /api/employees/webhook

外部システムから社員データを受け取るエンドポイントです。

#### リクエストヘッダー

- `Content-Type: application/json`
- `X-API-Key: your-api-key` または `Authorization: Bearer your-api-key`

#### リクエストボディ

```json
[
  {
    "employeeNo": "202501",
    "name": "佐藤 花子",
    "department": "営業部",
    "workPrefecture": "東京都",
    "standardMonthly": 450000,
    "birthDate": "1990-01-02",
    "payrolls": [
      {
        "yearMonth": "2025-04",
        "amount": 450000,
        "workedDays": 20
      }
    ]
  }
]
```

#### レスポンス

```json
{
  "total": 1,
  "processed": 1,
  "created": 1,
  "updated": 0,
  "errors": []
}

### GET /api/export/csv-data

CSV出力画面で取得できる社員・給与・計算結果相当のデータをJSONで返します。

#### リクエストヘッダー

- `Content-Type: application/json`
- `X-API-Key: your-api-key` または `Authorization: Bearer your-api-key`

#### クエリパラメータ

- `department` / `workPrefecture`: 部署・勤務地で絞り込み。`__ALL__` または未指定で全件。
- `payrollStartMonth` / `payrollEndMonth`: 給与履歴の年月範囲（例: `2024-04`）。
- `includeCalculation` : `true` のとき計算結果履歴も返却。
- `calculationId` : 特定の計算結果IDを指定する場合。
- `calculationLimit` : 計算結果を複数取得する際の件数上限（デフォルト10、最大50）。

#### レスポンス例

```json
{
  "employees": [
    {
      "id": "abc123",
      "employeeNo": "202501",
      "name": "佐藤 花子",
      "department": "営業部",
      "workPrefecture": "東京都",
      "standardMonthly": 450000,
      "payrolls": [
        {
          "id": "2025-04",
          "yearMonth": "2025-04",
          "amount": 450000,
          "workedDays": 20,
          "bonusPaidOn": "2025-06-25",
          "bonusTotal": 300000
        }
      ]
    }
  ],
  "calculationHistory": [
    {
      "id": "calc-123",
      "title": "BONUS",
      "createdAt": "2025-04-10T12:00:00Z",
      "rows": [
        { "employeeNo": "202501", "standardMonthly": 450000 }
      ]
    }
  ]
}
```
```
