from datetime import datetime

from tgdevice.parsers import parse_telegram_incident


def test_parse_telegram_incident_with_short_date() -> None:
    text = """#\u0417\u0430\u0432\u0438\u0441\u0448\u0430\u044f_\u0441\u043c\u0435\u043d\u0430
17.06.26 / 12:10
Uid - 6c0311fefff7a608
W2-001582
\u0422\u043d - 10903
\u0425\u043e\u043c\u0443\u0448\u043e\u0432 \u0410\u0431\u0434\u0443\u0434\u0436\u0430\u0431\u0431\u043e\u0440 \u0423\u043c\u0430\u0440\u043e\u0432\u0438\u0447
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
    text = """#\u041f\u0430\u0434\u0435\u043d\u0438\u0435
17.06.2026 11:28
Uid-8cfb10fefff7a608
W2-000906
\u0422\u043d-434
\u0411\u0430\u0439\u0433\u0430\u0437\u0438\u0435\u0432 \u0410\u0434\u0438\u043b\u0435\u0442 \u041a\u0435\u043d\u0435\u0448\u0431\u0435\u043a\u043e\u0432\u0438\u0447
@Ruslanburangulovv
"""
    parsed = parse_telegram_incident(
        text,
        external_id="chat:2",
        fallback_created_at=datetime(2026, 6, 17, 11, 28),
    )

    assert parsed.error is None
    assert parsed.incident is not None
    assert parsed.incident.issue_type == "\u041f\u0430\u0434\u0435\u043d\u0438\u0435"
    assert parsed.incident.uid == "8cfb10fefff7a608"


def test_parse_telegram_incident_with_eui_prefix() -> None:
    text = """#\u041f\u0430\u0434\u0435\u043d\u0438\u0435
19.06.26 / 4:45
EUI - b81811fefff7a608
W2 - 001030
TH - 8816
\u0421\u0438\u043d\u0433\u0445 \u0427\u0430\u043d\u0434\u0430\u043d \u041a\u0443\u043c\u0430\u0440
"""
    parsed = parse_telegram_incident(
        text,
        external_id="chat:3",
        fallback_created_at=datetime(2026, 6, 19, 4, 45),
    )

    assert parsed.error is None
    assert parsed.incident is not None
    assert parsed.incident.uid == "b81811fefff7a608"
    assert parsed.incident.device_code == "W2-001030"
    assert parsed.incident.employee_number == "8816"
