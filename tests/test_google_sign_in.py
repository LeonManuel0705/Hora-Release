# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import base64
import hashlib
import importlib.util
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from app import google_oauth

ROOT = Path(__file__).resolve().parent.parent
CALENDAR = google_oauth.CALENDAR_SCOPE
GMAIL_READ = google_oauth.GMAIL_READ_SCOPE
EVENTS = google_oauth.EVENTS_SCOPE
LISTING = google_oauth.CALENDAR_LIST_SCOPE
GMAIL = list(google_oauth.FEATURES['gmail'])
CLIENT = {'web': {
    'client_id': 'client.apps.googleusercontent.com', 'client_secret': 'secret',
    'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token',
    'redirect_uris': ['http://localhost:5050/api/email/google/oauth-callback'],
}}


@pytest.fixture
def hub(monkeypatch):
    from app import app as hub

    monkeypatch.setattr(hub, 'DESKTOP_TOKEN', None)
    monkeypatch.setattr(hub, '_google_states', {})
    hub.app.config['TESTING'] = True
    return hub


@pytest.fixture
def app_window(hub):
    with hub.app.test_client() as client:
        client.get(f'/hub?token={hub.API_TOKEN}')
        yield client


@pytest.fixture
def browser(hub):
    return hub.app.test_client()


@pytest.fixture
def google(monkeypatch):
    calls = []
    states = iter(f'state-{n}' for n in range(1, 100))

    def start(features=('calendar',), another=False):
        state = next(states)
        return {'success': True, 'auth_url': f'https://accounts.google.com/o/oauth2/auth?state={state}', 'state': state}

    def complete(code, features=('calendar',), verifier=None):
        calls.append(code)
        return {'success': True, 'email': 'lea@example.com'}

    monkeypatch.setattr(google_oauth, 'start_oauth_flow', start)
    monkeypatch.setattr(google_oauth, 'complete_oauth_flow', complete)
    return calls


def start(app_window):
    return app_window.post('/api/email/google/auth').get_json()['state']


def progress(app_window, state):
    return app_window.get(f'/api/email/google/progress?state={state}').get_json()


def test_sign_in_started_in_the_app_finishes_in_a_browser_without_its_cookies(app_window, browser, google):
    state = start(app_window)
    assert progress(app_window, state)['done'] is False
    page = browser.get(f'/api/email/google/oauth-callback?state={state}&code=abc')
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    assert 'Google ist verbunden' in html and 'lea@example.com' in html
    assert google == ['abc']
    assert progress(app_window, state) == {'success': True, 'done': True, 'ok': True, 'email': 'lea@example.com', 'error': ''}


def test_a_state_works_only_once(app_window, browser, google):
    state = start(app_window)
    browser.get(f'/api/email/google/oauth-callback?state={state}&code=abc')
    replay = browser.get(f'/api/email/google/oauth-callback?state={state}&code=evil')
    assert replay.status_code == 400 and 'Anmeldung abgelaufen' in replay.get_data(as_text=True)
    assert google == ['abc']


def test_unknown_and_expired_states_are_refused(hub, app_window, browser, google, monkeypatch):
    unknown = browser.get('/api/email/google/oauth-callback?state=erfunden&code=abc')
    assert unknown.status_code == 400 and 'Anmeldung abgelaufen' in unknown.get_data(as_text=True)
    monkeypatch.setattr(hub, 'GOOGLE_STATE_TTL', -1)
    state = start(app_window)
    expired = browser.get(f'/api/email/google/oauth-callback?state={state}&code=abc')
    assert expired.status_code == 400
    assert google == []
    assert progress(app_window, state)['ok'] is False


def test_a_cancelled_sign_in_reaches_the_app_and_is_escaped(app_window, browser, google):
    state = start(app_window)
    page = browser.get(f'/api/email/google/oauth-callback?state={state}&error=<script>alert(1)</script>')
    html = page.get_data(as_text=True)
    assert 'Anmeldung abgebrochen' in html and '<script>alert(1)' not in html
    result = progress(app_window, state)
    assert result['done'] is True and result['ok'] is False and 'abgebrochen' in result['error']
    assert google == []


def test_progress_needs_the_hub_login(app_window, browser, google):
    state = start(app_window)
    assert browser.get(f'/api/email/google/progress?state={state}').status_code == 401


class FakeCredentials:
    def __init__(self, granted):
        self.granted_scopes = granted
        self.token = 'access'
        self.refresh_token = 'refresh'
        self.token_uri = 'https://oauth2.googleapis.com/token'
        self.client_id = 'client'
        self.client_secret = 'secret'
        self.expiry = datetime.utcnow() + timedelta(hours=1)


class FakeFlow:
    def __init__(self, granted):
        self.credentials = FakeCredentials(granted)

    def fetch_token(self, **kwargs):
        pass


class Call:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


class FakeService:
    def __init__(self, api):
        self.api = api

    def users(self):
        return self

    def getProfile(self, userId):
        return Call({'emailAddress': 'mail@example.com'})

    def calendarList(self):
        return self

    def get(self, calendarId):
        return Call({'id': 'kalender@example.com'})


@pytest.fixture
def token_store(monkeypatch):
    saved = {}
    monkeypatch.setattr(google_oauth, '_get_oauth_client_config', lambda: {'web': {}})
    monkeypatch.setattr(google_oauth, 'build', lambda api, version, credentials: FakeService(api))
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: dict(saved))
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda tokens: saved.update(tokens) or True)
    return saved


def grant(monkeypatch, scopes):
    monkeypatch.setattr(google_oauth.Flow, 'from_client_config', classmethod(lambda cls, *args, **kwargs: FakeFlow(scopes)))


def test_calendar_alone_is_enough_and_its_scopes_are_kept(monkeypatch, token_store):
    grant(monkeypatch, [CALENDAR])
    result = google_oauth.complete_oauth_flow('abc')
    assert result['success'] is True and result['email'] == 'kalender@example.com'
    assert token_store['kalender@example.com']['scopes'] == [CALENDAR]
    assert token_store['kalender@example.com']['expiry']
    assert google_oauth.covers(token_store['kalender@example.com']['scopes'], 'calendar')


def test_gmail_gives_the_address_when_it_was_granted(monkeypatch, token_store):
    grant(monkeypatch, [GMAIL_READ, CALENDAR])
    assert google_oauth.complete_oauth_flow('abc')['email'] == 'mail@example.com'


def test_a_blocked_gmail_falls_back_to_the_calendar(monkeypatch, token_store):
    grant(monkeypatch, [GMAIL_READ, CALENDAR])

    def blocked(self, userId):
        raise RuntimeError('Gmail API has not been used in this project')

    monkeypatch.setattr(FakeService, 'getProfile', blocked)
    assert google_oauth.complete_oauth_flow('abc')['email'] == 'kalender@example.com'


def test_sign_in_without_the_calendar_asks_for_it(monkeypatch, token_store):
    grant(monkeypatch, [GMAIL_READ])
    result = google_oauth.complete_oauth_flow('abc')
    assert result['success'] is False and 'Kalender' in result['error']
    assert token_store == {}


def test_oauthlib_accepts_a_smaller_grant():
    import os

    assert os.environ.get('OAUTHLIB_RELAX_TOKEN_SCOPE')


class Grant:
    def __init__(self, scopes, refresh='refresh'):
        self.scopes = scopes
        self.refresh = refresh


@pytest.fixture
def flows(monkeypatch):
    """The real authorization URL, a token exchange that answers what the test grants."""
    saved = {}
    answer = Grant([EVENTS, LISTING])
    made = []
    real = google_oauth.Flow.from_client_config

    def make(cls, config, scopes, **kwargs):
        flow = real(config, scopes=scopes, **kwargs)
        made.append(list(scopes))

        def fetch_token(**params):
            flow.oauth2session.token = {
                'access_token': 'access', 'token_type': 'Bearer', 'expires_in': 3600, 'expires_at': time.time() + 3600,
                'scope': list(answer.scopes), **({'refresh_token': answer.refresh} if answer.refresh else {}),
            }
        flow.fetch_token = fetch_token
        return flow

    monkeypatch.setattr(google_oauth, '_get_oauth_client_config', lambda: CLIENT)
    monkeypatch.setattr(google_oauth, 'is_google_oauth_configured', lambda: True)
    monkeypatch.setenv('GOOGLE_GMAIL', '1')
    monkeypatch.setattr(google_oauth.Flow, 'from_client_config', classmethod(make))
    monkeypatch.setattr(google_oauth, 'build', lambda api, version, credentials=None, **kwargs: FakeService(api))
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {key: dict(value) for key, value in saved.items()})
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda tokens: saved.clear() or saved.update(tokens) or True)
    return saved, answer, made


def asked(result):
    return {key: values[0] for key, values in parse_qs(urlparse(result['auth_url']).query).items()}


def test_connecting_asks_for_the_calendar_alone_and_for_consent_the_first_time(flows):
    result = google_oauth.start_oauth_flow()
    query = asked(result)
    assert sorted(query['scope'].split()) == sorted([EVENTS, LISTING])
    assert query['prompt'] == 'consent' and query['access_type'] == 'offline' and query['include_granted_scopes'] == 'true'
    assert 'gmail' not in result['auth_url'] and result['features'] == ['calendar']


def test_adding_gmail_extends_a_working_sign_in_without_asking_for_consent_again(flows):
    saved, answer, _ = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}
    result = google_oauth.start_oauth_flow(['gmail'])
    query = asked(result)
    assert sorted(query['scope'].split()) == sorted(GMAIL)
    assert 'prompt' not in query and query['include_granted_scopes'] == 'true' and query['login_hint'] == 'lea@example.com'
    answer.scopes, answer.refresh = [EVENTS, LISTING, *GMAIL], None
    done = google_oauth.complete_oauth_flow('code', ['gmail'])
    assert done['success'] is True and done['email'] == 'mail@example.com'
    saved['lea@example.com'] = saved.pop('mail@example.com')
    assert saved['lea@example.com']['scopes'] == sorted([EVENTS, LISTING, *GMAIL])


def test_gmail_from_an_extended_sign_in_keeps_the_refresh_token_google_did_not_repeat(flows, monkeypatch):
    saved, answer, _ = flows
    monkeypatch.setattr(FakeService, 'getProfile', lambda self, userId: Call({'emailAddress': 'lea@example.com'}))
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}
    answer.scopes, answer.refresh = [EVENTS, LISTING, *GMAIL], None
    assert google_oauth.complete_oauth_flow('code', ['gmail'])['success'] is True
    assert saved['lea@example.com']['refresh_token'] == 'alt'
    answer.refresh = 'neu'
    google_oauth.complete_oauth_flow('code', ['gmail'])
    assert saved['lea@example.com']['refresh_token'] == 'neu'


def test_an_expired_sign_in_asks_for_consent_again(flows):
    saved, _, _ = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING], 'expired': True}
    query = asked(google_oauth.start_oauth_flow())
    assert query['prompt'] == 'consent' and query['login_hint'] == 'lea@example.com'


def test_what_was_granted_already_needs_no_browser(flows):
    saved, _, made = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt'}
    for features in (['calendar'], ['gmail'], ['school']):
        assert google_oauth.start_oauth_flow(features) == {'success': True, 'granted': True, 'email': 'lea@example.com', 'features': features}
    assert made == []


def test_a_gmail_opt_in_without_gmail_is_refused_and_changes_nothing(flows):
    saved, answer, _ = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}
    answer.scopes = [EVENTS, LISTING]
    result = google_oauth.complete_oauth_flow('code', ['gmail'])
    assert result['success'] is False and 'Gmail' in result['error']
    assert saved == {'lea@example.com': {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}}


def test_without_the_switch_only_an_account_that_holds_gmail_may_ask_for_it(flows, monkeypatch):
    saved, _, made = flows
    monkeypatch.delenv('GOOGLE_GMAIL')
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}
    assert google_oauth.gmail_via_google() is False
    assert google_oauth.start_oauth_flow(['gmail']) == {'success': False, 'error': google_oauth.GMAIL_OFF}
    assert google_oauth.start_oauth_flow(['calendar', 'gmail'], another=True)['success'] is False
    assert made == []
    saved['post@example.com'] = {'token': 'b', 'refresh_token': 'alt', 'scopes': GMAIL}
    assert google_oauth.gmail_via_google() is True
    assert google_oauth.start_oauth_flow(['gmail'], another=True)['success'] is True


def test_the_sign_in_ends_with_the_verifier_of_its_challenge_which_stays_on_the_server(app_window, browser, flows, monkeypatch):
    made = google_oauth.Flow.from_client_config
    verifiers = []

    def record(cls, config, scopes, **kwargs):
        verifiers.append(kwargs.get('code_verifier'))
        return made(config, scopes, **kwargs)
    monkeypatch.setattr(google_oauth.Flow, 'from_client_config', classmethod(record))
    started = app_window.post('/api/email/google/auth', json={'features': ['calendar'], 'another': True}).get_json()
    assert started['success'] is True and 'code_verifier' not in started
    query = asked(started)
    assert query['code_challenge_method'] == 'S256'
    assert browser.get(f"/api/email/google/oauth-callback?state={started['state']}&code=abc").status_code == 200
    verifier = verifiers[-1]
    digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    assert digest == query['code_challenge']


def test_a_release_carries_a_desktop_client_written_from_the_secrets(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('write_google_client', ROOT / 'scripts' / 'write_google_client.py')
    write_google_client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(write_google_client)
    target = tmp_path / 'google_client.json'
    monkeypatch.setattr(google_oauth, 'GOOGLE_CLIENT_ID', None)
    monkeypatch.setattr(google_oauth, 'CREDENTIALS_FILE', tmp_path / 'missing.json')
    monkeypatch.setattr(google_oauth, 'BUNDLED_CLIENT_FILE', target)
    monkeypatch.setenv('GOOGLE_OAUTH_CLIENT_ID', 'desktop.apps.googleusercontent.com')
    monkeypatch.setenv('GOOGLE_OAUTH_CLIENT_SECRET', 'GOCSPX-test')
    assert write_google_client.write(target) is True
    assert google_oauth.is_google_oauth_configured() is True
    client = google_oauth._get_oauth_client_config()['web']
    assert client['client_id'] == 'desktop.apps.googleusercontent.com' and client['client_secret'] == 'GOCSPX-test'
    assert urlparse(client['redirect_uris'][0]).hostname == 'localhost', 'a Desktop app client signs in through the loopback'
    monkeypatch.delenv('GOOGLE_OAUTH_CLIENT_SECRET')
    assert write_google_client.write(target) is False and not target.exists()
    assert google_oauth.is_google_oauth_configured() is False and google_oauth._get_oauth_client_config() is None


def test_the_client_file_of_a_release_stays_out_of_the_repository():
    ignored = subprocess.run(['git', 'check-ignore', '-q', 'app/google_client.json'], cwd=ROOT)
    assert ignored.returncode == 0
    spec = (ROOT / 'server.spec').read_text(encoding='utf-8')
    assert "GOOGLE_CLIENT = 'app/google_client.json'" in spec and 'datas.append((GOOGLE_CLIENT, ' in spec
    workflow = (ROOT / '.github' / 'workflows' / 'release.yml').read_text(encoding='utf-8')
    assert 'GOOGLE_OAUTH_CLIENT_ID: ${{ secrets.GOOGLE_OAUTH_CLIENT_ID }}' in workflow
    assert 'GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}' in workflow
    assert 'scripts/write_google_client.py' in (ROOT / 'scripts' / 'build_backend.sh').read_text(encoding='utf-8')
    assert 'scripts/write_google_client.py' in (ROOT / 'flutter_app' / 'scripts' / 'build_macos.sh').read_text(encoding='utf-8')


def test_unknown_parts_are_refused(flows):
    assert google_oauth.start_oauth_flow(['drive'])['success'] is False
    assert google_oauth.complete_oauth_flow('code', ['calendar', 'drive'])['success'] is False


def test_an_account_from_before_the_split_keeps_every_permission(monkeypatch):
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {'alt@example.com': {'token': 'x', 'refresh_token': 'r'}})
    assert google_oauth.can('calendar') and google_oauth.can('write') and google_oauth.can('gmail') and google_oauth.can('school')
    assert google_oauth.calendar_account() == 'alt@example.com'
    assert google_oauth.get_google_accounts() == [{'email': 'alt@example.com', 'provider': 'gmail_oauth'}]


def test_only_accounts_with_gmail_count_as_mailboxes_and_the_calendar_uses_one_that_reads_it(monkeypatch):
    tokens = {
        'post@example.com': {'token': 'x', 'scopes': GMAIL},
        'lea@example.com': {'token': 'y', 'scopes': [EVENTS, LISTING]},
    }
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: dict(tokens))
    assert [item['email'] for item in google_oauth.get_google_accounts()] == ['post@example.com']
    assert google_oauth.calendar_account() == 'lea@example.com'
    assert google_oauth.can('write') and not google_oauth.can('gmail') and not google_oauth.can('school')
    assert [(item['email'], item['gmail'], item['calendar']) for item in google_oauth.connected_accounts()] == [
        ('post@example.com', True, False), ('lea@example.com', False, True),
    ]


def test_a_sign_in_started_for_gmail_is_finished_for_gmail(app_window, browser, monkeypatch):
    finished = []
    monkeypatch.setattr(google_oauth, 'start_oauth_flow', lambda features, another=False: {'success': True, 'auth_url': 'https://accounts.google.com/x', 'state': 'gmail-state', 'features': list(features)})
    monkeypatch.setattr(google_oauth, 'complete_oauth_flow', lambda code, features=('calendar',), verifier=None: finished.append(list(features)) or {'success': True, 'email': 'lea@example.com'})
    started = app_window.post('/api/email/google/auth', json={'features': ['gmail']}).get_json()
    assert started['features'] == ['gmail']
    assert browser.get('/api/email/google/oauth-callback?state=gmail-state&code=abc').status_code == 200
    assert finished == [['gmail']]


def test_the_status_answers_in_german_when_google_is_not_set_up(app_window, monkeypatch):
    monkeypatch.setattr(google_oauth, 'is_google_oauth_configured', lambda: False)
    status = app_window.get('/api/email/google/status').get_json()
    assert status['configured'] is False and status['message'] == 'Google ist in dieser Installation nicht eingerichtet'


def test_an_extended_sign_in_keeps_what_was_granted_before_even_if_google_names_only_the_new_part(flows, monkeypatch):
    saved, answer, _ = flows
    monkeypatch.setattr(FakeService, 'getProfile', lambda self, userId: Call({'emailAddress': 'lea@example.com'}))
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [EVENTS, LISTING]}
    answer.scopes, answer.refresh = list(GMAIL), None
    assert google_oauth.complete_oauth_flow('code', ['gmail'])['success'] is True
    assert saved['lea@example.com']['scopes'] == sorted([EVENTS, LISTING, *GMAIL])
    assert google_oauth.calendar_account() == 'lea@example.com' and google_oauth.can('gmail')


def test_a_new_sign_in_after_expiry_takes_only_what_google_granted_now(flows):
    saved, answer, _ = flows
    saved['kalender@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'scopes': [*GMAIL, EVENTS, LISTING], 'expired': True}
    answer.scopes = [EVENTS, LISTING]
    assert google_oauth.complete_oauth_flow('code')['success'] is True
    entry = saved['kalender@example.com']
    assert entry['scopes'] == sorted([EVENTS, LISTING]) and 'expired' not in entry and entry['refresh_token'] == 'refresh'


def renew_and_grant_what_was_asked(answer, features=('calendar',)):
    query = asked(google_oauth.start_oauth_flow(list(features)))
    answer.scopes, answer.refresh = query['scope'].split(), 'neu'
    return query, google_oauth.complete_oauth_flow('code', list(features))


@pytest.mark.parametrize('scopes', [None, list(google_oauth.LEGACY_SCOPES), [EVENTS, LISTING, *GMAIL]], ids=['legacy-unlisted', 'legacy-listed', 'split'])
def test_renewing_an_expired_sign_in_keeps_its_mailbox(flows, monkeypatch, scopes):
    saved, answer, _ = flows
    monkeypatch.delenv('GOOGLE_GMAIL')
    monkeypatch.setattr(FakeService, 'getProfile', lambda self, userId: Call({'emailAddress': 'kalender@example.com'}))
    saved['kalender@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'expired': True, **({'scopes': scopes} if scopes else {})}
    query, done = renew_and_grant_what_was_asked(answer)
    assert query['prompt'] == 'consent' and set(GMAIL) <= set(query['scope'].split())
    assert google_oauth.APP_CALENDARS_SCOPE not in query['scope'], 'the school calendar is off, so it is not asked for'
    assert done['success'] is True
    assert google_oauth.get_google_accounts() == [{'email': 'kalender@example.com', 'provider': 'gmail_oauth'}]
    assert google_oauth.calendar_account() == 'kalender@example.com' and not google_oauth.login_expired()


@pytest.mark.parametrize('scopes', [None, list(google_oauth.LEGACY_SCOPES), [EVENTS, LISTING, google_oauth.APP_CALENDARS_SCOPE]], ids=['legacy-unlisted', 'legacy-listed', 'split'])
def test_renewing_keeps_the_school_calendar_where_it_is_on(flows, monkeypatch, scopes):
    from app import google_school

    saved, answer, _ = flows
    monkeypatch.setattr(FakeService, 'getProfile', lambda self, userId: Call({'emailAddress': 'kalender@example.com'}))
    monkeypatch.setattr(google_school, 'is_on', lambda account: account == 'kalender@example.com')
    saved['kalender@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'expired': True, **({'scopes': scopes} if scopes else {})}
    query, done = renew_and_grant_what_was_asked(answer)
    assert google_oauth.APP_CALENDARS_SCOPE in query['scope'].split() and done['success'] is True
    assert google_oauth.can('school')


def test_a_renewal_without_the_extra_parts_still_renews_the_calendar(flows):
    saved, answer, _ = flows
    saved['kalender@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'expired': True}
    google_oauth.start_oauth_flow(['calendar'])
    answer.scopes = [EVENTS, LISTING]
    assert google_oauth.complete_oauth_flow('code', ['calendar'])['success'] is True
    assert google_oauth.calendar_account() == 'kalender@example.com' and not google_oauth.login_expired()


def test_another_account_can_always_be_added(flows):
    saved, _, made = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt'}
    result = google_oauth.start_oauth_flow(['gmail'], another=True)
    query = asked(result)
    assert 'granted' not in result and 'login_hint' not in query and query['prompt'] == 'select_account consent'


def test_the_route_passes_the_wish_for_another_account(app_window, monkeypatch):
    seen = []
    monkeypatch.setattr(google_oauth, 'start_oauth_flow', lambda features, another=False: seen.append((list(features), another)) or {'success': True, 'granted': True})
    app_window.post('/api/email/google/auth', json={'features': ['gmail'], 'another': True})
    app_window.post('/api/email/google/auth')
    assert seen == [(['gmail'], True), (['calendar'], False)]


def test_a_refresh_asks_for_no_scope_list_so_a_larger_stored_list_cannot_break_it(monkeypatch):
    stored = {'lea@example.com': {'token': 'a', 'refresh_token': 'alt', 'client_id': 'c', 'client_secret': 's',
                                  'scopes': [EVENTS, LISTING, *GMAIL], 'expiry': (datetime.utcnow() - timedelta(minutes=5)).isoformat()}}
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {key: dict(value) for key, value in stored.items()})
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda tokens: stored.update(tokens) or True)

    def refresh(self, request):
        if self.scopes:
            raise RuntimeError('invalid_scope: Some requested scopes were invalid')
        self.token = 'neu'
        self.expiry = datetime.utcnow() + timedelta(hours=1)

    monkeypatch.setattr(google_oauth.Credentials, 'refresh', refresh)
    assert google_oauth.get_credentials('lea@example.com').token == 'neu'
    assert 'expired' not in stored['lea@example.com'] and stored['lea@example.com']['scopes'] == [EVENTS, LISTING, *GMAIL]


def test_the_classic_pages_offer_google_only_where_it_is_set_up(app_window, monkeypatch):
    monkeypatch.setattr(google_oauth, 'is_google_oauth_configured', lambda: False)
    assert 'connectGoogleAccount()">Konto verbinden' not in app_window.get('/hub/klassisch/settings').get_data(as_text=True)
    assert 'id="googleSignInBtn"' not in app_window.get('/hub/klassisch/email').get_data(as_text=True)
    monkeypatch.setattr(google_oauth, 'is_google_oauth_configured', lambda: True)
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {})
    monkeypatch.delenv('GOOGLE_GMAIL', raising=False)
    assert 'connectGoogleAccount()">Konto verbinden' in app_window.get('/hub/klassisch/settings').get_data(as_text=True)
    assert 'id="googleSignInBtn"' not in app_window.get('/hub/klassisch/email').get_data(as_text=True), 'Gmail through Google is switched off'
    monkeypatch.setenv('GOOGLE_GMAIL', '1')
    assert 'id="googleSignInBtn"' in app_window.get('/hub/klassisch/email').get_data(as_text=True)


def test_another_account_asked_for_while_the_sign_in_is_expired_renews_it_with_all_it_covered(flows):
    saved, _, _ = flows
    saved['lea@example.com'] = {'token': 'a', 'refresh_token': 'alt', 'expired': True}
    query = asked(google_oauth.start_oauth_flow(['gmail'], another=True))
    assert {EVENTS, LISTING, *GMAIL} <= set(query['scope'].split())
    assert query['prompt'] == 'consent' and query['login_hint'] == 'lea@example.com'
