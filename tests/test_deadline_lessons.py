# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from datetime import date, timedelta

import pytest

from app import database as db
from app import ui_data

TODAY = date.today()
TIMES = {'v': 2, 'blocks': [{'n': n, 'start': f'{7 + n:02d}:00', 'end': f'{7 + n:02d}:45'} for n in range(1, 7)]}
SUBJECTS = {'items': {
    'x-ma': {'custom': True, 'name': 'Mathe', 'short': 'Ma', 'hue': 'lake', 'type': 'LK', 'teacher': '', 'room': ''},
    'x-de': {'custom': True, 'name': 'Deutsch', 'short': 'De', 'hue': 'rose', 'type': 'GK', 'teacher': '', 'room': ''},
}}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        yield client


def monday_of(week, swapped=False):
    """The first Monday after this week that falls in the A or B week as the page counts them."""
    reference = date.fromisoformat(ui_data.school_setup(db.get_timetable_settings() or {})['abReference'])
    if swapped:
        reference += timedelta(days=7)
    monday = TODAY - timedelta(days=TODAY.weekday()) + timedelta(days=7)
    while ui_data.week_type(monday, reference.isoformat(), True) != week:
        monday += timedelta(days=7)
    return monday


def new_plan(client, cells, weeks=True):
    """A plan as the new setup writes it: own subjects, block times, the answer on A and B weeks and the lessons as edits."""
    assert client.put('/api/ui/store/app-subjects', json=SUBJECTS).status_code == 200
    assert client.put('/api/ui/store/app-block-times', json=TIMES).status_code == 200
    assert client.put('/api/ui/store/app-ab-weeks', json=weeks).status_code == 200
    assert client.put('/api/ui/store/app-timetable-edits', json=cells).status_code == 200


def add(client, subject, day, kind='Test'):
    body = {'kind': kind, 'title': 'Analysis', 'subject': subject, 'date': day.isoformat()}
    return client.post('/api/ui/deadlines', json=body).get_json()['deadline']


def shown(client, path='/hub'):
    html = client.get(path).get_data(as_text=True)
    data = json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))
    return {item['id']: item.get('block') for item in data['deadlines']}


def test_a_test_finds_its_lesson_in_a_plan_made_in_the_new_setup(client):
    new_plan(client, {
        'A:1:3': {'subject': 'x-ma', 'room': 'R1'}, 'A:1:1': {'subject': 'x-de', 'room': 'R2'},
        'B:1:1': {'subject': 'x-ma', 'room': 'R1'}, 'B:1:2': {'subject': 'x-de', 'room': 'R2'},
    })
    in_a, in_b = add(client, 'x-ma', monday_of('A')), add(client, 'x-ma', monday_of('B'))
    assert (in_a.get('block'), in_b.get('block')) == (3, 1)
    for path in ('/hub', '/hub/calendar', '/hub/school'):
        assert {key: shown(client, path)[key] for key in (in_a['id'], in_b['id'])} == {in_a['id']: 3, in_b['id']: 1}


def test_a_double_lesson_gives_its_first_block(client):
    new_plan(client, {f'{week}:2:{n}': {'subject': 'x-ma', 'room': 'R1'} for week in 'AB' for n in (4, 5)})
    klausur = add(client, 'x-ma', monday_of('A') + timedelta(days=1), kind='Klausur')
    assert klausur['block'] == 4
    assert shown(client)[klausur['id']] == 4


def test_no_lesson_of_the_subject_that_day_or_no_plan_leaves_the_test_without_a_lesson(client):
    nothing = add(client, 'x-ma', monday_of('A'))
    assert 'block' not in nothing and shown(client)[nothing['id']] is None
    new_plan(client, {'A:1:2': {'subject': 'x-de', 'room': 'R2'}, 'A:3:2': {'subject': 'x-ma', 'room': 'R1'}})
    other = add(client, 'x-ma', monday_of('A'))
    weekend = add(client, 'x-ma', monday_of('A') + timedelta(days=5))
    loose = add(client, None, monday_of('A') + timedelta(days=2))
    assert [item.get('block') for item in (other, weekend, loose)] == [None, None, None]
    assert [shown(client)[item['id']] for item in (nothing, other, weekend, loose)] == [None, None, None, None]


def test_without_a_and_b_weeks_every_week_has_the_lessons_of_the_a_week(client):
    new_plan(client, {'A:1:2': {'subject': 'x-ma', 'room': 'R1'}}, weeks=False)
    in_a, in_b = add(client, 'x-ma', monday_of('A')), add(client, 'x-ma', monday_of('B'))
    assert (in_a['block'], in_b['block']) == (2, 2)


def test_the_swapped_weeks_move_the_lesson_with_them(client):
    new_plan(client, {'A:1:3': {'subject': 'x-ma', 'room': 'R1'}, 'B:1:1': {'subject': 'x-ma', 'room': 'R1'}})
    assert client.put('/api/ui/store/app-ab-swap', json=True).status_code == 200
    in_a, in_b = add(client, 'x-ma', monday_of('A', swapped=True)), add(client, 'x-ma', monday_of('B', swapped=True))
    assert (in_a['block'], in_b['block']) == (3, 1)


def test_the_stored_plan_still_counts_where_the_settings_changed_nothing(client):
    client.post('/api/hub/school/timetable/entries', json={'day': 1, 'block': 2, 'subject': 'Physik', 'room': 'P1'})
    client.post('/api/hub/school/timetable/entries', json={'day': 2, 'block': 1, 'subject': 'Physik', 'room': 'P1'})
    physics = next(key for key, info in ui_data.school_setup({})['subjects'].items() if info['name'] == 'Physik')
    assert client.put('/api/ui/store/app-block-times', json=TIMES).status_code == 200
    assert client.put('/api/ui/store/app-timetable-edits', json={'A:2:1': None, 'B:2:1': None, 'A:2:3': {'subject': physics, 'room': 'P1'}, 'B:2:3': {'subject': physics, 'room': 'P1'}}).status_code == 200
    monday = monday_of('A')
    stored, moved = add(client, physics, monday), add(client, physics, monday + timedelta(days=1))
    assert (stored['block'], moved['block']) == (2, 3)
    changed = client.patch(f"/api/ui/deadlines/{stored['id']}", json={'date': (monday + timedelta(days=1)).isoformat()}).get_json()['deadline']
    assert changed['block'] == 3


def test_a_lesson_outside_the_block_times_or_of_a_put_aside_subject_does_not_count(client):
    new_plan(client, {'A:1:6': {'subject': 'x-ma', 'room': 'R1'}, 'A:1:2': {'subject': 'x-de', 'room': 'R2'}})
    late, german = add(client, 'x-ma', monday_of('A')), add(client, 'x-de', monday_of('A'))
    assert (late['block'], german['block']) == (6, 2)
    assert client.put('/api/ui/store/app-block-times', json={'v': 2, 'blocks': TIMES['blocks'][:5]}).status_code == 200
    assert client.put('/api/ui/store/app-subjects', json={**SUBJECTS, 'removed': ['x-de']}).status_code == 200
    assert (shown(client)[late['id']], shown(client)[german['id']]) == (None, None)


def test_homework_from_iserv_and_the_export_find_the_lesson_too(client):
    new_plan(client, {'A:4:5': {'subject': 'x-de', 'room': 'R2'}})
    thursday = monday_of('A') + timedelta(days=3)
    school = ui_data.school_with_plan(db.get_timetable_settings() or {})
    view = ui_data.iserv_homework_view({'id': '7', 'title': 'Gedicht', 'course': 'Deutsch', 'due': f'{thursday.isoformat()}T08:00:00'}, school, set())
    assert view['subject'] == 'x-de' and view['block'] == 5
    written = add(client, 'x-de', thursday, kind='Vortrag')
    assert next(item for item in ui_data.export_records()['deadlines'] if item['id'] == written['id'])['block'] == 5
