# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""The school week in Google: a calendar of its own with the lessons of the coming weeks and the tests, exams and talks.

Someone who lives in Google Calendar sees the timetable there. Nothing outside this one calendar is ever touched.
Every entry has an id made from what it is, so a restart, a lost state file or a new connection never makes a second
one. Only what changed is sent, in batches, and a refusal for going too fast makes the next round wait longer.
"""

import colorsys
import copy
import hashlib
import json
import logging
import threading
import time
from datetime import date, datetime, timedelta

from . import brand
from . import database as db
from . import ui_data
from .crypto_utils import decrypt_file, encrypt_file
from .paths import DATA_DIR

STATE_FILE = DATA_DIR / 'google_school.json'
NAME = f'{brand.NAME} Schule'
DESCRIPTION = f'Stundenplan und Tests aus {brand.NAME}. {brand.NAME} hält diesen Kalender aktuell, ändere die Einträge deshalb in {brand.NAME}.'
LESSON_DAYS = 28
DEADLINE_DAYS = 120
PERIOD_SECONDS = 300
CHANGE_DELAY = 3
BATCH = 50
PASSES = 3
BACKOFF = (60, 120, 300, 900, 1800)
GONE = (404, 410)
LIMITS = {'rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'}
KINDS = (('test', 'tests', 'Test'), ('exam', 'exams', 'Klausur'), ('talk', 'talks', 'Vortrag'))
TESTS_COLOR = '11'
GOOGLE_COLORS = {
    '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff', '4': '#ff887c', '5': '#fbd75b',
    '6': '#ffb878', '7': '#46d6db', '9': '#5484ed', '10': '#51b749', '11': '#dc2127',
}

log = logging.getLogger(__name__)

_round_lock = threading.Lock()
_state_lock = threading.Lock()
_memory = {'signature': None, 'state': None}
_due = {'at': None}


class CalendarGone(Exception):
    pass


class Limited(Exception):
    pass


def _google():
    from . import google_oauth
    return google_oauth


def _blank():
    return {'version': 1, 'on': False, 'account': None, 'calendar': None, 'events': {}, 'remove': None, 'epoch': 0}


def _read():
    try:
        stat = STATE_FILE.stat()
    except OSError:
        return _blank()
    signature = (stat.st_mtime_ns, stat.st_size)
    if _memory['signature'] != signature:
        try:
            state = decrypt_file(STATE_FILE)
        except Exception:
            state = None
        _memory.update(signature=signature, state=state if isinstance(state, dict) else _blank())
    return copy.deepcopy(_memory['state'])


def _write(state):
    encrypt_file(state, STATE_FILE)
    _memory.update(signature=None, state=None)


def _change(change):
    with _state_lock:
        state = _read()
        result = change(state)
        _write(state)
        return result


def managed():
    """The calendars this module writes to. The copy of the Google calendar leaves them out, the app shows its own plan."""
    state = _read()
    return {name for name in (state.get('calendar'), state.get('remove')) if name}


def _account():
    try:
        return _google().calendar_account()
    except Exception:
        return None


def view():
    """What Settings shows: whether it is on for the connected account, how far it got and what stands in the way."""
    state = _read()
    account = _account()
    on = bool(state.get('on')) and bool(account) and state.get('account') == account
    return {
        'on': on,
        'name': NAME,
        'busy': on and not state.get('problem') and (not state.get('stand') or _due['at'] is not None),
        'count': len(state.get('events') or {}) if on else 0,
        'stand': state.get('stand') if on else None,
        'problem': state.get('problem') if on else None,
        'notice': state.get('notice'),
        'removing': bool(state.get('remove')),
    }


def turn_on(account):
    def change(state):
        if state.get('account') != account:
            state.update(_blank(), epoch=state.get('epoch', 0), remove=state.get('remove'))
        state.update(on=True, account=account, notice=None, problem=None, stand=None, epoch=state.get('epoch', 0) + 1)
    _change(change)
    changed(delay=0)


def turn_off(keep):
    """Stops the entries. The calendar stays in Google as an ordinary one, or goes with the next round."""
    def change(state):
        calendar = state.get('calendar')
        state.update(on=False, calendar=None, events={}, problem=None, notice=None, stand=None, epoch=state.get('epoch', 0) + 1)
        if calendar and not keep:
            state['remove'] = calendar
        return calendar
    calendar = _change(change)
    changed(delay=0)
    return calendar


def changed(delay=None):
    """Something the entries come from changed. The round follows shortly, so several quick saves make one."""
    state = _read()
    if not state.get('on') and not state.get('remove'):
        return
    _due['at'] = time.monotonic() + (CHANGE_DELAY if delay is None else delay)
    from . import calendar_cache
    calendar_cache.wake()


def seconds_until_due():
    due = _due['at']
    return None if due is None else max(0.0, due - time.monotonic())


def _color_of(hue):
    """The Google event colour nearest to a subject colour of the app."""
    rgb = ui_data._hex_rgb(ui_data.HUES.get(hue))
    if rgb is None:
        return None
    own = colorsys.rgb_to_hsv(*rgb)[0]

    def distance(key):
        other = colorsys.rgb_to_hsv(*ui_data._hex_rgb(GOOGLE_COLORS[key]))[0]
        gap = abs(own - other)
        return min(gap, 1 - gap)

    return min(GOOGLE_COLORS, key=distance)


def _colors():
    school = ui_data.school_setup(db.get_timetable_settings() or {})
    hues = {key: info.get('hue') for key, info in school['shown'].items()}
    saved = db.get_ui_store().get('app-subjects')
    items = saved.get('items') if isinstance(saved, dict) and isinstance(saved.get('items'), dict) else {}
    hues.update({key: own['hue'] for key, own in items.items() if isinstance(own, dict) and own.get('hue') in ui_data.HUES})
    return {key: _color_of(hue) for key, hue in hues.items() if hue}


def _entry(summary, day, start=None, end=None, place='', notes='', color=None, quiet=False):
    """An event as Google stores it. A patch names both forms of start and end, otherwise Google would keep the old one."""
    body = {'summary': summary, 'location': place, 'description': notes}
    if start:
        first = datetime.fromisoformat(f'{day}T{start}:00')
        last = datetime.fromisoformat(f'{day}T{end}:00') if end else first + timedelta(hours=1)
        body['start'] = {'dateTime': first.astimezone().isoformat(), 'date': None}
        body['end'] = {'dateTime': max(last, first + timedelta(minutes=5)).astimezone().isoformat(), 'date': None}
    else:
        body['start'] = {'date': day, 'dateTime': None}
        body['end'] = {'date': (date.fromisoformat(day) + timedelta(days=1)).isoformat(), 'dateTime': None}
    body['colorId'] = color
    body['reminders'] = {'useDefault': False, 'overrides': []} if quiet else {'useDefault': True}
    return body


def _test_title(kind, subject, title):
    head = f'{kind} {subject}' if subject else kind
    return f'{head}: {title}' if title and title.casefold() not in (kind.casefold(), subject.casefold()) else head


def wanted(today=None):
    """Every entry the calendar should hold, by a key that names what it is: lessons by day and block, the rest by id.
    A test in a lesson of the coming weeks takes that lesson's place, so Google shows one entry there and not two."""
    today = today or date.today()
    school = ui_data.effective_school()
    colors = _colors()
    days = {(today + timedelta(days=offset)).isoformat(): ui_data.lessons_on(school, today + timedelta(days=offset)) for offset in range(LESSON_DAYS)}
    tests, result = {}, {}
    last = (today + timedelta(days=DEADLINE_DAYS)).isoformat()
    for prefix, name, kind in KINDS:
        for item in ui_data.load_list(name):
            day = ui_data.iso_day(item.get('date'))
            if not day or not today.isoformat() <= day <= last:
                continue
            key = str(item.get('subject_id') or '')
            info = school['subjects'].get(key)
            if info and info.get('retired'):
                continue
            title = _test_title(kind, info['name'] if info else '', str(item.get('title') or '').strip())
            notes = str(item.get('topics') or '').strip()
            start = ui_data.clock(item.get('time'))
            lessons = days[day] if day in days else ui_data.lessons_on(school, date.fromisoformat(day))
            lesson = next((entry for entry in lessons if info and entry['key'] == key and (not start or entry['start'] == start)), None)
            if lesson and day in days and (day, lesson['block']) not in tests:
                tests[(day, lesson['block'])] = (title, notes)
            elif lesson:
                result[f'{prefix}:{item.get("id")}'] = (day, _entry(title, day, lesson['start'], lesson['end'], lesson['room'], notes, TESTS_COLOR))
            else:
                result[f'{prefix}:{item.get("id")}'] = (day, _entry(title, day, start, None, notes=notes, color=TESTS_COLOR))
    for day, lessons in days.items():
        for lesson in lessons:
            test = tests.get((day, lesson['block']))
            notes = '\n\n'.join(part for part in ((test[1] if test else ''), lesson['teacher']) if part)
            summary, color = (test[0], TESTS_COLOR) if test else (lesson['subject'], colors.get(lesson['key']))
            result[f'lesson:{day}:{lesson["block"]}'] = (day, _entry(summary, day, lesson['start'], lesson['end'], lesson['room'], notes, color, quiet=not test))
    return result


def _digest(body):
    return hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def event_id(calendar, key, generation=0):
    """Google takes ids made of a to v and digits. The same entry always gets the same id, a deleted one a new generation."""
    return hashlib.sha1(f'{calendar}|{key}|{generation}'.encode('utf-8')).hexdigest()


def _without_nulls(value):
    if isinstance(value, dict):
        return {name: _without_nulls(item) for name, item in value.items() if item is not None}
    return value


def _status_of(error):
    return getattr(getattr(error, 'resp', None), 'status', None)


def _limited(error):
    if _status_of(error) == 429:
        return True
    if _status_of(error) != 403:
        return False
    try:
        reasons = {str(item.get('reason')) for item in json.loads(getattr(error, 'content', b'') or b'{}')['error']['errors']}
    except Exception:
        return False
    return bool(reasons & LIMITS)


def _plan(state, desired, today):
    """What to send: new entries, changed ones and those that left the plan. Past entries stay in Google as a record."""
    calendar, events, first = state['calendar'], state['events'], today.isoformat()
    ops = []
    for key, (day, body) in desired.items():
        known = events.get(key)
        digest = _digest(body)
        if not known:
            generation = 0
            ops.append(('insert', key, day, body, digest, event_id(calendar, key, generation), generation))
        elif known.get('hash') != digest:
            ops.append(('patch', key, day, body, digest, known['id'], known.get('gen', 0)))
    for key, known in list(events.items()):
        if key in desired:
            continue
        if (known.get('day') or '') < first:
            events.pop(key)
        else:
            ops.append(('delete', key, known.get('day'), None, None, known['id'], known.get('gen', 0)))
    return ops


def _request(service, calendar, op):
    kind, key, day, body, digest, identifier, generation = op
    if kind == 'insert':
        return service.events().insert(calendarId=calendar, body={**_without_nulls(body), 'id': identifier})
    if kind == 'patch':
        return service.events().patch(calendarId=calendar, eventId=identifier, body={**body, 'status': 'confirmed'})
    return service.events().delete(calendarId=calendar, eventId=identifier)


def _batch(service, calendar, ops):
    answers = {}

    def done(request_id, answer, error):
        answers[request_id] = (answer, error)

    for start in range(0, len(ops), BATCH):
        batch = service.new_batch_http_request(callback=done)
        for op in ops[start:start + BATCH]:
            batch.add(_request(service, calendar, op), request_id=op[1])
        batch.execute()
    return answers


def _apply(service, state, ops):
    """Sends the planned changes. An id that is taken was an earlier try that arrived, it is patched. An entry that was
    deleted in Google cannot come back under its id, it gets the next generation."""
    calendar, events = state['calendar'], state['events']
    limited = False
    for _ in range(PASSES):
        if not ops:
            break
        answers = _batch(service, calendar, ops)
        again = []
        for op in ops:
            kind, key, day, body, digest, identifier, generation = op
            if key not in answers:
                continue
            answer, error = answers[key]
            status = _status_of(error) if error is not None else None
            if error is None and kind == 'delete':
                events.pop(key, None)
            elif error is None and (answer or {}).get('status') != 'cancelled':
                events[key] = {'id': identifier, 'hash': digest, 'day': day, 'gen': generation}
            elif error is None or (kind == 'patch' and status in GONE):
                again.append(('insert', key, day, body, digest, event_id(calendar, key, generation + 1), generation + 1))
            elif kind == 'insert' and status == 409:
                again.append(('patch', key, day, body, digest, identifier, generation))
            elif kind == 'delete' and status in GONE:
                events.pop(key, None)
            elif kind == 'insert' and status == 404:
                raise CalendarGone()
            elif _limited(error):
                limited = True
            else:
                log.warning('School calendar entry not sent: %s', status)
        ops = again
    if limited:
        raise Limited()


def _find(service):
    """The calendar made here before, found by its name. Also gives the time zone of the main calendar for a new one."""
    found, zone, token = None, None, None
    while True:
        page = service.calendarList().list(pageToken=token).execute()
        for item in page.get('items', []):
            if item.get('primary'):
                zone = item.get('timeZone')
            if not found and item.get('summary') == NAME and item.get('accessRole') == 'owner':
                found = item.get('id')
        token = page.get('nextPageToken')
        if not token:
            return found, zone


def _ensure(service, state, today):
    """The calendar of the entries, made once. A day later it is looked for again, it may have been deleted in Google."""
    if state.get('calendar'):
        if state.get('seen') != today.isoformat():
            try:
                service.calendarList().get(calendarId=state['calendar']).execute()
            except Exception as error:
                if _status_of(error) in GONE:
                    raise CalendarGone() from error
                raise
            state['seen'] = today.isoformat()
        return state['calendar']
    found, zone = _find(service)
    if not found:
        found = service.calendars().insert(body=_without_nulls({'summary': NAME, 'description': DESCRIPTION, 'timeZone': zone})).execute()['id']
    state.update(calendar=found, seen=today.isoformat())
    return found


def _commit(epoch, state):
    """Keeps the result of a round, unless it was switched on or off meanwhile: then that newer choice wins."""
    with _state_lock:
        if _read().get('epoch', 0) == epoch:
            _write(state)


def _pause(state, problem):
    misses = state.get('misses', 0)
    state.update(problem=problem, misses=misses + 1, pause_until=time.time() + BACKOFF[min(misses, len(BACKOFF) - 1)])


def run(today=None):
    """One round: the calendar, then only the entries that differ from what was sent. Returns the problem, if any."""
    with _round_lock:
        return _run(today or date.today())


def _run(today):
    state = _read()
    epoch = state.get('epoch', 0)
    google = _google()
    account = _account()
    if not account or google.login_expired(account) or not (state.get('on') or state.get('remove')):
        return None
    if state.get('account') not in (None, account):
        return None
    service, email = google.calendar_service()
    if service is None or email != account:
        _pause(state, 'offline')
        _commit(epoch, state)
        return 'offline'
    if not google.can('school', account):
        _pause(state, 'scope')
        _commit(epoch, state)
        return 'scope'
    try:
        if state.get('remove'):
            try:
                service.calendars().delete(calendarId=state['remove']).execute()
            except Exception as error:
                if _status_of(error) not in GONE:
                    raise
            state['remove'] = None
        if state.get('on'):
            new = not state.get('calendar')
            _ensure(service, state, today)
            if new:
                _commit(epoch, state)
            ops = _plan(state, wanted(today), today)
            if ops:
                _apply(service, state, ops)
            state['stand'] = datetime.now().strftime('%Y-%m-%dT%H:%M')
        state.update(problem=None, misses=0, pause_until=None, day=today.isoformat(), last=time.time())
    except CalendarGone:
        state.update(on=False, calendar=None, events={}, notice='gone', problem=None, stand=None)
    except Limited:
        _pause(state, 'limit')
    except Exception as error:
        log.warning('School calendar round failed: %s', type(error).__name__)
        if type(error).__name__ == 'RefreshError' and google.refused_for_good(error):
            google.mark_expired(account)
        _pause(state, 'offline')
    _commit(epoch, state)
    return state.get('problem')


def background_round(today=None):
    """Called by the background thread after each look at the Google calendar. A change asks for a round at once,
    otherwise one comes every few minutes and on a new day, when the weeks ahead move on. A pause after a refusal holds."""
    state = _read()
    if not state.get('on') and not state.get('remove'):
        _due['at'] = None
        return False
    now = time.time()
    if now < (state.get('pause_until') or 0):
        return False
    today = today or date.today()
    due = _due['at'] is not None and time.monotonic() >= _due['at']
    rested = state.get('day') == today.isoformat() and 0 <= now - (state.get('last') or 0) < PERIOD_SECONDS
    if not due and not state.get('problem') and rested:
        return False
    _due['at'] = None
    run(today)
    return True
