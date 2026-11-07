# Every argument is forwarded as a separate token, including quoted paths containing spaces.
# If ART_ENGINE_HOME / ART_OUTPUT_DIR are set (by setup-art-engine-windows.ps1 -EngineHome/-OutputDir),
# the venv, models and results default to those folders; explicit --models/--output still win.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$EngineHome = $env:ART_ENGINE_HOME
if (-not $EngineHome) { $EngineHome = [Environment]::GetEnvironmentVariable("ART_ENGINE_HOME", "User") }
$OutputDir = $env:ART_OUTPUT_DIR
if (-not $OutputDir) { $OutputDir = [Environment]::GetEnvironmentVariable("ART_OUTPUT_DIR", "User") }

$Python = Join-Path $Root ".venv-art\Scripts\python.exe"
if ($EngineHome) { $Python = Join-Path $EngineHome "venv\Scripts\python.exe" }
$env:PYTHONUTF8 = "1"
if (-not (Test-Path $Python)) {
    throw "Run scripts/setup-art-engine-windows.ps1 first."
}
$Forward = @($args)
if ($Forward.Count -eq 0) { $Forward = @("analyze") }

# Subcommand options must follow the subcommand, so insert defaults right after it.
$Commands = @("scan", "prepare", "doctor", "analyze", "cluster", "similar")
if ($Forward[0] -in $Commands) {
    $Extra = @()
    if ($EngineHome -and ($Forward -notcontains "--models")) { $Extra += @("--models", (Join-Path $EngineHome "models")) }
    if ($OutputDir -and ($Forward -notcontains "--output")) { $Extra += @("--output", $OutputDir) }
    if ($Extra.Count -gt 0) {
        $Rest = @()
        if ($Forward.Count -gt 1) { $Rest = $Forward[1..($Forward.Count - 1)] }
        $Forward = @($Forward[0]) + $Extra + $Rest
    }
}
& $Python (Join-Path $PSScriptRoot "analyze-art.py") @Forward
exit $LASTEXITCODE
