$API_KEY = "receiveEmployees_8Jf90sLqP9xZ0kM"
$ENDPOINT_URL = "https://us-central1-kensyu10115.cloudfunctions.net/receiveEmployees"

$employeeData = @'
[
  {
    "employeeNo": "202504",
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
        "bonusTotal": 1000000
      }
    ]
  },
  {
    "employeeNo": "202504",
    "name": "佐藤 花子",
    "kana": "サトウ ハナコ",
    "gender": "女",
    "birthDate": "1988-03-20",
    "postalCode": "150-0001",
    "address": "東京都渋谷区神宮前1-1",
    "currentAddress": "東京都渋谷区神宮前1-1",
    "department": "総務部",
    "workPrefecture": "東京都",
    "personalNumber": "2345678901234",
    "basicPensionNumber": "234567890123",
    "healthStandardMonthly": 380000,
    "welfareStandardMonthly": 380000,
    "healthInsuredNumber": "23456789",
    "pensionInsuredNumber": "23456789",
    "healthAcquisition": "2025-01-01",
    "pensionAcquisition": "2025-01-01",
    "careSecondInsured": false,
    "currentLeaveStatus": "なし",
    "hasDependent": false,
    "payrolls": [
      {
        "yearMonth": "2025-04",
        "amount": 380000,
        "workedDays": 22
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
    $response = Invoke-WebRequest -Uri $ENDPOINT_URL -Method Post -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
    
    # 成功時
    Write-Host "HTTPステータスコード: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "`n=== 成功レスポンス ===" -ForegroundColor Green
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
}
catch {
    Write-Host "エラーが発生しました" -ForegroundColor Red
    
    # エラーレスポンスのJSONボディを取得
    $statusCode = $null
    $responseBody = $null
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTPステータスコード: $statusCode" -ForegroundColor Red
        
        try {
            # ストリームを取得して読み取る（UTF-8エンコーディングを明示）
            $responseStream = $_.Exception.Response.GetResponseStream()
            
            # ストリームの位置をリセット（既に読み取られている可能性があるため）
            if ($responseStream.CanSeek) {
                $responseStream.Position = 0
            }
            
            $encoding = [System.Text.Encoding]::UTF8
            $streamReader = New-Object System.IO.StreamReader($responseStream, $encoding)
            $responseBody = $streamReader.ReadToEnd()
            $streamReader.Close()
            $responseStream.Close()
        }
        catch {
            Write-Host "ストリーム読み取りエラー: $_" -ForegroundColor Red
            Write-Host $_.Exception.Message -ForegroundColor Red
        }
    }
    
    # ErrorDetailsからも取得を試みる
    if (-not $responseBody -and $_.ErrorDetails) {
        $responseBody = $_.ErrorDetails.Message
    }
    
    if ($responseBody) {
        Write-Host "`nエラーレスポンスボディ:" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Yellow
        
        try {
            $errorJson = $responseBody | ConvertFrom-Json
            Write-Host "`n=== エラー詳細 ===" -ForegroundColor Cyan
            Write-Host "エラータイプ: $($errorJson.error)" -ForegroundColor Yellow
            Write-Host "エラーメッセージ: $($errorJson.message)" -ForegroundColor Yellow
            
            if ($errorJson.errors -and $errorJson.errors.Count -gt 0) {
                Write-Host "`nエラー詳細 ($($errorJson.errors.Count)件):" -ForegroundColor Yellow
                $errorJson.errors | ForEach-Object {
                    Write-Host "  [インデックス $($_.index)] 社員番号: $($_.employeeNo)" -ForegroundColor Yellow
                    Write-Host "    メッセージ: $($_.message)" -ForegroundColor Yellow
                }
            }
            
            Write-Host "`n=== 完全なエラーレスポンス ===" -ForegroundColor Cyan
            $errorJson | ConvertTo-Json -Depth 10
        }
        catch {
            Write-Host "JSONパースエラー: $_" -ForegroundColor Red
            Write-Host "レスポンスボディ（生）: $responseBody" -ForegroundColor Red
        }
    }
    else {
        Write-Host "`nエラーレスポンスボディが取得できませんでした" -ForegroundColor Red
        Write-Host "例外メッセージ: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails) {
            Write-Host "エラー詳細: $($_.ErrorDetails.Message)" -ForegroundColor Red
        }
    }
}