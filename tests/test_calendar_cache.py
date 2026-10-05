# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import json
import re
from datetime import date, datetime, timedelta

import pytest

from app import calendar_cache
from app import database as db
from app import google_oauth
from app import ui_data
from tests.google_fake import FakeGoogle, local_stamp

TODAY = date.today()
REAL_SERVICE = google_oauth.calendar_service


def day(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


@pytest.fixture
def google(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, '_path', lambda name: tmp_path / ui_data.FILES[name])
    ui_data._cache.clear()
    monkeypatch.setattr(calendar_cache, 'CACHE_FILE', tmp_path / 'google_calendar_cache.json')
    monkeypatch.setattr(calendar_cache, 'QUEUE_FILE', tmp_path / 'google_calendar_queue.json')
    calendar_cache._memory.update(signature=None, cache=None)
    calendar_cache._status.update(checked=None, problem=None)
    monkeypatch.setattr(calendar_cache, 'datetime', Clock)
    Clock.ahead = timedelta()
    fake = FakeGoogle()
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {fake.primary: {'token': 'x'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (fake, fake.primary))
    monkeypatch.setattr(calendar_cache, '_spawn', lambda run: run())
    yield fake
    ui_data._cache.clear()
    calendar_cache._memory.update(signature=None, cache=None)
    calendar_cache._status.update(checked=None, problem=None)


@pytest.fixture
def client(google):
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        yield client


class Clock(datetime):
    ahead = timedelta()

    @classmethod
    def now(cls, tz=None):
        return datetime.now(tz) + cls.ahead


def titles(start=-70, end=100):
    return [item['title'] for item in calendar_cache.events(day(start), day(end))]


def due_again():
    calendar_cache._status['checked'] = None


def local_events():
    return ui_data.load_list('calendar')


def own_event(client, **fields):
    body = {'title': 'Fahrstunde', 'date': day(2), 'start': '16:00', 'end': '17:30', **fields}
    ref = client.post('/api/ui/events', json={key: value for key, value in body.items() if value is not None}).get_json()['event']['id']
    return ref, local_events()[-1]['google_id']


def write_to_google(client, on):
    client.put('/api/ui/store/app-settings', json={'google': {'write': on}})


def test_first_sync_loads_the_window_and_later_reads_cost_nothing(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    google.put('primary', 'Zu alt', day(-200))
    google.put('primary', 'Zu weit', day(300))
    assert calendar_cache.sync() is None
    assert titles() == ['Gym']
    calls = len(google.calls)
    assert calendar_cache.refresh() is None
    assert titles() == ['Gym']
    assert len(google.calls) == calls


def test_a_check_asks_only_for_changes(google):
    kept = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    gone = google.put('primary', 'Zahnarzt', day(2), '15:00', '15:30')
    calendar_cache.sync()
    google.calls.clear()
    google.put('primary', 'Nachhilfe', day(3), '17:00', '18:00')
    google.store[google.primary][kept].update(summary='Gym Beine', updated=google._now())
    google.cancel('primary', gone)
    due_again()
    assert calendar_cache.refresh() is None
    assert titles() == ['Gym Beine', 'Nachhilfe']
    assert google.count('calendarList.list') == 0
    assert all('updatedMin' in details for name, details in google.calls if name == 'events.list')


def test_an_event_moved_out_of_the_window_leaves_the_copy(google):
    key = google.put('primary', 'Konzert', day(5), '20:00', '22:00')
    calendar_cache.sync()
    google.store[google.primary][key].update(start={'dateTime': local_stamp(day(300), '20:00')}, end={'dateTime': local_stamp(day(300), '22:00')}, updated=google._now())
    due_again()
    calendar_cache.refresh()
    assert titles(end=400) == []


def test_a_changed_series_reloads_that_calendar(google):
    calendar_cache.sync()
    google.put('primary', 'Training', day(2), '18:00', '19:00', key='series', recurrence=['RRULE:FREQ=WEEKLY;COUNT=2'])
    google.put('primary', 'Training', day(2), '18:00', '19:00', recurringEventId='series')
    google.put('primary', 'Training', day(9), '18:00', '19:00', recurringEventId='series')
    due_again()
    calendar_cache.refresh()
    assert [(event['title'], event['date']) for event in calendar_cache.events(day(-70), day(100))] == [('Training', day(2)), ('Training', day(9))]


def test_a_check_only_asks_for_what_changed_since_the_last_one(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    first = calendar_cache._load()['synced_at']
    Clock.ahead = timedelta(minutes=10)
    google.calls.clear()
    due_again()
    calendar_cache.refresh()
    asked = [details['updatedMin'] for name, details in google.calls if name == 'events.list']
    assert asked == [first]
    assert calendar_cache._load()['synced_at'] > first


def test_another_account_replaces_the_copy(google, monkeypatch):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    other = FakeGoogle('zweit@example.org')
    other.put('primary', 'Chor', day(2), '19:00', '20:30')
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    calendar_cache.sync()
    assert titles() == ['Chor'] and google.count('events.list') == 1


def test_a_whole_day_event_from_google_ends_on_its_last_day(google):
    google.put('primary', 'Klassenfahrt', day(5), end_day=day(8))
    calendar_cache.sync()
    assert [(event['date'], event['endDate']) for event in calendar_cache.events(day(-70), day(100))] == [(day(5), day(7))]


def test_the_whole_window_is_loaded_again_on_a_new_day(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.calls.clear()
    calendar_cache.sync(today=TODAY + timedelta(days=1))
    assert google.count('calendarList.list') == 1


def test_hidden_calendars_stay_out(google, client):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    assert titles() == ['Gym', 'Punktspiel']
    client.put('/api/ui/store/app-settings', json={'google': {'calendars': {'team@example.org': False}}})
    assert titles() == ['Gym']


def test_an_own_event_goes_to_google_and_is_shown_once(google, client):
    created = client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00', 'end': '17:30', 'place': 'Fahrschule'}).get_json()
    assert created['event']['pending'] is True
    sent = [details for name, details in google.calls if name == 'events.insert']
    assert len(sent) == 1
    assert sent[0]['body']['summary'] == 'Fahrstunde'
    assert sent[0]['body']['start']['dateTime'].startswith(f'{day(2)}T16:00:00') and len(sent[0]['body']['start']['dateTime']) == 25
    assert sent[0]['body']['end']['dateTime'].startswith(f'{day(2)}T17:30:00')
    item = local_events()[0]
    assert item['google_id'] and 'google_dirty' not in item
    calendar_cache.sync()
    assert titles() == []
    payload = client.get('/api/ui/events/synced').get_json()
    assert payload['events'] == []
    assert [event['title'] for event in payload['own']] == ['Fahrstunde']
    assert payload['own'][0]['google'] is True and 'pending' not in payload['own'][0]


def test_all_day_events_end_on_the_following_day_for_google(google, client):
    client.post('/api/ui/events', json={'title': 'Klassenfahrt', 'date': day(10), 'endDate': day(12)})
    client.post('/api/ui/events', json={'title': 'Anruf', 'date': day(3), 'start': '09:00'})
    bodies = {details['body']['summary']: details['body'] for name, details in google.calls if name == 'events.insert'}
    assert bodies['Klassenfahrt']['start']['date'] == day(10) and bodies['Klassenfahrt']['start']['dateTime'] is None
    assert bodies['Klassenfahrt']['end']['date'] == day(13)
    assert bodies['Anruf']['end']['dateTime'].startswith(f'{day(3)}T10:00:00') and bodies['Anruf']['endTimeUnspecified'] is True
    stored = {event['summary']: event for event in google.live()}
    assert stored['Klassenfahrt']['start'] == {'date': day(10)} and stored['Klassenfahrt']['end'] == {'date': day(13)}


def test_edits_and_deletes_of_an_own_event_follow_to_google(google, client):
    ref = client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00', 'end': '17:30'}).get_json()['event']['id']
    remote = local_events()[0]['google_id']
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Autobahn'
    assert google.count('events.insert') == 1
    client.delete(f'/api/ui/events/{ref}')
    assert google.store[google.primary][remote]['status'] == 'cancelled'
    assert local_events() == []


def test_changes_made_in_google_reach_the_own_event(google, client):
    client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00', 'end': '17:30'})
    calendar_cache.sync()
    remote = local_events()[0]['google_id']
    google.store[google.primary][remote].update(
        summary='Fahrstunde verlegt',
        start={'dateTime': local_stamp(day(3), '15:00')}, end={'dateTime': local_stamp(day(3), '16:30')}, updated=google._now(),
    )
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert (item['title'], item['date'], item['time'], item['end_time']) == ('Fahrstunde verlegt', day(3), '15:00', '16:30')
    assert google.count('events.patch') == 0
    google.cancel('primary', remote)
    due_again()
    calendar_cache.refresh()
    assert local_events() == []


def test_nothing_is_lost_while_google_is_unreachable(google, client):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.offline = True
    client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00'})
    assert local_events()[0].get('google_dirty') is True
    due_again()
    assert calendar_cache.refresh() == 'offline'
    assert titles() == ['Gym']
    google.offline = False
    due_again()
    assert calendar_cache.refresh() is None
    item = local_events()[0]
    assert item['google_id'] and 'google_dirty' not in item
    assert [event['summary'] for event in google.store[google.primary].values()] == ['Gym', 'Fahrstunde']


def test_a_delete_waits_until_google_is_back(google, client):
    ref = client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00'}).get_json()['event']['id']
    remote = local_events()[0]['google_id']
    calendar_cache.sync()
    google.offline = True
    client.delete(f'/api/ui/events/{ref}')
    assert google.store[google.primary][remote]['status'] == 'confirmed'
    google.offline = False
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['status'] == 'cancelled'
    assert not calendar_cache.QUEUE_FILE.exists()


def test_writing_to_google_can_be_switched_off(google, client):
    client.put('/api/ui/store/app-settings', json={'google': {'write': False}})
    created = client.post('/api/ui/events', json={'title': 'Privat', 'date': day(2), 'start': '16:00'}).get_json()
    assert 'pending' not in created['event']
    calendar_cache.sync()
    assert google.count('events.insert') == 0


def test_events_made_before_the_update_are_not_sent(google, client):
    ui_data.modify_list('calendar', lambda items: items.append({'id': 'alt', 'title': 'Alter Termin', 'date': day(1), 'time': '10:00'}))
    calendar_cache.sync()
    assert google.count('events.insert') == 0


def test_pages_show_the_copy_without_asking_google(google, client):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    client.post('/api/ui/events', json={'title': 'Lerngruppe', 'date': day(1), 'start': '14:00'})
    calendar_cache.sync()
    google.calls.clear()
    html = client.get('/hub').get_data(as_text=True)
    data = json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))
    assert [(event['title'], event['synced']) for event in data['events']] == [('Lerngruppe', False), ('Gym', True)]
    assert google.calls == []


def test_the_endpoint_serves_the_copy_and_checks_when_due(google, client):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    first = client.get('/api/ui/events/synced?frisch=1').get_json()
    assert [event['title'] for event in first['events']] == ['Gym']
    assert first['source'] == 'google' and first['problem'] is None and first['stand']
    google.calls.clear()
    again = client.get('/api/ui/events/synced?frisch=1').get_json()
    assert [event['title'] for event in again['events']] == ['Gym']
    assert google.calls == []
    client.get('/api/ui/events/synced?frisch=alles')
    assert google.count('calendarList.list') == 1


def test_an_expired_login_is_reported(google, client, monkeypatch):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    tokens = {google.primary: {'token': 'x'}}
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: dict(tokens))

    def expired(account_email=None):
        tokens.clear()
        return None, google.primary

    monkeypatch.setattr(google_oauth, 'calendar_service', expired)
    due_again()
    assert calendar_cache.refresh() == 'login'


def test_removing_the_account_forgets_the_copy(google, monkeypatch):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda tokens: True)
    assert google_oauth.remove_google_account(google.primary)
    assert not calendar_cache.CACHE_FILE.exists()


def test_times_from_google_are_shown_in_local_time(google):
    key = google.put('primary', 'Anruf', day(1), '10:00', '11:00')
    google.store[google.primary][key].update(start={'dateTime': f'{day(1)}T08:00:00Z'}, end={'dateTime': f'{day(1)}T09:00:00Z'})
    calendar_cache.sync()
    local = datetime.fromisoformat(f'{day(1)}T08:00:00+00:00').astimezone()
    assert [(event['date'], event['start']) for event in calendar_cache.events(day(-70), day(100))] == [(local.strftime('%Y-%m-%d'), local.strftime('%H:%M'))]


def test_an_event_deleted_in_google_goes_even_when_the_whole_window_is_loaded_again(google, client):
    own_event(client)
    _, second = own_event(client, title='Nachhilfe', date=day(3))
    first = local_events()[0]['google_id']
    calendar_cache.sync()
    google.cancel('primary', first)
    calendar_cache.sync(today=TODAY + timedelta(days=1))
    assert [item['title'] for item in local_events()] == ['Nachhilfe']
    google.cancel('primary', second)
    calendar_cache.sync(full=True, today=TODAY + timedelta(days=1))
    assert local_events() == []


def test_an_event_deleted_long_ago_is_confirmed_before_it_goes(google, client):
    _, remote = own_event(client)
    _, kept = own_event(client, title='Nachhilfe', date=day(3))
    calendar_cache.sync()
    google.cancel('primary', remote, age=3600)
    google.change('primary', kept, age=3600, start={'dateTime': local_stamp(day(300), '16:00')}, end={'dateTime': local_stamp(day(300), '17:00')})
    google.calls.clear()
    calendar_cache.sync(full=True)
    assert sorted(details['event'] for name, details in google.calls if name == 'events.get') == sorted([remote, kept])
    assert [(item['title'], item['date']) for item in local_events()] == [('Nachhilfe', day(300))]


def test_a_calendar_that_cannot_be_read_never_counts_as_deleted(google, client):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    own_event(client)
    calendar_cache.sync()
    google.broken[google.primary] = None
    google.broken['team@example.org'] = 500
    assert calendar_cache.sync(full=True) == 'offline'
    assert [item['title'] for item in local_events()] == ['Fahrstunde']
    assert titles() == ['Punktspiel']
    assert google.count('events.get') == 0
    google.broken.clear()
    google.calls.clear()
    due_again()
    assert calendar_cache.refresh() is None
    assert google.count('calendarList.list') == 1 and titles() == ['Punktspiel']


def test_a_calendar_that_disappeared_is_dropped_without_an_error(google):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.remove_calendar('team@example.org')
    due_again()
    assert calendar_cache.refresh() is None
    assert titles() == ['Gym']


def test_a_lost_answer_does_not_make_a_second_event(google, client):
    google.lost_answers.add('events.insert')
    own_event(client)
    assert local_events()[0].get('google_dirty') is True
    due_again()
    assert calendar_cache.refresh() is None
    item = local_events()[0]
    assert 'google_dirty' not in item and 'google_new' not in item
    assert [event['id'] for event in google.live()] == [item['google_id']]
    assert google.count('events.insert') == 2


def test_an_event_removed_while_it_was_on_its_way_is_deleted_in_google(google, client):
    google.hooks['events.insert'] = lambda details: ui_data.modify_list('calendar', lambda items: items.clear())
    client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00'})
    del google.hooks['events.insert']
    assert local_events() == [] and len(google.live()) == 1
    due_again()
    calendar_cache.refresh()
    assert google.live() == [] and not calendar_cache.QUEUE_FILE.exists()


def test_an_edit_made_while_the_event_is_sent_goes_out_with_the_next_check(google, client):
    ref, remote = own_event(client)

    def edit_meanwhile(details):
        del google.hooks['events.patch']
        ui_data.modify_list('calendar', lambda items: items[0].update(title='Fahrstunde Autobahn', updated_at='later'))

    google.hooks['events.patch'] = edit_meanwhile
    client.patch(f'/api/ui/events/{ref}', json={'place': 'Fahrschule'})
    assert local_events()[0].get('google_dirty') is True
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Autobahn' and 'google_dirty' not in local_events()[0]


def test_with_writing_switched_off_a_linked_event_is_neither_sent_nor_undone(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn', 'date': day(4)})
    due_again()
    calendar_cache.refresh()
    assert (local_events()[0]['title'], local_events()[0]['date']) == ('Fahrstunde Autobahn', day(4))
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde'
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Autobahn'
    assert 'google_dirty' not in local_events()[0]


def test_with_writing_switched_off_a_delete_stays_here(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.delete(f'/api/ui/events/{ref}')
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['status'] == 'confirmed' and not calendar_cache.QUEUE_FILE.exists()
    assert local_events() == [] and titles() == ['Fahrstunde']


def test_switching_between_a_whole_day_and_a_time_reaches_google(google, client):
    ref, remote = own_event(client, start=None, end=None)
    assert google.store[google.primary][remote]['start'] == {'date': day(2)}
    client.patch(f'/api/ui/events/{ref}', json={'start': '16:00', 'end': '17:00'})
    stored = google.store[google.primary][remote]
    assert stored['start']['dateTime'].startswith(f'{day(2)}T16:00') and 'date' not in stored['start'] and 'date' not in stored['end']
    client.patch(f'/api/ui/events/{ref}', json={'start': None, 'end': None})
    stored = google.store[google.primary][remote]
    assert stored['start'] == {'date': day(2)} and stored['end'] == {'date': day(3)}
    assert 'google_dirty' not in local_events()[0]


def test_a_cancellation_in_another_calendar_leaves_the_own_event(google, client):
    _, remote = own_event(client)
    google.add_calendar('gast@example.org', 'Gast')
    calendar_cache.sync(full=True)
    google.put('gast@example.org', 'Fahrstunde', day(2), '16:00', '17:30', key=remote, status='cancelled')
    due_again()
    calendar_cache.refresh()
    assert [item['title'] for item in local_events()] == ['Fahrstunde']


def test_the_delete_queue_is_free_while_google_is_asked(google, client):
    ref, remote = own_event(client)
    google.hooks['events.delete'] = lambda details: calendar_cache.drop({'google_id': 'spaeter', 'google_calendar': google.primary})
    client.delete(f'/api/ui/events/{ref}')
    assert google.store[google.primary][remote]['status'] == 'cancelled'
    assert [entry['id'] for entry in calendar_cache._queue()] == ['spaeter']


def test_an_open_end_stays_open(google, client):
    ref, remote = own_event(client, date=day(2), start='23:30', end=None)
    calendar_cache.sync()
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert (item['time'], item.get('end_time') or '', item.get('end_date') or '') == ('23:30', '', '')
    google.change('primary', remote, summary='Fahrstunde Nacht')
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert (item['title'], item['time'], item.get('end_time') or '', item.get('end_date') or '') == ('Fahrstunde Nacht', '23:30', '', '')


def test_a_change_in_google_reaches_an_own_whole_day_event_with_its_last_day(google, client):
    ref, remote = own_event(client, start=None, end=None)
    calendar_cache.sync()
    google.change('primary', remote, start={'date': day(5)}, end={'date': day(8)})
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert (item['date'], item['end_date'], item['time']) == (day(5), day(7), '')


@pytest.mark.parametrize('quiet', [False, True])
def test_an_edit_of_an_event_deleted_in_google_makes_a_new_one(google, client, quiet):
    google.quiet_patch = quiet
    ref, remote = own_event(client)
    calendar_cache.sync()
    google.cancel('primary', remote)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    item = local_events()[0]
    assert item['google_id'] != remote and 'google_dirty' not in item
    assert [(event['id'], event['summary']) for event in google.live()] == [(item['google_id'], 'Fahrstunde Autobahn')]
    due_again()
    calendar_cache.refresh()
    assert [entry['title'] for entry in local_events()] == ['Fahrstunde Autobahn']


def _real_login(monkeypatch, google, tokens):
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {key: dict(value) for key, value in tokens.items()})
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda fresh: tokens.clear() or tokens.update(fresh) or True)
    monkeypatch.setattr(google_oauth, 'calendar_service', REAL_SERVICE)
    monkeypatch.setattr(google_oauth, 'build', lambda *args, **kwargs: google)


def test_a_revoked_login_is_remembered_and_reported(google, monkeypatch):
    tokens = {google.primary: {'token': 'x', 'refresh_token': 'r', 'client_id': 'c', 'client_secret': 's'}}
    _real_login(monkeypatch, google, tokens)
    tries = []

    def refuse(self, request):
        tries.append(1)
        raise RuntimeError("('invalid_grant: Token has been expired or revoked.', {'error': 'invalid_grant'})")

    monkeypatch.setattr(google_oauth.Credentials, 'refresh', refuse)
    assert calendar_cache.sync() == 'login'
    assert tokens[google.primary]['expired'] is True and google_oauth.login_expired()
    due_again()
    assert calendar_cache.refresh() == 'login'
    assert len(tries) == 1 and google.calls == []


def test_a_login_that_cannot_be_renewed_right_now_counts_as_offline(google, monkeypatch):
    tokens = {google.primary: {'token': 'x', 'refresh_token': 'r', 'client_id': 'c', 'client_secret': 's'}}
    _real_login(monkeypatch, google, tokens)

    def unreachable(self, request):
        raise OSError('no route to host')

    monkeypatch.setattr(google_oauth.Credentials, 'refresh', unreachable)
    assert calendar_cache.sync() == 'offline'
    assert 'expired' not in tokens[google.primary]


def test_a_renewed_login_is_stored_and_used_until_it_runs_out(google, monkeypatch):
    tokens = {google.primary: {'token': 'x', 'refresh_token': 'r', 'client_id': 'c', 'client_secret': 's'}}
    _real_login(monkeypatch, google, tokens)
    renewed = []

    def renew(self, request):
        renewed.append(1)
        self.token = f'neu-{len(renewed)}'
        self.expiry = datetime.utcnow() + timedelta(hours=1)

    monkeypatch.setattr(google_oauth.Credentials, 'refresh', renew)
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    assert calendar_cache.sync() is None and titles() == ['Gym']
    assert tokens[google.primary]['token'] == 'neu-1' and tokens[google.primary]['expiry']
    due_again()
    calendar_cache.refresh()
    assert len(renewed) == 1
    tokens[google.primary]['expiry'] = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    due_again()
    calendar_cache.refresh()
    assert len(renewed) == 2 and tokens[google.primary]['token'] == 'neu-2'

