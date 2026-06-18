from __future__ import annotations

from datetime import date, datetime
from urllib.parse import urljoin
import re

from bs4 import BeautifulSoup
import requests

from ..config import Settings
from ..db import Database
from ..models import DeviceIncident
from ..parsers import extract_uid_from_text


class SiteCollector:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self.session = requests.Session()

    def collect_for_day(self, target_day: date) -> list[DeviceIncident]:
        self._login()
        url = urljoin(self.settings.site_base_url, self.settings.site_service_requests_path)
        response = self.session.get(url, timeout=30)
        response.raise_for_status()
        incidents = self._parse_service_requests(response.text, target_day)
        for incident in incidents:
            self.db.upsert_incident(incident)
        return incidents

    def _login(self) -> None:
        login_url = (
            urljoin(self.settings.site_base_url, self.settings.site_login_path)
            if self.settings.site_login_path
            else self.settings.site_base_url
        )
        response = self.session.get(login_url, timeout=30)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        form = soup.find("form")
        if form is None:
            raise RuntimeError("Login form not found on site")

        action = form.get("action") or login_url
        action_url = urljoin(login_url, action)
        payload = {}
        username_field = None
        password_field = None

        for input_tag in form.find_all("input"):
            name = input_tag.get("name")
            if not name:
                continue
            input_type = (input_tag.get("type") or "text").lower()
            value = input_tag.get("value", "")
            payload[name] = value
            lowered = name.lower()

            if input_type == "password" or "pass" in lowered:
                password_field = name
            elif any(token in lowered for token in ("login", "user", "email", "username")):
                username_field = name

        if not username_field or not password_field:
            raise RuntimeError("Could not detect username/password fields in login form")

        payload[username_field] = self.settings.site_username
        payload[password_field] = self.settings.site_password

        post_response = self.session.post(action_url, data=payload, timeout=30)
        post_response.raise_for_status()

    def _parse_service_requests(self, html: str, target_day: date) -> list[DeviceIncident]:
        soup = BeautifulSoup(html, "lxml")
        incidents: list[DeviceIncident] = []

        for table in soup.find_all("table"):
            headers = [
                self._normalize_header(cell.get_text(" ", strip=True))
                for cell in table.find_all("th")
            ]
            if not headers:
                continue
            if not any("дата" in header or "create" in header for header in headers):
                continue

            for row in table.find_all("tr"):
                cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td")]
                if not cells or len(cells) != len(headers):
                    continue

                record = dict(zip(headers, cells))
                created_at = self._extract_created_at(record)
                if created_at is None or created_at.date() != target_day:
                    continue

                uid = self._extract_uid(record)
                if not uid:
                    continue

                external_id = self._extract_external_id(record, uid, created_at)
                issue_type = self._extract_issue_type(record)
                device_code = self._extract_device_code(record)
                employee_name = self._extract_employee_name(record)

                raw_text = "\n".join(f"{key}: {value}" for key, value in record.items())
                incidents.append(
                    DeviceIncident(
                        source="site",
                        external_id=external_id,
                        created_at=created_at,
                        uid=uid,
                        issue_type=issue_type,
                        device_code=device_code,
                        employee_number=None,
                        employee_name=employee_name,
                        reporter_username=None,
                        raw_text=raw_text,
                    )
                )

        return incidents

    def _extract_created_at(self, record: dict[str, str]) -> datetime | None:
        for key, value in record.items():
            if "дата" not in key and "create" not in key:
                continue
            for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    return datetime.strptime(value, fmt)
                except ValueError:
                    continue
        return None

    def _extract_uid(self, record: dict[str, str]) -> str | None:
        for key, value in record.items():
            if "uid" in key:
                return re.sub(r"\s+", "", value).lower()
            uid = extract_uid_from_text(value)
            if uid:
                return uid
        return None

    def _extract_external_id(self, record: dict[str, str], uid: str, created_at: datetime) -> str:
        for key, value in record.items():
            if any(token in key for token in ("id", "номер", "request")):
                compact = value.strip()
                if compact:
                    return compact
        return f"{uid}:{created_at.isoformat()}"

    def _extract_issue_type(self, record: dict[str, str]) -> str:
        for key, value in record.items():
            if any(token in key for token in ("problem", "issue", "неисправ", "тип")):
                return value
        return "service_request"

    def _extract_device_code(self, record: dict[str, str]) -> str | None:
        for value in record.values():
            if re.match(r"^[A-Z]\d?-?\d+$", value.replace(" ", "")):
                return value.replace(" ", "")
        return None

    def _extract_employee_name(self, record: dict[str, str]) -> str | None:
        for key, value in record.items():
            if any(token in key for token in ("сотруд", "employee", "фио", "name")):
                return value
        return None

    def _normalize_header(self, value: str) -> str:
        return re.sub(r"\s+", " ", value.strip().lower())
