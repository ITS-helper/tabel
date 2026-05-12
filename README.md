# WORK WATCH — табель рабочего времени

Веб-прототип графика смен: закреплённые столбцы, фильтр по отметкам легенды, экспорт JSON.

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

## Структура

| Файл        | Назначение        |
|------------|-------------------|
| `index.html` | Разметка          |
| `styles.css` | Стили             |
| `app.js`     | Логика и демо-данные |

Приложение без сборки, только статические файлы.
