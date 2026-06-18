from __future__ import annotations

from datetime import date, datetime
from urllib.parse import urljoin
import re

from bs4 import BeautifulSoup
import requests

from ..config import Settings
from ..db import Database
from ..models import DeviceIncident


class SiteCollector:
    REQUEST_NUMBER_INDEX = 0
    SERIAL_INDEX = 1
    EUI_INDEX = 2
    FAULT_INDEX = 6
    PROBLEM_INDEX = 7
    CREATED_INDEX = 9
    CREATOR_INDEX = 10

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
        login_url = urljoin(self.settings.site_base_url, self.settings.site_login_path)
        response = self.session.get(login_url, timeout=30)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'lxml')
        form = soup.find('form')
        if form is None:
            raise RuntimeError('Login form not found on site')

        action = form.get('action') or login_url
        action_url = urljoin(login_url, action)
        payload: dict[str, str] = {}
        username_field = None
        password_field = None

        for input_tag in form.find_all('input'):
            name = input_tag.get('name')
            if not name:
                continue
            input_type = (input_tag.get('type') or 'text').lower()
            payload[name] = input_tag.get('value', '')
            lowered = name.lower()
            if input_type == 'password' or 'pass' in lowered:
                password_field = name
            elif any(token in lowered for token in ('login', 'user', 'email', 'username')):
                username_field = name

        if not username_field or not password_field:
            raise RuntimeError('Could not detect username/password fields in login form')

        payload[username_field] = self.settings.site_username
        payload[password_field] = self.settings.site_password

        post_response = self.session.post(action_url, data=payload, timeout=30)
        post_response.raise_for_status()
        if 'login.php' in post_response.url.lower() and 'logout' not in post_response.text.lower():
            raise RuntimeError('Site login failed. Check SITE_USERNAME and SITE_PASSWORD.')

    def _parse_service_requests(self, html: str, target_day: date) -> list[DeviceIncident]:
        soup = BeautifulSoup(html, 'lxml')
        incidents: list[DeviceIncident] = []

        for table in soup.find_all('table'):
            headers = [cell.get_text(' ', strip=True) for cell in table.find_all('th')]
            if not headers:
                continue
            if 'MAC / EUI' not in headers or len(headers) < 11:
                continue

            for row in table.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) < len(headers):
                    continue

                values = [cell.get_text(' ', strip=True) for cell in cells]
                created_at = self._parse_created_at(values[self.CREATED_INDEX])
                if created_at is None or created_at.date() != target_day:
                    continue

                uid = self._extract_uid(values[self.EUI_INDEX])
                if not uid:
                    continue

                request_number = values[self.REQUEST_NUMBER_INDEX].strip()
                issue_type = self._pick_issue_type(values[self.PROBLEM_INDEX], values[self.FAULT_INDEX])
                source_url = self._extract_source_url(cells)
                raw_text = '\n'.join(values)

                incidents.append(
                    DeviceIncident(
                        source='site',
                        external_id=request_number or f'{uid}:{created_at.isoformat()}',
                        created_at=created_at,
                        uid=uid,
                        issue_type=issue_type,
                        device_code=values[self.SERIAL_INDEX].strip() or None,
                        employee_number=None,
                        employee_name=values[self.CREATOR_INDEX].strip() or None,
                        reporter_username=None,
                        raw_text=raw_text,
                        source_url=source_url,
                    )
                )

        return incidents

    def _parse_created_at(self, value: str) -> datetime | None:
        value = value.strip()
        for fmt in ('%d.%m.%Y %H:%M', '%d.%m.%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S'):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None

    def _extract_uid(self, eui_value: str) -> str | None:
        compact = re.sub(r'[^a-f0-9]', '', eui_value.strip().lower())
        if len(compact) >= 16:
            return compact[-16:]
        return None

    def _pick_issue_type(self, problem: str, fault: str) -> str:
        problem = problem.strip()
        if problem and problem != '-':
            return problem
        fault = fault.strip()
        if fault and fault != '-':
            return fault
        return 'service_request'

    def _extract_source_url(self, cells) -> str | None:
        link = cells[-1].find('a', href=True)
        if not link:
            return None
        requests_dir = urljoin(self.settings.site_base_url, 'views/service_requests/')
        return urljoin(requests_dir, link['href'])