# 크롤러(KOREA_WEBTOON_API) Windows 초기 설정
# Google Drive 한글 경로에서 sqlite3 빌드가 실패할 수 있어 C:\dev 복사본을 권장합니다.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$ApiSrc = Join-Path $Root "KOREA_WEBTOON_API"
$RunDir = "C:\dev\webtoon-crawler\KOREA_WEBTOON_API"

if (-not (Get-Command yarn -ErrorAction SilentlyContinue)) {
  npm install -g yarn
}

New-Item -ItemType Directory -Force -Path (Split-Path $RunDir -Parent) | Out-Null
if (Test-Path $RunDir) { Remove-Item -Recurse -Force $RunDir }
robocopy $ApiSrc $RunDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

Set-Location $RunDir
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host ""
Write-Host "Setup OK. Run crawler from:"
Write-Host "  cd $RunDir"
Write-Host "  npm start"
Write-Host "Then in another terminal:"
Write-Host "  curl http://localhost:3000/health-check"
