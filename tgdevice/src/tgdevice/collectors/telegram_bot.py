from __future__ import annotations

from datetime import datetime, timezone
import json
import time
from typing import Any

import requests

from ..config import Settings
from ..db import Database
from ..parsers import parse_telegram_incident


class TelegramArchiver:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self.base_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}"

    def archive_once(self, limit: int = 100) -> int:
        offset = self._get_offset()
        params = {"timeout": 10, "allowed_updates": json.dumps(["message", "channel_post"])}
        if offset is not None:
            params["offset"] = offset

        response = requests.get(f"{self.base_url}/getUpdates", params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(f"Telegram API error: {payload}")

        processed = 0
        for update in payload.get("result", [])[:limit]:
            self.archive_update(update)
            processed += 1

        return processed

    def poll_forever(self) -> None:
        while True:
            self.archive_once()
            time.sleep(self.settings.poll_sleep_seconds)

    def archive_update(self, update: dict[str, Any]) -> None:
        update_id = update["update_id"]
        message = update.get("message") or update.get("channel_post")
        if not message:
            self._set_offset(update_id + 1)
            return

        chat_id = str(message["chat"]["id"])
        message_id = message.get("message_id")
        message_date = datetime.fromtimestamp(message["date"], tz=timezone.utc).replace(tzinfo=None)
        text = message.get("text") or message.get("caption")

        self.db.save_update(
            update_id=update_id,
            chat_id=chat_id,
            message_id=message_id,
            message_date=message_date,
            raw_json=update,
            text=text,
        )

        if chat_id == self.settings.telegram_source_chat_id and text:
            external_id = f"{chat_id}:{message_id}"
            parsed = parse_telegram_incident(
                text,
                external_id=external_id,
                fallback_created_at=message_date,
            )
            if parsed.incident:
                self.db.upsert_incident(parsed.incident)
            elif parsed.error:
                self.db.save_parse_error(
                    external_id=external_id,
                    chat_id=chat_id,
                    created_at=message_date,
                    error=parsed.error,
                    raw_text=text,
                )

        self._set_offset(update_id + 1)

    def send_message(self, text: str) -> None:
        response = requests.post(
            f"{self.base_url}/sendMessage",
            json={
                "chat_id": self.settings.telegram_report_chat_id,
                "text": text,
                "disable_web_page_preview": True,
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(f"Telegram sendMessage failed: {payload}")

    def _get_offset(self) -> int | None:
        value = self.db.get_state("telegram_update_offset")
        return int(value) if value else None

    def _set_offset(self, offset: int) -> None:
        self.db.set_state("telegram_update_offset", str(offset))
