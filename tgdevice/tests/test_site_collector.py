from datetime import date
from pathlib import Path

from tgdevice.collectors.site import SiteCollector
from tgdevice.config import Settings


class DummyDb:
    def __init__(self) -> None:
        self.incidents = []

    def upsert_incident(self, incident) -> None:
        self.incidents.append(incident)


class DummyResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class DummySession:
    def __init__(self, pages: dict[int, str]) -> None:
        self.pages = pages

    def get(self, url: str, params=None, timeout: int = 30):
        page = 1 if not params else int(params.get("page", 1))
        return DummyResponse(self.pages[page])


def _settings() -> Settings:
    return Settings(
        telegram_bot_token="",
        telegram_report_chat_id="",
        telegram_report_chat_ids="",
        telegram_source_chat_id="",
        telethon_api_id="",
        telethon_api_hash="",
        telethon_session_name="",
        telethon_string_session="",
        site_base_url="https://device.workwatch.pro/",
        site_login_path="/login.php",
        site_service_requests_path="/views/service_requests/index.php",
        site_username="",
        site_password="",
        database_path=Path("dummy.sqlite3"),
        timezone="Europe/Moscow",
        report_hour="08:00",
        poll_sleep_seconds=30,
    )


def _page(rows: list[tuple[str, str, str]], links: list[str]) -> str:
    links_html = "".join(f'<a href="{href}">{href}</a>' for href in links)
    body_rows = "".join(
        (
            "<tr>"
            f"<td>{request_number}</td>"
            "<td>W2-000001</td>"
            "<td>a41c 11fefff7a608</td>"
            "<td>Часы</td>"
            "<td>-</td>"
            "<td>-</td>"
            "<td>-</td>"
            f"<td>{problem}</td>"
            "<td>-</td>"
            f"<td>{created_at}</td>"
            "<td>Tester</td>"
            '<td><a href="view.php?id=1">Открыть</a></td>'
            "</tr>"
        )
        for request_number, created_at, problem in rows
    )
    return (
        "<html><body>"
        f"{links_html}"
        "<table>"
        "<tr>"
        "<th>Номер заявки</th><th>Серийный номер</th><th>MAC / EUI</th><th>Тип</th>"
        "<th>Статус устройства</th><th>Объект</th><th>Неисправность</th><th>Проблема</th>"
        "<th>Статус заявки</th><th>Создана</th><th>Создал</th><th></th>"
        "</tr>"
        f"{body_rows}"
        "</table>"
        "</body></html>"
    )


def test_collect_for_day_walks_to_next_page_for_split_day() -> None:
    target_day = date(2026, 6, 18)
    db = DummyDb()
    collector = SiteCollector(_settings(), db)
    collector._login = lambda: None
    collector.session = DummySession(
        {
            1: _page(
                [
                    ("SR-1", "20.06.2026 13:14", "new"),
                    ("SR-2", "19.06.2026 03:39", "new"),
                ],
                ["?page=2"],
            ),
            2: _page(
                [
                    ("SR-3", "18.06.2026 09:05", "target-a"),
                    ("SR-4", "18.06.2026 08:33", "target-b"),
                ],
                ["?page=3"],
            ),
            3: _page(
                [
                    ("SR-5", "18.06.2026 07:55", "target-c"),
                    ("SR-6", "16.06.2026 13:56", "older"),
                ],
                [],
            ),
        }
    )

    incidents = collector.collect_for_day(target_day)

    assert [item.external_id for item in incidents] == ["SR-3", "SR-4", "SR-5"]
    assert [item.external_id for item in db.incidents] == ["SR-3", "SR-4", "SR-5"]
