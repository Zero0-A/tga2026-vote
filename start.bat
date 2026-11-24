@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TGA 2026 玩家票选

where node >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动 TGA 2026 玩家票选服务...
  echo 前台页面：http://localhost:3000
  echo 后台统计：http://localhost:3000/admin
  echo 关闭此窗口即可停止服务。
  echo.
  node server.js
) else (
  echo.
  echo [未检测到 Node.js]
  echo 请先安装 Node.js 18 或更高版本：https://nodejs.org/zh-cn
  echo 安装完成后，重新双击本文件即可。
  echo.
)
pause
