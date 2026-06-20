from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass
class Incident:
    source: str
    external_id: str
    created_at: str
    uid: str
    issue_type: str
    source_url: str

    @property
    def day_key(self) -> str:
        dt = _parse_datetime(self.created_at)
        return dt.date().isoformat()

    @property
    def time_label(self) -> str:
        return _parse_datetime(self.created_at).strftime("%H:%M")

    @property
    def uid_short(self) -> str:
        return (self.uid or "")[:4]

    def to_payload(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "external_id": self.external_id,
            "created_at": self.created_at,
            "time": self.time_label,
            "uid": self.uid,
            "uid_short": self.uid_short,
            "issue_type": self.issue_type,
            "source_url": _normalize_source_url(self.source, self.source_url, self.external_id),
        }


def _parse_datetime(raw: str) -> datetime:
    value = (raw or "").strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")


def _load_incidents(db_path: Path) -> list[Incident]:
    con = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in con.execute("PRAGMA table_info(incidents)").fetchall()}
        source_url_expr = "coalesce(source_url, '')" if "source_url" in columns else "''"
        rows = con.execute(
            f"""
            select source, external_id, created_at, uid, issue_type, {source_url_expr}
            from incidents
            where uid is not null and trim(uid) <> ''
            order by created_at asc, source asc, external_id asc
            """
        ).fetchall()
    finally:
        con.close()
    return [
        Incident(
            source=row[0],
            external_id=row[1],
            created_at=row[2],
            uid=row[3],
            issue_type=row[4],
            source_url=row[5],
        )
        for row in rows
    ]


def _build_day_payload(day: str, day_incidents: list[Incident]) -> dict[str, Any]:
    telegram = [item for item in day_incidents if item.source == "telegram"]
    site = [item for item in day_incidents if item.source == "site"]

    return {
        "date": day,
        "title": f"Повреждения от {datetime.strptime(day, '%Y-%m-%d').strftime('%d.%m.%Y')}",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "counts": {
            "telegram": len(telegram),
            "site": len(site),
            "total_devices": len(telegram) + len(site),
        },
        "telegram": [item.to_payload() for item in telegram],
        "site": [item.to_payload() for item in site],
    }


def _load_existing_day_payloads(output_dir: Path) -> dict[str, dict[str, Any]]:
    payloads: dict[str, dict[str, Any]] = {}
    if not output_dir.exists():
        return payloads

    for path in output_dir.glob("*.json"):
        if path.name == "index.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        day = str(payload.get("date") or path.stem).strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            payloads[day] = payload

    return payloads


def _normalize_source_url(source: str, source_url: str, external_id: str = "") -> str:
    value = (source_url or "").strip()
    if source == "telegram":
        if value:
            return value
        if ":" in external_id:
            chat_id, message_id = external_id.split(":", 1)
            chat_tail = chat_id.removeprefix("-100")
            if chat_tail and message_id:
                return f"https://t.me/c/{chat_tail}/{message_id}"
        return value
    match = re.search(r"id=(\d+)", value)
    if match:
        return f"https://device.workwatch.pro/views/service_requests/view.php?id={match.group(1)}"
    return value


def _load_existing_summaries(output_dir: Path) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    if not output_dir.exists():
        return summaries

    for path in output_dir.glob("*.json"):
        if path.name == "index.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        day = str(payload.get("date") or path.stem).strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue

        counts = payload.get("counts")
        if not isinstance(counts, dict):
            continue

        summaries[day] = {
            "date": day,
            "title": payload.get("title") or f"Повреждения от {day}",
            "counts": {
                "telegram": int(counts.get("telegram", 0) or 0),
                "site": int(counts.get("site", 0) or 0),
                "total_devices": int(counts.get("total_devices", 0) or 0),
            },
        }

    return summaries


def export_reports(db_path: Path, output_dir: Path) -> None:
    incidents = _load_incidents(db_path)
    by_day: dict[str, list[Incident]] = defaultdict(list)
    for item in incidents:
        by_day[item.day_key].append(item)

    output_dir.mkdir(parents=True, exist_ok=True)
    existing_payloads = _load_existing_day_payloads(output_dir)
    summaries_by_day = _load_existing_summaries(output_dir)

    for day in sorted(by_day.keys()):
        payload = _build_day_payload(day, by_day[day])
        existing_payload = existing_payloads.get(day) or {}
        if not payload["telegram"] and isinstance(existing_payload.get("telegram"), list):
            payload["telegram"] = existing_payload["telegram"]
        if not payload["site"] and isinstance(existing_payload.get("site"), list):
            payload["site"] = existing_payload["site"]
        payload["counts"] = {
            "telegram": len(payload["telegram"]),
            "site": len(payload["site"]),
            "total_devices": len(payload["telegram"]) + len(payload["site"]),
        }
        target = output_dir / f"{day}.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        summaries_by_day[day] = {
            "date": day,
            "title": payload["title"],
            "counts": payload["counts"],
        }

    available_dates = sorted(summaries_by_day.keys(), reverse=True)
    summaries = [summaries_by_day[day] for day in available_dates]

    index_payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "latest_date": available_dates[0] if available_dates else None,
        "dates": summaries,
    }
    (output_dir / "index.json").write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=str(Path("data") / "tgdevice.sqlite3"),
        help="Path to tgdevice SQLite database",
    )
    parser.add_argument(
        "--out",
        default=str(Path("data") / "damage-reports"),
        help="Output directory for static report JSON files",
    )
    args = parser.parse_args()
    export_reports(Path(args.db), Path(args.out))


if __name__ == "__main__":
    main()
