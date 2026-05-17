@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

title WORK WATCH — офлайн-пакет BLE

echo.
echo ========================================
echo   Сборка ble-field-pack.zip (нужен VPN)
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден.
  goto :end_pause
)

call npm install
if errorlevel 1 goto :end_pause

echo Сборка: 2 фото на метку (метка + место). Для одного фото: npm run ble-field-pack:tag-only
echo.
call npm run ble-field-pack
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Сборка не удалась.
  goto :end_pause
)

if not exist "data\ble-field-pack.zip" (
  echo [ОШИБКА] data\ble-field-pack.zip не создан.
  goto :end_pause
)

echo.
echo Готово. Файл: data\ble-field-pack.zip
echo Закоммитьте data\ble-field-pack-meta.json и выложите .zip на сайт
echo (или Supabase Storage — URL в packUrl в meta).
echo.

:end_pause
pause
endlocal
