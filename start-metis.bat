@echo off
setlocal

cd /d "%~dp0"

if not exist ".env" (
    echo [ERROR] .env file not found. Copy .env.example to .env first.
    pause
    exit /b 1
)

echo ============================================
echo   Starting METIS local dev server...
echo ============================================
echo.

REM Give the server a few seconds to boot, then open the browser.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"

REM dotenv (inside server.js) loads .env automatically.
node server.js

if errorlevel 1 (
    echo.
    echo ============================================
    echo   [ERROR] Server exited with an error.
    echo ============================================
) else (
    echo.
    echo Server stopped.
)

pause
