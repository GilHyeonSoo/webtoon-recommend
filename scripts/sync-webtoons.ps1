# Windows: export + Backend seed (환경 변수·경로는 사용자 PC에 맞게 수정)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

$RunDir = Join-Path $env:TEMP "KOREA_WEBTOON_API_RUN"
$ApiSrc = Join-Path $Root "KOREA_WEBTOON_API"
$OutDir = Join-Path $Root "data\webtoons"

Remove-Item -Recurse -Force $RunDir -ErrorAction SilentlyContinue
Copy-Item -Recurse $ApiSrc $RunDir
Set-Location $RunDir
npm ci --no-fund

$env:COUNT_PER_PLATFORM = if ($env:COUNT_PER_PLATFORM) { $env:COUNT_PER_PLATFORM } else { "10" }
$env:EXPORT_OUTPUT_DIR = $OutDir
npm run export:platform

Set-Location (Join-Path $Root "Backend")
if (-not (Test-Path ".env")) { throw "Backend\.env required (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)" }
npm run seed

Set-Location $Root
node (Join-Path $Root "scripts\merge-frontend-webtoons.mjs")
Write-Host "Sync completed."
