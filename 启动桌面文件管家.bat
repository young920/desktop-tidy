@echo off
cd /d "%~dp0"
if not exist node_modules\electron\cli.js (
  echo 首次启动需要安装依赖，请保持网络连接...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
call npm start
