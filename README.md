# WORK WATCH — табель рабочего времени

Веб-прототип графика смен: закреплённые столбцы, фильтр по отметкам легенды, блок **«Сводка»** (сегодня / завтра по объекту), карточки **«Отпуска»** (цепочки **ВП** + **ОТ**), экспорт JSON. Без сборки — только статические файлы.

## Запуск локально

Откройте в браузере файл [`index.html`](index.html) или поднимите любой статический сервер в корне репозитория.

## GitHub Pages

### Вариант A — через GitHub Actions (рекомендуется)

В репозитории есть workflow `.github/workflows/pages.yml`. После пуша в `main`:

1. **Settings** → **Pages** → раздел **Build and deployment**.
2. **Source**: выберите **GitHub Actions** (не «Deploy from a branch»).
3. Во вкладке **Actions** дождитесь зелёного прогона **Deploy Pages**.

Сайт: `https://its-helper.github.io/tabel/`

### Вариант B — только ветка, без Actions

1. **Settings** → **Pages** → Source: **Deploy from a branch**.
2. Branch: **main**, folder: **/ (root)** → Save.

Если видите **404 There isn't a GitHub Pages site here**, чаще всего Pages ещё не включали или не сохранили источник. Для **приватного** репозитория на бесплатном тарифе Pages недоступен — репозиторий должен быть **public**.

---

## Синхронизация с Supabase (важно для доработок)

Между браузерами шарится **общее состояние табеля** через таблицу **`tabel_state`** (REST API Supabase). Схема и комментарии: [`supabase-schema.sql`](supabase-schema.sql).

### Поведение

- При загрузке приложения вызывается **`pull`** последнего `payload` для строки с `id = global`, затем **`render()`**.
- После правок, которые меняют общие данные, вызывается **`scheduleRemotePersistDebounced()`** — через **~900 ms** выполняется **`push`** (upsert того же `payload`).

### Что входит в `payload` (уходит в облако)

- правки ячеек графика по месяцам;
- состав команд (ФИО → объект) и переименование вкладок объектов;
- переопределения ТН / должности и вручную добавленные строки;
- флаг «Показать всех» в легенде.

### Что остаётся только в этом браузере

- выбранный месяц и вкладка объекта, фильтр легенды, режим просмотр/редактирование;
- сворачивание панелей (Сводка / Объекты / Отпуска), видимость закреплённых колонок, тема.

**Если добавляете новое «общее» состояние** — расширьте `buildSharedPayload` / `applySharedPayload` в `app.js` и при необходимости обновите `supabase-schema.sql`.

Расширенные пометки для Cursor: [`.cursor/rules/workwatch-remote-sync.mdc`](.cursor/rules/workwatch-remote-sync.mdc).

---

## Структура репозитория

| Путь | Назначение |
|------|------------|
| [`index.html`](index.html) | Разметка |
| [`styles.css`](styles.css) | Стили (в т.ч. сводка, шапка-«капсулы», график) |
| [`app.js`](app.js) | Логика, `DATABASE`, Supabase, рендер |
| [`scripts/`](scripts/) | Выгрузки под месяцы (например `parsed-employees-may.js`) |
| [`.cursor/rules/`](.cursor/rules/) | Правила для Cursor: Git (`main`), синхронизация, визуальный стиль сводки/шапки |

---

## Подсказки для Cursor / продолжение работы

- Контекст проекта и ссылки на правила: [`.cursor/rules/workwatch-project-overview.mdc`](.cursor/rules/workwatch-project-overview.mdc).
- Визуальный язык сводки и шапки: [`.cursor/rules/workwatch-summary-visual-style.mdc`](.cursor/rules/workwatch-summary-visual-style.mdc).

---

## Git

Ветка разработки по умолчанию: **`main`**, пуш в **`origin main`** (без отдельных feature-веток, если не оговорено иначе). См. [`.cursor/rules/git-push-main.mdc`](.cursor/rules/git-push-main.mdc).
