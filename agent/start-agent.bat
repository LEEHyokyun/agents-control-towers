@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo   Agents Control Towers
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js를 찾을 수 없습니다.
    echo Node.js 설치 및 PATH 설정을 확인하세요.
    pause
    exit /b 1
)

where codex >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Codex CLI를 찾을 수 없습니다.
    echo Codex CLI 설치 및 PATH 설정을 확인하세요.
    pause
    exit /b 1
)

echo [INFO] 에이전트 관리자를 실행합니다.
echo [INFO] 종료하려면 Ctrl+C를 누르세요.
echo.

node agent-manager.mjs

set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] 에이전트가 오류 코드 %EXIT_CODE%로 종료되었습니다.
    pause
)

exit /b %EXIT_CODE%
