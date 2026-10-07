param(
    [string]$TemplateFile = "infrastructure/aws/template.yaml"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dashboardPath = Join-Path $projectRoot "apps/dashboard"
$resolvedTemplate = Join-Path $projectRoot $TemplateFile

foreach ($command in @("node", "sam")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is not installed or not in PATH: $command"
    }
}

Push-Location $dashboardPath
try {
    # 不在驗證腳本內自動安裝套件：避免預檢時意外連網或改動 node_modules。
    # 此專案的測試與型別檢查可由 Node 直接執行，不依賴全域 pnpm。
    if (-not (Test-Path (Join-Path $dashboardPath "node_modules"))) {
        throw "Dependencies are not installed. Restore apps/dashboard/node_modules with the project lockfile first."
    }
    node --experimental-strip-types --test tests/*.test.ts
    if ($LASTEXITCODE -ne 0) { throw "Automated tests failed." }
    node node_modules/typescript/bin/tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "TypeScript validation failed." }
}
finally {
    Pop-Location
}

Push-Location $projectRoot
try {
    # 僅限目前執行階段停用 SAM telemetry；不寫入使用者設定。
    $env:SAM_CLI_TELEMETRY = "0"
    sam validate --lint --template-file $resolvedTemplate
    if ($LASTEXITCODE -ne 0) { throw "SAM template validation failed." }
    sam build --template-file $resolvedTemplate
    if ($LASTEXITCODE -ne 0) { throw "SAM build failed." }
}
finally {
    Pop-Location
}

Write-Host "Local AWS prototype validation completed successfully."
