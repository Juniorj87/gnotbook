@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=1 delims=.v " %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Current version:
  node --version
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules\express (
  echo Installing server dependencies. An internet connection is required for first launch...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Check internet access and try npm install from this folder.
    pause
    exit /b 1
  )
)
echo Running syntax and project preflight checks...
call npm test
if errorlevel 1 (
  echo Preflight checks failed. Review the errors above before continuing.
  pause
  exit /b 1
)
echo.
echo Starting Morrow Marketplace on http://127.0.0.1:4173
call npm start
pause
