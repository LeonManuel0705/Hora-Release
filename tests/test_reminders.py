# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app' / 'static' / 'app' / 'js' / 'reminders.js'


def reminder_defaults():
    block = SOURCE.read_text(encoding='utf-8').split('export const CATEGORY_DEFAULTS = {', 1)[1].split('};', 1)[0]
    defaults = {}
    for key, body in re.findall(r'(\w+): \{([^}]*)\}', block):
        lead = re.search(r'lead: (\d+)', body)
        defaults[key] = {'on': 'on: true' in body, 'lead': int(lead.group(1)) if lead else None}
    return defaults


def test_reminders_start_from_the_same_defaults_as_the_settings_page():
    expected = {
        item['key']: {'on': item['on'], 'lead': item.get('lead')}
        for item in ui_data.NOTIFY_DEFAULTS['categories']
    }
    assert reminder_defaults() == expected


def test_every_page_starts_the_reminders():
    main = (ROOT / 'app' / 'static' / 'app' / 'js' / 'main.js').read_text(encoding='utf-8')
    assert 'import { initReminders } from "./reminders.js";' in main
    assert re.search(r'^initReminders\(\);$', main, re.M)


def test_the_phone_app_ships_the_same_reminders():
    copy = ROOT / 'flutter_app' / 'assets' / 'ui' / 'static' / 'app' / 'js' / 'reminders.js'
    assert copy.read_text(encoding='utf-8') == SOURCE.read_text(encoding='utf-8')


def test_reminders_are_on_for_whoever_never_chose_on_every_backend():
    assert ui_data.NOTIFY_DEFAULTS['enabled'] is True
    dart = (ROOT / 'flutter_app' / 'lib' / 'web_ui' / 'ui_data.dart').read_text(encoding='utf-8')
    assert re.search(r"uiNotifyDefaults\(\) => \{\s*'enabled': true,", dart)


def page_reads(client, path='/hub/settings'):
    html = client.get(path).get_data(as_text=True)
    found = {name: json.loads(re.search(rf'<script type="application/json" id="{name}">(.*?)</script>', html, re.S).group(1)) for name in ('appData', 'appStore')}
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    fixture = {'brand': 'App', 'data': found['appData'], 'store': found['appStore'], 'prefs': [found['appStore'].get('app-settings')]}
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'fixture.json'
        path.write_text(json.dumps(fixture), encoding='utf-8')
        result = subprocess.run([node, str(ROOT / 'flutter_app' / 'test' / 'js' / 'reminders_dump.mjs'), str(path)], capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)[0]


def test_an_off_switched_by_hand_stays_off_after_a_restart_while_one_from_the_old_default_reads_as_on(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    cases = [
        ({'notify': {'enabled': False, 'sound': True, 'quiet': {'from': '22:00', 'to': '07:00'}}, 'school': {'grade': 12}}, True),
        ({'notify': {'enabled': False, 'chosen': True}, 'school': {'grade': 12}}, False),
        ({'notify': {'enabled': True}}, True),
        ({'notify': {'enabled': True, 'chosen': True}}, True),
    ]
    for saved, on in cases:
        with app.test_client() as client:
            client.get(f'/hub?token={app_module.API_TOKEN}')
            assert client.put('/api/ui/store/app-settings', json=saved).status_code == 200
        with app.test_client() as client:
            client.get(f'/hub?token={app_module.API_TOKEN}')
            assert db.get_ui_store()['app-settings'] == saved
            assert page_reads(client) is on, saved
