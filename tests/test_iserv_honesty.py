# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from datetime import date, datetime, timedelta

import pytest

from app import database as db
from app import iserv_service
from app import ui_data
from app.crypto_utils import encrypt_file
from app.paths import DATA_DIR

class FakeIserv:
    def __init__(self, homework=None, plan=None):
        self.homework = homework or {'success': True, 'exercises': []}
        self.plan = plan or {'success': True, 'pdfs': [{'data': ''}]}
        self.calls = []

    def get_homework(self):
        self.calls.append('homework')
        return self.homework

    def get_vertretungsplan_pdfs(self):
        self.calls.append('plan')
        return self.plan

    def plan_cache(self):
        return {'files': [{'page': 1, 'type': 'image', 'digest': 'a1'}, {'page': 2, 'type': 'image', 'digest': 'b2'}], 'cached_at': None}

    def is_connected(self):
        return True

    def connect(self):
        return {'success': True}

    def get_emails(self, limit=20):
        self.calls.append('mail')
        return {'success': True, 'emails': [
            {'uid': 7, 'from': 'mueller@schule.de', 'subject': 'Klausur', 'date': '2026-11-06 07:12', 'read': False},
            {'uid': 8, 'from': 'sekretariat@schule.de', 'subject': 'Info', 'date': '2026-11-05 12:00', 'read': True},
        ]}

    def get_status(self):
        return {'connected': True, 'has_credentials': True, 'username': 'ben.k'}


def forget():
    for name in ('iserv', 'sync', 'iserv_homework', 'mail_archive', 'homework'):
        path = ui_data._path(name)
        if path.exists():
            path.unlink()
        ui_data._cache.pop(name, None)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    fetches = []
    monkeypatch.setattr(ui_data, 'refresh_iserv_homework_soon', lambda: fetches.append(1))
    forget()
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        client.fetches = fetches
        yield client
    forget()


def connect(user='ben.k', host='iserv.schule.de'):
    encrypt_file({'username': user, 'password': 'geheim', 'iserv_url': host}, ui_data._path('iserv'))
    ui_data._cache.pop('iserv', None)


def page_data(client, path):
    html = client.get(path).get_data(as_text=True)
    return json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))


def test_nothing_connected_claims_no_sync(client):
    status = page_data(client, '/hub')['status']
    assert status['iserv'] is False and status['iservAvailable'] is True
    assert status['synced'] == {'iserv': None, 'google': None}
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', status['rendered'])
    assert client.fetches == []


def test_the_stand_is_when_iserv_last_gave_data_and_only_for_that_account(client):
    connect()
    assert page_data(client, '/hub')['status']['synced']['iserv'] is None
    ui_data.mark_synced('iserv', 'plan', 'ben.k@iserv.schule.de')
    status = page_data(client, '/hub')['status']
    assert status['synced']['iserv'] == datetime.now().isoformat(timespec='minutes') == status['iservParts']['plan']
    assert status['iservParts']['homework'] is None
    connect(user='mia.k')
    assert page_data(client, '/hub')['status']['synced']['iserv'] is None


def test_a_plan_kept_by_an_older_version_counts_as_the_last_sync(client):
    connect()
    meta = DATA_DIR / 'vertretungsplan_cache' / 'cache_meta.json'
    meta.parent.mkdir(parents=True, exist_ok=True)
    encrypt_file({'version': 2, 'cached_at': '2026-11-06T07:36:12.123456', 'files': []}, meta)
    ui_data._cache.pop('plan_meta', None)
    try:
        assert page_data(client, '/hub')['status']['synced']['iserv'] == '2026-11-06T07:36'
    finally:
        meta.unlink()
        ui_data._cache.pop('plan_meta', None)


def test_a_fresh_plan_is_noted_as_synced_and_a_failed_one_is_not(client, monkeypatch):
    connect()
    fake = FakeIserv()
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    fake.plan = {'success': False, 'cause': 'offline'}
    assert client.get('/api/ui/vplan?frisch=1').get_json()['problem'] == 'offline'
    assert ui_data.iserv_parts('ben.k@iserv.schule.de')['plan'] is None
    fake.plan = {'success': True, 'pdfs': [{'data': ''}]}
    assert client.get('/api/ui/vplan?frisch=1').get_json()['problem'] is None
    assert ui_data.iserv_parts('ben.k@iserv.schule.de')['plan'] == datetime.now().isoformat(timespec='minutes')


def homework(item_id, title, due, course='Mathematik', status='open'):
    return {'id': item_id, 'title': title, 'description': '', 'course': course, 'teacher': 'Herr Krause', 'due': due, 'status': status}


def test_homework_from_iserv_is_listed_read_only_and_only_once(client, monkeypatch):
    connect()
    soon = (date.today() + timedelta(days=2)).isoformat()
    client.post('/api/ui/deadlines', json={'kind': 'Hausaufgabe', 'title': 'Diercke S. 24', 'date': soon})
    fake = FakeIserv({'success': True, 'exercises': [
        homework('41', 'Analysis Blatt 3', f'{soon}T23:59:00+01:00'),
        homework('42', 'Diercke S. 24', soon, course='Geografie'),
        homework('43', 'Längst abgegeben', (date.today() - timedelta(days=30)).isoformat()),
    ]})
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    answer = client.post('/api/ui/iserv/homework').get_json()
    assert answer['ok'] is True and answer['count'] == 1
    assert [item['id'] for item in answer['deadlines']] == ['hw-iserv.41']
    listed = [item for item in page_data(client, '/hub')['deadlines'] if item['kind'] == 'Hausaufgabe']
    assert sorted(item['title'] for item in listed) == ['Analysis Blatt 3', 'Diercke S. 24']
    mine = next(item for item in listed if item['title'] == 'Analysis Blatt 3')
    assert (mine['origin'], mine['date'], mine['detail'], mine['status']) == ('iserv', soon, 'Mathematik', 'offen')
    assert page_data(client, '/hub')['status']['iservParts']['homework'] == datetime.now().isoformat(timespec='minutes')


def test_homework_taken_over_by_hand_and_ticked_off_keeps_its_iserv_copy_away(client):
    connect()
    past = (date.today() - timedelta(days=3)).isoformat()
    soon = (date.today() + timedelta(days=2)).isoformat()
    ui_data.modify_list('homework', lambda items: items.extend([
        {'id': 'own1', 'title': 'Mathe S. 40 Nr. 3', 'due_date': past, 'completed': True},
        {'id': 'own2', 'title': 'Diercke S. 24', 'due_date': soon, 'completed': True},
    ]))
    ui_data.change_iserv_homework(ui_data.iserv_key(), lambda state: state.update(items=[
        homework('7', 'Mathe S. 40 Nr. 3', past), homework('8', 'Diercke S. 24', soon, course='Geografie'),
    ]))
    listed = [(item['id'], item['status']) for item in page_data(client, '/hub/tasks')['deadlines'] if item['kind'] == 'Hausaufgabe']
    assert listed == [('hw-own2', 'abgegeben')]


def test_homework_from_iserv_can_be_ticked_hidden_and_brought_back_without_touching_iserv(client, monkeypatch):
    connect()
    soon = (date.today() + timedelta(days=1)).isoformat()
    fake = FakeIserv({'success': True, 'exercises': [homework('41', 'Analysis Blatt 3', soon)]})
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    client.post('/api/ui/iserv/homework')
    ticked = client.patch('/api/ui/deadlines/hw-iserv.41', json={'status': 'abgegeben', 'title': 'Anders'}).get_json()['deadline']
    assert ticked['status'] == 'abgegeben' and ticked['title'] == 'Analysis Blatt 3'
    assert client.delete('/api/ui/deadlines/hw-iserv.41').status_code == 200
    assert 'hw-iserv.41' not in [item['id'] for item in page_data(client, '/hub')['deadlines']]
    back = client.patch('/api/ui/deadlines/hw-iserv.41', json={'hidden': False, 'status': 'offen'}).get_json()['deadline']
    assert back['status'] == 'offen'
    assert 'hw-iserv.41' in [item['id'] for item in page_data(client, '/hub')['deadlines']]
    assert client.patch('/api/ui/deadlines/hw-iserv.99', json={'status': 'offen'}).status_code == 404
    assert fake.calls == ['homework']


def test_a_failed_fetch_keeps_the_last_list_and_says_why(client, monkeypatch):
    connect()
    soon = (date.today() + timedelta(days=1)).isoformat()
    fake = FakeIserv({'success': True, 'exercises': [homework('41', 'Analysis Blatt 3', soon)]})
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    client.post('/api/ui/iserv/homework')
    fake.homework = {'success': False, 'cause': 'format'}
    answer = client.post('/api/ui/iserv/homework').get_json()
    assert answer['ok'] is False and answer['problem'] == 'format' and 'nicht lesen' in answer['message']
    assert [item['id'] for item in answer['deadlines']] == ['hw-iserv.41']


def test_pages_only_start_a_fetch_in_the_background_when_the_last_one_is_old(client, monkeypatch):
    page_data(client, '/hub')
    assert client.fetches == []
    connect()
    page_data(client, '/hub/tasks')
    assert client.fetches == [1]
    ui_data.change_iserv_homework('ben.k@iserv.schule.de', lambda state: state.update(tried_at=datetime.now().isoformat(timespec='minutes')))
    page_data(client, '/hub/tasks')
    assert client.fetches == [1]


def test_syncing_now_fetches_what_iserv_gives_here_and_reports_each_part(client, monkeypatch):
    connect()
    soon = (date.today() + timedelta(days=1)).isoformat()
    fake = FakeIserv({'success': True, 'exercises': [homework('41', 'Analysis Blatt 3', soon)]})
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    answer = client.post('/api/ui/iserv/sync').get_json()
    assert sorted(fake.calls) == ['homework', 'mail', 'plan']
    parts = answer['parts']
    assert parts['plan'] == {'ok': True, 'problem': None, 'message': '', 'count': 2}
    assert parts['homework']['ok'] is True and parts['homework']['count'] == 1
    assert parts['mail'] == {'ok': True, 'problem': None, 'message': '', 'count': 1}
    now = datetime.now().isoformat(timespec='minutes')
    assert answer['status']['synced']['iserv'] == now
    assert answer['status']['iservParts'] == {'plan': now, 'mail': now, 'homework': now}
    assert page_data(client, '/hub')['mailUnread'] == 1


def test_syncing_without_an_account_says_so(client):
    response = client.post('/api/ui/iserv/sync')
    assert response.status_code == 409 and response.get_json()['error'] == 'IServ ist nicht verbunden.'


def test_the_unread_counter_follows_the_mailboxes_without_asking_them_on_every_page(client, monkeypatch):
    from app import ui_pages
    views = lambda account, unread: [{'id': f'{account}|{uid}', 'folder': 'inbox', 'read': False} for uid in unread]
    ui_data.note_unread(views('a@x.de', [1, 2]) + views('b@x.de', [5]), {'a@x.de', 'b@x.de'}, {'a@x.de', 'b@x.de'})
    assert page_data(client, '/hub')['mailUnread'] == 3
    ui_data.note_unread(views('a@x.de', [2]), {'a@x.de'}, {'a@x.de', 'b@x.de'})
    assert page_data(client, '/hub/tasks')['mailUnread'] == 2
    ui_data.note_unread([], set(), {'a@x.de'})
    assert ui_data.mail_unread_ids() == ['a@x.de|2']
    ui_data.note_read(['a@x.de|2'])
    assert page_data(client, '/hub')['mailUnread'] == 0
    monkeypatch.setattr(ui_pages, '_mail_accounts', lambda: [{'email': 'a@x.de', 'kind': 'imap', 'name': 'a@x.de'}])
    monkeypatch.setattr(ui_pages, '_fetch_inbox', lambda account, limit: (True, [{'id': 1, 'read': False}, {'id': 2, 'read': False}, {'id': 3, 'read': True}]))
    assert client.get('/api/ui/mail').status_code == 200
    assert page_data(client, '/hub')['mailUnread'] == 2
    assert client.put('/api/ui/mail/archive', json={'id': 'a@x.de|1', 'archived': True}).status_code == 200
    assert page_data(client, '/hub')['mailUnread'] == 1


def unread(*mail_ids):
    mailboxes = {mail_id.split('|', 1)[0] for mail_id in mail_ids}
    ui_data.note_unread([{'id': mail_id, 'folder': 'inbox', 'read': False} for mail_id in mail_ids], mailboxes, mailboxes)


def test_disconnecting_iserv_takes_its_unread_mails_and_its_stand_with_it(client, monkeypatch):
    connect()
    unread('ben.k@iserv|1', 'ben.k@iserv|2', 'a@x.de|5')
    ui_data.mark_synced('iserv', 'plan', ui_data.iserv_key())
    assert page_data(client, '/hub')['mailUnread'] == 3
    fake = FakeIserv()
    fake.delete_credentials = lambda: ui_data._path('iserv').unlink()
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    assert client.post('/api/iserv/disconnect').get_json() == {'success': True}
    data = page_data(client, '/hub')
    assert data['mailUnread'] == 1 and data['status']['synced']['iserv'] is None
    assert ui_data.mail_unread_ids() == ['a@x.de|5']
    connect()
    data = page_data(client, '/hub')
    assert data['mailUnread'] == 1 and data['status']['synced']['iserv'] is None


def test_a_removed_mailbox_no_longer_counts_its_unread_mails(client, monkeypatch):
    from app import email_service, google_oauth
    unread('a@x.de|1', 'a@x.de|2', 'b@gmail.com|3', 'c@x.de|4')
    monkeypatch.setattr(google_oauth, 'get_google_accounts', lambda: [{'email': 'b@gmail.com'}])
    monkeypatch.setattr(google_oauth, 'remove_google_account', lambda email: email == 'b@gmail.com')
    monkeypatch.setattr(email_service, 'remove_email_account', lambda email: email == 'a@x.de')
    assert client.delete('/api/email/accounts/a@x.de').status_code == 200
    assert page_data(client, '/hub')['mailUnread'] == 2
    assert client.delete('/api/email/google/remove/b@gmail.com').get_json() == {'success': True}
    assert client.delete('/api/email/accounts/nobody@x.de').status_code == 404
    assert ui_data.mail_unread_ids() == ['c@x.de|4']


def test_another_iserv_account_starts_without_the_stand_and_the_mails_of_the_last_one(client, monkeypatch):
    connect()
    meta = DATA_DIR / 'vertretungsplan_cache' / 'cache_meta.json'
    meta.parent.mkdir(parents=True, exist_ok=True)
    encrypt_file({'version': 2, 'cached_at': '2026-11-06T07:36:12.123456', 'files': []}, meta)
    ui_data._cache.pop('plan_meta', None)
    unread('ben.k@iserv|1', 'a@x.de|5')
    fake = FakeIserv()

    def sign_in(username=None, password=None, iserv_url=None):
        connect(user=username, host=iserv_url)
        return {'success': True}

    fake.connect = sign_in
    monkeypatch.setattr(iserv_service, 'get_iserv_service', lambda: fake)
    try:
        assert client.post('/api/iserv/connect', json={'username': 'ben.k', 'password': 'neu', 'iserv_url': 'iserv.schule.de'}).status_code == 200
        data = page_data(client, '/hub')
        assert data['status']['synced']['iserv'] == '2026-11-06T07:36' and data['mailUnread'] == 2
        assert client.post('/api/iserv/connect', json={'username': 'mia.k', 'password': 'geheim', 'iserv_url': 'iserv.schule.de'}).status_code == 200
        data = page_data(client, '/hub')
        assert data['status']['synced']['iserv'] is None and data['mailUnread'] == 1
        assert ui_data.mail_unread_ids() == ['a@x.de|5']
        stamp = datetime.now().isoformat(timespec='minutes')
        encrypt_file({'version': 2, 'cached_at': f'{stamp}:30.5', 'files': []}, meta)
        ui_data._cache.pop('plan_meta', None)
        assert page_data(client, '/hub')['status']['synced']['iserv'] == stamp
    finally:
        meta.unlink()
        ui_data._cache.pop('plan_meta', None)


def test_the_counter_leaves_out_the_mails_of_an_iserv_account_that_is_not_signed_in(client):
    connect()
    unread('ben.k@iserv|1', 'a@x.de|5')
    assert page_data(client, '/hub')['mailUnread'] == 2
    connect(user='mia.k')
    assert page_data(client, '/hub')['mailUnread'] == 1
    connect()
    assert page_data(client, '/hub')['mailUnread'] == 2


def test_the_service_reads_the_exercise_list_and_tells_why_nothing_came(monkeypatch):
    class Response:
        def __init__(self, status, body, url='https://iserv.schule.de/iserv/exercise/api/exercises', kind='application/json'):
            self.status_code, self.body, self.url = status, body, url
            self.headers = {'Content-Type': kind}
            self.text = body if isinstance(body, str) else ''
            self.is_redirect = False

        def json(self):
            if isinstance(self.body, str):
                raise ValueError('no json')
            return self.body

    answers = []

    class Session:
        def request(self, method, url, **kwargs):
            assert url == 'https://iserv.schule.de/iserv/exercise/api/exercises'
            assert kwargs['headers']['Accept'] == 'application/json'
            return answers.pop(0)

    service = iserv_service.IServService.__new__(iserv_service.IServService)
    service.api = type('Api', (), {'_session': Session()})()
    service.connected = True
    service.iserv_url = 'iserv.schule.de'
    monkeypatch.setattr(service, 'connect', lambda *args, **kwargs: {'success': True})
    answers.append(Response(200, {'data': [
        {'id': 41, 'title': 'Analysis Blatt 3', 'course': {'name': 'Mathematik'}, 'teacher': {'name': 'Herr Krause'}, 'endDate': '2026-11-10T23:59:00+01:00', 'status': 'open'},
        {'id': 41, 'title': 'doppelt'},
        {'title': 'ohne Kennung'},
    ]}))
    result = service.get_homework()
    assert result['success'] is True
    assert result['exercises'] == [{'id': '41', 'title': 'doppelt', 'description': '', 'course': '', 'teacher': '', 'due': '', 'status': 'open'}]
    answers.append(Response(404, 'not found', kind='text/html'))
    assert service.get_homework() == {'success': False, 'cause': 'format'}
    answers.append(Response(200, '<html></html>', kind='text/html'))
    assert service.get_homework() == {'success': False, 'cause': 'format'}
    answers.extend([Response(200, '<input name="_password">', url='https://iserv.schule.de/iserv/auth/login', kind='text/html'), Response(200, {'data': []})])
    assert service.get_homework() == {'success': True, 'exercises': []}
