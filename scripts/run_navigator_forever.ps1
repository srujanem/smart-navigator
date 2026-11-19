<#
.SYNOPSIS
    Self-healing 24/7 Windows watchdog for Smart Campus 360 Navigator backend & Cloudflare Tunnel.
.DESCRIPTION
    Keeps FastAPI/Uvicorn and IPv4 HTTP/2 Cloudflared running continuously, automatically
    restarting either process if it exits or fails health checks.
    Optional: set $env:CF_TUNNEL_TOKEN to run a permanent fixed custom-domain Cloudflare Tunnel.
#>
$ErrorActionPreference = "Continue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
$CloudflaredExe = Join-Path $RepoRoot ".tools\cloudflared.exe"
$LogDir = Join-Path $BackendDir "var\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$UvicornOut = Join-Path $LogDir "uvicorn.log"
$UvicornErr = Join-Path $LogDir "uvicorn.err.log"
$TunnelOut = Join-Path $LogDir "cloudflared.log"
$TunnelErr = Join-Path $LogDir "cloudflared.err.log"

$UvicornProc = $null
$TunnelProc = $null
$FailedHealthChecks = 0

function Start-NavigatorBackend {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting FastAPI Uvicorn server..." -ForegroundColor Cyan
    return Start-Process -FilePath $PythonExe `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "65", "--limit-concurrency", "64" `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $UvicornOut `
        -RedirectStandardError $UvicornErr `
        -PassThru `
        -NoNewWindow
}

function Start-NavigatorTunnel {
    if (-not (Test-Path $CloudflaredExe)) {
        Write-Warning "cloudflared.exe not found at $CloudflaredExe — skipping tunnel."
        return $null
    }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting IPv4 HTTP/2 Cloudflare Tunnel..." -ForegroundColor Green
    if ($env:CF_TUNNEL_TOKEN) {
        $args = @("tunnel", "--edge-ip-version", "4", "--protocol", "http2", "run", "--token", $env:CF_TUNNEL_TOKEN)
    } else {
        $args = @("tunnel", "--edge-ip-version", "4", "--protocol", "http2", "--url", "http://127.0.0.1:8000")
    }
    return Start-Process -FilePath $CloudflaredExe `
        -ArgumentList $args `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $TunnelOut `
        -RedirectStandardError $TunnelErr `
        -PassThru `
        -NoNewWindow
}

try {
    $UvicornProc = Start-NavigatorBackend
    Start-Sleep -Seconds 3
    $TunnelProc = Start-NavigatorTunnel

    while ($true) {
        Start-Sleep -Seconds 15

        if (-not $UvicornProc -or $UvicornProc.HasExited) {
            Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] Backend exited unexpectedly — restarting..."
            $UvicornProc = Start-NavigatorBackend
            $FailedHealthChecks = 0
            Start-Sleep -Seconds 4
        }

        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 5 -UseBasicParsing
            if ($resp.StatusCode -eq 200) {
                $FailedHealthChecks = 0
            } else {
                $FailedHealthChecks++
            }
        } catch {
            $FailedHealthChecks++
        }

        if ($FailedHealthChecks -ge 3) {
            Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] Backend failed 3 health checks — force restarting..."
            if ($UvicornProc -and -not $UvicornProc.HasExited) {
                Stop-Process -Id $UvicornProc.Id -Force -ErrorAction SilentlyContinue
            }
            $UvicornProc = Start-NavigatorBackend
            $FailedHealthChecks = 0
            Start-Sleep -Seconds 4
        }

        if ((Test-Path $CloudflaredExe) -and (-not $TunnelProc -or $TunnelProc.HasExited)) {
            Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] Cloudflared tunnel exited — restarting..."
            $TunnelProc = Start-NavigatorTunnel
        }
    }
} finally {
    if ($TunnelProc -and -not $TunnelProc.HasExited) { Stop-Process -Id $TunnelProc.Id -Force -ErrorAction SilentlyContinue }
    if ($UvicornProc -and -not $UvicornProc.HasExited) { Stop-Process -Id $UvicornProc.Id -Force -ErrorAction SilentlyContinue }
}
