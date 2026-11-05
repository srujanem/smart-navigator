@echo off
title Push to GitHub and Deploy to Vercel
set "PATH=C:\campus navigator\.tools\git\cmd;C:\campus navigator\.tools\git\mingw64\bin;%PATH%"
cd /d "C:\campus navigator"
echo ======================================================================
echo Pushing updated website to https://github.com/srujanem/Campus-Navigator
echo ======================================================================
git push origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Code pushed to GitHub! Vercel will now deploy automatically.
) else (
    echo [ERROR] Push failed. If prompted for password, use a GitHub Personal Access Token.
)
echo.
pause
