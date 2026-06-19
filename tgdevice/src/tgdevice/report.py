from __future__ import annotations

from datetime import date
import html

from .db import Database
from .models import DeviceIncident, MatchResult

FOOTER_LINES = [
    "Anton",
    "@Uglu_Hog",
    "@OlegSamotokhin",
    "@Ruslanburangulovv",
    "@NURLAN_MURZABAEV",
]

TITLE = "\u041f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f \u043e\u0442"
SOFTWARE = "\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u043d\u044b\u0435"
HARDWARE = "\u0410\u043f\u043f\u0430\u0440\u0430\u0442\u043d\u044b\u0435"
TOTAL = "\u0418\u0442\u043e\u0433\u043e \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432"
MATCHED = "\u0421\u043e\u0432\u043f\u0430\u043b\u043e"


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
        candidate = next((item for item in candidates if item.external_id not in used_site_ids), None)
        if candidate is None:
            telegram_only.append(telegram_incident)
            continue
        matched.append((telegram_incident, candidate))
        used_site_ids.add(candidate.external_id)

    site_only = [item for item in site_incidents if item.external_id not in used_site_ids]
    return MatchResult(telegram_only=telegram_only, site_only=site_only, matched=matched)


def build_daily_report_plain(db: Database, target_day: date) -> str:
    telegram_incidents = db.load_incidents_for_day("telegram", target_day)
    site_incidents = db.load_incidents_for_day("site", target_day)
    result = match_incidents(telegram_incidents, site_incidents)
    total_devices = _count_total_devices(telegram_incidents, site_incidents)

    lines = [
        f"{TITLE} {target_day.strftime('%d.%m.%Y')}",
        "",
        f"{SOFTWARE}: {len(telegram_incidents)}",
        f"{HARDWARE}: {len(site_incidents)}",
        f"{TOTAL}: {total_devices}",
        "",
    ]

    if result.matched:
        lines.append(f"{MATCHED}:")
        for tg_incident, site_incident in result.matched[:20]:
            lines.append(_format_match_text(tg_incident, site_incident))
        lines.append("")

    if result.telegram_only:
        lines.append(f"{SOFTWARE}:")
        for incident in result.telegram_only[:20]:
            lines.append(_format_label(incident))
        lines.append("")

    if result.site_only:
        lines.append(f"{HARDWARE}:")
        for incident in result.site_only[:20]:
            lines.append(_format_label(incident))
        lines.append("")

    lines.extend(FOOTER_LINES)
    return "\n".join(lines).strip()


def build_daily_report_html(db: Database, target_day: date) -> str:
    telegram_incidents = db.load_incidents_for_day("telegram", target_day)
    site_incidents = db.load_incidents_for_day("site", target_day)
    result = match_incidents(telegram_incidents, site_incidents)
    total_devices = _count_total_devices(telegram_incidents, site_incidents)

    header_lines = [
        f"{TITLE} {target_day.strftime('%d.%m.%Y')}",
        "",
        f"{SOFTWARE}: {len(telegram_incidents)}",
        f"{HARDWARE}: {len(site_incidents)}",
        f"{TOTAL}: {total_devices}",
    ]
    lines = ["<pre>" + html.escape("\n".join(header_lines)) + "</pre>", ""]

    if result.matched:
        lines.append(f"{MATCHED}:")
        for tg_incident, site_incident in result.matched[:20]:
            lines.append(_format_match_html(tg_incident, site_incident))
        lines.append("")

    if result.telegram_only:
        lines.append(f"{SOFTWARE}:")
        for incident in result.telegram_only[:20]:
            lines.append(_format_incident_html(incident))
        lines.append("")

    if result.site_only:
        lines.append(f"{HARDWARE}:")
        for incident in result.site_only[:20]:
            lines.append(_format_incident_html(incident))
        lines.append("")

    lines.extend(html.escape(line) for line in FOOTER_LINES)
    return "\n".join(lines).strip()


def _count_total_devices(telegram_incidents: list[DeviceIncident], site_incidents: list[DeviceIncident]) -> int:
    return len(telegram_incidents) + len(site_incidents)


def _format_match_text(telegram_incident: DeviceIncident, site_incident: DeviceIncident) -> str:
    return f"- {_short_uid(telegram_incident.uid)} | TG {telegram_incident.issue_type} | SITE {site_incident.external_id} | {site_incident.issue_type}"


def _format_match_html(telegram_incident: DeviceIncident, site_incident: DeviceIncident) -> str:
    tg_text = f"TG {telegram_incident.issue_type} | {_short_uid(telegram_incident.uid)}"
    site_text = f"SITE {site_incident.external_id} | {site_incident.issue_type} | {_short_uid(site_incident.uid)}"
    return f"{_linkify(tg_text, _incident_link(telegram_incident))} | {_linkify(site_text, _incident_link(site_incident))}"


def _format_incident_html(incident: DeviceIncident) -> str:
    return _linkify(_format_label(incident), _incident_link(incident))


def _format_label(incident: DeviceIncident) -> str:
    return f"- | {incident.issue_type} | {_short_uid(incident.uid)}"


def _short_uid(uid: str) -> str:
    return uid[:4] if uid else ""


def _linkify(text: str, link: str | None) -> str:
    escaped = html.escape(text)
    if not link:
        return escaped
    return f'<a href="{html.escape(link)}">{escaped}</a>'


def _incident_link(incident: DeviceIncident) -> str | None:
    if incident.source == "telegram":
        parts = incident.external_id.split(":", 1)
        if len(parts) != 2:
            return None
        chat_id, message_id = parts
        if not chat_id.startswith("-100"):
            return None
        return f"https://t.me/c/{chat_id[4:]}/{message_id}"
    if incident.source == "site":
        return incident.source_url
    return None
