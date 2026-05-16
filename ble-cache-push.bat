@echo off
chcp 65001 >nul
setlocal

:: Корень репозитория = папка, где лежит этот bat-файл
cd /d "%~dp0"

title WORK WATCH — кэш карты BLE и push

echo.
echo ========================================
echo   Кэш BLE-меток + коммит + push в main
echo ========================================
echo   Папка: %CD%
echo   Запуск от администратора НЕ нужен — обычный двойной щелчок.
echo   От админа git может не видеть ваш GitHub-логин.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден. Установите с https://nodejs.org/
  goto :end_pause
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] npm не найден.
  goto :end_pause
)

where git >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Git не найден. Установите с https://git-scm.com/
  goto :end_pause
)

echo [1/4] Скачивание меток с API (нужен доступ к workers.dev, часто VPN)...
echo      Для кэша в Supabase без VPN задайте перед запуском:
echo      set SUPABASE_SERVICE_ROLE_KEY=ваш_ключ
echo.
call npm run ble-cache
if errorlevel 1 (
  echo.
  echo [ОШИБКА] npm run ble-cache не выполнился. Push отменён.
  echo        Проверьте VPN / сеть и повторите.
  goto :end_pause
)

if not exist "data\ble-map-cache.json" (
  echo [ОШИБКА] Файл data\ble-map-cache.json не создан.
  goto :end_pause
)

echo.
echo [2/4] git add data\ble-map-cache.json ...
git add "data/ble-map-cache.json"
if errorlevel 1 goto :git_fail

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo [ГОТОВО] Кэш обновлён, но в git изменений нет — коммит не нужен.
  goto :end_pause
)

echo.
echo [3/4] git commit ...
git commit -m "Обновить кэш BLE-меток для карты"
if errorlevel 1 goto :git_fail

echo.
echo [4/4] git push origin main ...
git push origin main
if errorlevel 1 (
  echo.
  echo [ОШИБКА] push не удался. Проверьте логин GitHub ^(git credential^).
  goto :end_pause
)

echo.
echo ========================================
echo   Готово: кэш на диске и в origin/main
echo ========================================
goto :end_pause

:git_fail
echo.
echo [ОШИБКА] Операция git не выполнена.
goto :end_pause

:end_pause
echo.
pause
endlocal
