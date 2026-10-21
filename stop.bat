@echo off
chcp 65001 >nul
title 고스톱 서버 종료
echo.
echo  고스톱 서버(node.exe)를 종료합니다...
taskkill /f /im node.exe >nul 2>&1
if %errorlevel%==0 (
  echo  [OK] 서버가 종료되었습니다.
) else (
  echo  [정보] 실행 중인 서버가 없습니다.
)
echo.
pause