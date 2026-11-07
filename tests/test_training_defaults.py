# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent
PERSONAL_PLAN = ('DLRG', 'Chestday', 'Backday', 'Armday', 'Legday', 'Brust + Bizep', 'Schulter + Trizep')


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


def test_the_training_page_ships_no_personal_plan(client):
    page = client.get('/hub/training').get_data(as_text=True)
    for word in PERSONAL_PLAN:
        assert word not in page
    assert '/api/hub/training/schedule/import' not in page
    assert 'loadDefaultTemplate' not in page


def test_a_new_training_plan_starts_empty(client):
    assert client.get('/api/hub/training/schedule/entries').get_json()['entries'] == []
    settings = client.get('/api/hub/training/schedule/settings').get_json()['settings']
    assert not settings or not settings.get('setup_completed')


def test_the_phone_training_screen_ships_no_personal_plan():
    source = (ROOT / 'flutter_app' / 'lib' / 'screens' / 'training_screen.dart').read_text(encoding='utf-8')
    for word in PERSONAL_PLAN:
        assert word not in source
