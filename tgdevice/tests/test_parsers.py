from datetime import datetime

from tgdevice.parsers import parse_telegram_incident


def test_parse_telegram_incident_with_short_date() -> None:
    text = """#Зависшая_смена
17.06.26 / 12:10
Uid - 6c0311fefff7a608
W2-001582
Тн - 10903
Хомушов Абдуджаббор Умарович
@Ruslanburangulovv
"""
    parsed = parse_telegram_incident(
        text,
        external_id="chat:1",
        fallback_created_at=datetime(2026, 6, 17, 12, 10),
    )

    assert parsed.error is None
    assert parsed.incident is not None
    assert parsed.incident.uid == "6c0311fefff7a608"
    assert parsed.incident.device_code == "W2-001582"
    assert parsed.incident.employee_number == "10903"


def test_parse_telegram_incident_with_long_date() -> None:
    text = """#Падение
17.06.2026 11:28
Uid-8cfb10fefff7a608
W2-000906
Тн-434
Байгазиев Адилет Кенешбекович
@Ruslanburangulovv
"""
    parsed = parse_telegram_incident(
        text,
        external_id="chat:2",
        fallback_created_at=datetime(2026, 6, 17, 11, 28),
    )

    assert parsed.error is None
    assert parsed.incident is not None
    assert parsed.incident.issue_type == "Падение"
    assert parsed.incident.uid == "8cfb10fefff7a608"
