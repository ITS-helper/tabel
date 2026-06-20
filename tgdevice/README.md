# tgdevice

Local free service that:

- archives Telegram messages about broken devices
- collects service requests from `device.workwatch.pro`
- matches records by `Uid`
- sends a daily summary to Telegram direct messages

## Flow

Sources:

1. Telegram supergroup/channel with strict template messages.
2. Web page `device.workwatch.pro/views/service_requests/index.php` with service requests.

The service stores raw and normalized data in local `SQLite`, then builds a daily report for the previous day.

## Telegram modes

### Bot API mode

Works for new messages only. It archives `getUpdates` into local `SQLite`.

### Telethon mode

Works for history backfill. It reads old messages from the Telegram chat for a selected day.

For Telethon you need:

- `TELETHON_API_ID`
- `TELETHON_API_HASH`

Both are created at `https://my.telegram.org`.

## Setup

```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
py -3 -m pip install -e .
Copy-Item .env.example .env
```

Fill `.env`.

## Commands

Init database:

```powershell
py -3 -m tgdevice.main init-db
```

Fetch new Telegram updates once:

```powershell
py -3 -m tgdevice.main archive-updates
```

Run continuous Telegram poller:

```powershell
py -3 -m tgdevice.main poll-updates
```

Create Telethon session:

```powershell
py -3 -m tgdevice.main telethon-login
```

Import Telegram history for a specific day:

```powershell
py -3 -m tgdevice.main import-history --date 2026-06-17
```

Fetch site requests for a specific day:

```powershell
py -3 -m tgdevice.main fetch-site --date 2026-06-17
```

Build report and send it to Telegram:

```powershell
py -3 -m tgdevice.main report --date 2026-06-17 --send
```

`TELEGRAM_REPORT_CHAT_ID` may contain one destination or several destinations separated by commas.
Supported forms: `-100...`, `-100.../4`, `https://t.me/c/.../4`.

`TELEGRAM_SOURCE_CHAT_ID` supports the same chat/topic formats.
Use a topic form when incidents live inside a forum topic instead of the main chat feed.

Full daily run:

```powershell
py -3 -m tgdevice.main run-daily
```

If Telegram messages are already archived by another bot process:

```powershell
py -3 -m tgdevice.main run-daily --skip-telegram-fetch
```

## Quick backfill flow

```powershell
py -3 -m tgdevice.main telethon-login
py -3 -m tgdevice.main import-history --date 2026-06-17
py -3 -m tgdevice.main fetch-site --date 2026-06-17
py -3 -m tgdevice.main report --date 2026-06-17 --send
```

## Security

Keep the bot token, site credentials, Telethon API credentials, and session files only on this machine.

If the bot token was exposed in chat or logs, rotate it in BotFather.
