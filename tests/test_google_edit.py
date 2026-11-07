# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import threading

import pytest

from app import calendar_cache
from app import google_oauth
from tests.google_fake import FakeHttpError, local_stamp
from tests.test_calendar_cache import client, day, google, titles  # noqa: F401


def shown(start=-70, end=100):
    return {event['title']: event for event in calendar_cache.events(day(start), day(end))}


def patches(google):
    return [details['body'] for name, details in google.calls if name == 'events.patch']


def test_only_events_of_calendars_the_account_may_write_to_are_editable(google):
    google.add_calendar('team@example.org', 'Verein', role='writer')
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    google.put('team@example.org', 'Punktspiel', day(2), '10:00', '12:00')
    google.put('feiertage@example.org', 'Buß- und Bettag', day(3))
    calendar_cache.sync()
    assert {title: event['editable'] for title, event in shown().items()} == {'Gym': True, 'Punktspiel': True, 'Buß- und Bettag': False}


def test_an_edit_goes_to_google_onto_the_state_shown_and_the_copy_has_it_at_once(google, client):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00', description='Beine')
    calendar_cache.sync()
    google.calls.clear()
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken', 'date': day(1), 'start': '16:30', 'end': '18:00', 'notes': 'Beine'})
    assert reply.status_code == 200
    event = reply.get_json()['event']
    assert event['title'] == 'Gym Rücken' and event['editable'] is True
    assert patches(google) == [{'summary': 'Gym Rücken'}]
    assert google.store[google.primary][key]['summary'] == 'Gym Rücken'
    assert google.store[google.primary][key]['start'] == {'dateTime': local_stamp(day(1), '16:30')}
    google.calls.clear()
    assert titles() == ['Gym Rücken'] and google.calls == []


def test_a_new_time_and_day_reach_google_as_one_change(google, client):
    key = google.put('primary', 'Zahnarzt', day(2), '15:00', '15:30')
    calendar_cache.sync()
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'date': day(4), 'start': '15:30', 'end': '16:15'})
    assert reply.status_code == 200
    stored = google.store[google.primary][key]
    assert stored['start']['dateTime'].startswith(f'{day(4)}T15:30:00') and stored['end']['dateTime'].startswith(f'{day(4)}T16:15:00')
    assert set(patches(google)[0]) == {'start', 'end'}
    assert (shown()['Zahnarzt']['date'], shown()['Zahnarzt']['start'], shown()['Zahnarzt']['end']) == (day(4), '15:30', '16:15')


def test_an_editable_event_gets_its_whole_description_and_a_changed_word_keeps_the_rest(google, client):
    long_text = ('Agenda Zeile ' * 160) + 'ENDE: Link zum Treffen https://example.org/join'
    key = google.put('primary', 'Teams', day(2), '17:00', '18:00', description=long_text)
    calendar_cache.sync()
    notes = shown()['Teams']['notes']
    assert notes == long_text, 'the form gets the whole description, not the first 2000 characters'
    edited = notes.replace('Agenda', 'Tagesordnung', 1)
    assert client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'notes': edited}).status_code == 200
    assert google.store[google.primary][key]['description'] == edited
    assert shown()['Teams']['notes'].endswith('https://example.org/join')


def test_a_description_sent_back_unchanged_is_never_written(google, client):
    long_text = 'a' * 1999 + ' ' + 'b' * 1000 + '\n'
    key = google.put('primary', 'Lang', day(2), '17:00', '18:00', description=long_text)
    calendar_cache.sync()
    notes = shown()['Lang']['notes']
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Lang 2', 'notes': '  ' + notes.replace('\n', '\r\n') + '  '})
    assert reply.status_code == 200
    assert patches(google) == [{'summary': 'Lang 2'}]
    assert google.store[google.primary][key]['description'] == long_text


@pytest.mark.parametrize('description', [
    'Agenda<br><a href="https://example.org/join">Teilnehmen</a>',
    'Plan ' * 1300,
], ids=['formatted', 'too-long'])
def test_a_description_the_form_cannot_take_in_full_is_never_replaced(google, client, description):
    key = google.put('primary', 'Treffen', day(2), '17:00', '18:00', description=description)
    calendar_cache.sync()
    notes = shown()['Treffen']['notes']
    refused = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'notes': notes + ' neu'})
    assert refused.status_code == 409 and refused.get_json()['message'] == calendar_cache.KEEP_NOTES
    assert client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Treffen 2', 'notes': notes}).status_code == 200
    assert patches(google) == [{'summary': 'Treffen 2'}]
    assert google.store[google.primary][key]['description'] == description


def test_a_change_made_in_google_meanwhile_is_never_overwritten(google, client):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.change('primary', key, summary='Gym verlegt')
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken'})
    assert reply.status_code == 409 and reply.get_json()['error'] == calendar_cache.CHANGED_THERE
    assert google.store[google.primary][key]['summary'] == 'Gym verlegt'
    assert titles() == ['Gym verlegt'], 'the copy shows what Google has now'


def test_deleting_a_google_event_removes_it_there_and_here(google, client):
    key = google.put('primary', 'Kino', day(3), '20:00', '22:00')
    calendar_cache.sync()
    assert client.delete(f'/api/ui/events/g-{google.primary}-{key}').status_code == 200
    assert google.store[google.primary][key]['status'] == 'cancelled'
    assert titles() == []


def test_a_delete_of_something_changed_in_google_meanwhile_is_refused(google, client):
    key = google.put('primary', 'Kino', day(3), '20:00', '22:00')
    calendar_cache.sync()
    google.change('primary', key, summary='Kino mit Lea')
    reply = client.delete(f'/api/ui/events/g-{google.primary}-{key}')
    assert reply.status_code == 409
    assert google.store[google.primary][key]['status'] == 'confirmed' and titles() == ['Kino mit Lea']


def test_an_event_deleted_in_google_meanwhile_leaves_the_copy_on_an_edit(google, client):
    key = google.put('primary', 'Kino', day(3), '20:00', '22:00')
    calendar_cache.sync()
    google.cancel('primary', key)
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Kino 2'})
    assert reply.status_code == 404 and titles() == []
    assert client.delete(f'/api/ui/events/g-{google.primary}-{key}').status_code == 404


def test_read_only_calendars_refuse_and_are_never_asked(google, client):
    google.add_calendar('feiertage@example.org', 'Feiertage', role='reader')
    key = google.put('feiertage@example.org', 'Buß- und Bettag', day(3))
    calendar_cache.sync()
    google.calls.clear()
    reply = client.patch(f'/api/ui/events/g-feiertage@example.org-{key}', json={'title': 'Frei'})
    assert reply.status_code == 403 and reply.get_json()['error'] == calendar_cache.READ_ONLY
    assert client.delete(f'/api/ui/events/g-feiertage@example.org-{key}').status_code == 403
    assert google.calls == []


def test_an_account_without_write_permission_shows_nothing_as_editable(google, client, monkeypatch):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    scopes = [google_oauth.EVENTS_READ_SCOPE, google_oauth.CALENDAR_LIST_SCOPE]
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'scopes': scopes}})
    assert shown()['Gym']['editable'] is False
    assert client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'X'}).status_code == 403


def test_an_expired_sign_in_and_a_dead_network_make_events_read_only(google, client, monkeypatch):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.offline = True
    calendar_cache._status['checked'] = None
    assert calendar_cache.sync() == 'offline'
    assert shown()['Gym']['editable'] is False
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken'})
    assert reply.status_code == 503 and reply.get_json()['error'] == calendar_cache.UNREACHABLE
    google.offline = False
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'expired': True}})
    assert shown()['Gym']['editable'] is False
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken'})
    assert reply.status_code == 409 and reply.get_json()['error'] == calendar_cache.SIGNED_OUT
    assert google.store[google.primary][key]['summary'] == 'Gym'


def test_an_unknown_google_event_is_not_found(google, client):
    calendar_cache.sync()
    assert client.patch(f'/api/ui/events/g-{google.primary}-gibtsnicht', json={'title': 'X'}).status_code == 404


def test_an_edit_while_a_check_runs_is_not_undone_by_that_check(google, client, monkeypatch):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    other = google.put('primary', 'Kino', day(3), '20:00', '22:00')
    calendar_cache.sync()
    google.change('primary', other, summary='Kino mit Lea')
    calendar_cache._status['checked'] = None
    entered, release = threading.Event(), threading.Event()
    pull = calendar_cache._pull_changes

    def pulled_then_held(service, cache):
        answer = pull(service, cache)
        entered.set()
        release.wait(5)
        return answer

    monkeypatch.setattr(calendar_cache, '_pull_changes', pulled_then_held)
    running = threading.Thread(target=calendar_cache.sync)
    running.start()
    assert entered.wait(5)
    assert client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken'}).status_code == 200
    release.set()
    running.join(5)
    assert titles() == ['Gym Rücken', 'Kino'], 'the check that read Google before the edit keeps its older copy to itself'
    monkeypatch.setattr(calendar_cache, '_pull_changes', pull)
    calendar_cache._status['checked'] = None
    calendar_cache.sync()
    assert titles() == ['Gym Rücken', 'Kino mit Lea']


def test_a_copy_from_before_learns_once_what_each_calendar_allows(google):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    cache = calendar_cache._load()
    for calendar in cache['calendars']:
        calendar.pop('accessRole')
    calendar_cache._save(cache)
    calendar_cache._status['checked'] = None
    google.calls.clear()
    calendar_cache.sync()
    assert google.count('calendarList.list') == 1
    assert shown()['Gym']['editable'] is True
    google.calls.clear()
    calendar_cache._status['checked'] = None
    calendar_cache.sync()
    assert google.count('calendarList.list') == 0


def test_a_calendar_id_with_dashes_is_found_and_a_refusal_carries_its_message(google, client):
    google.add_calendar('familie-berger@group.calendar.google.com', 'Familie', role='writer')
    google.add_calendar('familie-berger-alt@group.calendar.google.com', 'Familie alt', role='reader')
    key = google.put('familie-berger@group.calendar.google.com', 'Lerngruppe', day(2), '17:00', '18:00', key='lerngruppe1')
    old = google.put('familie-berger-alt@group.calendar.google.com', 'Damals', day(3), '17:00', '18:00', key='lerngruppe2')
    calendar_cache.sync()
    reply = client.patch(f'/api/ui/events/g-familie-berger@group.calendar.google.com-{key}', json={'title': 'Lerngruppe Mathe'})
    assert reply.status_code == 200 and google.store['familie-berger@group.calendar.google.com'][key]['summary'] == 'Lerngruppe Mathe'
    refused = client.patch(f'/api/ui/events/g-familie-berger-alt@group.calendar.google.com-{old}', json={'title': 'X'})
    assert refused.status_code == 403
    assert refused.get_json() == {'success': False, 'error': calendar_cache.READ_ONLY, 'message': calendar_cache.READ_ONLY}


def test_a_change_google_declines_is_named_as_such(google, client):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.hooks['events.patch'] = lambda details: (_ for _ in ()).throw(FakeHttpError(400, 'invalid'))
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym Rücken'})
    assert reply.status_code == 400 and reply.get_json()['message'] == calendar_cache.DECLINED
    assert titles() == ['Gym']


@pytest.mark.parametrize('status, reason, message, code', [
    (403, 'rateLimitExceeded', calendar_cache.SLOW_DOWN, 503),
    (429, None, calendar_cache.SLOW_DOWN, 503),
    (403, 'forbidden', calendar_cache.DECLINED, 403),
    (403, 'forbiddenForNonOrganizer', calendar_cache.READ_ONLY, 403),
    (401, None, calendar_cache.SIGNED_OUT, 409),
])
def test_a_refusal_from_google_is_named_by_its_reason(google, client, status, reason, message, code):
    key = google.put('primary', 'Gym', day(1), '16:30', '18:00')
    calendar_cache.sync()
    google.hooks['events.patch'] = lambda details: (_ for _ in ()).throw(FakeHttpError(status, reason))
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'title': 'Gym 2'})
    assert (reply.status_code, reply.get_json()['message']) == (code, message)


def test_an_invitation_from_someone_else_stays_read_only_unless_guests_may_change_it(google, client):
    boss = {'email': 'chef@example.org'}
    invited = google.put('primary', 'Einladung', day(2), '10:00', '11:00', organizer=boss)
    open_one = google.put('primary', 'Offene Runde', day(2), '12:00', '13:00', organizer=boss, guestsCanModify=True)
    google.put('primary', 'Eigenes', day(2), '14:00', '15:00', organizer={'email': google.primary, 'self': True})
    calendar_cache.sync()
    assert {title: event['editable'] for title, event in shown().items()} == {'Einladung': False, 'Offene Runde': True, 'Eigenes': True}
    google.calls.clear()
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{invited}', json={'title': 'X'})
    assert reply.status_code == 403 and reply.get_json()['message'] == calendar_cache.INVITED and google.calls == []
    assert client.patch(f'/api/ui/events/g-{google.primary}-{open_one}', json={'title': 'Offene Runde 2'}).status_code == 200


@pytest.mark.parametrize('description, locked', [
    ('Treffpunkt am Tor', False),
    ('Alt <s>und gestrichen</s>', True),
    ('Oben<hr>Unten', True),
    ('<blockquote>Zitat</blockquote>', True),
    ('Toms&#39;s Plan', True),
    ('Kurz &ndash; und gut', True),
])
def test_a_description_with_any_markup_is_locked_and_never_replaced(google, client, description, locked):
    key = google.put('primary', 'Treffen', day(2), '17:00', '18:00', description=description)
    calendar_cache.sync()
    event = shown()['Treffen']
    assert event['notesLocked'] is locked
    reply = client.patch(f'/api/ui/events/g-{google.primary}-{key}', json={'notes': 'Neu geschrieben'})
    if locked:
        assert reply.status_code == 409 and reply.get_json()['message'] == calendar_cache.KEEP_NOTES
        assert google.store[google.primary][key]['description'] == description
    else:
        assert reply.status_code == 200 and google.store[google.primary][key]['description'] == 'Neu geschrieben'
