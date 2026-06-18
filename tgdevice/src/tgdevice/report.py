from __future__ import annotations

from datetime import date

from .db import Database
from .models import DeviceIncident, MatchResult


def match_incidents(
    telegram_incidents: list[DeviceIncident], site_incidents: list[DeviceIncident]
) -> MatchResult:
    site_by_uid: dict[str, list[DeviceIncident]] = {}
    for incident in site_incidents:
        site_by_uid.setdefault(incident.uid, []).append(incident)

    matched: list[tuple[DeviceIncident, DeviceIncident]] = []
    telegram_only: list[DeviceIncident] = []
    used_site_ids: set[str] = set()

    for telegram_incident in telegram_incidents:
        candidates = site_by_uid.get(telegram_incident.uid, [])
        candidate = next(
            (item for item in candidates if item.external_id not in used_site_ids),
            None,
        )
        if candidate is None:
            telegram_only.append(telegram_incident)
            continue
        matched.append((telegram_incident, candidate))
        used_site_ids.add(candidate.external_id)

    site_only = [item for item in site_incidents if item.external_id not in used_site_ids]
    return MatchResult(telegram_only=telegram_only, site_only=site_only, matched=matched)


def build_daily_report(db: Database, target_day: date) -> str:
    telegram_incidents = db.load_incidents_for_day("telegram", target_day)
    site_incidents = db.load_incidents_for_day("site", target_day)
    parse_errors = db.count_parse_errors_for_day(target_day)
    result = match_incidents(telegram_incidents, site_incidents)

    lines = [
        f"Device report for {target_day.strftime('%d.%m.%Y')}",
        "",
        f"Telegram total: {len(telegram_incidents)}",
        f"Site total: {len(site_incidents)}",
        f"Matched by Uid: {len(result.matched)}",
        f"Telegram only: {len(result.telegram_only)}",
        f"Site only: {len(result.site_only)}",
        f"Telegram parse errors: {parse_errors}",
        "",
    ]

    if result.telegram_only:
        lines.append("Telegram without site request:")
        for incident in result.telegram_only[:20]:
            lines.append(_format_incident(incident))
        lines.append("")

    if result.site_only:
        lines.append("Site request without Telegram message:")
        for incident in result.site_only[:20]:
            lines.append(_format_incident(incident))
        lines.append("")

    if result.matched:
        lines.append("Matched records:")
        for telegram_incident, site_incident in result.matched[:20]:
            lines.append(
                f"- Uid {telegram_incident.uid} | TG {telegram_incident.issue_type} | SITE {site_incident.issue_type}"
            )

    return "\n".join(lines).strip()


def _format_incident(incident: DeviceIncident) -> str:
    parts = [
        f"- {incident.created_at.strftime('%H:%M')}",
        f"Uid {incident.uid}",
        incident.issue_type,
    ]
    if incident.device_code:
        parts.append(incident.device_code)
    if incident.employee_name:
        parts.append(incident.employee_name)
    return " | ".join(parts)
