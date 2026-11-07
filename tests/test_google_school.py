# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

from datetime import timedelta

import pytest

from app import brand
from app import calendar_cache
from app import database as db
from app import google_oauth
from app import google_school
from tests.test_calendar_cache import TODAY, client, day, google  # noqa: F401

MONDAY = TODAY - timedelta(days=TODAY.weekday())


def mondays():
    """The Mondays in the four weeks ahead, today included, with the week they fall in."""
    days = [TODAY + timedelta(days=offset) for offset in range(google_school.LESSON_DAYS)]
    return [(item.isoformat(), 'A' if (item - MONDAY).days // 7 % 2 == 0 else 'B') for item in days if item.weekday() == 0]


@pytest.fixture
def school(google, client, tmp_path, monkeypatch):
    monkeypatch.setattr(google_school, 'STATE_FILE', tmp_path / 'google_school.json')
    monkeypatch.setattr(google_school, 'CHANGE_DELAY', 0)
    google_school._memory.update(signature=None, state=None)
    google_school._due['at'] = None
    db.save_timetable_settings(has_ab_weeks=True, reference_date=MONDAY.isoformat())
    client.put('/api/ui/store/app-teachers', json={'items': {'t-mueller': {'title': 'Frau', 'name': 'Müller', 'custom': True}}})
    client.put('/api/ui/store/app-subjects', json={'items': {
        'mathe': {'custom': True, 'name': 'Mathe', 'hue': 'lake', 'type': 'LK', 'teacher': 't-mueller'},
        'deutsch': {'custom': True, 'name': 'Deutsch', 'hue': 'brick'},
    }, 'removed': []})
    plan(client, {'A:1:1': {'subject': 'mathe', 'room': 'R121'}, 'B:1:1': {'subject': 'deutsch', 'room': 'R204'}})
    calendar_cache.sync()
    google.calls.clear()
    yield google
    google_school._memory.update(signature=None, state=None)
    google_school._due['at'] = None


def plan(client, edits):
    client.put('/api/ui/store/app-timetable-edits', json=edits)


def switch_on(client):
    reply = client.post('/api/ui/google/school')
    assert reply.status_code == 200, reply.get_json()
    assert google_school.background_round() is True
    return google_school._read()['calendar']


def entries(google, calendar):
    return sorted((event['start'].get('dateTime', event['start'].get('date'))[:10], event['summary'], event.get('location', '')) for event in google.live(calendar))


def writes(google):
    return [(name, details['calendar']) for name, details in google.calls if name in ('events.insert', 'events.patch', 'events.delete')]


def test_it_is_off_until_switched_on_and_costs_nothing_then(school, client):
    assert client.get('/api/ui/google/school').get_json()['school']['on'] is False
    assert google_school.background_round() is False
    client.put('/api/ui/store/app-timetable-edits', json={'A:1:1': {'subject': 'mathe', 'room': 'R007'}})
    assert google_school.background_round() is False and school.calls == []


def test_switching_on_makes_one_calendar_and_fills_the_weeks_ahead(school, client):
    calendar = switch_on(client)
    assert school.count('calendars.insert') == 1
    assert school.listed[calendar]['summary'] == f'{brand.NAME} Schule'
    expected = [(monday, 'Mathe LK' if week == 'A' else 'Deutsch', 'R121' if week == 'A' else 'R204') for monday, week in mondays()]
    assert entries(school, calendar) == expected
    stored = {event['summary']: event for event in school.live(calendar)}
    assert stored['Mathe LK']['description'] == 'Frau Müller'
    assert stored['Mathe LK']['reminders'] == {'useDefault': False, 'overrides': []}
    assert stored['Mathe LK']['start']['dateTime'][11:16] == '08:00' and stored['Mathe LK']['end']['dateTime'][11:16] == '09:30'
    assert stored['Mathe LK']['colorId'] == google_school._color_of('lake')
    assert school.live('primary') == []
    view = client.get('/api/ui/google/school').get_json()['school']
    assert view['on'] is True and view['count'] == len(expected) and view['stand'] and view['busy'] is False


def test_holidays_have_no_lessons(school, client):
    free, _ = mondays()[1]
    db.create_holiday(free, 'Herbstferien', 'BB', int(free[:4]), end_date=free, holiday_type='schulferien')
    calendar = switch_on(client)
    assert free not in [first for first, _, _ in entries(school, calendar)]
    assert len(entries(school, calendar)) == len(mondays()) - 1


def test_changes_follow_and_what_left_the_plan_goes(school, client):
    calendar = switch_on(client)
    school.calls.clear()
    plan(client, {'A:1:1': {'subject': 'mathe', 'room': 'R007'}, 'B:1:1': {'subject': 'deutsch', 'room': 'R204'}})
    assert google_school.background_round() is True
    a_weeks = [monday for monday, week in mondays() if week == 'A']
    assert [name for name, _ in writes(school)] == ['events.patch'] * len(a_weeks)
    assert sorted(place for first, title, place in entries(school, calendar) if title == 'Mathe LK') == ['R007'] * len(a_weeks)
    school.calls.clear()
    plan(client, {'A:1:1': {'subject': 'mathe', 'room': 'R007'}, 'B:1:1': None})
    assert google_school.background_round() is True
    assert [title for _, title, _ in entries(school, calendar)] == ['Mathe LK'] * len(a_weeks)
    assert [name for name, _ in writes(school)] == ['events.delete'] * (len(mondays()) - len(a_weeks))


def test_tests_exams_and_talks_are_entered_and_a_test_takes_the_place_of_its_lesson(school, client):
    calendar = switch_on(client)
    a_monday = next(monday for monday, week in mondays() if week == 'A')
    wednesday = (TODAY + timedelta(days=(2 - TODAY.weekday()) % 7 + 7)).isoformat()
    test = client.post('/api/ui/deadlines', json={'kind': 'Test', 'title': 'Analysis', 'subject': 'mathe', 'date': a_monday, 'detail': 'Kapitel 3'}).get_json()['deadline']
    client.post('/api/ui/deadlines', json={'kind': 'Klausur', 'title': 'Erörterung', 'subject': 'deutsch', 'date': wednesday})
    client.post('/api/ui/deadlines', json={'kind': 'Vortrag', 'title': 'Weimar', 'date': wednesday, 'time': '14:00'})
    assert google_school.background_round() is True
    stored = {event['summary']: event for event in school.live(calendar)}
    assert stored['Test Mathe LK: Analysis']['start']['dateTime'].startswith(f'{a_monday}T08:00')
    assert stored['Test Mathe LK: Analysis']['location'] == 'R121' and stored['Test Mathe LK: Analysis']['description'] == 'Kapitel 3\n\nFrau Müller'
    assert stored['Test Mathe LK: Analysis']['colorId'] == google_school.TESTS_COLOR
    assert stored['Klausur Deutsch: Erörterung']['start'] == {'date': wednesday}
    assert stored['Vortrag: Weimar']['start']['dateTime'].startswith(f'{wednesday}T14:00')
    assert sum(1 for event in school.live(calendar) if event['start'].get('dateTime', '').startswith(a_monday)) == 1
    client.delete(f"/api/ui/deadlines/{test['id']}")
    assert google_school.background_round() is True
    assert [title for first, title, _ in entries(school, calendar) if first == a_monday] == ['Mathe LK']


def test_a_restart_sends_nothing_and_a_lost_state_makes_no_second_calendar_or_entry(school, client):
    calendar = switch_on(client)
    before = entries(school, calendar)
    school.calls.clear()
    google_school._memory.update(signature=None, state=None)
    google_school._due['at'] = None
    google_school.changed(delay=0)
    assert google_school.background_round() is True
    assert writes(school) == [], 'nothing changed, nothing is sent'
    google_school.STATE_FILE.unlink()
    google_school._memory.update(signature=None, state=None)
    assert client.post('/api/ui/google/school').status_code == 200
    assert google_school.background_round() is True
    assert school.count('calendars.insert') == 0 and google_school._read()['calendar'] == calendar
    assert entries(school, calendar) == before
    assert len(school.live(calendar)) == len(before)


def test_an_entry_deleted_in_google_comes_back_under_a_new_id_when_it_changes(school, client):
    calendar = switch_on(client)
    first, _ = mondays()[0]
    key = f'lesson:{first}:1'
    gone = google_school._read()['events'][key]['id']
    school.cancel(calendar, gone)
    plan(client, {'A:1:1': {'subject': 'mathe', 'room': 'R007'}, 'B:1:1': {'subject': 'deutsch', 'room': 'R007'}})
    assert google_school.background_round() is True
    again = google_school._read()['events'][key]
    assert again['id'] == google_school.event_id(calendar, key, 1) and again['gen'] == 1
    assert [place for when, _, place in entries(school, calendar) if when == first] == ['R007']


def test_it_never_writes_to_any_other_calendar(school, client):
    school.add_calendar('team@example.org', 'Verein')
    calendar = switch_on(client)
    plan(client, {'A:1:1': None, 'B:1:1': {'subject': 'deutsch', 'room': 'R204'}})
    google_school.background_round()
    assert writes(school) and {target for _, target in writes(school)} == {calendar}
    assert school.live('team@example.org') == [] and school.live('primary') == []


def test_the_school_calendar_stays_out_of_the_app_calendar_and_its_settings(school, client):
    calendar = switch_on(client)
    calendar_cache.sync(full=True)
    assert all(event['title'] not in ('Mathe LK', 'Deutsch') for event in calendar_cache.events(day(-70), day(100)))
    assert calendar not in [item['id'] for item in calendar_cache.settings_view()['calendars']]


def test_turning_off_keeps_the_calendar_in_google_or_deletes_it(school, client):
    calendar = switch_on(client)
    kept = client.delete('/api/ui/google/school', json={'keep': True}).get_json()
    assert kept['calendar'] == calendar and kept['school']['on'] is False
    assert google_school.background_round() is False
    assert calendar in school.listed and len(school.live(calendar)) == len(mondays())
    assert google_school.managed() == set()
    calendar = switch_on(client)
    assert school.count('calendars.insert') == 1, 'switched on again, the kept calendar is used'
    client.delete('/api/ui/google/school', json={'keep': False})
    assert google_school.managed() == {calendar}
    assert google_school.background_round() is True
    assert calendar not in school.listed and google_school.managed() == set()


def test_a_delete_that_cannot_reach_google_waits_for_the_next_round(school, client):
    calendar = switch_on(client)
    client.delete('/api/ui/google/school', json={'keep': False})
    school.offline = True
    google_school.background_round()
    assert google_school._read()['remove'] == calendar and calendar in school.listed
    school.offline = False
    google_school._change(lambda state: state.update(pause_until=0))
    google_school.background_round()
    assert calendar not in school.listed


def test_going_too_fast_pauses_and_finishes_later_in_batches(school, client, monkeypatch):
    monkeypatch.setattr(google_school, 'BATCH', 2)
    school.write_budget = 2
    client.post('/api/ui/google/school')
    assert google_school.background_round() is True
    state = google_school._read()
    assert state['problem'] == 'limit' and state['pause_until'] and len(state['events']) == 2
    assert google_school.background_round() is False, 'the pause holds'
    school.write_budget = None
    google_school._change(lambda state: state.update(pause_until=0))
    school.calls.clear()
    assert google_school.background_round() is True
    assert google_school._read()['problem'] is None and len(google_school._read()['events']) == len(mondays())
    assert [details['size'] for name, details in school.calls if name == 'batch'] == [2] * ((len(mondays()) - 2 + 1) // 2)


def test_a_calendar_deleted_in_google_switches_it_off_with_a_note(school, client):
    calendar = switch_on(client)
    school.remove_calendar(calendar)
    google_school._change(lambda state: state.update(seen=None))
    google_school.changed(delay=0)
    assert google_school.background_round() is True
    view = client.get('/api/ui/google/school').get_json()['school']
    assert view['on'] is False and view['notice'] == 'gone'
    assert school.count('calendars.insert') == 1


def test_switching_on_needs_the_permission_to_make_a_calendar(school, client, monkeypatch):
    scopes = list(google_oauth.FEATURES['calendar'])
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {school.primary: {'token': 'x', 'refresh_token': 'r', 'scopes': scopes}})
    refused = client.post('/api/ui/google/school')
    assert refused.status_code == 403 and refused.get_json()['needs'] == 'school'
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {school.primary: {'token': 'x', 'refresh_token': 'r', 'scopes': [*scopes, google_oauth.APP_CALENDARS_SCOPE]}})
    assert client.post('/api/ui/google/school').status_code == 200


def test_without_network_the_round_waits_and_then_catches_up(school, client):
    client.post('/api/ui/google/school')
    school.offline = True
    assert google_school.background_round() is True
    state = google_school._read()
    assert state['problem'] == 'offline' and state['pause_until']
    assert google_school.background_round() is False
    school.offline = False
    google_school._change(lambda state: state.update(pause_until=0))
    assert google_school.background_round() is True
    assert len(google_school._read()['events']) == len(mondays())


def test_a_sign_in_that_cannot_be_renewed_right_now_pauses_the_rounds(school, client, monkeypatch):
    client.post('/api/ui/google/school')
    asked = []
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: asked.append(1) or (None, school.primary))
    assert google_school.background_round() is True
    for _ in range(5):
        assert google_school.background_round() is False
    assert asked == [1] and google_school._read()['problem'] == 'offline'


def test_the_background_thread_fills_the_calendar(school, client, monkeypatch):
    import time

    monkeypatch.setattr(calendar_cache, 'TICK_SECONDS', 0.05)
    client.post('/api/ui/google/school')
    thread = calendar_cache.start_background()
    try:
        deadline = time.monotonic() + 5
        while len(google_school._read()['events']) < len(mondays()) and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        calendar_cache.stop_background()
    assert not thread.is_alive()
    assert len(google_school._read()['events']) == len(mondays())


def test_the_school_calendar_stays_out_of_events_loaded_live_beyond_the_copy(school, client, monkeypatch):
    calendar = switch_on(client)
    far = (TODAY + timedelta(days=200)).isoformat()
    loaded = [
        {'id': 'x1', 'title': 'Mathe LK', 'start_date': far, 'start_time': '08:00', 'end_date': far, 'end_time': '09:30', 'calendar_id': calendar},
        {'id': 'x2', 'title': 'Konzert', 'start_date': far, 'start_time': '20:00', 'end_date': far, 'end_time': '22:00', 'calendar_id': school.primary},
    ]
    monkeypatch.setattr(google_oauth, 'fetch_google_calendar_events', lambda **kwargs: {'success': True, 'events': loaded})
    payload = client.get(f'/api/ui/events/synced?start={far}&end={far}').get_json()
    assert [event['title'] for event in payload['events']] == ['Konzert']
