param(
    [string]$StackName = "material-dashboard-demo",
    [string]$Region = "ap-northeast-1",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dashboardPath = Join-Path $projectRoot "apps/dashboard"
$awsCommon = @("--region", $Region)
if ($Profile) { $awsCommon += @("--profile", $Profile) }

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI is required." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm is required." }

$outputJson = & aws cloudformation describe-stacks --stack-name $StackName @awsCommon --query "Stacks[0].Outputs" --output json
if ($LASTEXITCODE -ne 0) { throw "Unable to read CloudFormation outputs." }
$outputs = $outputJson | ConvertFrom-Json
function Get-StackOutput([string]$key) {
    return ($outputs | Where-Object OutputKey -eq $key | Select-Object -ExpandProperty OutputValue)
}

$apiUrl = Get-StackOutput "DashboardApiUrl"
$frontendBucket = Get-StackOutput "FrontendBucketName"
$distributionId = Get-StackOutput "FrontendDistributionId"
if (-not $apiUrl -or -not $frontendBucket -or -not $distributionId) {
    throw "Required stack outputs are missing. Deploy the current SAM stack first."
}

Push-Location $dashboardPath
try {
    $env:NEXT_PUBLIC_MATERIAL_API_BASE_URL = $apiUrl.TrimEnd("/")
    pnpm run build:static
    if ($LASTEXITCODE -ne 0) { throw "Static dashboard build failed." }
}
finally {
    Remove-Item Env:NEXT_PUBLIC_MATERIAL_API_BASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}

& aws s3 sync (Join-Path $dashboardPath "dist-static") "s3://$frontendBucket" --delete @awsCommon
if ($LASTEXITCODE -ne 0) { throw "Frontend upload failed." }
& aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*" @awsCommon
if ($LASTEXITCODE -ne 0) { throw "CloudFront invalidation failed." }

Write-Host "Static dashboard uploaded and CloudFront invalidation requested."
