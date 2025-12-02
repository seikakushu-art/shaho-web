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
```
