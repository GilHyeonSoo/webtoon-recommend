param(
    [string]$PythonVersion = "3.11",
    [switch]$SkipModels,
    [switch]$CpuOnly,
    # Optional local folder for the venv and models (e.g. C:\webtoon-art), useful when the repo lives on a synced drive.
    [string]$EngineHome = $env:ART_ENGINE_HOME,
    # Optional analysis output folder (e.g. C:\webtoon-analysis). Defaults to the repo's result folder.
    [string]$OutputDir = $env:ART_OUTPUT_DIR
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Venv = Join-Path $Root ".venv-art"
$PathArgs = @()
if ($EngineHome) {
    $EngineHome = [System.IO.Path]::GetFullPath($EngineHome)
    New-Item -ItemType Directory -Force $EngineHome | Out-Null
    $Venv = Join-Path $EngineHome "venv"
    $PathArgs += @("--models", (Join-Path $EngineHome "models"))
    # Persist so run-art-analysis.ps1 finds the same venv/models in later sessions.
    [Environment]::SetEnvironmentVariable("ART_ENGINE_HOME", $EngineHome, "User")
    $env:ART_ENGINE_HOME = $EngineHome
}
if ($OutputDir) {
    $OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
    [Environment]::SetEnvironmentVariable("ART_OUTPUT_DIR", $OutputDir, "User")
    $env:ART_OUTPUT_DIR = $OutputDir
    $PathArgs += @("--output", $OutputDir)
}
$Python = Join-Path $Venv "Scripts\python.exe"
$Entry = Join-Path $PSScriptRoot "analyze-art.py"
$env:PYTHONUTF8 = "1"
$env:HF_HUB_DISABLE_TELEMETRY = "1"

if ($PythonVersion -notin @("3.11", "3.12")) {
    throw "Use Python 3.11 or 3.12 (64-bit)."
}
if (-not (Test-Path $Python)) {
    $SystemPythonOk = $false
    if (Get-Command python -ErrorAction SilentlyContinue) {
        & python -c "import sys,struct; sys.exit(0 if sys.version_info[:2] in [(3,11),(3,12)] and struct.calcsize('P') == 8 else 1)"
        $SystemPythonOk = ($LASTEXITCODE -eq 0)
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py "-$PythonVersion" -m venv $Venv
    } elseif ($SystemPythonOk) {
        Write-Host "py launcher not found; using python on PATH."
        & python -m venv $Venv
    } else {
        throw "Install Python 3.11/3.12 64-bit first (python.org installer includes the py launcher): https://www.python.org/downloads/windows/"
    }
    if ($LASTEXITCODE -ne 0) { throw "Python virtual environment creation failed." }
}
& $Python -c "import sys,struct; assert sys.version_info[:2] in [(3,11),(3,12)] and struct.calcsize('P') == 8, 'Python 3.11/3.12 64-bit required'"
if ($LASTEXITCODE -ne 0) { throw "Unsupported Python virtual environment: $Venv" }
& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }

$TorchIndex = "https://download.pytorch.org/whl/cu126"
if ($CpuOnly) { $TorchIndex = "https://download.pytorch.org/whl/cpu" }
& $Python -m pip install torch==2.7.1 torchvision==0.22.1 --index-url $TorchIndex
if ($LASTEXITCODE -ne 0) { throw "PyTorch installation failed." }
& $Python -m pip install -r (Join-Path $Root "tools\art-style-engine\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Engine dependency installation failed." }
& $Python -m pip check
if ($LASTEXITCODE -ne 0) { throw "Engine dependency validation failed." }

$Device = "cuda"
if ($CpuOnly) { $Device = "cpu" }
& $Python $Entry doctor --device $Device @PathArgs
if ($LASTEXITCODE -ne 0) { throw "Runtime check failed. Check Python packages and the NVIDIA driver." }
if (-not $SkipModels) {
    & $Python $Entry prepare @PathArgs
    if ($LASTEXITCODE -ne 0) { throw "Model download failed. Rerun setup to resume downloads." }
}
Write-Host "Setup complete. Run from the repository root:"
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 scan'
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze --limit 20'
Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-art-analysis.ps1 analyze'
