# Damage Reports Cloud Flow

The website remains a static GitHub Pages site. Background collection now moves to GitHub Actions.

## What runs in the cloud

Workflow: [`.github/workflows/damage-reports-cron.yml`](../.github/workflows/damage-reports-cron.yml)

It does this:

1. Restores a Telethon session from GitHub Secrets.
2. Imports Telegram history for the target day.
3. Fetches `device.workwatch.pro` incidents for the same day.
4. Sends the Telegram report.
5. Exports `data/damage-reports/*.json` for the static website.
6. Commits refreshed JSON back to `main`, which republishes GitHub Pages.

Schedule: every day at `05:15 UTC`, which is `08:15 Europe/Moscow`.

## Required GitHub Secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_REPORT_CHAT_ID`
- `TELEGRAM_SOURCE_CHAT_ID`
- `TELETHON_API_ID`
- `TELETHON_API_HASH`
- `TELETHON_SESSION_B64`
- `SITE_USERNAME`
- `SITE_PASSWORD`

## How to prepare `TELETHON_SESSION_B64`

Create or refresh the local session first, then encode it:

```powershell
cd D:\tabel\tgdevice
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m tgdevice.main telethon-login
[Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\tabel\data\telethon_user.session"))
```

Copy the printed Base64 string into the GitHub secret `TELETHON_SESSION_B64`.

## Manual backfill

Open GitHub Actions and run `Damage reports cloud refresh` manually.

- `target_date`: `YYYY-MM-DD`
- `send_telegram`: `true` or `false`

The export script preserves older JSON day files already committed in `data/damage-reports`, so a one-day cloud run does not wipe site history.
