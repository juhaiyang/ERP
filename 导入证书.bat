@echo off
chcp 65001 >nul
title Import HTTPS Certificate
cd /d "%~dp0"

set "CERT_FILE=%~dp0certs\server.crt"

echo ==========================================
echo   SWC-ERP - HTTPS Certificate Importer
echo ==========================================
echo.

if not exist "%CERT_FILE%" (
    echo [ERROR] Certificate file not found:
    echo         %CERT_FILE%
    echo.
    echo Please place certs\server.crt beside this script.
    echo.
    pause
    exit /b 1
)

echo Certificate: %CERT_FILE%
echo.

certutil -user -addstore Root "%CERT_FILE%"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to import certificate.
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   Certificate imported successfully
echo ==========================================
echo.
echo Notes:
echo   - Edge/Chrome will no longer show "Not Secure" warning
echo   - Imported for current Windows user only
echo   - Please restart your browser to take effect
echo.
pause
