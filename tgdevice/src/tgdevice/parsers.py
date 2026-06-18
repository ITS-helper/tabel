from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re

from .models import DeviceIncident


DATE_FORMATS = (
    "%d.%m.%y / %H:%M",
    "%d.%m.%Y / %H:%M",
    "%d.%m.%Y %H:%M",
    "%d.%m.%y %H:%M",
)


@dataclass(slots=True)
class ParsedTelegramMessage:
    incident: DeviceIncident | None
    error: str | None


def _normalize_spaces(value: str) -> str:
    return re.sub(r"[ \t]+", " ", value.strip())


def parse_message_datetime(value: str) -> datetime:
    clean = _normalize_spaces(value.replace("  ", " "))
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(clean, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unsupported date format: {value}")


def looks_like_template_message(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 6:
        return False
    if not lines[0].startswith("#"):
        return False
    return any(re.search(r"uid\s*[-: ]\s*[a-z0-9]+", line, flags=re.IGNORECASE) for line in lines)


def parse_telegram_incident(
    text: str,
    *,
    external_id: str,
    fallback_created_at: datetime,
) -> ParsedTelegramMessage:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 6:
        return ParsedTelegramMessage(None, "Too few non-empty lines")

    issue_type = lines[0].lstrip("#").strip()

    try:
        created_at = parse_message_datetime(lines[1])
    except ValueError:
        created_at = fallback_created_at

    uid_match = re.search(r"uid\s*[-: ]\s*([a-z0-9]+)", lines[2], flags=re.IGNORECASE)
    if not uid_match:
        return ParsedTelegramMessage(None, "Uid not found")
    uid = uid_match.group(1).lower()

    device_code = _extract_device_code(lines[3])
    employee_number = _extract_after_dash(lines[4])
    employee_name = lines[5].strip() if len(lines) >= 6 else None
    reporter_username = lines[6].strip() if len(lines) >= 7 else None

    return ParsedTelegramMessage(
        DeviceIncident(
            source="telegram",
            external_id=external_id,
            created_at=created_at,
            uid=uid,
            issue_type=issue_type,
            device_code=device_code,
            employee_number=employee_number,
            employee_name=employee_name,
            reporter_username=reporter_username,
            raw_text=text,
        ),
        None,
    )


def _extract_device_code(value: str) -> str | None:
    compact = re.sub(r"\s+", "", value.upper())
    if re.fullmatch(r"W\d-?\d+", compact):
        if "-" not in compact:
            return compact[:2] + "-" + compact[2:]
        return compact
    return _extract_after_dash(value)


def _extract_after_dash(value: str) -> str | None:
    match = re.search(r"[-:]\s*(.+)$", value)
    if not match:
        compact = value.replace(" ", "")
        return compact or None
    return match.group(1).strip().replace(" ", "")


def extract_uid_from_text(value: str) -> str | None:
    match = re.search(r"uid\s*[-: ]\s*([a-z0-9]+)", value, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).lower()