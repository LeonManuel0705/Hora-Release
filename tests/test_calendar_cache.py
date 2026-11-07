# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from datetime import date, datetime, timedelta

import pytest

from app import calendar_cache
from app import database as db
from app import google_oauth
from app import ui_data
from tests.google_fake import FakeGoogle, FakeHttpError, local_stamp

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
    calendar_cache._status.update(checked=None, checked_at=None, problem=None, misses=0)
    monkeypatch.setattr(calendar_cache, 'datetime', Clock)
    Clock.ahead = timedelta()
    fake = FakeGoogle()
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {fake.primary: {'token': 'x'}})
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda tokens: True)
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (fake, fake.primary))
    monkeypatch.setattr(calendar_cache, '_spawn', lambda run: run())
    yield fake
    ui_data._cache.clear()
    calendar_cache._memory.update(signature=None, cache=None)
    calendar_cache._status.update(checked=None, checked_at=None, problem=None, misses=0)
    calendar_cache._worker.update(nudged=False)


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
    assert bodies['Klassenfahrt']['start'] == {'date': day(10)} and bodies['Klassenfahrt']['end'] == {'date': day(13)}
    assert bodies['Anruf']['end']['dateTime'].startswith(f'{day(3)}T10:00:00')
    assert bodies['Anruf']['extendedProperties'] == {'private': {'horaOpenEnd': '1'}}
    assert re.fullmatch(r'[a-v0-9]{32}', bodies['Anruf']['id'])
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
    Clock.ahead = timedelta(minutes=30)
    calendar_cache.sync()
    google.cancel('primary', remote)
    google.change('primary', kept, start={'dateTime': local_stamp(day(300), '16:00')}, end={'dateTime': local_stamp(day(300), '17:00')})
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
    sent = [details['body'] for name, details in google.calls if name == 'events.patch'][-1]
    assert sent['start'] == {'date': day(2), 'dateTime': None, 'timeZone': None}
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


def test_renewing_one_login_leaves_the_other_accounts_as_they_are(google, monkeypatch):
    tokens = {google.primary: {'token': 'x', 'refresh_token': 'r', 'client_id': 'c', 'client_secret': 's'}}
    _real_login(monkeypatch, google, tokens)

    def renew(self, request):
        tokens['zweit@example.org'] = {'token': 'z'}
        self.token = 'neu'
        self.expiry = datetime.utcnow() + timedelta(hours=1)

    monkeypatch.setattr(google_oauth.Credentials, 'refresh', renew)
    assert google_oauth.get_credentials(google.primary).token == 'neu'
    assert tokens['zweit@example.org'] == {'token': 'z'} and tokens[google.primary]['token'] == 'neu'

    def renew_while_removed(self, request):
        tokens.pop(google.primary)
        self.token = 'spaet'
        self.expiry = datetime.utcnow() + timedelta(hours=1)

    tokens[google.primary]['expiry'] = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    monkeypatch.setattr(google_oauth.Credentials, 'refresh', renew_while_removed)
    google_oauth.get_credentials(google.primary)
    assert list(tokens) == ['zweit@example.org']


def linked(count, account, calendar=None):
    items = [
        {'id': f'alt-{index}', 'title': f'Alt {index}', 'date': day(5), 'time': '10:00', 'google_id': f'{index:032x}', 'google_calendar': calendar or account, 'google_account': account}
        for index in range(count)
    ]
    ui_data.modify_list('calendar', lambda stored: stored.extend(items))


def test_events_linked_with_another_account_are_left_alone(google, client, monkeypatch):
    own_event(client)
    ui_data.modify_list('calendar', lambda items: items.append({'id': 'alias', 'title': 'Vor dem Wechsel', 'date': day(4), 'time': '09:00', 'google_id': 'b' * 32, 'google_calendar': 'primary'}))
    calendar_cache.sync()
    other = FakeGoogle('zweit@example.org')
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    calendar_cache.sync()
    calendar_cache.sync(full=True)
    assert sorted(item['title'] for item in local_events()) == ['Fahrstunde', 'Vor dem Wechsel']
    assert [details['event'] for name, details in other.calls if name == 'events.get'] == ['b' * 32, 'b' * 32]
    assert other.count('events.patch') == 0 and other.count('events.insert') == 0


def test_a_missing_event_goes_only_when_google_says_so_for_this_account(google, client):
    linked(2, google.primary)
    ui_data.modify_list('calendar', lambda items: items[1].pop('google_account'))
    calendar_cache.sync()
    assert [item['id'] for item in local_events()] == ['alt-1']


def test_an_error_while_asking_about_a_missing_event_keeps_it(google, client):
    linked(1, google.primary)
    google.hooks['events.get'] = lambda details: (_ for _ in ()).throw(OSError('reset'))
    calendar_cache.sync()
    assert [item['id'] for item in local_events()] == ['alt-0']


def test_missing_events_outside_the_window_are_not_asked_about(google, client):
    linked(1, google.primary)
    ui_data.modify_list('calendar', lambda items: items[0].update(date=day(calendar_cache.AHEAD_DAYS)))
    calendar_cache.sync()
    assert google.count('events.get') == 0 and len(local_events()) == 1


def test_only_so_many_missing_events_are_asked_about_per_reload(google, client):
    linked(calendar_cache.CONFIRM_LIMIT + 2, google.primary)
    calendar_cache.sync()
    assert google.count('events.get') == calendar_cache.CONFIRM_LIMIT and len(local_events()) == 2
    calendar_cache.sync(full=True)
    assert local_events() == []


def test_an_event_google_still_has_is_asked_about_once_a_day(google, client):
    _, remote = own_event(client)
    Clock.ahead = timedelta(minutes=30)
    calendar_cache.sync()
    google.change('primary', remote, start={'dateTime': local_stamp(day(300), '16:00')}, end={'dateTime': local_stamp(day(300), '17:00')})
    ui_data.modify_list('calendar', lambda items: items[0].update(google_seen='9'))
    calendar_cache.sync(full=True)
    calendar_cache.sync(full=True)
    assert google.count('events.get') == 1 and local_events()[0]['date'] == day(2)


def test_a_change_made_in_google_after_the_waiting_edit_wins(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, location='Hauptbahnhof', start={'dateTime': local_stamp(day(5), '08:00')}, end={'dateTime': local_stamp(day(5), '09:30')})
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert (item['title'], item['date'], item['time'], item['location']) == ('Fahrstunde', day(5), '08:00', 'Hauptbahnhof')
    assert 'google_dirty' not in item and google.store[google.primary][remote]['summary'] == 'Fahrstunde'


def test_a_waiting_edit_that_is_newer_than_the_change_in_google_wins(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    google.change('primary', remote, age=120, location='Hauptbahnhof')
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Autobahn'
    assert local_events()[0]['title'] == 'Fahrstunde Autobahn' and 'google_dirty' not in local_events()[0]


@pytest.mark.parametrize('deleted_first', [True, False])
def test_a_waiting_edit_meets_a_deletion_in_google(google, client, deleted_first):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    if deleted_first:
        google.cancel('primary', remote, age=120)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    if not deleted_first:
        google.cancel('primary', remote)
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    if deleted_first:
        assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn'] and local_events()[0]['google_id'] != remote
    else:
        assert google.live() == [] and local_events() == []


def test_an_older_copy_never_replaces_what_was_sent(google, client):
    ref, remote = own_event(client)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, age=3600, summary='Fahrstunde')
    calendar_cache.sync(full=True)
    assert local_events()[0]['title'] == 'Fahrstunde Autobahn'
    assert local_events()[0]['google_seen'] > google.store[google.primary][remote]['updated']


def test_a_new_event_for_a_deleted_one_is_not_made_twice(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    google.cancel('primary', remote)
    google.lost_answers.add('events.insert')
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    assert local_events()[0].get('google_dirty') is True and local_events()[0]['google_id'] != remote
    due_again()
    calendar_cache.refresh()
    assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn']
    assert 'google_dirty' not in local_events()[0] and 'google_new' not in local_events()[0]


@pytest.mark.parametrize('reason, kept', [
    ('rateLimitExceeded', True), ('accessNotConfigured', True), (None, True), (('forbidden', 'rateLimitExceeded'), True), ('forbidden', False),
])
def test_a_limit_that_passes_is_not_a_calendar_that_went_away(google, reason, kept):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    calendar_cache.sync()
    before = calendar_cache._load()['synced_at']
    Clock.ahead = timedelta(minutes=10)
    google.broken['team@example.org'] = (403, reason)
    assert calendar_cache.sync(full=True) == ('offline' if kept else None)
    assert titles() == (['Punktspiel'] if kept else [])
    assert (calendar_cache._load()['synced_at'] == before) is kept
    due_again()
    assert calendar_cache.refresh() == ('offline' if kept else None)


def test_a_copy_forgotten_while_it_was_loaded_does_not_come_back(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    google.hooks['events.list'] = lambda details: calendar_cache.forget()
    assert calendar_cache.sync() is None
    assert not calendar_cache.CACHE_FILE.exists() and titles() == []


def test_a_login_that_fails_during_a_request_is_reported(google):
    class RefreshError(Exception):
        pass

    google.hooks['calendarList.list'] = lambda details: (_ for _ in ()).throw(RefreshError('invalid_grant'))
    assert calendar_cache.sync() == 'login'


def test_a_queued_delete_waits_while_writing_is_off(google, client):
    ref, remote = own_event(client)
    google.offline = True
    client.delete(f'/api/ui/events/{ref}')
    google.offline = False
    write_to_google(client, False)
    calendar_cache.sync()
    assert google.store[google.primary][remote]['status'] == 'confirmed' and calendar_cache.QUEUE_FILE.exists()
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['status'] == 'cancelled'


def test_an_event_that_has_not_arrived_is_not_called_linked(google, client):
    google.offline = True
    created = client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00'}).get_json()['event']
    assert created['pending'] is True and 'google' not in created
    assert local_events()[0]['google_new'] is True


def test_a_new_event_goes_to_the_account_that_is_connected_now(google, client, monkeypatch):
    calendar_cache.sync()
    other = FakeGoogle('zweit@example.org')
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    own_event(client)
    item = local_events()[0]
    assert (item['google_calendar'], item['google_account']) == (other.primary, other.primary)
    assert len(other.live()) == 1 and google.live() == []


def test_what_was_sent_is_remembered_so_the_echo_is_not_taken_over(google, client):
    _, remote = own_event(client)
    item = local_events()[0]
    assert item['google_seen'] == google.store[google.primary][remote]['updated'] and item['google_etag'] == google.store[google.primary][remote]['etag']
    ui_data.modify_list('calendar', lambda items: items[0].update(title='Nur hier geändert'))
    calendar_cache.sync()
    due_again()
    calendar_cache.refresh()
    assert local_events()[0]['title'] == 'Nur hier geändert'


def test_an_alias_link_of_another_account_is_neither_asked_about_nor_matched(google, client, monkeypatch):
    stranger = 'c' * 32
    ui_data.modify_list('calendar', lambda items: items.append({
        'id': 'alias', 'title': 'Vom ersten Konto', 'date': day(4), 'time': '09:00',
        'google_id': stranger, 'google_calendar': 'primary', 'google_account': google.primary, 'google_seen': '1',
    }))
    ui_data.modify_list('calendar', lambda items: items.append({
        'id': 'alias-2', 'title': 'Auch vom ersten Konto', 'date': day(5), 'time': '09:00',
        'google_id': 'd' * 32, 'google_calendar': 'primary', 'google_account': google.primary, 'google_seen': '1',
    }))
    other = FakeGoogle('zweit@example.org')
    other.put('primary', 'Zufall', day(4), '09:00', '10:00', key=stranger)
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    calendar_cache.sync()
    assert local_events()[0]['title'] == 'Vom ersten Konto'
    other.cancel('primary', stranger)
    due_again()
    calendar_cache.refresh()
    calendar_cache.sync(full=True)
    assert [item['title'] for item in local_events()] == ['Vom ersten Konto', 'Auch vom ersten Konto'] and other.count('events.get') == 0


def test_an_edit_waits_for_its_own_account(google, client, monkeypatch):
    ref, remote = own_event(client)
    other = FakeGoogle('zweit@example.org')
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    calendar_cache.sync()
    assert other.live() == [] and other.count('events.patch') == 0
    assert local_events()[0].get('google_dirty') is True and local_events()[0]['google_id'] == remote


def test_a_calendar_that_failed_is_not_asked_about_single_events(google, client):
    calendar_cache.sync()
    linked(1, google.primary)
    google.broken[google.primary] = None
    assert calendar_cache.sync(full=True) == 'offline'
    assert google.count('events.get') == 0 and len(local_events()) == 1


def test_a_refusal_of_the_whole_account_drops_nothing(google):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    for name in (google.primary, 'team@example.org'):
        google.broken[name] = (403, 'forbidden')
    due_again()
    assert calendar_cache.refresh() == 'offline' and titles() == ['Gym', 'Punktspiel']
    assert calendar_cache.sync(full=True) == 'offline' and titles() == ['Gym', 'Punktspiel']


def test_a_quick_check_that_reaches_too_far_back_loads_everything_again(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()

    def too_old(details):
        if 'updatedMin' in details:
            raise FakeHttpError(410)

    google.hooks['events.list'] = too_old
    google.calls.clear()
    due_again()
    assert calendar_cache.refresh() is None
    assert titles() == ['Gym'] and google.count('calendarList.list') == 1


def test_a_quick_check_that_reaches_too_far_back_for_one_calendar_keeps_that_calendar(google):
    google.add_calendar('team@example.org', 'Verein')
    google.put('team@example.org', 'Punktspiel', day(4), '10:00', '12:00')
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()

    def too_old(details):
        if 'updatedMin' in details and details['calendar'] == 'team@example.org':
            raise FakeHttpError(410)

    google.hooks['events.list'] = too_old
    google.calls.clear()
    due_again()
    assert calendar_cache.refresh() is None
    assert titles() == ['Gym', 'Punktspiel'] and google.count('calendarList.list') == 1


def test_a_link_from_before_gets_what_it_takes_to_notice_a_conflict(google, client):
    ref, remote = own_event(client)
    ui_data.modify_list('calendar', lambda items: [items[0].pop(key) for key in ('google_etag', 'google_account')])
    calendar_cache.sync()
    item = local_events()[0]
    assert item['google_etag'] == google.store[google.primary][remote]['etag'] and item['google_account'] == google.primary
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    assert local_events()[0]['title'] == 'Fahrstunde verlegt' and google.store[google.primary][remote]['summary'] == 'Fahrstunde verlegt'


def test_a_waiting_edit_is_never_replaced_while_it_waits(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    due_again()
    calendar_cache.refresh()
    calendar_cache.sync(full=True)
    assert local_events()[0]['title'] == 'Fahrstunde Autobahn' and local_events()[0].get('google_dirty') is True


def test_a_deletion_that_google_reports_as_gone_is_weighed_like_any_other(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.cancel('primary', remote)
    write_to_google(client, True)

    def gone(details):
        del google.hooks['events.patch']
        raise FakeHttpError(410)

    google.hooks['events.patch'] = gone
    due_again()
    calendar_cache.refresh()
    assert local_events() == [] and google.live() == [] and google.count('events.insert') == 1


def test_an_edit_made_while_a_conflict_is_weighed_is_kept(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    write_to_google(client, True)

    def edit_again(details):
        del google.hooks['events.get']
        ui_data.modify_list('calendar', lambda items: items[0].update(title='Fahrstunde Nacht', updated_at='spaeter'))

    google.hooks['events.get'] = edit_again
    due_again()
    calendar_cache.refresh()
    assert local_events()[0]['title'] == 'Fahrstunde Nacht'


def test_after_giving_way_the_next_edit_goes_through_at_once(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    asked = google.count('events.get')
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Nacht'})
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Nacht' and google.count('events.get') == asked
    assert 'google_dirty' not in local_events()[0]


def test_an_end_that_is_set_later_clears_the_open_end(google, client):
    ref, remote = own_event(client, end=None)
    assert google.store[google.primary][remote]['extendedProperties']['private']['horaOpenEnd'] == '1'
    client.patch(f'/api/ui/events/{ref}', json={'end': '18:00'})
    assert google.store[google.primary][remote]['extendedProperties']['private'].get('horaOpenEnd') is None
    calendar_cache.sync(full=True)
    assert calendar_cache._load()['events'][google.primary][remote]['open_end'] is False


def test_forgetting_waits_for_a_copy_that_is_just_being_written(google, monkeypatch):
    import threading

    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    adopt = calendar_cache._adopt
    waiting = []

    def slow_adopt(cache, cancelled, seen):
        thread = threading.Thread(target=calendar_cache.forget)
        thread.start()
        waiting.append(thread)
        thread.join(0.3)
        return adopt(cache, cancelled, seen)

    monkeypatch.setattr(calendar_cache, '_adopt', slow_adopt)
    calendar_cache.sync()
    waiting[0].join(5)
    assert not calendar_cache.CACHE_FILE.exists() and titles() == []


def test_an_event_that_waited_through_an_account_change_goes_to_the_new_account(google, client, monkeypatch):
    calendar_cache.sync()
    google.offline = True
    client.post('/api/ui/events', json={'title': 'Fahrstunde', 'date': day(2), 'start': '16:00'})
    other = FakeGoogle('zweit@example.org')
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    calendar_cache.sync()
    item = local_events()[0]
    assert (item['google_calendar'], item['google_account']) == (other.primary, other.primary) and len(other.live()) == 1


def test_events_google_still_has_are_asked_about_again_the_next_day(google, client):
    _, remote = own_event(client)
    Clock.ahead = timedelta(minutes=30)
    calendar_cache.sync()
    google.change('primary', remote, start={'dateTime': local_stamp(day(300), '16:00')}, end={'dateTime': local_stamp(day(300), '17:00')})
    ui_data.modify_list('calendar', lambda items: items[0].update(google_seen='9'))
    calendar_cache.sync(full=True)
    calendar_cache.sync(today=TODAY + timedelta(days=1))
    assert google.count('events.get') == 2


def test_an_edit_whose_twin_lies_in_another_account_says_so(google, client, monkeypatch):
    ref, _ = own_event(client)
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {'zweit@example.org': {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (FakeGoogle('zweit@example.org'), 'zweit@example.org'))
    changed = client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'}).get_json()['event']
    assert changed.get('elsewhere') is True and 'pending' not in changed


def test_a_waiting_edit_lies_elsewhere_only_when_the_calendar_uses_another_account(google, client, monkeypatch):
    ref, _ = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    changed = client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'}).get_json()['event']
    assert changed.get('pending') is True and 'elsewhere' not in changed
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {'zweit@example.org': {'token': 'y'}, google.primary: {'token': 'x'}})
    view = ui_data.event_view(local_events()[0])
    assert view.get('elsewhere') is True and 'pending' not in view


def test_a_twin_google_no_longer_knows_at_all_is_made_anew(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    del google.store[google.primary][remote]
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn']
    assert item['google_id'] != remote and 'google_dirty' not in item and google.count('events.insert') == 2


def test_a_gone_that_google_takes_back_makes_no_second_event(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    write_to_google(client, True)

    def gone_once(details):
        del google.hooks['events.patch']
        raise FakeHttpError(410)

    google.hooks['events.patch'] = gone_once
    due_again()
    calendar_cache.refresh()
    assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn']
    assert local_events()[0]['google_id'] == remote and google.count('events.insert') == 1


def test_a_link_from_before_is_compared_first_even_when_its_twin_lies_outside_the_copy(google, client):
    ref, remote = own_event(client, date=day(200))
    calendar_cache.sync()
    ui_data.modify_list('calendar', lambda items: [items[0].pop(key) for key in ('google_etag', 'google_account')])
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    write_to_google(client, True)
    due_again()
    calendar_cache.refresh()
    assert local_events()[0]['title'] == 'Fahrstunde verlegt' and google.store[google.primary][remote]['summary'] == 'Fahrstunde verlegt'


def test_an_edit_after_a_deletion_in_google_makes_the_event_anew_also_for_a_link_from_before(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    ui_data.modify_list('calendar', lambda items: [items[0].pop('google_etag')])
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.quiet_patch = True
    google.cancel('primary', remote, age=120)
    write_to_google(client, True)
    google.calls.clear()
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert item['title'] == 'Fahrstunde Autobahn' and item['google_id'] != remote and 'google_dirty' not in item
    assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn']
    assert (google.count('events.patch'), google.count('events.insert')) == (0, 1)


def test_a_change_in_google_between_asking_and_writing_is_not_overwritten(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    ui_data.modify_list('calendar', lambda items: [items[0].pop('google_etag')])
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    write_to_google(client, True)

    def changed_meanwhile(details):
        del google.hooks['events.patch']
        google.change('primary', remote, summary='Fahrstunde verlegt')

    google.hooks['events.patch'] = changed_meanwhile
    due_again()
    calendar_cache.refresh()
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde verlegt'
    assert local_events()[0]['title'] == 'Fahrstunde Autobahn' and local_events()[0].get('google_dirty') is True
    due_again()
    calendar_cache.refresh()
    assert local_events()[0]['title'] == 'Fahrstunde verlegt' and 'google_dirty' not in local_events()[0]


def test_a_link_from_before_is_not_pinned_to_an_account_that_only_sees_its_calendar(google, client, monkeypatch):
    _, remote = own_event(client)
    calendar_cache.sync()
    ui_data.modify_list('calendar', lambda items: [items[0].pop('google_account')])
    other = FakeGoogle('zweit@example.org')
    other.add_calendar(google.primary, 'Geteilt')
    other.store[google.primary][remote] = dict(google.store[google.primary][remote])
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    calendar_cache.sync(full=True)
    assert 'google_account' not in local_events()[0] and local_events()[0]['google_id'] == remote


def test_giving_way_keeps_what_it_takes_to_notice_the_next_conflict(google, client):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    google.change('primary', remote, summary='Fahrstunde verlegt')
    write_to_google(client, True)
    google.calls.clear()
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert item['title'] == 'Fahrstunde verlegt' and item['google_etag'] == google.store[google.primary][remote]['etag']
    assert google.count('events.list') == 1


@pytest.mark.parametrize('failure', [500, 503, None])
@pytest.mark.parametrize('from_before', [True, False])
def test_a_question_google_does_not_answer_leaves_the_edit_waiting(google, client, failure, from_before):
    ref, remote = own_event(client)
    calendar_cache.sync()
    write_to_google(client, False)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    if from_before:
        ui_data.modify_list('calendar', lambda items: [items[0].pop('google_etag')])
    else:
        google.change('primary', remote, age=30, description='Treffpunkt Bahnhof')
    write_to_google(client, True)

    def unanswered(details):
        raise FakeHttpError(failure) if failure else OSError('timed out')

    google.hooks['events.get'] = unanswered
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert item['google_id'] == remote and item.get('google_dirty') is True
    assert [event['summary'] for event in google.live()] == ['Fahrstunde'] and google.count('events.insert') == 1
    del google.hooks['events.get']
    due_again()
    calendar_cache.refresh()
    assert [event['summary'] for event in google.live()] == ['Fahrstunde Autobahn']
    assert local_events()[0]['google_id'] == remote and 'google_dirty' not in local_events()[0]


def test_writing_into_a_calendar_of_someone_else_does_not_tie_the_link_to_the_writer(google, client, monkeypatch):
    ref, remote = own_event(client, date=day(200))
    calendar_cache.sync()
    ui_data.modify_list('calendar', lambda items: [items[0].pop('google_account')])
    other = FakeGoogle('zweit@example.org')
    other.add_calendar(google.primary, 'Geteilt')
    other.store[google.primary] = google.store[google.primary]
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {other.primary: {'token': 'y'}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: (other, other.primary))
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Fahrstunde Autobahn'})
    due_again()
    calendar_cache.refresh()
    item = local_events()[0]
    assert google.store[google.primary][remote]['summary'] == 'Fahrstunde Autobahn'
    assert 'google_dirty' not in item and 'google_account' not in item and item['google_calendar'] == google.primary

