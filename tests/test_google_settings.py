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
        assert status['googleConfigured'] is False and status['gmailViaGoogle'] is False and status['google'] is None, path
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


GMAIL_STATES = {
    'not-configured': (False, {}, None, False),
    'calendar-only': (True, {'lea@example.com': {'token': 'x', 'scopes': list(google_oauth.FEATURES['calendar'])}}, None, False),
    'switched-on': (True, {}, '1', True),
    'legacy-gmail': (True, {'lea@example.com': {'token': 'x', 'refresh_token': 'r'}}, None, True),
    'gmail-without-client': (False, {'lea@example.com': {'token': 'x', 'scopes': list(google_oauth.FEATURES['gmail'])}}, None, True),
}


@pytest.mark.parametrize('state', list(GMAIL_STATES))
def test_gmail_through_google_is_offered_only_where_switched_on_or_already_granted(client, configured, monkeypatch, state):
    on, tokens, switch, offered = GMAIL_STATES[state]
    configured['on'] = on
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: dict(tokens))
    if switch:
        monkeypatch.setenv('GOOGLE_GMAIL', switch)
    else:
        monkeypatch.delenv('GOOGLE_GMAIL', raising=False)
    for path in ('/hub', '/hub/email', '/hub/settings'):
        assert page_data(client, path)['status']['gmailViaGoogle'] is offered, path
    classic = client.get('/hub/klassisch/email').get_data(as_text=True)
    assert ('id="googleSignInBtn"' in classic) is offered
    assert ('nur für den Kalender' in classic) is (on and not offered)


def test_without_gmail_through_google_the_sign_in_refuses_gmail_and_keeps_the_calendar(client, configured, monkeypatch):
    monkeypatch.delenv('GOOGLE_GMAIL', raising=False)
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {'lea@example.com': {'token': 'x', 'scopes': list(google_oauth.FEATURES['calendar'])}})
    monkeypatch.setattr(google_oauth, '_get_oauth_client_config', lambda: {'web': {
        'client_id': 'client.apps.googleusercontent.com', 'client_secret': 'secret',
        'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token',
        'redirect_uris': [google_oauth.GOOGLE_REDIRECT_URI],
    }})
    for another in (False, True):
        refused = client.post('/api/email/google/auth', json={'features': ['gmail'], 'another': another}).get_json()
        assert refused == {'success': False, 'error': google_oauth.GMAIL_OFF}
    calendar = client.post('/api/email/google/auth', json={'features': ['calendar'], 'another': True}).get_json()
    assert calendar['success'] is True and 'gmail' not in calendar['auth_url']
    assert client.get('/api/email/google/status').get_json()['gmailViaGoogle'] is False


def choose(client, target):
    client.put('/api/ui/store/app-settings', json={'google': {'target': target}})


def own(client, title='Fahrstunde', offset=2):
    reply = client.post('/api/ui/events', json={'title': title, 'date': day(offset), 'start': '16:00', 'end': '17:30'}).get_json()
    return reply['event']['id']


def stored(google, calendar):
    return [event['summary'] for event in google.live(calendar)]


def test_new_own_events_go_to_the_chosen_calendar_and_stay_there(google, client):
    google.add_calendar('schule@example.org', 'Schule', role='owner')
    calendar_cache.sync()
    choose(client, 'schule@example.org')
    ref = own(client)
    assert stored(google, 'schule@example.org') == ['Fahrstunde'] and stored(google, 'primary') == []
    item = calendar_cache.ui_data.load_list('calendar')[0]
    assert item['google_calendar'] == 'schule@example.org' and 'google_dirty' not in item
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    assert stored(google, 'schule@example.org') == ['Fahrstunde Autobahn']
    calendar_cache._status['checked'] = None
    calendar_cache.sync()
    assert [event['title'] for event in calendar_cache.events(day(-70), day(100))] == [], 'the twin is never shown a second time'
    client.delete(f'/api/ui/events/{ref}')
    assert stored(google, 'schule@example.org') == []


def test_without_a_choice_new_events_go_to_the_main_calendar(google, client):
    google.add_calendar('schule@example.org', 'Schule')
    calendar_cache.sync()
    own(client)
    assert stored(google, 'primary') == ['Fahrstunde']


def test_a_chosen_calendar_that_can_no_longer_be_written_to_or_went_away_gives_way_to_the_main_one(google, client):
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    calendar_cache.sync()
    choose(client, 'feiertage@example.org')
    own(client, 'Erstens')
    choose(client, 'weg@example.org')
    own(client, 'Zweitens', 3)
    assert stored(google, 'primary') == ['Erstens', 'Zweitens'] and stored(google, 'feiertage@example.org') == []


def test_a_new_choice_leaves_events_already_in_google_where_they_are(google, client):
    google.add_calendar('schule@example.org', 'Schule')
    calendar_cache.sync()
    ref = own(client)
    choose(client, 'schule@example.org')
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    assert stored(google, 'primary') == ['Fahrstunde Autobahn'] and stored(google, 'schule@example.org') == []


def test_settings_offer_only_calendars_that_can_take_events_and_name_the_one_in_use(google, client, configured):
    google.add_calendar('schule@example.org', 'Schule', role='writer')
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    calendar_cache.sync()
    account = page_data(client, '/hub/settings')['page']['accounts']['google']
    assert {item['id']: item['writable'] for item in account['calendars']} == {google.primary: True, 'schule@example.org': True, 'feiertage@example.org': False}
    assert account['target'] == google.primary
    choose(client, 'schule@example.org')
    assert page_data(client, '/hub/settings')['page']['accounts']['google']['target'] == 'schule@example.org'


def test_the_calendar_page_knows_how_the_copy_stands_before_it_asks(google, client, monkeypatch):
    calendar_cache.sync()
    sync = page_data(client, '/hub/calendar')['page']['sync']
    assert sync['state'] == 'ok' and sync['stand']
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'expired': True}})
    assert page_data(client, '/hub/calendar')['page']['sync']['state'] == 'login'


def own_in(client, calendar, title='Café-Schicht', offset=2):
    reply = client.post('/api/ui/events', json={'title': title, 'date': day(offset), 'start': '16:00', 'end': '20:00', 'calendar': calendar}).get_json()
    return reply['event']['id']


def test_a_new_event_goes_to_the_calendar_picked_for_it_and_stays_there(google, client):
    google.add_calendar('nebenjob@example.org', 'Nebenjob', role='writer')
    calendar_cache.sync()
    ref = own_in(client, 'nebenjob@example.org')
    assert stored(google, 'nebenjob@example.org') == ['Café-Schicht'] and stored(google, 'primary') == []
    item = calendar_cache.ui_data.load_list('calendar')[0]
    assert item['google_calendar'] == 'nebenjob@example.org' and item['google_account'] == google.primary and 'google_dirty' not in item
    own(client, 'Fahrstunde', 3)
    assert stored(google, 'primary') == ['Fahrstunde'], 'the next event without a pick goes where the settings say'
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Café-Schicht lang'})
    assert stored(google, 'nebenjob@example.org') == ['Café-Schicht lang']
    calendar_cache._status['checked'] = None
    calendar_cache.sync()
    assert [event['title'] for event in calendar_cache.events(day(-70), day(100))] == [], 'the twin is never shown a second time'
    client.delete(f'/api/ui/events/{ref}')
    assert stored(google, 'nebenjob@example.org') == []


def test_a_picked_calendar_that_takes_no_events_gives_way_to_the_one_from_the_settings(google, client, monkeypatch):
    google.add_calendar('schule@example.org', 'Schule', role='owner')
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    google.add_calendar('plan@example.org', 'Stundenplan', role='owner')
    calendar_cache.sync()
    monkeypatch.setattr(calendar_cache, '_managed', lambda: {'plan@example.org'})
    choose(client, 'schule@example.org')
    own_in(client, 'feiertage@example.org', 'Erstens')
    own_in(client, 'plan@example.org', 'Zweitens', 3)
    own_in(client, 'weg@example.org', 'Drittens', 4)
    assert stored(google, 'schule@example.org') == ['Erstens', 'Zweitens', 'Drittens']
    assert stored(google, 'feiertage@example.org') == stored(google, 'plan@example.org') == stored(google, 'primary') == []


def test_a_change_never_moves_an_event_to_another_calendar(google, client):
    google.add_calendar('nebenjob@example.org', 'Nebenjob', role='writer')
    calendar_cache.sync()
    ref = own(client)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn', 'calendar': 'nebenjob@example.org'})
    assert stored(google, 'primary') == ['Fahrstunde Autobahn'] and stored(google, 'nebenjob@example.org') == []


def test_the_calendar_page_names_where_new_events_may_go(google, client, configured, monkeypatch):
    google.add_calendar('nebenjob@example.org', 'Nebenjob', role='writer', color='#f4511e')
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    google.add_calendar('plan@example.org', 'Stundenplan', role='owner')
    calendar_cache.sync()
    monkeypatch.setattr(calendar_cache, '_managed', lambda: {'plan@example.org'})
    google.calls.clear()
    sync = page_data(client, '/hub/calendar')['page']['sync']
    assert sync['calendars'] == [
        {'id': google.primary, 'name': 'Privat', 'color': '#4285f4', 'primary': True},
        {'id': 'nebenjob@example.org', 'name': 'Nebenjob', 'color': '#f4511e', 'primary': False},
    ]
    assert sync['target'] == google.primary and google.calls == []
    choose(client, 'nebenjob@example.org')
    assert page_data(client, '/hub/calendar')['page']['sync']['target'] == 'nebenjob@example.org'
    write_off = client.put('/api/ui/store/app-settings', json={'google': {'write': False}})
    assert write_off.status_code == 200
    sync = page_data(client, '/hub/calendar')['page']['sync']
    assert sync['write'] is False and 'calendars' not in sync


def test_without_google_the_calendar_page_names_no_calendar(client, configured, monkeypatch):
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {})
    sync = page_data(client, '/hub/calendar')['page']['sync']
    assert sync['source'] is None and sync['write'] is False and 'calendars' not in sync
