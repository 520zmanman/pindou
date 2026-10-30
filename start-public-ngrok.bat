@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-public-ngrok.ps1"
if errorlevel 1 (
  echo.
  echo Public startup failed. Please read the error above.
)
pause

