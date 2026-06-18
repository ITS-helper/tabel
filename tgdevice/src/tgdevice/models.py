from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class DeviceIncident:
    source: str
    external_id: str
    created_at: datetime
    uid: str
    issue_type: str
    device_code: str | None
    employee_number: str | None
    employee_name: str | None
    reporter_username: str | None
    raw_text: str


@dataclass(slots=True)
class MatchResult:
    telegram_only: list[DeviceIncident]
    site_only: list[DeviceIncident]
    matched: list[tuple[DeviceIncident, DeviceIncident]]
