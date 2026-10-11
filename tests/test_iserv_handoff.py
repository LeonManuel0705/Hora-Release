# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import html
from types import SimpleNamespace
from urllib.parse import urljoin, urlparse

import pytest

HOST = 'iserv.schule.de'
BASE = f'https://{HOST}'
HANDOFF = f'{BASE}/iserv/auth/auth?client_id=app&state=abc'
ENTRY = f'{BASE}/iserv/app/authentication/redirect?state=abc&code=xyz'
SHOW = f'{BASE}/iserv/infodisplay/show/3'
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 12000


class Answer:
    def __init__(self, url, status=200, body='', kind='text/html; charset=UTF-8', location=None):
        self.url = url
        self.status_code = status
        self.content = body if isinstance(body, bytes) else body.encode()
        self.text = '' if isinstance(body, bytes) else body
        self.headers = {'Content-Type': kind}
        if location:
            self.headers['Location'] = location
        self.is_redirect = location is not None

    def close(self):
        pass

    def iter_content(self, size):
        yield self.content

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def handoff_page(target=ENTRY, content=None):
    refresh = content if content is not None else f'0;url={target}'
    return f'<html><head><meta http-equiv="refresh" content="{html.escape(refresh)}"><title>IServ</title></head><body>Sie werden weitergeleitet.</body></html>'


class School:
    def __init__(self, signed_in=True, handoff=None, pages=None):
        self.signed_in = signed_in
        self.handoff = handoff_page() if handoff is None else handoff
        self.pages = pages or {}
        self.entered = False
        self.wanted = f'{BASE}/iserv/'
        self.requested = []
        self.sent = []
        self.cookies = []

    def request(self, method, url, allow_redirects=True, **kwargs):
        self.sent.append(kwargs)
        for _ in range(10):
            self.requested.append((method, url))
            answer = self.answer(method, url)
            if not allow_redirects or not answer.is_redirect:
                return answer
            url, method = urljoin(url, answer.headers['Location']), 'GET'
        raise AssertionError('redirect loop')

    def answer(self, method, url):
        path = urlparse(url).path
        if urlparse(url).netloc != HOST:
            raise AssertionError(f'left the school: {url}')
        if path == '/iserv/auth/login':
            return Answer(url, body='<form><input name="_username"><input name="_password"></form>')
        if path.startswith('/iserv/auth/'):
            if not self.signed_in:
                return Answer(url, 302, location='/iserv/auth/login')
            return Answer(url, body=self.handoff)
        if path == '/iserv/app/authentication/redirect':
            self.entered = True
            self.cookies = [SimpleNamespace(name=name, value=f'{name}-value') for name in ('IServAuthSession', 'IServSAT', 'IServSATId', 'IServSession')]
            return Answer(url, 302, location=self.wanted)
        if not self.entered:
            self.wanted = url
            return Answer(url, 302, location=HANDOFF)
        if method == 'HEAD':
            return Answer(url, 404)
        page = self.pages.get(path)
        if page is None:
            return Answer(url, 404)
        return Answer(url, body=page[0], kind=page[1])


@pytest.fixture
def iserv():
    from app import iserv_service

    return iserv_service


def test_the_sign_in_page_that_forwards_by_meta_refresh_is_passed(iserv):
    school = School(pages={'/iserv/infodisplay/show/3': ('<p>Plan</p>', 'text/html')})
    iserv._pass_handoff(school, BASE)
    answer = iserv._request_on_host(school, 'GET', SHOW, BASE, timeout=1)
    assert answer.url == SHOW and answer.text == '<p>Plan</p>'
    assert [url for _, url in school.requested] == [SHOW, HANDOFF, ENTRY, SHOW]


def test_calls_that_follow_redirects_themselves_are_asked_again_once_inside(iserv):
    api = f'{BASE}/iserv/notification/api/v1/notifications'
    school = School(pages={'/iserv/notification/api/v1/notifications': ('{"status":"success"}', 'application/json')})
    iserv._pass_handoff(school, BASE)
    assert school.request('GET', api, headers={'X-Requested-With': 'XMLHttpRequest'}).text == '{"status":"success"}'
    assert [url for _, url in school.requested] == [api, HANDOFF, ENTRY, api, api]
    assert school.sent[-1] == {'headers': {'X-Requested-With': 'XMLHttpRequest'}}
    assert school.request('GET', api).text == '{"status":"success"}'
    assert len(school.requested) == 6


def test_a_post_that_was_sent_to_the_sign_in_is_repeated_once_inside(iserv):
    read = f'{BASE}/iserv/notification/api/v1/notifications/7/read'
    school = School(pages={'/iserv/notification/api/v1/notifications/7/read': ('{"status":"success"}', 'application/json')})
    iserv._pass_handoff(school, BASE)
    assert school.request('POST', read).text == '{"status":"success"}'
    assert school.requested == [('POST', read), ('GET', HANDOFF), ('GET', ENTRY), ('GET', read), ('POST', read)]


@pytest.mark.parametrize('target', [
    'https://evil.example/iserv/app/authentication/redirect?code=xyz',
    'http://169.254.169.254/latest/meta-data/',
    'https://iserv.schule.de.evil.example/x',
    'http://iserv.schule.de/iserv/app/authentication/redirect',
    'https://evil.example\\.iserv.schule.de/x',
])
def test_a_refresh_that_leaves_the_school_is_never_requested(iserv, target):
    school = School(handoff=handoff_page(target))
    iserv._pass_handoff(school, BASE)
    answer = iserv._request_on_host(school, 'GET', SHOW, BASE, timeout=1)
    assert answer.url == HANDOFF and not school.entered
    assert [url for _, url in school.requested] == [SHOW, HANDOFF]


def test_a_page_inside_iserv_that_reloads_itself_is_left_alone(iserv):
    reload = '<html><head><meta http-equiv="refresh" content="60;url=/iserv/infodisplay/show/3"></head><body><img src="/iserv/infodisplay/pdf/17/1/0"></body></html>'
    assert iserv._handoff_target(Answer(SHOW, body=reload)) is None
    assert iserv._handoff_target(Answer(HANDOFF, body=handoff_page(), kind='application/json')) is None
    assert iserv._handoff_target(Answer(HANDOFF, 500, body=handoff_page())) is None


@pytest.mark.parametrize('content', [
    f'0;url={ENTRY}',
    f'0; URL={ENTRY}',
    f"0;url='{ENTRY}'",
    '0;/iserv/app/authentication/redirect?state=abc&code=xyz',
])
def test_the_refresh_target_is_read_in_the_ways_browsers_accept(iserv, content):
    assert iserv._handoff_target(Answer(HANDOFF, body=handoff_page(content=content))) == ENTRY


def test_a_refresh_without_an_address_is_no_handoff(iserv):
    assert iserv._handoff_target(Answer(HANDOFF, body=handoff_page(content='30'))) is None
    assert iserv._handoff_target(Answer(HANDOFF, body='<p>Sie sind eingeloggt.</p>')) is None


@pytest.fixture
def service(iserv, monkeypatch):
    service = iserv.IServService.__new__(iserv.IServService)
    service.api = None
    service.connected = False
    service.user_info = None
    service.iserv_url = None
    service.saved = []
    monkeypatch.setattr(iserv, '_validate_hostname_ssrf', lambda hostname: None)
    monkeypatch.setattr(service, 'save_credentials', lambda *args: service.saved.append(args))
    return service


def library(school):
    def build(username, password, iserv_url):
        return SimpleNamespace(_session=school, _IServSAT=None, _IServSATId=None, _IServSession=None, get_own_user_info=lambda: {'name': 'Lea'})

    return build


def test_connecting_enters_the_app_and_hands_the_library_its_cookies(iserv, service, monkeypatch):
    school = School(pages={'/iserv/': ('<h1>Start</h1>', 'text/html')})
    monkeypatch.setattr(iserv, 'IServAPI', library(school))
    assert service.connect('lea', 'geheim', HOST)['success'] is True
    assert service.is_connected() and school.entered and service.saved == [('lea', 'geheim', HOST)]
    assert (service.api._IServSAT, service.api._IServSATId, service.api._IServSession) == ('IServSAT-value', 'IServSATId-value', 'IServSession-value')


def test_a_sign_in_that_iserv_did_not_take_is_not_reported_as_connected(iserv, service, monkeypatch):
    monkeypatch.setattr(iserv, 'IServAPI', library(School(signed_in=False)))
    assert service.connect('lea', 'falsch', HOST) == {'success': False, 'error': 'Falscher Benutzername oder Passwort'}
    assert not service.is_connected() and service.saved == []


def test_a_sign_in_page_that_leads_nowhere_is_not_reported_as_connected(iserv, service, monkeypatch):
    monkeypatch.setattr(iserv, 'IServAPI', library(School(handoff='<p>Sie sind eingeloggt.</p>')))
    result = service.connect('lea', 'geheim', HOST)
    assert result['success'] is False and 'nicht abgeschlossen' in result['error']
    assert not service.is_connected() and service.saved == []


def test_the_plan_is_fetched_through_the_sign_in_page(iserv, service):
    show = '<html><body><img src="/iserv/assets/infodisplay/img/infodisplay.svg"><img src="/iserv/infodisplay/pdf/17/1/0?1"><img src="/iserv/infodisplay/pdf/17/2/0?1"></body></html>'
    school = School(pages={
        '/iserv/infodisplay/show/3': (show, 'text/html;charset=UTF-8'),
        '/iserv/infodisplay/pdf/17/1/0': (PNG, 'image/png'),
        '/iserv/infodisplay/pdf/17/2/0': (PNG + b'1', 'image/png'),
        '/iserv/assets/infodisplay/img/infodisplay.svg': (b'<svg/>' * 3000, 'image/svg+xml'),
    })
    iserv._pass_handoff(school, BASE)
    service.api, service.iserv_url, service.connected = SimpleNamespace(_session=school), HOST, True
    result = service._fetch_vertretungsplan_pdfs(3)
    assert result['success'] is True
    assert [(page['page'], page['type'], urlparse(page['url']).path) for page in result['pdfs']] == [(1, 'image', '/iserv/infodisplay/pdf/17/1/0'), (2, 'image', '/iserv/infodisplay/pdf/17/2/0')]


def test_a_plan_request_stuck_at_the_sign_in_counts_as_an_expired_session(iserv, service):
    school = School(handoff='<p>Sie sind eingeloggt und werden weitergeleitet.</p>')
    iserv._pass_handoff(school, BASE)
    service.api, service.iserv_url, service.connected = SimpleNamespace(_session=school), HOST, True
    assert service._fetch_vertretungsplan_pdfs(3) == {'success': False, 'error': 'Sitzung abgelaufen', 'expired': True}
