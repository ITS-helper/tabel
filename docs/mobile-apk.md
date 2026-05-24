# APK — карта BLE (этап 1)

Android-приложение — оболочка **Capacitor** вокруг той же `ble-map.js`, что и на сайте.  
Файлы UI **внутри APK** → перезапуск приложения не зависит от кэша браузера.

## Что умеет этап 1

- Карта, маршруты, метки, фото, правка зон — как на сайте
- Кнопка **«Подготовить»** (бывш. «Офлайн») — маршрут + фото в память приложения (IndexedDB)
- Без интернета после подготовки — метки и скачанные фото из памяти
- Спутниковые **тайлы** без сети по-прежнему не грузятся (этап 2)

## Требования на ПК

- Node.js 20+
- [Android Studio](https://developer.android.com/studio) (SDK, JDK 17)
- Переменная `ANDROID_HOME` или SDK через Android Studio

## Сборка debug APK

```bash
npm install
npm run mobile:build
```

Открыть проект в Android Studio:

```bash
npm run mobile:open
```

**Build → Build Bundle(s) / APK(s) → Build APK(s)**  
APK: `android/app/build/outputs/apk/debug/app-debug.apk`

Или из командной строки (Windows):

```bash
cd android
gradlew.bat assembleDebug
```

Установка на телефон: скопировать `app-debug.apk`, разрешить «Неизвестные источники».

**Windows:** если путь к репозиторию содержит кириллицу (`табель`), в `android/gradle.properties` уже включено `android.overridePathCheck=true`. При странных ошибках Gradle можно клонировать проект в `C:\dev\tabel`.

## Разработка

После правок в `ble-map.js` / `ble-map.html`:

```bash
npm run mobile:sync    # скопировать в mobile/www
npx cap sync android   # или npm run mobile:build
```

Запуск на подключённом телефоне / эмуляторе:

```bash
npm run mobile:run
```

## Структура

| Путь | Назначение |
|------|------------|
| `capacitor.config.ts` | id приложения, `webDir: mobile/www` |
| `scripts/sync-mobile-www.mjs` | копия карты + vendor (Leaflet локально) |
| `mobile/www/` | содержимое WebView (генерируется, не править вручную) |
| `android/` | проект Android Studio |

## Публикация (позже)

- Release APK / AAB: подпись keystore в Android Studio
- Google Play: аккаунт разработчика ($25)
