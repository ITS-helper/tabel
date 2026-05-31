# WORK WATCH BLE — React Native

Отдельное Android-приложение (ветка `react-native-ble-map`): **карта + BLE-обход + поиск меток**. Веб-табель и Capacitor APK (`android/`, `ble-map.js`) **не затрагиваются**.

## Стек

- **Expo SDK 56** + **expo-dev-client**
- **expo-router** — вкладки: Карта / Обход / Поиск
- **react-native-ble-plx** — скан и GATT
- **react-native-maps** + **react-native-map-clustering** — спутник, кластеры, зоны
- **Supabase Edge** (`ble-map-proxy`) + Worker fallback — как `ble-map.js`

## Быстрый старт (dev)

```bash
cd mobile-rn
npm install --legacy-peer-deps
npx expo prebuild --platform android
npx expo run:android
```

BLE **не работает** в Expo Go — только native build.

## Release APK

```bash
cd mobile-rn
npm install --legacy-peer-deps
npm run apk
```

APK: `mobile-rn/dist/workwatch-ble-rn-v1.0.0-release.apk`

Или EAS (облако):

```bash
npx eas build --platform android --profile production
```

## Функции (v1.0.0)

- [x] Карта: спутник, метки по статусу (обход / батарея / OK)
- [x] Маршруты, фильтр меток, прогресс обхода
- [x] Кластеры меток (переключатель)
- [x] Зоны (полигоны с API)
- [x] Офлайн-кэш меток и зон (AsyncStorage)
- [x] BLE-обход: скан, GATT, авто-подключение к выбранной метке
- [x] Локальные check-in + **отправка** `POST /api/v2/ble_inspection`
- [x] Поиск меток/часов со звуком
- [x] Иконка из `assets/app-icon-master.png`

## Структура

```
mobile-rn/
  app/(tabs)/          # UI
  src/api/             # bleClient, bleMapApi, upload
  src/ble/             # BleService, GATT, WW advert
  src/context/         # AppDataProvider
  src/storage/         # checkins, offline, prefs
  scripts/build-apk.mjs
```

## Эталоны (корень репо)

| Функция | Файл |
|--------|------|
| Карта, маршруты | `ble-map.js` |
| Обход, GATT | `ble-field.js` |
| Поиск | `ble-finder.js` |

## Google Maps

Для production-карты на Android может понадобиться API key в `app.json`:

```json
"android": {
  "config": {
    "googleMaps": { "apiKey": "YOUR_KEY" }
  }
}
```

## Ветка

Разработка: **`react-native-ble-map`**. `main` и Capacitor не меняются.
