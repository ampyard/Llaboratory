#Requires -Version 7.0

param()

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"

$backendProc = $null
$frontendProc = $null

function Write-Tag {
    param([string]$Tag, [string]$Color, [string]$Message)
    Write-Host "[$Tag] " -ForegroundColor $Color -NoNewline
    Write-Host $Message
}

function Stop-Processes {
    if ($frontendProc -and !$frontendProc.HasExited) {
        Write-Tag "FRONTEND" Cyan "Stopping dev server..."
        Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
        $frontendProc.WaitForExit(3000) | Out-Null
    }
    if ($backendProc -and !$backendProc.HasExited) {
        Write-Tag "BACKEND" Green "Stopping uvicorn..."
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
        $backendProc.WaitForExit(3000) | Out-Null
    }
}

try {
    # --- Install frontend dependencies ---
    $nodeModules = Join-Path $frontendDir "node_modules"
    if (!(Test-Path $nodeModules)) {
        Write-Tag "FRONTEND" Cyan "Installing dependencies..."
        Push-Location $frontendDir
        npm install
        Pop-Location
    }

    # --- Install backend dependencies ---
    $venvDir = Join-Path $backendDir ".venv"
    if (!(Test-Path $venvDir)) {
        Write-Tag "BACKEND" Green "Creating virtual environment and installing dependencies..."
        Push-Location $backendDir
        uv sync
        Pop-Location
    }

    # --- Start backend ---
    Write-Tag "BACKEND" Green "Starting uvicorn on http://localhost:8000 ..."
    $backendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "cd /d `"$backendDir`" && uv run uvicorn app.main:app --reload --port 8000" `
        -NoNewWindow -PassThru

    # --- Start frontend ---
    Write-Tag "FRONTEND" Cyan "Starting Vite dev server on http://localhost:5173 ..."
    $frontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "cd /d `"$frontendDir`" && npm run dev" `
        -NoNewWindow -PassThru

    Start-Sleep -Seconds 2

    # --- Verify processes are running ---
    if ($backendProc.HasExited) {
        Write-Tag "BACKEND" Red "Failed to start. Check logs above."
        exit 1
    }
    if ($frontendProc.HasExited) {
        Write-Tag "FRONTEND" Red "Failed to start. Check logs above."
        exit 1
    }

    Write-Host ""
    Write-Host "  Ready!" -ForegroundColor White
    Write-Host "  Frontend: " -NoNewline -ForegroundColor White
    Write-Host "http://localhost:5173" -ForegroundColor Cyan
    Write-Host "  Backend:  " -NoNewline -ForegroundColor White
    Write-Host "http://localhost:8000" -ForegroundColor Green
    Write-Host "  API docs: " -NoNewline -ForegroundColor White
    Write-Host "http://localhost:8000/docs" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""

    # --- Wait for either process to exit ---
    while (!$backendProc.HasExited -and !$frontendProc.HasExited) {
        Start-Sleep -Milliseconds 500
    }

    # If one died, report it
    if ($backendProc.HasExited -and $backendProc.ExitCode -ne 0) {
        Write-Tag "BACKEND" Red "Process exited with code $($backendProc.ExitCode)"
    }
    if ($frontendProc.HasExited -and $frontendProc.ExitCode -ne 0) {
        Write-Tag "FRONTEND" Red "Process exited with code $($frontendProc.ExitCode)"
    }
}
finally {
    Stop-Processes
}
