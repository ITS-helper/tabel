from __future__ import annotations

from datetime import date
import html

from .db import Database
from .models import DeviceIncident

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


def build_daily_report_plain(db: Database, target_day: date) -> str:
    telegram_incidents = db.load_incidents_for_day("telegram", target_day)
    site_incidents = db.load_incidents_for_day("site", target_day)
    total_devices = _count_total_items(telegram_incidents, site_incidents)

    lines = [
        f"{TITLE} {target_day.strftime('%d.%m.%Y')}",
        "",
        f"{SOFTWARE}: {len(telegram_incidents)}",
        f"{HARDWARE}: {len(site_incidents)}",
        f"{TOTAL}: {total_devices}",
        "",
    ]

    if telegram_incidents:
        lines.append(f"{SOFTWARE}:")
        for incident in telegram_incidents[:20]:
            lines.append(_format_label(incident))
        lines.append("")

    if site_incidents:
        lines.append(f"{HARDWARE}:")
        for incident in site_incidents[:20]:
            lines.append(_format_label(incident))
        lines.append("")

    lines.extend(FOOTER_LINES)
    return "\n".join(lines).strip()


def build_daily_report_html(db: Database, target_day: date) -> str:
    telegram_incidents = db.load_incidents_for_day("telegram", target_day)
    site_incidents = db.load_incidents_for_day("site", target_day)
    total_devices = _count_total_items(telegram_incidents, site_incidents)

    header_lines = [
        f"{TITLE} {target_day.strftime('%d.%m.%Y')}",
        "",
        f"{SOFTWARE}: {len(telegram_incidents)}",
        f"{HARDWARE}: {len(site_incidents)}",
        f"{TOTAL}: {total_devices}",
    ]
    lines = ["<pre>" + html.escape("\n".join(header_lines)) + "</pre>", ""]

    if telegram_incidents:
        lines.append(f"{SOFTWARE}:")
        for incident in telegram_incidents[:20]:
            lines.append(_format_incident_html(incident))
        lines.append("")

    if site_incidents:
        lines.append(f"{HARDWARE}:")
        for incident in site_incidents[:20]:
            lines.append(_format_incident_html(incident))
        lines.append("")

    lines.extend(html.escape(line) for line in FOOTER_LINES)
    return "\n".join(lines).strip()


def _count_total_items(telegram_incidents: list[DeviceIncident], site_incidents: list[DeviceIncident]) -> int:
    return len(telegram_incidents) + len(site_incidents)


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
