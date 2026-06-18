from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import qrcode
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession

from ..config import Settings
from ..db import Database
from ..parsers import looks_like_template_message, parse_telegram_incident


class TelethonHistoryCollector:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db

    def login(self) -> None:
        asyncio.run(self._login())

    def login_qr(self) -> Path:
        return asyncio.run(self._login_qr())

    def export_string_session(self) -> str:
        return asyncio.run(self._export_string_session())

    def import_day(self, target_day: date) -> int:
        return asyncio.run(self._import_day(target_day))

    async def _login(self) -> None:
        async with self._client() as client:
            await client.start()

    async def _login_qr(self) -> Path:
        qr_path = Path("data/telethon-login-qr.png")
        qr_path.parent.mkdir(parents=True, exist_ok=True)

        client = self._client()
        await client.connect()
        try:
            qr_login = await client.qr_login()
            image = qrcode.make(qr_login.url)
            image.save(qr_path)
            print(f"QR image saved to: {qr_path.resolve()}")
            print("Open the image and scan it from Telegram: Settings -> Devices -> Link Desktop Device")
            try:
                await qr_login.wait(timeout=180)
            except SessionPasswordNeededError:
                password = input("Enter your Telegram 2FA password: ")
                await client.sign_in(password=password)
        finally:
            await client.disconnect()
        return qr_path

    async def _export_string_session(self) -> str:
        async with self._client() as client:
            if not await client.is_user_authorized():
                await client.start()
            return StringSession.save(client.session)

    async def _import_day(self, target_day: date) -> int:
        tz = ZoneInfo(self.settings.timezone)
        day_start_local = datetime.combine(target_day, time.min, tzinfo=tz)
        day_end_local = day_start_local + timedelta(days=1)
        start_utc = day_start_local.astimezone(timezone.utc)
        end_utc = day_end_local.astimezone(timezone.utc)

        processed = 0
        client = self._client()
        await client.connect()
        try:
            if not await client.is_user_authorized():
                raise RuntimeError("Telethon session is not authorized. Run telethon_login.cmd first.")
            entity = await client.get_entity(int(self.settings.telegram_source_chat_id))
            async for message in client.iter_messages(entity, offset_date=end_utc):
                if message.date is None:
                    continue
                message_dt = message.date.astimezone(timezone.utc)
                if message_dt >= end_utc:
                    continue
                if message_dt < start_utc:
                    break

                text = message.message or ""
                if not text.strip() or not looks_like_template_message(text):
                    continue

                external_id = f"{self.settings.telegram_source_chat_id}:{message.id}"
                fallback_created_at = message_dt.astimezone(tz).replace(tzinfo=None)
                parsed = parse_telegram_incident(
                    text,
                    external_id=external_id,
                    fallback_created_at=fallback_created_at,
                )
                if parsed.incident:
                    self.db.upsert_incident(parsed.incident)
                elif parsed.error:
                    self.db.save_parse_error(
                        external_id=external_id,
                        chat_id=self.settings.telegram_source_chat_id,
                        created_at=fallback_created_at,
                        error=parsed.error,
                        raw_text=text,
                    )
                processed += 1
        finally:
            await client.disconnect()

        return processed

    def _client(self) -> TelegramClient:
        session = (
            StringSession(self.settings.telethon_string_session)
            if self.settings.telethon_string_session
            else self.settings.telethon_session_name
        )
        return TelegramClient(
            session,
            int(self.settings.telethon_api_id),
            self.settings.telethon_api_hash,
            lang_code="ru",
            system_lang_code="ru-RU",
        )
