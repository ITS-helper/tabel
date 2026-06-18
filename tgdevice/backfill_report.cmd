@echo off
setlocal
cd /d "%~dp0"
set REPORT_DATE=%~1
if "%REPORT_DATE%"=="" set /p REPORT_DATE=Enter date in YYYY-MM-DD format: 
if "%REPORT_DATE%"=="" (
  echo Date is required.
  exit /b 1
)
"%~dp0\.venv\Scripts\python.exe" -m tgdevice.main import-history --date %REPORT_DATE%
if errorlevel 1 exit /b %errorlevel%
"%~dp0\.venv\Scripts\python.exe" -m tgdevice.main fetch-site --date %REPORT_DATE%
if errorlevel 1 exit /b %errorlevel%
"%~dp0\.venv\Scripts\python.exe" -m tgdevice.main report --date %REPORT_DATE% --send
