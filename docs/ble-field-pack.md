# Офлайн-пакет BLE для поля — сборка и публикация

Инструкция для администратора: как собрать архив с метками и фотографиями для работы **без интернета** на объекте, и куда его выложить, чтобы телефоны могли скачать пакет с сайта.

Сайт: [https://its-helper.github.io/tabel/](https://its-helper.github.io/tabel/)  
Карта: кнопка **«Офлайн-пакет»** (на узком экране — **«Пакет»**).

---

## Зачем это нужно

На телефоне режим «скачать сотни фото в браузере» ненадёжен: вкладку может закрыть система, мало памяти, долго.

**Правильная схема:**

1. На **ПК с VPN** один раз собирается файл **`ble-field-pack.zip`**.
2. Архив **публикуется** (GitHub Pages, Supabase Storage или передаётся вручную).
3. На **телефоне** — одна загрузка zip или импорт файла с AirDrop/USB.

В пакете по умолчанию **два фото на метку**: снимок BLE-метки и снимок места установки.

---

## Что понадобится

| Требование | Зачем |
|------------|--------|
| **Node.js** 18+ | Запуск скрипта сборки |
| **VPN** (или сеть без блокировки `*.workers.dev`) | API меток и фото с Cloudflare Worker |
| Клон репозитория **tabel** | Скрипты в `scripts/build-ble-field-pack.mjs` |
| `npm install` в корне репозитория | Зависимость `fflate` для zip |

Учётные данные API заданы в скрипте (как в `ble-map.js`). При необходимости переопределите:

```bat
set BLE_AUTO_USER=impl_dept
set BLE_AUTO_PASS=impl_dept_vsm_2024
```

Опционально: `set BLE_PACK_CONCURRENCY=16` — параллельных загрузок фото (по умолчанию 12).

Опционально: установите **sharp** (`npm i -D sharp`) — сильнее сжимает большие JPEG при сборке.

---

## Сборка на компьютере

### Вариант A — двойной щелчок (Windows)

1. Откройте папку репозитория.
2. Запустите **`ble-field-pack-push.bat`**.
3. Дождитесь окончания (может занять **15–40 минут** в зависимости от сети).

### Вариант B — командная строка

```bash
cd путь/к/репозиторию/tabel
npm install
npm run ble-field-pack
```

### Облегчённый пакет (только 1 фото на метку)

Меньший архив, если места на телефоне мало:

```bash
npm run ble-field-pack:tag-only
```

---

## Что появится после сборки

| Файл | В git | Описание |
|------|-------|----------|
| `data/ble-field-pack.zip` | **Нет** (в `.gitignore`) | Архив для телефонов, обычно **60–120+ МБ** |
| `data/ble-field-pack-meta.json` | **Да** | Метаданные для сайта: URL, размер, число фото |

Пример `ble-field-pack-meta.json` после успешной сборки:

```json
{
  "packUrl": "data/ble-field-pack.zip",
  "updated_at": "2026-05-17T15:41:46.619Z",
  "company_id": 1,
  "markerCount": 860,
  "photosOk": 1640,
  "photosFail": 0,
  "bytesTotal": 95000000,
  "zipBytes": 95000000,
  "tagOnly": false
}
```

- **`photosOk`** — сколько фото реально попало в zip (при двух фото на метку обычно ≈ 2 × `markerCount`).
- **`tagOnly: false`** — полный пакет (метка + место); `true` — только фото метки.
- **`packUrl`** — относительный или абсолютный URL, откуда браузер качает zip (см. ниже).

Если сборка завершилась с **0 фото** или ошибкой `no_photo_urls_in_api` — проверьте VPN и повторите. Старый кэш `ble-map-cache.json` **без ссылок на фото** для пакета не подходит.

---

## Куда выложить zip

Файл **не коммитится** в git (лимит GitHub ~100 МБ на файл, архив часто больше). Нужен **публичный HTTPS-URL** к zip.

### Способ 1 — GitHub Pages (тот же сайт, что табель)

Подходит, если zip **меньше ~100 МБ** или вы готовы использовать [Git LFS](https://git-lfs.github.com/).

**A. Положить zip в репозиторий (если влезает в лимит)**

1. Временно можно убрать строку `data/ble-field-pack.zip` из `.gitignore` **или** использовать Git LFS.
2. Положите `data/ble-field-pack.zip` в репозиторий.
3. В `data/ble-field-pack-meta.json` оставьте:
   ```json
   "packUrl": "data/ble-field-pack.zip"
   ```
4. Закоммитьте **meta + zip** (или zip через LFS), `git push origin main`.
5. После деплоя Pages пакет будет по адресу:  
   `https://its-helper.github.io/tabel/data/ble-field-pack.zip`

**B. GitHub Release (удобно для больших zip)**

1. На GitHub: **Releases** → **Create a new release** → прикрепите `ble-field-pack.zip` как asset.
2. Скопируйте прямую ссылку на файл (вид `.../releases/download/v1.0/ble-field-pack.zip`).
3. В `data/ble-field-pack-meta.json` укажите полный URL:
   ```json
   "packUrl": "https://github.com/ITS-helper/tabel/releases/download/v1.0/ble-field-pack.zip"
   ```
4. Закоммитьте и запушьте **только** `data/ble-field-pack-meta.json`.

### Способ 2 — Supabase Storage (рекомендуется для больших архивов)

1. Supabase Dashboard → **Storage** → создайте bucket, например `public-assets` (public).
2. Загрузите `ble-field-pack.zip`.
3. Скопируйте **public URL** файла.
4. В `data/ble-field-pack-meta.json`:
   ```json
   "packUrl": "https://owcuvcshwtivqueftiuk.supabase.co/storage/v1/object/public/public-assets/ble-field-pack.zip"
   ```
5. Закоммитьте и запушьте meta в `main`.

### Способ 3 — без публикации на сайт

Передайте zip на телефон (AirDrop, USB, Telegram) → в карте **«Офлайн-пакет»** → **загрузить .zip** с телефона.  
`packUrl` в meta можно не менять; «Скачать с сайта» на телефоне будет недоступно, пока не выложите архив.

---

## Публикация meta на сайте (обязательно для «Скачать с сайта»)

После каждой пересборки:

1. Убедитесь, что `data/ble-field-pack-meta.json` обновлён скриптом (`photosOk`, `bytesTotal`, `updated_at`, `tagOnly`).
2. Проверьте **`packUrl`** — путь или URL, по которому **реально** открывается zip в браузере.
3. Закоммитьте meta и запушьте в **`main`**:

```bash
git add data/ble-field-pack-meta.json
git commit -m "Обновить meta офлайн-пакета BLE."
git push origin main
```

4. Дождитесь деплоя GitHub Pages (если используете Actions — зелёный прогон **Deploy Pages**).

Проверка в браузере:

- `https://its-helper.github.io/tabel/data/ble-field-pack-meta.json` — открывается JSON, `photosOk` > 0, `packUrl` задан.
- URL из `packUrl` — начинается скачивание zip.

---

## Как пользоваться на телефоне

1. Откройте сайт → **Карта** → **Офлайн-пакет**.
2. **Рекомендуется:** «Скачать готовый пакет с сайта» (если meta и zip выложены).
3. **Или:** «Загрузить .zip» — файл с ПК.
4. Не сворачивайте вкладку до сообщения «Пакет загружен».
5. На объекте без связи откройте карту снова — метки и фото из пакета.

Старый пакет на телефоне не обновится сам: после новой сборки на ПК **скачайте или импортируйте zip заново**.

---

## Обновление кэша меток (отдельно от пакета)

Пакет с фото **не заменяет** `ble-map-cache.json` (список меток без VPN).

Чтобы обновить только координаты/список меток на сайте:

- `ble-cache-push.bat` или `npm run ble-cache`

Офлайн-пакет имеет смысл пересобирать, когда **обновились фото** или сильно изменился состав меток.

---

## Частые проблемы

| Симптом | Что делать |
|---------|------------|
| `no_photo_urls_in_api` | VPN, повторить сборку; дождаться живого API, не старый кэш |
| `no_photos_downloaded` | Проверить доступ к Yandex Storage / прокси, VPN |
| На телефоне «пакет не выложен» | Нет `packUrl` / `photosOk` в meta или zip недоступен по URL |
| Одно фото вместо двух | Пересобрать **`npm run ble-field-pack`** без `--tag-only` |
| Не влезает в git | Release asset или Supabase Storage, полный URL в `packUrl` |
| QuotaExceeded на телефоне | Удалить данные сайта в настройках браузера или пакет `--tag-only` |

---

## Связанные файлы в репозитории

| Путь | Назначение |
|------|------------|
| `scripts/build-ble-field-pack.mjs` | Сборка zip |
| `ble-field-pack-push.bat` | Запуск сборки в Windows |
| `ble-map.js` | Импорт zip, кнопка «Офлайн-пакет» |
| `data/ble-field-pack-meta.json` | Описание для сайта |
| [`USER_GUIDE.md`](../USER_GUIDE.md) | Раздел 15.7 для пользователей карты |
| [`README.md`](../README.md) | Краткая отсылка «Карта BLE без VPN» |
