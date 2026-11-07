# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re

from app import calendar_cache, google_oauth, ui_data
from tests.google_fake import local_stamp
from tests.test_calendar_cache import TODAY, client, day, due_again, google, local_events  # noqa: F401

WEEKLY = {'freq': 'weekly', 'interval': 2, 'until': day(60), 'count': None, 'exceptions': [day(16)]}


def create(client, **fields):
    body = {'title': 'Klavier', 'date': day(2), 'start': '15:00', 'end': '15:45', **fields}
    reply = client.post('/api/ui/events', json=body)
    return reply.status_code, reply.get_json()


def test_an_own_event_keeps_its_repeat_rule_and_reminder(client):
    status, reply = create(client, recurrence={**WEEKLY, 'exceptions': [day(16), day(16), 'kaputt']}, reminderMinutes=30)
    assert status == 200
    event = reply['event']
    assert event['recurrence'] == WEEKLY
    assert event['reminderMinutes'] == 30
    ref = event['id']
    changed = client.patch(f'/api/ui/events/{ref}', json={'title': 'Klavierstunde'}).get_json()['event']
    assert (changed['recurrence'], changed['reminderMinutes']) == (WEEKLY, 30)
    cleared = client.patch(f'/api/ui/events/{ref}', json={'recurrence': None, 'reminderMinutes': -1}).get_json()['event']
    assert 'recurrence' not in cleared and cleared['reminderMinutes'] == -1
    back = client.patch(f'/api/ui/events/{ref}', json={'reminderMinutes': None}).get_json()['event']
    assert 'reminderMinutes' not in back


def test_a_rule_or_reminder_the_app_does_not_know_is_refused(client):
    for fields in ({'recurrence': {'freq': 'hourly'}}, {'recurrence': 'weekly'}, {'reminderMinutes': -5}, {'reminderMinutes': 50000},
                   {'reminderMinutes': 'bald'}, {'reminderMinutes': True}):
        status, reply = create(client, **fields)
        assert status == 400, fields
        assert reply['success'] is False
    assert local_events() == []


def test_an_event_without_rule_or_reminder_reaches_google_as_before(client, google):
    create(client)
    body = google.calls[-1][1]['body']
    assert 'recurrence' not in body and 'reminders' not in body
    assert 'timeZone' not in body['start']


def test_a_repeating_event_reaches_google_as_a_series_with_its_reminder(client, google, monkeypatch):
    monkeypatch.setattr(calendar_cache, '_zone', lambda: 'Europe/Berlin')
    create(client, recurrence=WEEKLY, reminderMinutes=1440)
    stored = google.live()[0]
    until = calendar_cache.datetime.fromisoformat(f'{day(60)}T23:59:59').astimezone(calendar_cache.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    assert stored['recurrence'] == [f'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL={until}', f"EXDATE;TZID=Europe/Berlin:{day(16).replace('-', '')}T150000"]
    assert stored['start']['timeZone'] == stored['end']['timeZone'] == 'Europe/Berlin'
    assert stored['reminders'] == {'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': 1440}]}


def test_a_whole_day_series_counts_days_and_skips_days_without_a_time(client, google):
    create(client, start=None, end=None, recurrence={'freq': 'monthly', 'count': 5, 'exceptions': [day(2)]}, reminderMinutes=-1)
    stored = google.live()[0]
    assert stored['recurrence'] == ['RRULE:FREQ=MONTHLY;COUNT=5', f"EXDATE;VALUE=DATE:{day(2).replace('-', '')}"]
    assert stored['reminders'] == {'useDefault': False, 'overrides': []}


def test_ending_a_series_and_going_back_to_the_default_reminder_reaches_google(client, google):
    _, reply = create(client, recurrence=WEEKLY, reminderMinutes=10)
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'recurrence': None, 'reminderMinutes': None})
    body = google.calls[-1][1]['body']
    assert body['recurrence'] == []
    assert body['reminders'] == {'useDefault': True, 'overrides': None}
    stored = google.live()[0]
    assert stored['recurrence'] == [] and stored['reminders'] == {'useDefault': True}


def test_a_rule_and_reminder_changed_in_google_come_back(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'}, reminderMinutes=10)
    key = google.live()[0]['id']
    google.change('primary', key, recurrence=['RRULE:FREQ=WEEKLY;BYDAY=' + calendar_cache.WEEKDAY_CODES[calendar_cache.date.fromisoformat(day(2)).weekday()] + ';COUNT=4'],
                  reminders={'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': 60}, {'method': 'email', 'minutes': 5}]})
    due_again()
    calendar_cache.sync(full=True)
    item = local_events()[0]
    assert item['recurrence'] == {'freq': 'weekly', 'interval': 1, 'until': None, 'count': 4, 'exceptions': []}
    assert item['reminder_minutes'] == 60


def test_a_rule_the_app_cannot_show_stays_as_google_has_it(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'})
    key = google.live()[0]['id']
    google.change('primary', key, summary='Klavier neu', recurrence=['RRULE:FREQ=WEEKLY;BYDAY=MO,TH'])
    due_again()
    calendar_cache.sync(full=True)
    assert local_events()[0]['title'] == 'Klavier neu'
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'title': 'Klavier'})
    assert (google.live()[0]['summary'], google.live()[0]['recurrence']) == ('Klavier', ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH'])
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'recurrence': {'freq': 'monthly'}})
    assert google.live()[0]['recurrence'] == ['RRULE:FREQ=MONTHLY']


def test_the_occurrences_google_makes_of_a_series_written_here_are_not_shown_twice(client, google):
    create(client, recurrence={'freq': 'weekly'})
    master = google.live()[0]['id']
    for offset in (2, 9):
        google.put('primary', 'Klavier', day(offset), '15:00', '15:45', key=f'{master}_{offset}', recurringEventId=master)
    google.put('primary', 'Training', day(3), '17:00', '18:30', key='other1', recurringEventId='someoneelse')
    due_again()
    calendar_cache.sync(full=True)
    assert [item['title'] for item in calendar_cache.events(day(0), day(20))] == ['Training']


def test_google_events_carry_colour_links_guests_and_reminder(google):
    google.add_calendar('handball', 'Handball')
    google.calendars['handball']['backgroundColor'] = '#33b679'
    google.put('handball', 'Training', day(1), '17:00', '18:30', key='plain1')
    google.put('primary', 'Lerngruppe Mathe', day(2), '18:30', '19:30', key='meet1', colorId='11', htmlLink='https://www.google.com/calendar/event?eid=abc',
               hangoutLink='https://meet.google.com/abc-defg-hij',
               attendees=[{'email': 'jonas@example.com', 'displayName': 'Jonas', 'responseStatus': 'accepted', 'organizer': True},
                          {'email': 'mia@example.com', 'responseStatus': 'needsAction'}, {'email': 'raum@example.com', 'resource': True}],
               reminders={'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': 30}]})
    google.put('primary', 'Serie', day(3), '08:00', '09:00', key='series1_1', recurringEventId='series1',
               conferenceData={'entryPoints': [{'entryPointType': 'phone', 'uri': 'tel:+49'}, {'entryPointType': 'video', 'uri': 'https://meet.google.com/xyz'}]})
    calendar_cache.sync(full=True)
    shown = {item['title']: item for item in calendar_cache.events(day(0), day(10))}
    plain, meet, series = shown['Training'], shown['Lerngruppe Mathe'], shown['Serie']
    assert (plain['color'], plain['calendarName'], plain['meetLink'], plain['attendees']) == ('#33b679', 'Handball', '', [])
    assert 'reminderMinutes' not in plain and 'inSeries' not in plain
    assert meet['color'] == '#d50000'
    assert meet['calendarName'] == 'Privat'
    assert meet['htmlLink'] == 'https://www.google.com/calendar/event?eid=abc'
    assert meet['meetLink'] == 'https://meet.google.com/abc-defg-hij'
    assert meet['attendees'] == [
        {'email': 'jonas@example.com', 'name': 'Jonas', 'status': 'accepted', 'organizer': True, 'self': False},
        {'email': 'mia@example.com', 'name': '', 'status': 'needsAction', 'organizer': False, 'self': False},
    ]
    assert meet['reminderMinutes'] == 30
    assert series['meetLink'] == 'https://meet.google.com/xyz' and series['inSeries'] is True


def test_a_link_that_is_no_web_address_is_left_out():
    view = google_oauth.calendar_event_view({
        'id': 'x', 'summary': 'X', 'start': {'dateTime': local_stamp(day(1), '10:00')}, 'end': {'dateTime': local_stamp(day(1), '11:00')},
        'htmlLink': 'javascript:alert(1)', 'hangoutLink': 'http://meet.example.com', 'reminders': {'useDefault': True},
    }, {'id': 'cal', 'summary': 'Cal'})
    assert (view['html_link'], view['meet_link'], view['reminder_minutes'], view['recurrence']) == ('', '', None, None)


def test_many_guests_are_cut_and_counted():
    people = [{'email': f'p{index}@example.com'} for index in range(70)]
    view = google_oauth.calendar_event_view({'id': 'x', 'start': {'date': day(1)}, 'end': {'date': day(2)}, 'attendees': people}, {'id': 'cal'})
    shown = calendar_cache.view({**view, 'calendar_id': 'cal'})
    assert len(shown['attendees']) == google_oauth.GUEST_LIMIT
    assert shown['attendeeTotal'] == 70


def test_the_rule_shape_is_checked_like_in_the_browser():
    assert ui_data.recurrence_rule({'freq': 'daily', 'count': '3', 'until': day(9)}) == {'freq': 'daily', 'interval': 1, 'until': None, 'count': 3, 'exceptions': []}
    assert ui_data.recurrence_rule({'freq': 'yearly', 'interval': 40})['interval'] == 12
    assert ui_data.recurrence_rule({'freq': 'weekly', 'exceptions': ['2026-02-30', '2026-11-11']})['exceptions'] == ['2026-11-11']
    assert ui_data.recurrence_rule(None) is None
    assert ui_data.reminder_minutes(None) is None and ui_data.reminder_minutes('1440') == 1440


def test_a_series_reaches_the_pages_as_long_as_it_repeats(client):
    first = day(-500)
    for title, rule in [('Endlos', {'freq': 'weekly'}), ('Vorbei', {'freq': 'weekly', 'count': 3}),
                        ('Bis vor langem', {'freq': 'daily', 'until': day(-450)}), ('Noch lange', {'freq': 'monthly', 'count': 30})]:
        assert create(client, title=title, date=first, recurrence=rule)[0] == 200
    shown = {item['title'] for item in ui_data.events(TODAY)}
    assert {'Endlos', 'Noch lange'} <= shown
    assert not {'Vorbei', 'Bis vor langem'} & shown
    page = client.get('/hub/calendar').get_data(as_text=True)
    data = json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', page, re.S).group(1))
    assert {'Endlos', 'Noch lange'} <= {item['title'] for item in data['events']}


def test_the_last_day_of_a_series_counts_only_days_that_exist():
    assert ui_data.series_last_day({'date': '2027-01-31', 'recurrence': {'freq': 'monthly', 'count': 6}}) == '2027-10-31'
    assert ui_data.series_last_day({'date': '2028-02-29', 'recurrence': {'freq': 'yearly', 'count': 3}}) == '2036-02-29'
    assert ui_data.series_last_day({'date': '2026-11-13', 'endDate': '2026-11-14', 'recurrence': {'freq': 'weekly', 'until': '2026-12-31'}}) == '2027-01-01'
    assert ui_data.series_last_day({'date': '2025-09-30', 'recurrence': {'freq': 'weekly'}}) is None
    assert ui_data.series_last_day({'date': '2025-09-30', 'endDate': '2025-10-02'}) == '2025-10-02'


def test_a_colour_that_is_no_plain_hex_value_is_left_out():
    base = {'id': 'x', 'calendar_id': 'cal', 'start_date': day(1), 'start_time': '10:00', 'end_date': day(1), 'end_time': '11:00', 'all_day': False}
    for bad in ('red', '#fff', '#12345g', '#123456;background:url(x)', '"><b>x</b>'):
        assert calendar_cache.view({**base, 'color': bad})['color'] == ''
    assert calendar_cache.view({**base, 'color': '#33B679'})['color'] == '#33B679'


def test_a_google_rule_beyond_what_the_app_offers_stays_as_google_wrote_it():
    assert calendar_cache._rule_of(['RRULE:FREQ=WEEKLY;INTERVAL=26'], day(1)) is False
    assert calendar_cache._rule_of(['RRULE:FREQ=DAILY;COUNT=2000'], day(1)) is False
    assert calendar_cache._rule_of(['RRULE:FREQ=WEEKLY;INTERVAL=x'], day(1)) is False
    assert calendar_cache._rule_of(['RRULE:FREQ=WEEKLY;INTERVAL=12;COUNT=1000'], day(1))['count'] == 1000


def test_only_a_pop_up_counts_as_a_reminder():
    def minutes(reminders):
        return google_oauth._reminder_minutes({'reminders': reminders})
    assert minutes({'useDefault': False, 'overrides': [{'method': 'email', 'minutes': 60}]}) == -1
    assert minutes({'useDefault': False, 'overrides': [{'method': 'email', 'minutes': 600}, {'method': 'popup', 'minutes': 10}]}) == 10
    assert minutes({'useDefault': True}) is None


def occurrences(google, master, title, first, last, start='15:00', end='15:45', changes=None, gone=()):
    for offset in range(first, last + 1, 7):
        if offset in gone:
            continue
        values = {'recurringEventId': master, 'originalStartTime': {'dateTime': local_stamp(day(offset), start)}}
        moved = (changes or {}).get(offset, {})
        google.put('primary', moved.get('title', title), day(offset), moved.get('start', start), moved.get('end', end), key=f'{master}_{offset}', **values)


def test_occurrences_changed_or_deleted_in_google_are_left_to_google(client, google):
    create(client, recurrence={'freq': 'weekly'})
    master = google.live()[0]['id']
    occurrences(google, master, 'Klavier', 2, 93, changes={9: {'start': '16:00', 'end': '16:45'}, 23: {'title': 'Klavier bei Frau Kunz'}}, gone=(16,))
    due_again()
    calendar_cache.sync(full=True)
    shown = sorted((item['title'], item['date'], item['start']) for item in calendar_cache.events(day(0), day(100)))
    assert shown == [('Klavier', day(9), '16:00'), ('Klavier bei Frau Kunz', day(23), '15:00')]
    own = next(item for item in ui_data.events(TODAY) if item['title'] == 'Klavier')
    assert {day(9), day(16), day(23)} <= set(own['googleDays'])
    assert day(30) not in own['googleDays'] and own['recurrence']['exceptions'] == []


def test_days_google_shows_itself_are_never_stored_or_sent_back(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'})
    ref = reply['event']['id']
    master = google.live()[0]['id']
    occurrences(google, master, 'Klavier', 2, 93, changes={9: {'start': '16:00', 'end': '16:45'}})
    due_again()
    calendar_cache.sync(full=True)
    own = next(item for item in ui_data.events(TODAY) if item['title'] == 'Klavier' and not item.get('synced'))
    assert own['recurrence']['exceptions'] == [] and day(9) in own['googleDays']
    stale = {**own['recurrence'], 'exceptions': [day(9), day(30)]}
    assert client.patch(f'/api/ui/events/{ref}', json={'recurrence': stale}).status_code == 200
    assert local_events()[0]['recurrence']['exceptions'] == [day(30)]
    sent = [details['body'].get('recurrence') for name, details in google.calls if name in ('events.patch', 'events.update')][-1]
    assert sent[0] == 'RRULE:FREQ=WEEKLY' and len(sent) == 2 and day(30).replace('-', '') in sent[1] and day(9).replace('-', '') not in sent[1]


def test_an_unchanged_rule_or_reminder_is_not_sent_again(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'}, reminderMinutes=30)
    ref = reply['event']['id']
    google.change('primary', google.live()[0]['id'], summary='Klavier bei Frau Kunz')
    due_again()
    calendar_cache.sync(full=True)
    calls = len(google.calls)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Klavierstunde', 'recurrence': {'freq': 'weekly'}, 'reminderMinutes': 30})
    bodies = [details['body'] for name, details in google.calls[calls:] if name in ('events.patch', 'events.update')]
    assert bodies and all(body['summary'] == 'Klavierstunde' and 'recurrence' not in body and 'reminders' not in body for body in bodies)


def test_google_s_old_occurrences_stay_hidden_right_after_a_change_from_here(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'})
    master = google.live()[0]['id']
    occurrences(google, master, 'Klavier', 2, 30)
    due_again()
    calendar_cache.sync(full=True)
    assert calendar_cache.events(day(0), day(40)) == []
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'title': 'Klavierstunde'})
    item = local_events()[0]
    assert item.get('google_id') and not item.get('google_dirty') and not item.get('google_new')
    assert calendar_cache.events(day(0), day(40)) == []
    own = next(item for item in ui_data.events(TODAY) if item['title'] == 'Klavierstunde' and not item.get('synced'))
    assert own['recurrence']['exceptions'] == [] and 'googleDays' not in own


def test_a_reminder_that_only_mails_stays_in_google(client, google):
    _, reply = create(client)
    ref = reply['event']['id']
    master = google.live()[0]['id']
    google.change('primary', master, reminders={'useDefault': False, 'overrides': [{'method': 'email', 'minutes': 60}]})
    due_again()
    calendar_cache.sync(full=True)
    client.patch(f'/api/ui/events/{ref}', json={'title': 'Klavierstunde'})
    assert 'reminders' not in google.calls[-1][1].get('body', {})
    assert google.live()[0]['reminders'] == {'useDefault': False, 'overrides': [{'method': 'email', 'minutes': 60}]}
    client.patch(f'/api/ui/events/{ref}', json={'reminderMinutes': 30})
    assert google.live()[0]['reminders'] == {'useDefault': False, 'overrides': [{'method': 'email', 'minutes': 60}, {'method': 'popup', 'minutes': 30}]}


def test_occurrences_of_a_series_with_an_edit_still_waiting_stay_hidden(client, google):
    _, reply = create(client, recurrence={'freq': 'weekly'})
    master = google.live()[0]['id']
    occurrences(google, master, 'Klavier', 2, 93, changes={9: {'start': '16:00', 'end': '16:45'}})
    due_again()
    calendar_cache.sync(full=True)
    google.offline = True
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'title': 'Klavierstunde'})
    assert [item['title'] for item in calendar_cache.events(day(0), day(100))] == []
    own = next(item for item in ui_data.events(TODAY) if item['title'] == 'Klavierstunde')
    assert own['recurrence']['exceptions'] == []


def test_a_rule_only_google_can_show_is_left_to_googles_occurrences(client, google):
    create(client)
    master = google.live()[0]['id']
    google.change('primary', master, recurrence=['RRULE:FREQ=WEEKLY;BYDAY=MO,TH'])
    occurrences(google, master, 'Klavier', 2, 30)
    due_again()
    calendar_cache.sync(full=True)
    assert local_events()[0]['recurrence'] == {'google': ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH']}
    assert [item['date'] for item in calendar_cache.events(day(0), day(40))] == [day(2), day(9), day(16), day(23), day(30)]
    assert 'Klavier' not in {item['title'] for item in ui_data.events(TODAY) if not item.get('synced')}


def test_a_series_made_in_google_is_not_flattened_by_an_edit_here(client, google):
    _, reply = create(client)
    master = google.live()[0]['id']
    google.change('primary', master, summary='Klavier neu')
    due_again()
    calendar_cache.sync(full=True)
    assert 'recurrence' in local_events()[0]
    google.change('primary', master, recurrence=['RRULE:FREQ=WEEKLY'])
    client.patch(f"/api/ui/events/{reply['event']['id']}", json={'place': 'Musikschule'})
    body = google.calls[-1][1]['body']
    assert 'recurrence' not in body and body['location'] == 'Musikschule'
    assert google.live()[0]['recurrence'] == ['RRULE:FREQ=WEEKLY']


def test_beyond_the_copy_only_untouched_occurrences_are_hidden(client, google):
    create(client, recurrence={'freq': 'weekly'})
    master = google.live()[0]['id']
    occurrences(google, master, 'Klavier', 100, 114, changes={107: {'start': '17:00', 'end': '17:45'}})
    calendar = {'id': google.primary, 'summary': 'Privat', 'backgroundColor': '#4285f4'}
    found = [{**google_oauth.calendar_event_view(event, calendar), 'calendar_id': google.primary} for event in google.live() if event.get('recurringEventId')]
    hidden = calendar_cache.live_overlay(found, day(95), day(120))
    assert sorted(key for _, key in hidden) == [f'{master}_100', f'{master}_114']


def test_a_long_description_reaches_the_page_whole():
    text = '<p>Agenda</p>' + 'x' * 3000 + '<a href="https://zoom.us/j/123">Beitreten</a>'
    shown = calendar_cache.view({'id': 'x', 'calendar_id': 'cal', 'start_date': day(1), 'start_time': '10:00', 'end_date': day(1), 'end_time': '11:00', 'description': text})
    assert shown['notes'] == text
