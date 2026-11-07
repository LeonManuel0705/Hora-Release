# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re

import pytest

from app import calendar_cache
from app import google_oauth
from tests.test_calendar_cache import client, day, google  # noqa: F401


def page_data(client, path):
    html = client.get(path).get_data(as_text=True)
    return json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))


@pytest.fixture
def configured(monkeypatch):
    state = {'on': True}
    monkeypatch.setattr(google_oauth, 'is_google_oauth_configured', lambda: state['on'])
    return state


def test_without_an_oauth_client_no_page_offers_google(client, configured, monkeypatch):
    configured['on'] = False
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {})
    for path in ('/hub', '/hub/calendar', '/hub/settings'):
        status = page_data(client, path)['status']
        assert status['googleConfigured'] is False and status['google'] is None, path
    account = page_data(client, '/hub/settings')['page']['accounts']['google']
    assert account == {'configured': False, 'connected': False, 'account': '', 'calendars': []}


def test_a_connected_account_shows_its_calendars_from_the_copy_and_how_it_stands(google, client, configured):
    google.add_calendar('team@example.org', 'Verein')
    calendar_cache.sync()
    google.calls.clear()
    data = page_data(client, '/hub/settings')
    assert data['status'] == {**data['status'], 'googleConfigured': True, 'google': 'ok'}
    account = data['page']['accounts']['google']
    assert account['connected'] is True and account['account'] == google.primary and account['state'] == 'ok'
    assert account['stand'] and account['gmail'] is True
    assert [(item['id'], item['name'], item['color'], item['primary']) for item in account['calendars']] == [
        (google.primary, 'Privat', '#4285f4', True), ('team@example.org', 'Verein', '#0b8043', False),
    ]
    assert google.calls == [], 'the settings page never waits for Google'


def test_an_account_connected_without_a_client_any_more_keeps_working_but_says_so(google, client, configured):
    configured['on'] = False
    calendar_cache.sync()
    account = page_data(client, '/hub/settings')['page']['accounts']['google']
    assert account['connected'] is True and account['configured'] is False


def test_an_expired_sign_in_is_reported_as_such(google, client, configured, monkeypatch):
    calendar_cache.sync()
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'expired': True}})
    data = page_data(client, '/hub/settings')
    assert data['status']['google'] == 'login'
    assert data['page']['accounts']['google']['state'] == 'login'


def test_gmail_shows_only_when_it_was_granted(google, client, configured, monkeypatch):
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'scopes': list(google_oauth.FEATURES['calendar'])}})
    assert page_data(client, '/hub/settings')['page']['accounts']['google']['gmail'] is False
