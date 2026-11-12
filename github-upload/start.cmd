@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%~dp0.tools\node\node-v*-win-x64") do if exist "%%D\node.exe" set "PATH=%%D;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo Install a supported Node.js LTS release, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dev -- --open
