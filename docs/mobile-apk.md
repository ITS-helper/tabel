# APK — карта BLE

Android-приложение — оболочка **Capacitor** вокруг той же `ble-map.js`, что и на сайте.

## Возможности приложения

- Карта, маршруты, метки, фото, правка зон
- **Спутник офлайн** — тайлы Esri встроены в APK (охват СПГ, z14–18)
- **«Подготовить»** — маршрут + фото в IndexedDB на телефоне
- Фото **не перекачиваются** при повторной подготовке; только новые
- **Принудительное обновление** — доп. меню кнопки «Подг.» → пункт 3
- Без пароля на входе

## Сборка debug APK

```bash
npm install
npm run mobile:apk
```

Скрипт `mobile:build` сначала докачивает спутниковые тайлы (`npm run mobile:tiles`, пропускает уже скачанные), затем собирает `mobile/www` и APK.

Готовый файл: **`dist/workwatch-ble-map-v{versionName}-vc{code}-web{BLE_MAP_BUILD}[-label].apk`**

Предыдущие сборки из `dist/` переносятся в **`dist/apk-archive/`**. См. `.cursor/rules/workwatch-apk-build.mdc`.

С меткой GATT: `npm run mobile:apk:gatt` или `node scripts/build-android-apk.mjs --label GATT` (после `mobile:build`).

Требуется **JDK 21** (Capacitor 7) и **Android SDK** (`platforms;android-35`, `build-tools;35.0.0`).

## Разработка

После правок в `ble-map.js` / `ble-map.html`:

```bash
npm run mobile:build
```

Запуск на телефоне / эмуляторе:

```bash
npm run mobile:run
```

## Структура

| Путь | Назначение |
|------|------------|
| `capacitor.config.json` | id приложения, `webDir: mobile/www` |
| `scripts/sync-mobile-www.mjs` | копия карты + vendor + assets |
| `scripts/download-satellite-tiles.mjs` | офлайн-тайлы → `assets/tiles/satellite/` |
| `mobile/www/` | WebView (генерируется) |
| `android/` | проект Android Studio |
