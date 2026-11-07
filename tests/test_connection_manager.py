# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent


def test_the_classic_connection_check_stays_on_its_own_server():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'connection_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


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


def test_classic_pages_say_whether_iserv_is_linked(client, tmp_path, monkeypatch):
    from app import iserv_service

    monkeypatch.setattr(iserv_service, 'CREDENTIALS_FILE', tmp_path / 'iserv_credentials.json')
    monkeypatch.setattr(iserv_service.get_iserv_service(), 'connected', False)
    assert 'data-iserv="none"' in client.get('/hub/training').get_data(as_text=True)
    (tmp_path / 'iserv_credentials.json').write_text('saved', encoding='utf-8')
    assert 'data-iserv="linked"' in client.get('/hub/training').get_data(as_text=True)


def test_classic_pages_never_probe_another_server():
    script = (ROOT / 'app' / 'static' / 'js' / 'connection-manager.js').read_text(encoding='utf-8')
    assert not re.search(r"fetch\(\s*['\"`]https?:", script)
