from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import re

from dotenv import load_dotenv


@dataclass(frozen=True, slots=True)
class TelegramDestination:
    chat_id: str
    message_thread_id: int | None = None


@dataclass(slots=True)
class Settings:
    telegram_bot_token: str
    telegram_report_chat_id: str
    telegram_report_chat_ids: str
    telegram_source_chat_id: str
    telethon_api_id: str
    telethon_api_hash: str
    telethon_session_name: str
    telethon_string_session: str
    site_base_url: str
    site_login_path: str
    site_service_requests_path: str
    site_username: str
    site_password: str
    database_path: Path
    timezone: str
    report_hour: str
    poll_sleep_seconds: int

    def report_destinations(self) -> list[TelegramDestination]:
        raw_values = [self.telegram_report_chat_ids, self.telegram_report_chat_id]
        result: list[TelegramDestination] = []
        seen: set[tuple[str, int | None]] = set()
        for raw in raw_values:
            for part in raw.split(","):
                destination = _parse_report_destination(part)
                if not destination:
                    continue
                key = (destination.chat_id, destination.message_thread_id)
                if key in seen:
                    continue
                seen.add(key)
                result.append(destination)
        return result

    def source_destination(self) -> TelegramDestination | None:
        return _parse_report_destination(self.telegram_source_chat_id)


def load_settings(env_path: str | None = None) -> Settings:
    load_dotenv(env_path)
    db_path = Path(os.getenv("DATABASE_PATH", "./data/tgdevice.sqlite3")).expanduser()
    return Settings(
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_report_chat_id=os.getenv("TELEGRAM_REPORT_CHAT_ID", ""),
        telegram_report_chat_ids=os.getenv("TELEGRAM_REPORT_CHAT_IDS", ""),
        telegram_source_chat_id=os.getenv("TELEGRAM_SOURCE_CHAT_ID", ""),
        telethon_api_id=os.getenv("TELETHON_API_ID", ""),
        telethon_api_hash=os.getenv("TELETHON_API_HASH", ""),
        telethon_session_name=os.getenv("TELETHON_SESSION_NAME", "./data/telethon_user"),
        telethon_string_session=os.getenv("TELETHON_STRING_SESSION", ""),
        site_base_url=os.getenv("SITE_BASE_URL", "https://device.workwatch.pro/"),
        site_login_path=os.getenv("SITE_LOGIN_PATH", "/login.php"),
        site_service_requests_path=os.getenv(
            "SITE_SERVICE_REQUESTS_PATH", "/views/service_requests/index.php"
        ),
        site_username=os.getenv("SITE_USERNAME", ""),
        site_password=os.getenv("SITE_PASSWORD", ""),
        database_path=db_path,
        timezone=os.getenv("TIMEZONE", "Europe/Moscow"),
        report_hour=os.getenv("REPORT_HOUR", "08:00"),
        poll_sleep_seconds=int(os.getenv("POLL_SLEEP_SECONDS", "30")),
    )


def _parse_report_destination(raw: str) -> TelegramDestination | None:
    value = raw.strip()
    if not value:
        return None

    link_match = re.fullmatch(r"https://t\.me/c/(\d+)/(\d+)", value)
    if link_match:
        return TelegramDestination(
            chat_id=f"-100{link_match.group(1)}",
            message_thread_id=int(link_match.group(2)),
        )

    path_match = re.fullmatch(r"(-100\d+)[/#](\d+)", value)
    if path_match:
        return TelegramDestination(
            chat_id=path_match.group(1),
            message_thread_id=int(path_match.group(2)),
        )

    return TelegramDestination(chat_id=value)
