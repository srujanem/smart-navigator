# Pushes your local commit to https://github.com/srujanem/Campus-Navigator
# Because your Vercel project (campus-navigator-9fbb) has Git Integration enabled on 'main',
# pushing will trigger an automatic Vercel deployment!
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path "$root\.tools\git\cmd") {
    $env:Path = "$root\.tools\git\cmd;" + $env:Path
}
Set-Location $root
Write-Host "Pushing to https://github.com/srujanem/Campus-Navigator (branch main)..." -ForegroundColor Cyan
git push origin main
