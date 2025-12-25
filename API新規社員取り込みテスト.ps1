$API_KEY = "receiveEmployees_8Jf90sLqP9xZ0kM"
$ENDPOINT_URL = "https://us-central1-kensyu10115.cloudfunctions.net/receiveEmployees"

$employeeData = @'
[
  {
    "employeeNo": "202501",
    "name": "山田 太郎",
    "kana": "ヤマダ タロウ",
    "gender": "男",
    "birthDate": "1990-05-15",
    "postalCode": "100-0001",
    "address": "東京都千代田区千代田1-1",
    "currentAddress": "東京都千代田区千代田1-1",
    "department": "営業部",
    "workPrefecture": "東京都",
    "personalNumber": "1234567890123",
    "basicPensionNumber": "123456789012",
    "healthStandardMonthly": 450000,
    "welfareStandardMonthly": 450000,
    "healthInsuredNumber": "12345678",
    "pensionInsuredNumber": "12345678",
    "healthAcquisition": "2025-01-01",
    "pensionAcquisition": "2025-01-01",
    "careSecondInsured": true,
    "currentLeaveStatus": "なし",
    "hasDependent": true,
    "dependents": [
      {
        "relationship": "配偶者",
        "nameKanji": "山田 花子",
        "nameKana": "ヤマダ ハナコ",
        "birthDate": "1992-08-20",
        "gender": "女",
        "personalNumber": "9876543210987",
        "cohabitationType": "同居",
        "annualIncome": 0,
        "dependentStartDate": "2020-04-01",
        "thirdCategoryFlag": true
      }
    ],
    "payrolls": [
      {
        "yearMonth": "2025-04",
        "amount": 450000,
        "workedDays": 20
      },
      {
        "yearMonth": "2025-05",
        "bonusPaidOn": "2025-05-15",
        "bonusTotal": 1000000,
        "standardBonus": 1000000
      }
    ]
  }
]
'@

$headers = @{
    "Content-Type" = "application/json; charset=utf-8"
    "X-API-Key" = $API_KEY
}

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($employeeData)

try {
    $response = Invoke-RestMethod -Uri $ENDPOINT_URL -Method Post -Headers $headers -Body $bodyBytes
    $response | ConvertTo-Json -Depth 10
}
catch {
    $errorResponse = $_.ErrorDetails.Message
    if ($errorResponse) {
        try {
            $errorJson = $errorResponse | ConvertFrom-Json
            $errorJson | ConvertTo-Json -Depth 10
        }
        catch {
            $errorResponse
        }
    }
    else {
        $_
    }
}