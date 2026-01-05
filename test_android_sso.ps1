# Test Android SSO Flow
Write-Host "Step 1: Logging into main platform..." -ForegroundColor Cyan

$loginResponse = Invoke-RestMethod -Uri "http://localhost:5000/bharatlytics/v1/users/login" -Method POST -Headers @{"Content-Type" = "application/json" } -Body '{"email": "admin@bharatlytics.com", "password": "admin123"}'

$platformToken = $loginResponse.token
$companyId = $loginResponse.context.companyId
$companyName = $loginResponse.context.companyName

Write-Host "Login successful! Company: $companyName" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Authenticating with VMS using platform SSO..." -ForegroundColor Cyan

$ssoBody = @{
    token     = $platformToken
    companyId = $companyId
} | ConvertTo-Json

$vmsResponse = Invoke-RestMethod -Uri "http://localhost:5001/auth/platform-sso" -Method POST -Headers @{"Content-Type" = "application/json" } -Body $ssoBody

Write-Host "VMS SSO successful!" -ForegroundColor Green

if ($vmsResponse.vmsToken) {
    Write-Host "VMS Token received! Expires in: $($vmsResponse.expiresIn) seconds" -ForegroundColor Green
    $vmsToken = $vmsResponse.vmsToken
}
else {
    Write-Host "ERROR: No VMS token in response!" -ForegroundColor Red
    $vmsResponse | ConvertTo-Json
    exit 1
}
Write-Host ""

Write-Host "Step 3: Testing VMS API - List Visitors..." -ForegroundColor Cyan

try {
    $visitorsResponse = Invoke-RestMethod -Uri "http://localhost:5001/api/visitors?companyId=$companyId" -Method GET -Headers @{"Authorization" = "Bearer $vmsToken"; "Content-Type" = "application/json" }
    Write-Host "Visitors API successful! Found $($visitorsResponse.visitors.Count) visitors" -ForegroundColor Green
}
catch {
    Write-Host "Visitors API failed: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "Step 4: Testing VMS API - List Visits..." -ForegroundColor Cyan

try {
    $visitsResponse = Invoke-RestMethod -Uri "http://localhost:5001/api/visits?companyId=$companyId" -Method GET -Headers @{"Authorization" = "Bearer $vmsToken"; "Content-Type" = "application/json" }
    Write-Host "Visits API successful! Found $($visitsResponse.Count) visits" -ForegroundColor Green
}
catch {
    Write-Host "Visits API failed: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "Step 5: Testing VMS API - List Employees..." -ForegroundColor Cyan

try {
    $employeesResponse = Invoke-RestMethod -Uri "http://localhost:5001/api/employees?companyId=$companyId" -Method GET -Headers @{"Authorization" = "Bearer $vmsToken"; "Content-Type" = "application/json" }
    Write-Host "Employees API successful! Found $($employeesResponse.employees.Count) employees" -ForegroundColor Green
}
catch {
    Write-Host "Employees API failed: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "Android SSO Flow Test Complete!" -ForegroundColor Green
