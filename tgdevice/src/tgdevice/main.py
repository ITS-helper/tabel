from __future__ import annotations

from argparse import ArgumentParser
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .collectors.site import SiteCollector
from .collectors.telegram_bot import TelegramArchiver
from .collectors.telegram_telethon import TelethonHistoryCollector
from .config import load_settings
from .db import Database
from .report import build_daily_report_html, build_daily_report_plain


def main() -> None:
    parser = ArgumentParser(prog="tgdevice")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init-db")

    archive_parser = subparsers.add_parser("archive-updates")
    archive_parser.add_argument("--limit", type=int, default=100)

    subparsers.add_parser("poll-updates")
    subparsers.add_parser("telethon-login")
    subparsers.add_parser("telethon-login-qr")
    subparsers.add_parser("telethon-string-session")

    import_history_parser = subparsers.add_parser("import-history")
    import_history_parser.add_argument("--date", default=None)

    fetch_site_parser = subparsers.add_parser("fetch-site")
    fetch_site_parser.add_argument("--date", default=None)

    report_parser = subparsers.add_parser("report")
    report_parser.add_argument("--date", default=None)
    report_parser.add_argument("--send", action="store_true")

    run_daily_parser = subparsers.add_parser("run-daily")
    run_daily_parser.add_argument("--date", default=None)
    run_daily_parser.add_argument("--skip-telegram-fetch", action="store_true")
    run_daily_parser.add_argument("--skip-site-fetch", action="store_true")

    args = parser.parse_args()

    settings = load_settings()
    db = Database(settings.database_path)
    db.init()

    if args.command == "init-db":
        return

    if args.command in {"archive-updates", "poll-updates", "report", "run-daily"}:
        _require_setting(settings.telegram_bot_token, "TELEGRAM_BOT_TOKEN")
    if args.command in {"telethon-login", "telethon-login-qr", "telethon-string-session", "import-history"}:
        _require_setting(settings.telethon_api_id, "TELETHON_API_ID")
        _require_setting(settings.telethon_api_hash, "TELETHON_API_HASH")
    if args.command in {"report", "run-daily"} and getattr(args, "send", True):
        if not settings.report_destinations():
            raise RuntimeError(
                "Missing required setting: TELEGRAM_REPORT_CHAT_ID or TELEGRAM_REPORT_CHAT_IDS"
            )
    if args.command in {"fetch-site", "run-daily"}:
        _require_setting(settings.site_username, "SITE_USERNAME")
        _require_setting(settings.site_password, "SITE_PASSWORD")

    telegram = TelegramArchiver(settings, db)
    telethon_collector = TelethonHistoryCollector(settings, db)
    site = SiteCollector(settings, db)

    if args.command == "archive-updates":
        count = telegram.archive_once(limit=args.limit)
        print(f"Archived {count} update(s)")
        return

    if args.command == "poll-updates":
        telegram.poll_forever()
        return

    if args.command == "telethon-login":
        telethon_collector.login()
        print("Telethon session saved")
        return

    if args.command == "telethon-login-qr":
        qr_path = telethon_collector.login_qr()
        print(f"Telethon QR session saved via {qr_path}")
        return

    if args.command == "telethon-string-session":
        print(telethon_collector.export_string_session())
        return

    if args.command == "import-history":
        target_day = _resolve_day(args.date, settings.timezone)
        count = telethon_collector.import_day(target_day)
        print(f"Imported {count} Telegram message(s) for {target_day.isoformat()}")
        return

    if args.command == "fetch-site":
        target_day = _resolve_day(args.date, settings.timezone)
        incidents = site.collect_for_day(target_day)
        print(f"Fetched {len(incidents)} site incident(s) for {target_day.isoformat()}")
        return

    if args.command == "report":
        target_day = _resolve_day(args.date, settings.timezone)
        report_text = build_daily_report_plain(db, target_day)
        print(report_text)
        if args.send:
            telegram.send_message(build_daily_report_html(db, target_day), parse_mode="HTML")
        return

    if args.command == "run-daily":
        target_day = _resolve_day(args.date, settings.timezone)
        if not args.skip_telegram_fetch:
            telegram.archive_once(limit=100)
        if not args.skip_site_fetch:
            site.collect_for_day(target_day)
        report_text = build_daily_report_plain(db, target_day)
        print(report_text)
        telegram.send_message(build_daily_report_html(db, target_day), parse_mode="HTML")
        return


def _resolve_day(raw_value: str | None, timezone_name: str):
    if raw_value:
        return datetime.strptime(raw_value, "%Y-%m-%d").date()
    now = datetime.now(ZoneInfo(timezone_name))
    return (now - timedelta(days=1)).date()


def _require_setting(value: str, setting_name: str) -> None:
    if not value:
        raise RuntimeError(f"Missing required setting: {setting_name}")


if __name__ == "__main__":
    main()
