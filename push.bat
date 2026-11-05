@echo off
title Push to GitHub smart-navigator
set "PATH=C:\campus navigator\.tools\git\cmd;C:\campus navigator\.tools\git\mingw64\bin;%PATH%"
cd /d "C:\campus navigator"
echo ======================================================================
echo Pushing updated website to https://github.com/srujanem/smart-navigator.git
echo ======================================================================
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Pushed to smart-navigator!
) else (
    echo [ERROR] Push failed. If prompted for password, use a GitHub Personal Access Token.
)
echo.
pause
