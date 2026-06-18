from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, date
from pathlib import Path
import json
import sqlite3

from .models import DeviceIncident


SCHEMA = """
CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id INTEGER,
    message_date TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    text TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    uid TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    device_code TEXT,
    employee_number TEXT,
    employee_name TEXT,
    reporter_username TEXT,
    raw_text TEXT NOT NULL,
    source_url TEXT,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_source_created_at
ON incidents(source, created_at);

CREATE INDEX IF NOT EXISTS idx_incidents_uid
ON incidents(uid);

CREATE TABLE IF NOT EXISTS telegram_parse_errors (
    external_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    error TEXT NOT NULL,
    raw_text TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            columns = {row['name'] for row in conn.execute("PRAGMA table_info(incidents)").fetchall()}
            if 'source_url' not in columns:
                conn.execute("ALTER TABLE incidents ADD COLUMN source_url TEXT")

    def get_state(self, key: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM bot_state WHERE key = ?", (key,)).fetchone()
            return row['value'] if row else None

    def set_state(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO bot_state(key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def save_update(
        self,
        *,
        update_id: int,
        chat_id: str,
        message_id: int | None,
        message_date: datetime,
        raw_json: dict,
        text: str | None,
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO telegram_updates(
                    update_id, chat_id, message_id, message_date, raw_json, text
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    update_id,
                    chat_id,
                    message_id,
                    message_date.isoformat(),
                    json.dumps(raw_json, ensure_ascii=False),
                    text,
                ),
            )

    def upsert_incident(self, incident: DeviceIncident) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO incidents(
                    source, external_id, created_at, uid, issue_type, device_code,
                    employee_number, employee_name, reporter_username, raw_text, source_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, external_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    uid = excluded.uid,
                    issue_type = excluded.issue_type,
                    device_code = excluded.device_code,
                    employee_number = excluded.employee_number,
                    employee_name = excluded.employee_name,
                    reporter_username = excluded.reporter_username,
                    raw_text = excluded.raw_text,
                    source_url = excluded.source_url
                """,
                (
                    incident.source,
                    incident.external_id,
                    incident.created_at.isoformat(),
                    incident.uid,
                    incident.issue_type,
                    incident.device_code,
                    incident.employee_number,
                    incident.employee_name,
                    incident.reporter_username,
                    incident.raw_text,
                    incident.source_url,
                ),
            )

    def save_parse_error(
        self,
        *,
        external_id: str,
        chat_id: str,
        created_at: datetime,
        error: str,
        raw_text: str,
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_parse_errors(external_id, chat_id, created_at, error, raw_text)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(external_id) DO UPDATE SET
                    chat_id = excluded.chat_id,
                    created_at = excluded.created_at,
                    error = excluded.error,
                    raw_text = excluded.raw_text
                """,
                (external_id, chat_id, created_at.isoformat(), error, raw_text),
            )

    def load_incidents_for_day(self, source: str, day: date) -> list[DeviceIncident]:
        start = datetime.combine(day, datetime.min.time()).isoformat()
        end = datetime.combine(day, datetime.max.time()).isoformat()
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM incidents
                WHERE source = ? AND created_at BETWEEN ? AND ?
                ORDER BY created_at ASC
                """,
                (source, start, end),
            ).fetchall()
        return [self._row_to_incident(row) for row in rows]

    def count_parse_errors_for_day(self, day: date) -> int:
        start = datetime.combine(day, datetime.min.time()).isoformat()
        end = datetime.combine(day, datetime.max.time()).isoformat()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS total
                FROM telegram_parse_errors
                WHERE created_at BETWEEN ? AND ?
                """,
                (start, end),
            ).fetchone()
        return int(row['total'])

    def _row_to_incident(self, row: sqlite3.Row) -> DeviceIncident:
        return DeviceIncident(
            source=row['source'],
            external_id=row['external_id'],
            created_at=datetime.fromisoformat(row['created_at']),
            uid=row['uid'],
            issue_type=row['issue_type'],
            device_code=row['device_code'],
            employee_number=row['employee_number'],
            employee_name=row['employee_name'],
            reporter_username=row['reporter_username'],
            raw_text=row['raw_text'],
            source_url=row['source_url'],
        )