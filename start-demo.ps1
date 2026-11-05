# Starts both the FastAPI AI backend (port 8000) and Vite 3D frontend (port 5173)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Test-Path "$root\.tools\node") {
    $env:Path = "$root\.tools\node;" + $env:Path
}

Write-Host "Starting Navigator AI Backend on http://localhost:8000 ..." -ForegroundColor Cyan
Start-Process -FilePath "$root\backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory "$root\backend"

Start-Sleep -Seconds 2
Write-Host "Starting Navigator 3D Frontend on http://localhost:5173 ..." -ForegroundColor Green
Set-Location "$root\frontend"
& npm.cmd run dev
