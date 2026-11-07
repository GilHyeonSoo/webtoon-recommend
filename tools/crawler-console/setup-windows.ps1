# 크롤러 콘솔 1회 설정 (Windows)
# - config.json 생성
# - %LOCALAPPDATA%\webtoon-crawler 에 KOREA_WEBTOON_API + npm ci
# - Google Drive 경로 npm 이슈 시 C:\dev\webtoon-recommend 미러 + Backend npm ci
$ErrorActionPreference = "Stop"
$ConsoleDir = $PSScriptRoot
$Root = Split-Path (Split-Path $ConsoleDir -Parent) -Parent
$ConfigPath = Join-Path $ConsoleDir "config.json"
$ExamplePath = Join-Path $ConsoleDir "config.example.json"
$DevRoot = "C:\dev\webtoon-recommend"
$RunDir = Join-Path $env:LOCALAPPDATA "webtoon-crawler\KOREA_WEBTOON_API"
$ApiSrc = Join-Path $Root "KOREA_WEBTOON_API"

if (-not (Test-Path $ConfigPath)) {
  node -e "const fs=require('fs');const c=require('crypto');const p=process.argv[1];const o=process.argv[2];const cfg=JSON.parse(fs.readFileSync(p,'utf8'));cfg.adminSecret=c.randomBytes(24).toString('base64url');if(!cfg.deploy)cfg.deploy={};if(!cfg.deploy.railway)cfg.deploy.railway={};cfg.deploy.railway.enabled=false;fs.writeFileSync(o,JSON.stringify(cfg,null,2)+'\n');" $ExamplePath $ConfigPath
  Write-Host "config.json 생성됨 — adminSecret은 git에 올라가지 않습니다."
}

Write-Host "크롤러 실행 폴더 준비: $RunDir"
New-Item -ItemType Directory -Force -Path (Split-Path $RunDir -Parent) | Out-Null
if (-not (Test-Path (Join-Path $RunDir "node_modules"))) {
  if (Test-Path $RunDir) { Remove-Item -Recurse -Force $RunDir }
  robocopy $ApiSrc $RunDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  Push-Location $RunDir
  npm ci --no-fund
  Pop-Location
}

Write-Host "통합·배포용 로컬 미러: $DevRoot"
New-Item -ItemType Directory -Force -Path "C:\dev" | Out-Null
robocopy $Root $DevRoot /E /XD node_modules dist ".webtoon-deps-backup-nw6c_50k" /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
Push-Location (Join-Path $DevRoot "Backend")
npm ci --no-fund
Pop-Location

node -e "const fs=require('fs');const p=process.argv[1];const root=process.argv[2];const cfg=JSON.parse(fs.readFileSync(p,'utf8'));if(!cfg.projectRoot){cfg.projectRoot=root;fs.writeFileSync(p,JSON.stringify(cfg,null,2)+'\n');console.log('projectRoot set');}" $ConfigPath $DevRoot

Write-Host ""
Write-Host "설정 완료. 실행:"
Write-Host "  cd $ConsoleDir"
Write-Host "  .\start-crawler.ps1   # 터미널 A"
Write-Host "  .\start-console.ps1   # 터미널 B  -> http://127.0.0.1:3780/"
Write-Host ""
Write-Host "Drive에서 코드를 수정한 뒤 통합/배포 전에 setup-windows.ps1 을 다시 실행하면 C:\dev 미러가 갱신됩니다."
