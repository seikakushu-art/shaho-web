$API_KEY = "receiveEmployees_8Jf90sLqP9xZ0kM"
$ENDPOINT_URL = "https://us-central1-kensyu10115.cloudfunctions.net/exportCsvData"
$EMPLOYEE_NO = "101342"

$headers = @{
    "X-API-Key" = $API_KEY
}

try {
    $response = Invoke-RestMethod -Uri $ENDPOINT_URL -Method Get -Headers $headers
    $employee = $response.employees | Where-Object { $_.employeeNo -eq $EMPLOYEE_NO }
    
    if ($employee) {
        $employee | ConvertTo-Json -Depth 10
    }
    else {
        @{
            error = "社員番号 $EMPLOYEE_NO の社員が見つかりませんでした"
        } | ConvertTo-Json
    }
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

