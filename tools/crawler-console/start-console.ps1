# 로컬 웹 UI (크롤 버튼)
$ErrorActionPreference = "Stop"
$ConfigPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $ConfigPath)) {
  Copy-Item (Join-Path $PSScriptRoot "config.example.json") $ConfigPath
  Write-Host "config.json을 생성했습니다. adminSecret(32자+)을 편집한 뒤 크롤러·콘솔을 같은 값으로 맞추세요."
}
Set-Location $PSScriptRoot
node server.mjs
