# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        yield client


def test_feedback_goes_to_the_address_the_legal_pages_publish():
    published = json.loads((ROOT / 'landing-page' / 'src' / 'content' / 'company.json').read_text(encoding='utf-8'))['email']
    script = (ROOT / 'app' / 'static' / 'app' / 'js' / 'feedback.js').read_text(encoding='utf-8')
    assert re.search(r'export const CONTACT = "([^"]+)";', script).group(1) == published
    electron = (ROOT / 'desktop' / 'src' / 'rules.js').read_text(encoding='utf-8')
    assert re.search(r"const FEEDBACK_ADDRESS = '([^']+)';", electron).group(1) == published
    mac = (ROOT / 'flutter_app' / 'lib' / 'screens' / 'desktop_webview_screen.dart').read_text(encoding='utf-8')
    assert re.search(r"const feedbackAddress = '([^']+)';", mac).group(1) == published


@pytest.mark.parametrize('path', ['/hub', '/hub/tasks', '/hub/bookmarks', '/hub/settings'])
def test_every_page_knows_its_version_and_build_for_a_report(client, path):
    from app.app import _get_app_version

    html = client.get(path).get_data(as_text=True)
    version = re.search(r'data-app-version="([^"]*)"', html).group(1)
    assert version == _get_app_version()
    assert re.fullmatch(r'\d+\.\d+\.\d+.* \(Build \d+\)', version)
    assert 'data-feedback' in html.split('id="moreSheet"')[1].split('id="noteSheet"')[0]


def test_the_phone_pages_fill_in_version_and_build():
    assert 'data-app-version="__APP_VERSION__"' in (ROOT / 'flutter_app' / 'assets' / 'ui' / 'pages' / 'home.html').read_text(encoding='utf-8')
    pages = (ROOT / 'flutter_app' / 'lib' / 'web_ui' / 'ui_pages.dart').read_text(encoding='utf-8')
    assert "'__APP_VERSION__': _escape('${BuildInfo.versionName} (Build ${BuildInfo.buildNumber})')" in pages


def test_the_frozen_backend_carries_the_build_number():
    spec = (ROOT / 'server.spec').read_text(encoding='utf-8')
    assert "('flutter_app/lib/build_info.dart', 'flutter_app/lib')" in spec


def test_about_and_search_offer_the_feedback_dialog():
    settings = (ROOT / 'app' / 'static' / 'app' / 'js' / 'pages' / 'settings.js').read_text(encoding='utf-8')
    assert 'data-feedback>${icon("send")}Rückmeldung geben' in settings
    shell = (ROOT / 'app' / 'static' / 'app' / 'js' / 'shell.js').read_text(encoding='utf-8')
    assert 'label: "Rückmeldung geben"' in shell and 'new CustomEvent("app:feedback")' in shell
