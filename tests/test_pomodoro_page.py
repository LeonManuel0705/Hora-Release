# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import json
import re
import time
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


def page_data(client):
    html = client.get('/hub/pomodoro').get_data(as_text=True)
    match = re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S)
    return json.loads(match.group(1))


def post(client, **fields):
    body = {'subject_id': 'mathe', 'duration': 25, 'session_type': 'work', 'ended_at': int((time.time() - 30) * 1000), **fields}
    assert client.post('/api/pomodoro/session', json=body).status_code == 200


def test_page_is_the_new_interface_and_only_german(client):
    html = client.get('/hub/pomodoro').get_data(as_text=True)
    assert 'data-page-module="pomodoro"' in html
    assert '/static/app/css/pages/pomodoro.css' in html
    assert '<a class="nav-item" href="/hub/pomodoro" data-page="pomodoro" aria-current="page">' in html
    for english in ('How it works', 'Pomodoro Timer', 'Work for 25 minutes', 'Take a 5-minute break', 'Repeat and track'):
        assert english not in html
    for german in ('Rhythmus', 'Lernzeit', 'Starten', 'Zurücksetzen'):
        assert german in html


def test_the_old_classic_page_is_gone(client):
    from app.app import app

    rules = [rule for rule in app.url_map.iter_rules() if rule.rule == '/hub/pomodoro']
    assert len(rules) == 1 and rules[0].endpoint.startswith('ui.')
    assert not (ROOT / 'app' / 'templates' / 'hub' / 'pomodoro.html').exists()


def test_page_data_carries_the_statistics_of_all_three_ranges(client):
    empty = page_data(client)['page']['stats']
    assert set(empty) == {'today', 'week', 'month'}
    assert all(item == {'total_sessions': 0, 'total_minutes': 0, 'by_subject': []} for item in empty.values())
    post(client)
    post(client, ended_at=int((time.time() - 60) * 1000), subject_id='deutsch', duration=40)
    filled = page_data(client)['page']['stats']
    assert filled['month']['total_sessions'] == 2 and filled['month']['total_minutes'] == 65
    assert {row['subject_id'] for row in filled['month']['by_subject']} == {'mathe', 'deutsch'}


def test_the_service_worker_ships_the_pomodoro_files():
    from app import ui_assets

    urls = ui_assets.asset_urls()
    for path in ('/static/app/js/pomodoro-timer.js', '/static/app/js/pages/pomodoro.js', '/static/app/css/pages/pomodoro.css'):
        assert path in urls


def test_every_icon_the_page_uses_is_in_the_sprite():
    sprite = (ROOT / 'app' / 'templates' / 'app' / '_icons.svg').read_text(encoding='utf-8')
    known = set(re.findall(r'<symbol id="i-([a-z0-9-]+)"', sprite))
    template = (ROOT / 'app' / 'templates' / 'app' / 'pomodoro.html').read_text(encoding='utf-8')
    script = (ROOT / 'app' / 'static' / 'app' / 'js' / 'pages' / 'pomodoro.js').read_text(encoding='utf-8')
    used = set(re.findall(r'#i-([a-z0-9-]+)"', template)) | set(re.findall(r'icon: "([a-z0-9-]+)"', script))
    used |= {'play', 'pause', 'coffee', 'skip-forward', 'rotate-ccw'}
    assert used <= known, sorted(used - known)


def test_the_page_texts_use_no_long_dashes():
    for name in ('templates/app/pomodoro.html', 'static/app/js/pages/pomodoro.js', 'static/app/js/reminders.js'):
        text = (ROOT / 'app' / name).read_text(encoding='utf-8')
        assert '—' not in text and '–' not in text, name
