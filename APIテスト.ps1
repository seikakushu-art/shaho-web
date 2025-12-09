# ============================================
# APIデータ取り込み・出力テストスクリプト
# ============================================

# 設定項目
$API_KEY = "receiveEmployees_8Jf90sLqP9xZ0kM"
$RECEIVE_EMPLOYEES_URL = "https://us-central1-kensyu10115.cloudfunctions.net/receiveEmployees"
$EXPORT_CSV_DATA_URL = "https://us-central1-kensyu10115.cloudfunctions.net/exportCsvData"

# ============================================
# 1. 外部APIから社員データを取得（GET）
# ============================================
function Test-GetExternalEmployees {
    param(
        [string]$ExternalApiUrl = "https://api.example.com/employees"
    )
    
    Write-Host "`n=== GET: 外部APIから社員データを取得 ===" -ForegroundColor Cyan
    Write-Host "URL: $ExternalApiUrl" -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri $ExternalApiUrl -Method Get -ContentType "application/json"
        
        Write-Host "✓ リクエスト成功" -ForegroundColor Green
        Write-Host "レスポンス:" -ForegroundColor Yellow
        $response | ConvertTo-Json -Depth 10 | Write-Host
        
        return $response
    }
    catch {
        Write-Host "✗ エラーが発生しました" -ForegroundColor Red
        Write-Host "エラー詳細: $_" -ForegroundColor Red
        return $null
    }
}

# ============================================
# 2. 外部APIにリクエストボディを送信（POST）
# ============================================
function Test-PostExternalEmployees {
    param(
        [string]$ExternalApiUrl = "https://api.example.com/employees",
        [hashtable]$RequestBody = $null
    )
    
    Write-Host "`n=== POST: 外部APIにリクエストボディを送信 ===" -ForegroundColor Cyan
    Write-Host "URL: $ExternalApiUrl" -ForegroundColor Gray
    
    # デフォルトのリクエストボディ
    if ($null -eq $RequestBody) {
        $RequestBody = @{
            filter = @{
                department = "営業部"
                updatedSince = "2025-01-01"
            }
        }
    }
    
    $jsonBody = $RequestBody | ConvertTo-Json -Depth 10
    Write-Host "リクエストボディ:" -ForegroundColor Gray
    Write-Host $jsonBody -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri $ExternalApiUrl -Method Post -ContentType "application/json" -Body $jsonBody
        
        Write-Host "✓ リクエスト成功" -ForegroundColor Green
        Write-Host "レスポンス:" -ForegroundColor Yellow
        $response | ConvertTo-Json -Depth 10 | Write-Host
        
        return $response
    }
    catch {
        Write-Host "✗ エラーが発生しました" -ForegroundColor Red
        Write-Host "エラー詳細: $_" -ForegroundColor Red
        return $null
    }
}

# ============================================
# 3. Firebase Functions: 社員データ受信（POST）
# ============================================
function Test-PostReceiveEmployees {
    param(
        [string]$EndpointUrl = $RECEIVE_EMPLOYEES_URL,
        [string]$ApiKey = $API_KEY,
        [array]$EmployeeData = $null
    )
    
    $endpoint = $EndpointUrl
    Write-Host "`n=== POST: Firebase Functions - 社員データ受信 ===" -ForegroundColor Cyan
    Write-Host "エンドポイント: $endpoint" -ForegroundColor Gray
    
    # デフォルトのサンプルデータ
    if ($null -eq $EmployeeData) {
        $EmployeeData = @(
            @{
                employeeNo = "202501"
                name = "佐藤 花子"
                kana = "サトウ ハナコ"
                department = "営業部"
                workPrefecture = "東京都"
                standardMonthly = 450000
                birthDate = "1990-01-02"
                payrolls = @(
                    @{
                        yearMonth = "2025-04"
                        amount = 450000
                        workedDays = 20
                    }
                    @{
                        yearMonth = "2025-05"
                        bonusPaidOn = "2025-05-15"
                        bonusTotal = 1000000
                        standardBonus = 1000000
                    }
                )
            }
        )
    }
    
    $jsonBody = $EmployeeData | ConvertTo-Json -Depth 10
    Write-Host "リクエストボディ:" -ForegroundColor Gray
    Write-Host $jsonBody -ForegroundColor Gray
    
    $headers = @{
        "Content-Type" = "application/json"
        "X-API-Key" = $ApiKey
    }
    
    try {
        $response = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -Body $jsonBody
        
        Write-Host "✓ リクエスト成功" -ForegroundColor Green
        Write-Host "レスポンス:" -ForegroundColor Yellow
        $response | ConvertTo-Json -Depth 10 | Write-Host
        
        # 結果の詳細表示
        if ($response.total) {
            Write-Host "`n処理結果:" -ForegroundColor Cyan
            Write-Host "  総件数: $($response.total)" -ForegroundColor White
            Write-Host "  処理件数: $($response.processed)" -ForegroundColor White
            Write-Host "  新規作成: $($response.created)" -ForegroundColor Green
            Write-Host "  更新: $($response.updated)" -ForegroundColor Yellow
            if ($response.errors -and $response.errors.Count -gt 0) {
                Write-Host "  エラー件数: $($response.errors.Count)" -ForegroundColor Red
                $response.errors | ForEach-Object {
                    Write-Host "    - [$($_.index)] $($_.employeeNo): $($_.message)" -ForegroundColor Red
                }
            }
        }
        
        return $response
    }
    catch {
        Write-Host "✗ エラーが発生しました" -ForegroundColor Red
        $errorResponse = $_.ErrorDetails.Message
        if ($errorResponse) {
            Write-Host "エラー詳細: $errorResponse" -ForegroundColor Red
            try {
                $errorJson = $errorResponse | ConvertFrom-Json
                $errorJson | ConvertTo-Json -Depth 10 | Write-Host
            }
            catch {
                Write-Host "エラーレスポンス: $errorResponse" -ForegroundColor Red
            }
        }
        else {
            Write-Host "エラー: $_" -ForegroundColor Red
        }
        return $null
    }
}

# ============================================
# 4. Firebase Functions: CSV出力データ取得（GET）
# ============================================
function Test-GetExportCsvData {
    param(
        [string]$EndpointUrl = $EXPORT_CSV_DATA_URL,
        [string]$ApiKey = $API_KEY,
        [string]$Department = $null,
        [string]$WorkPrefecture = $null,
        [string]$PayrollStartMonth = $null,
        [string]$PayrollEndMonth = $null,
        [bool]$IncludeCalculation = $false,
        [string]$CalculationId = $null,
        [int]$CalculationLimit = 10
    )
    
    $endpoint = $EndpointUrl
    $queryParams = @()
    
    if ($Department) { $queryParams += "department=$Department" }
    if ($WorkPrefecture) { $queryParams += "workPrefecture=$WorkPrefecture" }
    if ($PayrollStartMonth) { $queryParams += "payrollStartMonth=$PayrollStartMonth" }
    if ($PayrollEndMonth) { $queryParams += "payrollEndMonth=$PayrollEndMonth" }
    if ($IncludeCalculation) { $queryParams += "includeCalculation=true" }
    if ($CalculationId) { $queryParams += "calculationId=$CalculationId" }
    if ($CalculationLimit) { $queryParams += "calculationLimit=$CalculationLimit" }
    
    if ($queryParams.Count -gt 0) {
        $endpoint += "?" + ($queryParams -join "&")
    }
    
    Write-Host "`n=== GET: Firebase Functions - CSV出力データ取得 ===" -ForegroundColor Cyan
    Write-Host "エンドポイント: $endpoint" -ForegroundColor Gray
    
    $headers = @{
        "X-API-Key" = $ApiKey
    }
    
    try {
        $response = Invoke-RestMethod -Uri $endpoint -Method Get -Headers $headers
        
        Write-Host "✓ リクエスト成功" -ForegroundColor Green
        
        # レスポンスの構造を確認
        if ($response.employees) {
            Write-Host "`n社員データ件数: $($response.employees.Count)" -ForegroundColor Cyan
            if ($response.employees.Count -gt 0) {
                Write-Host "`n最初の社員データ:" -ForegroundColor Yellow
                $response.employees[0] | ConvertTo-Json -Depth 5 | Write-Host
            }
        }
        
        if ($response.calculations) {
            Write-Host "`n計算結果件数: $($response.calculations.Count)" -ForegroundColor Cyan
            if ($response.calculations.Count -gt 0) {
                Write-Host "`n最初の計算結果:" -ForegroundColor Yellow
                $response.calculations[0] | ConvertTo-Json -Depth 5 | Write-Host
            }
        }
        
        # 全データを表示する場合はコメントアウト
        # Write-Host "`n全レスポンス:" -ForegroundColor Yellow
        # $response | ConvertTo-Json -Depth 10 | Write-Host
        
        return $response
    }
    catch {
        Write-Host "✗ エラーが発生しました" -ForegroundColor Red
        $errorResponse = $_.ErrorDetails.Message
        if ($errorResponse) {
            Write-Host "エラー詳細: $errorResponse" -ForegroundColor Red
            try {
                $errorJson = $errorResponse | ConvertFrom-Json
                $errorJson | ConvertTo-Json -Depth 10 | Write-Host
            }
            catch {
                Write-Host "エラーレスポンス: $errorResponse" -ForegroundColor Red
            }
        }
        else {
            Write-Host "エラー: $_" -ForegroundColor Red
        }
        return $null
    }
}

# ============================================
# 5. OPTIONSリクエスト（CORS）テスト
# ============================================
function Test-OptionsRequest {
    param(
        [string]$Url = $RECEIVE_EMPLOYEES_URL
    )
    
    $url = $Url
    Write-Host "`n=== OPTIONS: CORSプリフライトリクエスト ===" -ForegroundColor Cyan
    Write-Host "URL: $url" -ForegroundColor Gray
    
    try {
        $response = Invoke-WebRequest -Uri $url -Method Options
        
        Write-Host "✓ リクエスト成功" -ForegroundColor Green
        Write-Host "ステータスコード: $($response.StatusCode)" -ForegroundColor Yellow
        Write-Host "`nCORSヘッダー:" -ForegroundColor Cyan
        $response.Headers | ForEach-Object {
            $key = $_.Key
            $value = $_.Value
            if ($key -like "*Access-Control*") {
                Write-Host "  $key : $value" -ForegroundColor White
            }
        }
        
        return $response
    }
    catch {
        Write-Host "✗ エラーが発生しました" -ForegroundColor Red
        Write-Host "エラー: $_" -ForegroundColor Red
        return $null
    }
}

# ============================================
# メイン実行部分
# ============================================
Write-Host @"
============================================
APIデータ取り込み・出力テストスクリプト
============================================
"@ -ForegroundColor Magenta

Write-Host "`n設定確認:" -ForegroundColor Cyan
Write-Host "  APIキー: $(if ($API_KEY -eq 'your-api-key-here') { '未設定' } else { '設定済み' })" -ForegroundColor $(if ($API_KEY -eq 'your-api-key-here') { 'Red' } else { 'Green' })
Write-Host "  社員データ受信URL: $RECEIVE_EMPLOYEES_URL" -ForegroundColor Green
Write-Host "  CSV出力データ取得URL: $EXPORT_CSV_DATA_URL" -ForegroundColor Green

Write-Host "`n実行するテストを選択してください:" -ForegroundColor Yellow
Write-Host "  1. 外部APIから社員データを取得（GET）"
Write-Host "  2. 外部APIにリクエストボディを送信（POST）"
Write-Host "  3. Firebase Functions: 社員データ受信（POST）"
Write-Host "  4. Firebase Functions: CSV出力データ取得（GET）"
Write-Host "  5. CORSプリフライトリクエスト（OPTIONS）"
Write-Host "  6. 全てのテストを実行"
Write-Host "  0. 終了"

$choice = Read-Host "`n選択 (0-6)"

switch ($choice) {
    "1" {
        $externalUrl = Read-Host "外部API URL（Enterでデフォルト）"
        if ([string]::IsNullOrWhiteSpace($externalUrl)) {
            $externalUrl = "https://api.example.com/employees"
        }
        Test-GetExternalEmployees -ExternalApiUrl $externalUrl
    }
    "2" {
        $externalUrl = Read-Host "外部API URL（Enterでデフォルト）"
        if ([string]::IsNullOrWhiteSpace($externalUrl)) {
            $externalUrl = "https://api.example.com/employees"
        }
        Test-PostExternalEmployees -ExternalApiUrl $externalUrl
    }
    "3" {
        Test-PostReceiveEmployees
    }
    "4" {
        Write-Host "`nフィルタオプション（Enterでスキップ）:" -ForegroundColor Cyan
        $dept = Read-Host "部署"
        $pref = Read-Host "勤務地"
        $startMonth = Read-Host "給与開始月 (例: 2025-04)"
        $endMonth = Read-Host "給与終了月 (例: 2025-06)"
        $includeCalc = (Read-Host "計算結果を含める (y/n)") -eq "y"
        $calcId = Read-Host "計算結果ID"
        $calcLimit = Read-Host "計算結果件数上限 (デフォルト: 10)"
        if ([string]::IsNullOrWhiteSpace($calcLimit)) { $calcLimit = 10 }
        
        Test-GetExportCsvData `
            -Department $(if ([string]::IsNullOrWhiteSpace($dept)) { $null } else { $dept }) `
            -WorkPrefecture $(if ([string]::IsNullOrWhiteSpace($pref)) { $null } else { $pref }) `
            -PayrollStartMonth $(if ([string]::IsNullOrWhiteSpace($startMonth)) { $null } else { $startMonth }) `
            -PayrollEndMonth $(if ([string]::IsNullOrWhiteSpace($endMonth)) { $null } else { $endMonth }) `
            -IncludeCalculation $includeCalc `
            -CalculationId $(if ([string]::IsNullOrWhiteSpace($calcId)) { $null } else { $calcId }) `
            -CalculationLimit $calcLimit
    }
    "5" {
        Test-OptionsRequest
    }
    "6" {
        Write-Host "`n=== 全テストを実行します ===" -ForegroundColor Magenta
        
        Write-Host "`n[1/5] 外部API GETテスト..." -ForegroundColor Cyan
        Test-GetExternalEmployees
        
        Write-Host "`n[2/5] 外部API POSTテスト..." -ForegroundColor Cyan
        Test-PostExternalEmployees
        
        Write-Host "`n[3/5] Firebase Functions POSTテスト..." -ForegroundColor Cyan
        Test-PostReceiveEmployees
        
        Write-Host "`n[4/5] Firebase Functions GETテスト..." -ForegroundColor Cyan
        Test-GetExportCsvData
        
        Write-Host "`n[5/5] CORS OPTIONSテスト..." -ForegroundColor Cyan
        Test-OptionsRequest
        
        Write-Host "`n=== 全テスト完了 ===" -ForegroundColor Green
    }
    "0" {
        Write-Host "終了します。" -ForegroundColor Yellow
        exit
    }
    default {
        Write-Host "無効な選択です。" -ForegroundColor Red
    }
}

Write-Host "`nテスト完了。Enterキーで終了します。" -ForegroundColor Gray
Read-Host

