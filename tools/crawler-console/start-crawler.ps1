# KOREA_WEBTOON_API 크롤러 서버 (SQLite 저장)
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ConfigPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $ConfigPath)) {
  throw "config.json이 없습니다. config.example.json을 복사한 뒤 adminSecret을 설정하세요."
}
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Secret = $Config.adminSecret
if (-not $Secret -or $Secret.Length -lt 32) { throw "adminSecret은 32자 이상이어야 합니다." }

$RunDir = if ($env:CRAWLER_RUN_DIR) { $env:CRAWLER_RUN_DIR } else { Join-Path $env:LOCALAPPDATA "webtoon-crawler\KOREA_WEBTOON_API" }
$ApiSrc = Join-Path $Root "KOREA_WEBTOON_API"
if (-not (Test-Path $RunDir)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $RunDir -Parent) | Out-Null
  robocopy $ApiSrc $RunDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  Set-Location $RunDir
  npm ci --no-fund
} else {
  Set-Location $RunDir
}

$env:ENABLE_ADMIN_HTTP = "true"
$env:CRAWLER_ADMIN_SECRET = $Secret
$env:PORT = "3000"
$env:BIND_HOST = "127.0.0.1"
if ($env:SQLITE_PATH) {
  Write-Host "SQLITE_PATH=$env:SQLITE_PATH"
} else {
  $env:SQLITE_PATH = Join-Path $RunDir "database.sqlite"
  Write-Host "SQLITE_PATH=$env:SQLITE_PATH"
}

Write-Host "Crawler API: http://127.0.0.1:3000/health-check"
npm start
