# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import imaplib
import re
from pathlib import Path

import pytest

from app import database as db
from app import email_service
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent


class FakeImap:
    answers = {}
    logins = []

    def __init__(self, host, port, ssl_context=None, timeout=None):
        self.host = host
        answer = self.answers.get('connect')
        if answer:
            raise answer

    def login(self, user, password):
        FakeImap.logins.append((self.host, user))
        answer = self.answers.get(password)
        if answer:
            raise answer

    def logout(self):
        pass


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    monkeypatch.setattr(email_service, 'EMAIL_CONFIG_PATH', tmp_path / 'email_config.json')
    monkeypatch.setattr(email_service.imaplib, 'IMAP4_SSL', FakeImap)
    monkeypatch.setattr(email_service, 'fetch_emails', lambda email, folder='INBOX', limit=20: {'success': True, 'emails': []})
    FakeImap.answers = {
        'falsch': imaplib.IMAP4.error('[AUTHENTICATIONFAILED] Invalid credentials (Failure)'),
        'kontopasswort': imaplib.IMAP4.error('[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)'),
        'gesperrt': imaplib.IMAP4.error('LOGIN failed.'),
    }
    FakeImap.logins = []
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        yield client


def add(client, password, provider='gmail', email='schueler@gmail.com'):
    return client.post('/api/email/accounts', json={'email': email, 'password': password, 'provider': provider})


@pytest.mark.parametrize(('password', 'code'), [('falsch', 'login'), ('kontopasswort', 'app_password'), ('gesperrt', 'refused')])
def test_a_refused_login_says_why(client, password, code):
    response = add(client, password)
    assert response.status_code == 400
    assert response.get_json()['code'] == code
    assert FakeImap.logins == [('imap.gmail.com', 'schueler@gmail.com')]
    assert client.get('/api/ui/mail').get_json()['accounts'] == []


def test_an_unreachable_mail_server_is_named_as_such(client):
    FakeImap.answers['connect'] = OSError('Network is unreachable')
    response = add(client, 'abcd efgh ijkl mnop')
    assert response.status_code == 400
    assert response.get_json()['code'] == 'unreachable'


def test_an_unknown_provider_is_refused(client):
    assert add(client, 'x', provider='yahoo').get_json()['code'] == 'provider'


def test_an_added_mailbox_reaches_the_new_mail_page_and_can_be_removed(client):
    assert add(client, 'abcd efgh ijkl mnop').get_json()['success'] is True
    accounts = client.get('/api/ui/mail').get_json()['accounts']
    assert accounts == [{'email': 'schueler@gmail.com', 'kind': 'imap', 'name': 'schueler@gmail.com'}]
    assert client.delete('/api/email/accounts/schueler@gmail.com').status_code == 200
    assert client.get('/api/ui/mail').get_json()['accounts'] == []


def test_the_mail_page_offers_the_new_dialog_instead_of_the_classic_page():
    script = (ROOT / 'app' / 'static' / 'app' / 'js' / 'pages' / 'email.js').read_text(encoding='utf-8')
    assert '/hub/klassisch' not in script
    dialog = (ROOT / 'app' / 'static' / 'app' / 'js' / 'mailbox.js').read_text(encoding='utf-8')
    assert '"/api/email/accounts"' in dialog
    assert not re.search(r"provider:\s*\"outlook\"", dialog)
    assert 'data?.status?.googleConfigured === true' in dialog
