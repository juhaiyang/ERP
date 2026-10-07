@echo off
chcp 65001 >nul
title 水土保持项目管理系统 - ERP服务
cd /d "%~dp0"
setlocal enabledelayedexpansion

if "%PORT%"=="" set PORT=3000

REM ====== HTTPS 开关 ======
REM 默认为 HTTPS 模式（自签名证书，首次自动生成于 certs/ 目录）
REM 如需使用普通 HTTP，设为 false
set HTTPS=true

if /i "%HTTPS%"=="true" (
    set PROTO=https
) else (
    set PROTO=http
)

echo ==========================================
echo   水土保持项目管理系统 ERP
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18.17 或更高版本
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
    echo.
)

echo 访问地址:
echo   本机:     %PROTO%://localhost:%PORT%
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set "IP=%%a"
    set "IP=!IP: =!"
    echo   局域网:   %PROTO%://!IP!:%PORT%
)
echo.
if /i "%HTTPS%"=="true" (
    echo [HTTPS] 使用自签名证书，首次访问浏览器会提示不安全，选择 高级 - 继续前往 即可。
    echo         若需消除警告，可将 certs\server.crt 导入各终端的 受信任的根证书颁发机构。
    echo.
)
echo 说明:
echo   - 局域网内其他电脑使用上面的 局域网 地址访问
echo   - 若其他电脑无法访问，请在 Windows 防火墙中放行 %PORT% 端口
echo   - 切换 HTTP/HTTPS: 编辑本脚本顶部的 set HTTPS=true/false
echo   - 需要换端口时: set PORT=8080 后再运行本脚本
echo   - 关闭本窗口即停止服务
echo ==========================================
echo.

netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
    echo [提示] 端口 %PORT% 已被占用，服务可能已在运行
    echo 浏览器直接访问上述地址即可
    echo 如需重启，请先关闭已运行的服务窗口
    echo.
)

node server\index.js

echo.
echo 服务已停止
pause
