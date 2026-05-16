@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0\.."

where node >nul 2>&1
if errorlevel 1 (
  echo [Ошибка] Node.js не найден. Установите Node.js и добавьте его в PATH.
  pause
  exit /b 1
)

echo Обновление кэша BLE-меток для карты без VPN...
echo Корень проекта: %CD%
echo.

node scripts\push-ble-cache.mjs
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% equ 0 (
  echo Готово.
) else (
  echo Завершено с ошибкой ^(код %EXIT_CODE%^).
  echo Нужен VPN или доступ к Worker API. Для загрузки в Supabase задайте:
  echo   set SUPABASE_SERVICE_ROLE_KEY=ваш_ключ
  echo и запустите батник снова.
)

pause
exit /b %EXIT_CODE%
