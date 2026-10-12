@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
	echo Node.js is required to run FLOW. Install it from https://nodejs.org and try again.
	pause
	exit /b 1
)

if not defined FLOW_OPEN_BROWSER set "FLOW_OPEN_BROWSER=1"
echo Starting FLOW. Keep this window open while you use the app.
call npm.cmd start

if errorlevel 1 (
	echo FLOW stopped because the server could not start.
)
pause
