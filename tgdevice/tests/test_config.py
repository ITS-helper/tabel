from pathlib import Path

from tgdevice.config import Settings, TelegramDestination


def _settings(source_chat_id: str) -> Settings:
    return Settings(
        telegram_bot_token="",
        telegram_report_chat_id="",
        telegram_report_chat_ids="",
        telegram_source_chat_id=source_chat_id,
        telethon_api_id="1",
        telethon_api_hash="hash",
        telethon_session_name="./data/telethon_user",
        telethon_string_session="",
        site_base_url="https://device.workwatch.pro/",
        site_login_path="/login.php",
        site_service_requests_path="/views/service_requests/index.php",
        site_username="",
        site_password="",
        database_path=Path("data/tgdevice.sqlite3"),
        timezone="Europe/Moscow",
        report_hour="08:00",
        poll_sleep_seconds=30,
    )


def test_source_destination_parses_plain_chat_id() -> None:
    settings = _settings("-1001234567890")

    assert settings.source_destination() == TelegramDestination(chat_id="-1001234567890")


def test_source_destination_parses_chat_topic_pair() -> None:
    settings = _settings("-1001234567890/42")

    assert settings.source_destination() == TelegramDestination(
        chat_id="-1001234567890",
        message_thread_id=42,
    )


def test_source_destination_parses_t_me_link() -> None:
    settings = _settings("https://t.me/c/1234567890/42")

    assert settings.source_destination() == TelegramDestination(
        chat_id="-1001234567890",
        message_thread_id=42,
    )
