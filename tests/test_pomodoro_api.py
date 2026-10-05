# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import os
import time
from datetime import datetime, timedelta, timezone

import pytest

from app import database as db
from app import ui_data

STAMP = '%Y-%m-%d %H:%M:%S'


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


@pytest.fixture
def far_east_clock():
    previous = os.environ.get('TZ')
    os.environ['TZ'] = 'Etc/GMT-14'
    time.tzset()
    yield
    if previous is None:
        os.environ.pop('TZ', None)
    else:
        os.environ['TZ'] = previous
    time.tzset()


def milliseconds(offset_seconds=0):
    return int((time.time() + offset_seconds) * 1000)


def utc_text(milliseconds_value):
    return datetime.fromtimestamp(milliseconds_value / 1000, timezone.utc).strftime(STAMP)


def post(client, **fields):
    body = {'subject_id': 'mathe', 'duration': 25, 'session_type': 'work', **fields}
    response = client.post('/api/pomodoro/session', json=body)
    assert response.status_code == 200
    return response.get_json()['session_id']


def stats(client, range_name):
    return client.get(f'/api/pomodoro/stats?range={range_name}').get_json()


def noon(days_ago):
    local = datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)
    return (local - timedelta(days=days_ago)).astimezone(timezone.utc).strftime(STAMP)


def test_a_session_keeps_the_end_time_it_is_given(client):
    ended = milliseconds(-3600)
    post(client, ended_at=ended)
    assert client.get('/api/pomodoro/sessions').get_json()['sessions'][0]['completed_at'] == utc_text(ended)


def test_sending_a_session_twice_stores_it_once(client):
    ended = milliseconds(-120)
    first = post(client, ended_at=ended)
    second = post(client, ended_at=ended)
    assert first == second
    assert stats(client, 'month')['total_sessions'] == 1


def test_sessions_that_differ_are_kept_apart(client):
    ended = milliseconds(-120)
    ids = {post(client, ended_at=ended), post(client, ended_at=ended, subject_id='deutsch'), post(client, ended_at=ended, duration=50), post(client, ended_at=ended, subject_id=None)}
    assert len(ids) == 4
    assert stats(client, 'month')['total_sessions'] == 4


def test_a_session_without_a_subject_is_deduplicated_too(client):
    ended = milliseconds(-120)
    assert post(client, ended_at=ended, subject_id=None) == post(client, ended_at=ended, subject_id=None)


UNUSABLE_END_TIMES = {
    'text': lambda: 'soon',
    'boolean': lambda: True,
    'missing': lambda: None,
    'zero': lambda: 0,
    'negative': lambda: -5,
    'future': lambda: milliseconds(600),
    'ancient': lambda: milliseconds(-30 * 86400),
    'infinite': lambda: float('inf'),
}


@pytest.mark.parametrize('make', UNUSABLE_END_TIMES.values(), ids=UNUSABLE_END_TIMES.keys())
def test_unusable_end_times_fall_back_to_the_moment_of_saving(client, make):
    value = make()
    body = {'subject_id': 'mathe', 'duration': 25, 'session_type': 'work'}
    if value is not None:
        body['ended_at'] = value
    assert client.post('/api/pomodoro/session', json=body).status_code == 200
    stored = client.get('/api/pomodoro/sessions').get_json()['sessions'][0]['completed_at']
    assert abs((datetime.strptime(stored, STAMP).replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds()) < 120


UNUSABLE_SESSIONS = {
    'no object': ['mathe', 25],
    'text as duration': {'duration': '25'},
    'no minutes': {'duration': 0},
    'days of minutes': {'duration': 5000},
    'truth as duration': {'duration': True},
    'fraction as duration': {'duration': 12.5},
    'unknown kind': {'session_type': 'nap'},
    'number as subject': {'subject_id': 7},
    'empty subject': {'subject_id': ''},
    'endless subject': {'subject_id': 'm' * 81},
}


@pytest.mark.parametrize('fields', UNUSABLE_SESSIONS.values(), ids=UNUSABLE_SESSIONS.keys())
def test_a_session_that_makes_no_sense_is_refused(client, fields):
    body = {'subject_id': 'mathe', 'duration': 25, 'session_type': 'work', **fields} if isinstance(fields, dict) else fields
    response = client.post('/api/pomodoro/session', json=body)
    assert response.status_code == 400
    assert response.get_json()['success'] is False
    assert client.get('/api/pomodoro/sessions').get_json()['sessions'] == []
    assert stats(client, 'today')['total_sessions'] == 0


def test_end_stamp_helper_only_accepts_plausible_numbers():
    ended = milliseconds(-90)
    assert db.pomodoro_end_stamp(ended) == utc_text(ended)
    assert db.pomodoro_end_stamp(float(ended)) == utc_text(ended)
    for value in ('1', None, True, [], {}, 0, milliseconds(3600), milliseconds(-15 * 86400)):
        assert db.pomodoro_end_stamp(value) is None


def test_the_split_by_subject_adds_up(client):
    now = milliseconds(-60)
    post(client, ended_at=now - 1000)
    post(client, ended_at=now - 2000)
    post(client, ended_at=now - 3000, subject_id='deutsch', duration=50)
    post(client, ended_at=now - 4000, subject_id=None)
    result = stats(client, 'month')
    assert result['total_sessions'] == 4 and result['total_minutes'] == 125
    rows = {row['subject_id']: (row['sessions'], row['minutes']) for row in result['by_subject']}
    assert rows == {'mathe': (2, 50), 'deutsch': (1, 50), None: (1, 25)}
    assert result['by_subject'][0]['minutes'] >= result['by_subject'][-1]['minutes']


def test_breaks_never_count_as_study_time(client):
    post(client, session_type='break', ended_at=milliseconds(-60))
    assert stats(client, 'month') == {'total_sessions': 0, 'total_minutes': 0, 'by_subject': []}


@pytest.mark.skipif(not hasattr(time, 'tzset'), reason='needs tzset')
def test_today_follows_the_local_day_not_the_utc_day(client, far_east_clock):
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    after = (midnight + timedelta(minutes=30)).astimezone(timezone.utc)
    before = (midnight - timedelta(minutes=30)).astimezone(timezone.utc)
    db.create_pomodoro_session('mathe', 25, 'work', after.strftime(STAMP))
    db.create_pomodoro_session('mathe', 25, 'work', before.strftime(STAMP))
    assert stats(client, 'today')['total_sessions'] == 1


def test_week_and_month_cover_seven_and_thirty_days_including_today(client):
    for days_ago in (0, 6, 7, 29, 30):
        db.create_pomodoro_session('mathe', 25, 'work', noon(days_ago))
    assert stats(client, 'today')['total_sessions'] == 1
    assert stats(client, 'week')['total_sessions'] == 2
    assert stats(client, 'month')['total_sessions'] == 4
