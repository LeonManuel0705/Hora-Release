# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""A local copy of the connected Google calendar for a window around today.

Pages read the copy, so opening the calendar never waits for Google. A sync
first sends what changed in the app, then asks Google only for what changed
since the last check. Once a day the whole window is loaded again, because the
window moves with the date. Events made in the app keep living in the app and
carry the id of their Google twin, so the twin is never shown a second time.

While the app runs, a background thread checks every few minutes and soon after
a page comes to the front, so the copy is fresh before anyone opens the calendar.
"""

import copy
import json
import logging
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from . import database as db
from . import ui_data
from .crypto_utils import decrypt_file, encrypt_file
from .paths import DATA_DIR

CACHE_FILE = DATA_DIR / 'google_calendar_cache.json'
QUEUE_FILE = DATA_DIR / 'google_calendar_queue.json'
CACHE_VERSION = 2
CONFIRM_LIMIT = 25
OPEN_END = 'horaOpenEnd'
BACK_DAYS = 62
AHEAD_DAYS = 93
CHECK_SECONDS = 60
PERIOD_SECONDS = 300
TICK_SECONDS = 30
RETRY_SECONDS = 60
REQUEST_WAIT = 15
FULL_SECONDS = 20 * 3600
OVERLAP = timedelta(minutes=2)
SOURCE = 'dem Google-Kalender'
KIND_WORDS = (
    ('training', ('training', 'sport', 'gym', 'fitness', 'schwimm', 'verein')),
    ('school', ('schule', 'school', 'iserv', 'kurs', 'uni', 'klasse')),
)
GONE = (404, 410)
CONFLICT = object()

log = logging.getLogger(__name__)

_sync_lock = threading.Lock()
_store_lock = threading.Lock()
_memory_lock = threading.Lock()
_queue_lock = threading.Lock()
_memory = {'signature': None, 'cache': None}
_status = {'checked': None, 'checked_at': None, 'problem': None, 'epoch': 0, 'round': 0, 'misses': 0}
_worker = {'thread': None, 'stop': threading.Event(), 'wake': threading.Event(), 'nudged': False}


def _google():
    from . import google_oauth
    return google_oauth


def _school():
    from . import google_school
    return google_school


def _managed():
    """The calendar the app fills with the school week. The copy leaves it out, the pages show the plan itself."""
    try:
        return _school().managed()
    except Exception:
        return set()


def connected():
    try:
        return bool(_google().calendar_account())
    except Exception:
        return False


def google_settings():
    settings = db.get_ui_store().get('app-settings')
    google = settings.get('google') if isinstance(settings, dict) else None
    return google if isinstance(google, dict) else {}


def write_enabled():
    return google_settings().get('write') is not False


def hidden_calendars():
    calendars = google_settings().get('calendars')
    if not isinstance(calendars, dict):
        return set()
    return {key for key, shown in calendars.items() if shown is False}


def window(today=None):
    today = today or date.today()
    return today - timedelta(days=BACK_DAYS), today + timedelta(days=AHEAD_DAYS)


def _signature():
    try:
        stat = CACHE_FILE.stat()
    except OSError:
        return None
    return stat.st_mtime_ns, stat.st_size


def _load(shared=False):
    signature = _signature()
    if signature is None:
        return None
    with _memory_lock:
        if _memory['signature'] == signature:
            return _memory['cache'] if shared else copy.deepcopy(_memory['cache'])
    try:
        cache = decrypt_file(CACHE_FILE)
    except Exception:
        return None
    if not isinstance(cache, dict) or cache.get('version') != CACHE_VERSION:
        return None
    with _memory_lock:
        _memory.update(signature=signature, cache=copy.deepcopy(cache))
    return cache


def _save(cache):
    encrypt_file(cache, CACHE_FILE)
    with _memory_lock:
        _memory.update(signature=_signature(), cache=copy.deepcopy(cache))


def _queue():
    try:
        value = decrypt_file(QUEUE_FILE)
    except Exception:
        return []
    return value if isinstance(value, list) else []


def forget():
    with _store_lock:
        for path in (CACHE_FILE, QUEUE_FILE):
            try:
                path.unlink()
            except OSError:
                pass
        with _memory_lock:
            _memory.update(signature=None, cache=None)
        _status.update(checked=None, checked_at=None, problem=None, misses=0, epoch=_status['epoch'] + 1)


def _status_of(error):
    return getattr(getattr(error, 'resp', None), 'status', None)


def _unreadable(error):
    """True when this one calendar is gone or closed to the account. Limits and refusals of the whole account are not that."""
    status = _status_of(error)
    if status != 403:
        return status in GONE
    try:
        reasons = {str(entry.get('reason')) for entry in json.loads(getattr(error, 'content', b'') or b'{}')['error']['errors']}
    except Exception:
        reasons = set()
    return reasons == {'forbidden'}


def _stamp(moment):
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _moment(stamp):
    """A stored time as a moment that can be compared. Times without a zone were written here, in local time."""
    try:
        moment = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment.astimezone(timezone.utc)


def _bounds(cache):
    return f"{cache['start']}T00:00:00Z", f"{cache['end']}T23:59:59Z"


def _in_window(view, cache):
    first = view.get('start_date') or ''
    last = view.get('end_date') or first
    return bool(first) and last >= cache['start'] and first <= cache['end']


def _primary(cache):
    for calendar in (cache or {}).get('calendars', []):
        if calendar.get('primary'):
            return calendar.get('id')
    return None


def _load_calendar(service, cache, calendar):
    google = _google()
    time_min, time_max = _bounds(cache)
    items = google.list_calendar_events(service, calendar['id'], timeMin=time_min, timeMax=time_max, singleEvents=True)
    return {
        event['id']: google.calendar_event_view(event, calendar)
        for event in items if event.get('id') and event.get('status') != 'cancelled'
    }


def _pull_full(service, email, today, previous=None):
    """The whole window again. A calendar that cannot be read right now keeps its last copy and is named in the second value."""
    start, end = window(today)
    began = datetime.now(timezone.utc)
    calendars = []
    token = None
    while True:
        page = service.calendarList().list(pageToken=token).execute()
        calendars.extend(page.get('items', []))
        token = page.get('nextPageToken')
        if not token:
            break
    managed = _managed()
    calendars = [item for item in calendars if item.get('id') not in managed]
    cache = {
        'version': CACHE_VERSION,
        'account': email,
        'start': start.isoformat(),
        'end': end.isoformat(),
        'full_at': time.time(),
        'full_day': today.isoformat(),
        'synced_at': _stamp(began - OVERLAP),
        'calendars': [
            {
                'id': item.get('id'), 'summary': item.get('summary', 'Kalender'), 'backgroundColor': item.get('backgroundColor', '#4285f4'),
                'primary': bool(item.get('primary')), 'accessRole': item.get('accessRole') or 'reader',
            }
            for item in calendars if item.get('id')
        ],
        'events': {},
    }
    failed, closed = set(), set()
    for calendar in cache['calendars']:
        try:
            cache['events'][calendar['id']] = _load_calendar(service, cache, calendar)
        except Exception as error:
            log.warning('Google calendar skipped: %s', type(error).__name__)
            (closed if _unreadable(error) else failed).add(calendar['id'])
    if closed and len(closed) == len(cache['calendars']):
        failed, closed = closed, set()
    for name in failed:
        kept = ((previous or {}).get('events') or {}).get(name)
        if kept is not None:
            cache['events'][name] = kept
    if failed:
        cache['partial'] = True
        if previous and previous.get('synced_at'):
            cache['synced_at'] = min(cache['synced_at'], previous['synced_at'])
    return cache, failed


def _pull_changes(service, cache):
    """What changed since the last check. Deleted events and seen ones are named with their calendar, ids repeat across calendars."""
    google = _google()
    began = datetime.now(timezone.utc)
    changed = False
    cancelled = set()
    seen = {}
    closed = []
    managed = _managed()
    for calendar in list(cache['calendars']):
        name = calendar['id']
        if name in managed:
            continue
        try:
            items = google.list_calendar_events(service, name, updatedMin=cache['synced_at'], showDeleted=True, singleEvents=False)
        except Exception as error:
            closed.append(calendar)
            if _status_of(error) == 410 or not _unreadable(error) or len(closed) == len(cache['calendars']):
                raise
            continue
        bucket = cache['events'].setdefault(name, {})
        cancelled.update((name, item['id']) for item in items if item.get('status') == 'cancelled' and item.get('id'))
        if any(item.get('recurrence') or item.get('recurringEventId') for item in items):
            fresh = _load_calendar(service, cache, calendar)
            if fresh != bucket:
                cache['events'][name] = fresh
                changed = True
            continue
        for item in items:
            key = item.get('id')
            if not key:
                continue
            if item.get('status') == 'cancelled':
                changed = bucket.pop(key, None) is not None or changed
                continue
            view = google.calendar_event_view(item, calendar)
            seen[(name, key)] = view
            if not _in_window(view, cache):
                changed = bucket.pop(key, None) is not None or changed
            elif bucket.get(key) != view:
                bucket[key] = view
                changed = True
    for calendar in closed:
        cache['calendars'].remove(calendar)
        changed = cache['events'].pop(calendar['id'], None) is not None or changed
    cache['synced_at'] = _stamp(began - OVERLAP)
    return changed, cancelled, seen


def _body(item):
    """The event as Google stores it. Both forms of start and end are named, a patch would otherwise keep the old one beside the new."""
    body = {'summary': item.get('title') or 'Termin', 'description': item.get('description') or '', 'location': item.get('location') or ''}
    first = item['date']
    last = max(item.get('end_date') or first, first)
    start, end = ui_data.clock(item.get('time')), ui_data.clock(item.get('end_time'))
    if start:
        begin = datetime.fromisoformat(f'{first}T{start}:00')
        finish = datetime.fromisoformat(f'{last}T{end}:00') if end else begin + timedelta(hours=1)
        if finish <= begin:
            finish = begin + timedelta(hours=1)
        body['start'] = {'dateTime': begin.astimezone().isoformat(), 'date': None}
        body['end'] = {'dateTime': finish.astimezone().isoformat(), 'date': None}
    else:
        body['start'] = {'date': first, 'dateTime': None, 'timeZone': None}
        body['end'] = {'date': (date.fromisoformat(last) + timedelta(days=1)).isoformat(), 'dateTime': None, 'timeZone': None}
    body['extendedProperties'] = {'private': {OPEN_END: '1' if start and not end else None}}
    return body


def _without_nulls(value):
    if isinstance(value, dict):
        return {key: _without_nulls(item) for key, item in value.items() if item is not None}
    return value


def _mark(item_id, stamp, values):
    """Writes the link fields of one event. The pending flag goes only when the event was not changed since `stamp`."""
    def change(items):
        for item in items:
            if str(item.get('id')) == item_id:
                for key, value in values.items():
                    if value is None:
                        item.pop(key, None)
                    else:
                        item[key] = value
                if stamp is not None and (item.get('updated_at') or item.get('created_at')) == stamp:
                    item.pop('google_dirty', None)
                return True
        return False
    return ui_data.modify_list('calendar', change)


def _enqueue_delete(calendar, key):
    with _queue_lock:
        encrypt_file([*_queue(), {'calendar': calendar or 'primary', 'id': key}], QUEUE_FILE)


def _push_deletes(service, target):
    with _queue_lock:
        queue = _queue()
    done = []
    for entry in queue:
        try:
            service.events().delete(calendarId=entry.get('calendar') or target, eventId=entry['id']).execute()
        except Exception as error:
            if _status_of(error) not in GONE:
                continue
        done.append(entry)
    if done:
        with _queue_lock:
            waiting = [entry for entry in _queue() if entry not in done]
            if waiting:
                encrypt_file(waiting, QUEUE_FILE)
            else:
                QUEUE_FILE.unlink(missing_ok=True)
    return bool(done)


def _patch(service, calendar, key, body, etag=None):
    """The changed event, None when Google no longer has it, CONFLICT when it changed there since `etag`."""
    request = service.events().patch(calendarId=calendar, eventId=key, body=body)
    if etag:
        request.headers['If-Match'] = etag
    try:
        answer = request.execute()
    except Exception as error:
        if _status_of(error) in GONE:
            return None
        if etag and _status_of(error) == 412:
            return CONFLICT
        raise
    return None if answer.get('status') == 'cancelled' else answer


def _insert(service, calendar, key, body):
    """The new event under an id chosen here. If the id is taken, an earlier try arrived and only its answer was lost."""
    try:
        return service.events().insert(calendarId=calendar, body={**_without_nulls(body), 'id': key}).execute()
    except Exception as error:
        if _status_of(error) != 409:
            raise
    return _patch(service, calendar, key, body)


def _there(service, calendar, key):
    """The event as Google has it now, a deleted one included. None when it has none under this id."""
    try:
        return service.events().get(calendarId=calendar, eventId=key).execute()
    except Exception as error:
        if _status_of(error) not in GONE:
            raise
        return None


def _newer(event, item):
    """True when the change Google has is newer than the one waiting here."""
    here, there = _moment(item.get('updated_at') or item.get('created_at')), _moment(event.get('updated'))
    return bool(here and there and there > here)


def _give_way(item_id, stamp, event, calendar):
    """The change made in Google is the newer one: it replaces the edit that was waiting here."""
    def change(items):
        for item in items:
            if str(item.get('id')) != item_id:
                continue
            if (item.get('updated_at') or item.get('created_at')) != stamp:
                return False
            if event.get('status') == 'cancelled':
                items.remove(item)
                return True
            view = _google().calendar_event_view(event, calendar)
            item.update(_local_fields(view), google_seen=view.get('updated') or '', google_etag=view.get('etag') or '')
            item.pop('google_dirty', None)
            return True
        return False
    return ui_data.modify_list('calendar', change)


def _send(service, item, target):
    """Brings one changed event to Google. Returns (id, calendar, event), or None when nothing was written there.

    An event Google already has is only overwritten in the state that was
    compared: the one of the last sync, or else the one Google names when it is
    asked. A link from before the etag was kept is asked about first. If the
    event changes there in that very moment, the edit waits for the next round.
    """
    key, stamp = str(item.get('id')), item.get('updated_at') or item.get('created_at')
    body = _body(item)
    remote = item.get('google_id')
    calendar = item.get('google_calendar') or target
    fresh = bool(item.get('google_new')) or not remote
    answer = None
    if not fresh:
        etag = item.get('google_etag')
        answer = _patch(service, calendar, remote, body, etag) if etag else CONFLICT
    if answer is CONFLICT or (answer is None and not fresh):
        theirs = _there(service, calendar, remote)
        if theirs is not None and _newer(theirs, item) and _give_way(key, stamp, theirs, {'id': calendar}):
            return None
        answer = None
        if theirs is not None and theirs.get('status') != 'cancelled':
            answer = _patch(service, calendar, remote, body, theirs.get('etag'))
            if answer is CONFLICT:
                return None
    for _ in range(2):
        if answer is not None:
            break
        if not fresh or not remote:
            remote = uuid.uuid4().hex
            if not _mark(key, None, {'google_id': remote, 'google_calendar': target, 'google_new': True, 'google_seen': None, 'google_etag': None}):
                return None
        fresh, calendar = False, target
        answer = _insert(service, calendar, remote, body)
    return (remote, calendar, answer) if answer is not None else None


def target_calendar(cache, account=None):
    """Where new events go: the calendar chosen in the settings while the account may still write to it, else the main one.
    Events already in Google stay in the calendar they were written to."""
    chosen = google_settings().get('target')
    for calendar in (cache or {}).get('calendars', []):
        if chosen and calendar['id'] == chosen and _writable(calendar):
            return chosen
    return _primary(cache) or account or 'primary'


def _push(service, cache, account=None):
    if not write_enabled():
        return False
    target = target_calendar(cache, account)
    sent = _push_deletes(service, target)
    for item in ui_data.load_list('calendar'):
        if not item.get('google_dirty') or not ui_data.iso_day(item.get('date')) or not _own_account(account, item):
            continue
        stamp = item.get('updated_at') or item.get('created_at')
        try:
            result = _send(service, item, target)
        except Exception as error:
            log.warning('Event not sent to Google: %s', type(error).__name__)
            continue
        sent = True
        if result is None:
            continue
        remote, calendar, answer = result
        values = {
            'google_id': remote, 'google_calendar': calendar, 'google_new': None,
            'google_seen': answer.get('updated') or '', 'google_etag': answer.get('etag'),
        }
        # Only its own calendar ties a link to the account. One that it may merely write to belongs to someone else.
        if calendar in ('primary', target):
            values['google_account'] = account
        if not _mark(str(item.get('id')), stamp, values):
            _enqueue_delete(calendar, remote)
    return sent


def _own_account(account, item):
    """Links made with another Google account are left alone until that account is back."""
    return not item.get('google_account') or not account or item['google_account'] == account


def _calendar_of(cache, item):
    calendar = item.get('google_calendar')
    return _primary(cache) if calendar in (None, 'primary') else calendar


def _lookup(cache, item):
    return (cache.get('events', {}).get(_calendar_of(cache, item)) or {}).get(item.get('google_id'))


def _local_fields(view):
    last = view.get('end_date') or view.get('start_date')
    if view.get('all_day') and last:
        last = (date.fromisoformat(last) - timedelta(days=1)).isoformat()
    first = view.get('start_date')
    timed = not view.get('all_day')
    open_end = timed and view.get('open_end')
    return {
        'title': view.get('title') or 'Termin',
        'date': first,
        'end_date': last if last and last > first and not open_end else '',
        'time': ui_data.clock(view.get('start_time')) or '' if timed else '',
        'end_time': ui_data.clock(view.get('end_time')) or '' if timed and not open_end else '',
        'location': view.get('location') or '',
        'description': view.get('description') or '',
    }


def _settled(item):
    return item.get('google_id') and not item.get('google_dirty') and not item.get('google_new')


def _adopt(cache, cancelled, seen):
    """Takes over what was changed or deleted in Google for events the app wrote there, never what was changed here since."""
    def change(items):
        changed = False
        for item in list(items):
            if not _settled(item) or not _own_account(cache.get('account'), item):
                continue
            key = (_calendar_of(cache, item), item['google_id'])
            if key in cancelled:
                items.remove(item)
                changed = True
                continue
            view = seen.get(key) or _lookup(cache, item)
            if not view:
                continue
            if (view.get('updated') or '') > (item.get('google_seen') or ''):
                fields = {**_local_fields(view), 'google_seen': view.get('updated') or '', 'google_etag': view.get('etag') or ''}
            elif view.get('updated') == item.get('google_seen') and view.get('etag') and not item.get('google_etag'):
                fields = {'google_etag': view['etag']}
            else:
                fields = {}
            if not item.get('google_account') and cache.get('account') and key[0] == _primary(cache):
                fields['google_account'] = cache['account']
            if any((item.get(name) or '') != value for name, value in fields.items()):
                item.update(fields)
                changed = True
        return changed
    if not any(item.get('google_id') for item in ui_data.load_list('calendar')):
        return False
    return ui_data.modify_list('calendar', change)


def _confirm_missing(service, cache, previous, failed, cancelled, seen):
    """Linked events the fresh copy lacks. Google is asked about each one, so only a deletion it confirms is taken over.

    An event it still has (moved far away, turned into a series) is noted for the day and not asked about again.
    """
    names = {calendar['id']: calendar for calendar in cache['calendars']}
    same_day = previous and previous.get('full_day') == cache['full_day'] and previous.get('account') == cache['account']
    present = dict(previous.get('present') or {}) if same_day else {}
    asked = 0
    for item in ui_data.load_list('calendar'):
        if not _settled(item) or not _own_account(cache['account'], item):
            continue
        calendar = _calendar_of(cache, item)
        key = (calendar, item['google_id'])
        day = ui_data.iso_day(item.get('date'))
        if calendar in failed or calendar not in cache['events'] or key in cancelled or key in seen or item['google_id'] in cache['events'][calendar]:
            continue
        if not day or not cache['start'] < day < cache['end'] or item['google_id'] in present or asked >= CONFIRM_LIMIT:
            continue
        asked += 1
        try:
            event = service.events().get(calendarId=calendar, eventId=item['google_id']).execute()
        except Exception as error:
            if _status_of(error) in GONE and item.get('google_account') == cache['account']:
                cancelled.add(key)
            continue
        if event.get('status') == 'cancelled':
            cancelled.add(key)
        else:
            seen[key] = _google().calendar_event_view(event, names.get(calendar) or {'id': calendar})
            present[item['google_id']] = True
    cache['present'] = present


def sync(full=False, today=None, wait=None):
    """One check. With `wait` a page is asking: it waits that long at most for a check that is already running, and takes
    that one's result instead of asking Google a second time."""
    if not connected():
        return None
    before = _status['round']
    if not _sync_lock.acquire(timeout=-1 if wait is None else wait):
        return _status['problem']
    try:
        if wait is not None and not full and _status['round'] != before:
            return _status['problem']
        return _sync(full, today or date.today())
    finally:
        _sync_lock.release()


def _settle(problem):
    misses = _status['misses'] + 1 if problem == 'offline' else 0
    _status.update(checked=time.monotonic(), checked_at=time.time(), problem=problem, round=_status['round'] + 1, misses=misses)
    return problem


def _sync(full, today):
    epoch = _status['epoch']
    try:
        service, email = _google().calendar_service()
    except Exception:
        service, email = None, None
    if service is None:
        return _settle('login' if not connected() or _google().login_expired(email) else 'offline')
    cache = _load()
    try:
        known = cache is not None and cache.get('account') == email
        stale = (
            not known or cache.get('partial') or cache.get('full_day') != today.isoformat()
            or time.time() - float(cache.get('full_at') or 0) > FULL_SECONDS
            or any('accessRole' not in calendar for calendar in cache.get('calendars', []))
        )
        _push(service, cache if known else None, email)
        changed, cancelled, seen, failed = False, set(), {}, set()
        if known:
            try:
                changed, cancelled, seen = _pull_changes(service, cache)
            except Exception as error:
                if not (full or stale or _status_of(error) in (400, 410)):
                    raise
                stale = True
        if full or stale:
            previous = cache if known else None
            cache, failed = _pull_full(service, email, today, previous)
            changed = True
            _confirm_missing(service, cache, previous, failed, cancelled, seen)
        with _store_lock:
            if _status['epoch'] != epoch:
                return None
            _adopt(cache, cancelled, seen)
            if changed:
                _save(cache)
            else:
                with _memory_lock:
                    if _memory['cache'] is not None:
                        _memory['cache']['synced_at'] = cache['synced_at']
        return _settle('offline' if failed else None)
    except Exception as error:
        log.warning('Google calendar sync failed: %s', type(error).__name__)
        if type(error).__name__ != 'RefreshError':
            return _settle('offline')
        if email and _google().refused_for_good(error):
            _google().mark_expired(email)
        return _settle('login')


def _checked_lately(seconds=CHECK_SECONDS):
    """Both clocks have to agree: the monotonic one stands still while the computer sleeps, the wall clock can be set back."""
    checked, stamp = _status['checked'], _status['checked_at']
    if checked is None or stamp is None:
        return False
    return time.monotonic() - checked < seconds and 0 <= time.time() - stamp < seconds


def refresh(force=False):
    if not connected():
        return None
    if _google().login_expired():
        return 'login'
    if not force and _load(shared=True) is not None and _checked_lately():
        return _status['problem']
    return sync(full=force, wait=REQUEST_WAIT)


def due():
    return connected() and (_load(shared=True) is None or not _checked_lately())


def start_background():
    """Keeps the copy fresh while the app runs. Only the running app starts it, an import never does, so tests run without it."""
    thread = _worker['thread']
    if thread is not None and thread.is_alive():
        return thread
    _worker['stop'].clear()
    thread = threading.Thread(target=_background, name='calendar-sync', daemon=True)
    _worker['thread'] = thread
    thread.start()
    return thread


def stop_background(timeout=5):
    thread, _worker['thread'] = _worker['thread'], None
    _worker['stop'].set()
    _worker['wake'].set()
    if thread is not None and thread is not threading.current_thread():
        thread.join(timeout)


def nudge():
    """A page came to the front. The next check follows at once, but never sooner than CHECK_SECONDS after the last one."""
    _worker['nudged'] = True
    _worker['wake'].set()


def wake():
    _worker['wake'].set()


def _background():
    stop, wake = _worker['stop'], _worker['wake']
    while not stop.is_set():
        for job in (background_round, _school().background_round):
            try:
                job()
            except Exception as error:
                log.warning('Background calendar job failed: %s', type(error).__name__)
        soon = _school().seconds_until_due()
        wake.wait(TICK_SECONDS if soon is None else min(TICK_SECONDS, max(soon, 0.05)))
        wake.clear()


def _pause():
    """How long the copy may rest. Without network the next try comes sooner, with a pause that grows up to the period."""
    if _status['problem'] != 'offline':
        return PERIOD_SECONDS
    return min(PERIOD_SECONDS, RETRY_SECONDS * 2 ** max(0, _status['misses'] - 1))


def background_round():
    """One look at the clock, made every TICK_SECONDS. The wall clock decides, because it runs on while the computer sleeps.
    An expired sign-in is never tried again, it stays expired until the account is connected anew."""
    nudged, _worker['nudged'] = _worker['nudged'], False
    if not connected() or _google().login_expired():
        return False
    stamp = _status['checked_at']
    if stamp is not None:
        rest = min(_pause(), CHECK_SECONDS) if nudged else _pause()
        if 0 <= time.time() - stamp < rest:
            return False
    sync()
    return True


def push_soon():
    if not connected():
        return

    def run():
        with _sync_lock:
            try:
                service, email = _google().calendar_service()
                if service is None:
                    return
                cache = _load()
                _push(service, cache if cache and cache.get('account') == email else None, email)
            except Exception as error:
                log.warning('Google calendar push failed: %s', type(error).__name__)

    _spawn(run)


def _spawn(run):
    threading.Thread(target=run, name='calendar-push', daemon=True).start()


def touch(item):
    """Marks an event that was made or changed here. True when it should be sent now."""
    sending = connected() and write_enabled()
    if not item.get('google_id'):
        if not sending:
            return False
        item['google_id'] = uuid.uuid4().hex
        item['google_new'] = True
    item['google_dirty'] = True
    return sending


def drop(item):
    remote = item.get('google_id')
    if not remote or not connected() or not write_enabled():
        return False
    _enqueue_delete(item.get('google_calendar'), remote)
    return True


def waits_elsewhere(item):
    """True for a changed event whose Google twin belongs to an account other than the one the calendar uses, the first stored one."""
    account = item.get('google_account')
    if not account or not item.get('google_dirty'):
        return False
    try:
        return account != _google().calendar_account()
    except Exception:
        return False


def configured():
    """True where this installation can sign in to Google at all. Released apps bring no OAuth client of their own."""
    try:
        return bool(_google().is_google_oauth_configured())
    except Exception:
        return False


def settings_view():
    """What Settings shows about Google, read from the copy so the page never waits for Google."""
    google = _google()
    tokens = google.load_tokens()
    account = google.calendar_account(tokens)
    view = {'configured': configured(), 'connected': bool(account), 'account': account or '', 'calendars': []}
    if not account:
        return view
    scopes = google.scopes_of(tokens[account])
    cache = _load(shared=True) or {}
    view.update(
        state=page_state()['google'],
        stand=stand(),
        gmail=google.covers(scopes, 'gmail'),
        calendars=[
            {
                'id': item['id'], 'name': item.get('summary') or 'Kalender', 'color': item.get('backgroundColor') or '',
                'primary': bool(item.get('primary')), 'writable': _writable(item),
            }
            for item in cache.get('calendars', []) if cache.get('account') == account
        ],
        target=target_calendar(cache if cache.get('account') == account else None, account),
        school=_school().view(),
        may_make_calendars=google.covers(scopes, 'school'),
    )
    return view


def page_state():
    """How the copy stands, in the words of the pages: no Google, fine, signed out, or out of reach."""
    if not connected():
        return {'google': None, 'stand': None}
    if _google().login_expired() or _status['problem'] == 'login':
        google = 'login'
    else:
        google = 'offline' if _status['problem'] == 'offline' else 'ok'
    return {'google': google, 'stand': stand()}


def stand():
    cache = _load(shared=True)
    if not cache or not cache.get('synced_at'):
        return None
    try:
        moment = datetime.strptime(cache['synced_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc) + OVERLAP
    except ValueError:
        return None
    return moment.astimezone().strftime('%Y-%m-%dT%H:%M')


def kind_of(*texts):
    text = ' '.join(str(item or '') for item in texts).casefold()
    for kind, words in KIND_WORDS:
        if any(word in text for word in words):
            return kind
    return 'private'


def view(item):
    day = ui_data.iso_day(item.get('start_date'))
    if not day:
        return None
    last = ui_data.iso_day(item.get('end_date'))
    if item.get('all_day') and last:
        last = (date.fromisoformat(last) - timedelta(days=1)).isoformat()
    elif item.get('open_end'):
        last = None
    result = {
        'id': f"g-{item.get('calendar_id', '')}-{item.get('id', '')}",
        'date': day,
        'start': None if item.get('all_day') else ui_data.clock(item.get('start_time')),
        'end': None if item.get('all_day') or item.get('open_end') else ui_data.clock(item.get('end_time')),
        'title': str(item.get('title') or 'Termin'),
        'place': str(item.get('location') or ''),
        'kind': kind_of(item.get('calendar'), item.get('title')),
        'notes': str(item.get('description') or '')[:2000],
        'source': SOURCE,
        'synced': True,
    }
    if last and last > day:
        result['endDate'] = last
    return result


def events(start, end):
    cache = _load(shared=True)
    if not cache:
        return []
    hidden = hidden_calendars()
    linked = {item.get('google_id') for item in ui_data.load_list('calendar') if item.get('google_id')}
    calendars = {calendar['id']: calendar for calendar in cache.get('calendars', [])}
    open_to_edits = _open_to_edits(cache)
    hidden = hidden | _managed()
    result = []
    for calendar_id, bucket in cache.get('events', {}).items():
        if calendar_id in hidden:
            continue
        editable = open_to_edits and _writable(calendars.get(calendar_id))
        for key, item in bucket.items():
            if key in linked:
                continue
            shown = view(item)
            if shown and (shown.get('endDate') or shown['date']) >= start and shown['date'] <= end:
                shown['editable'] = editable
                result.append(shown)
    result.sort(key=lambda item: (item['date'], item['start'] or ''))
    return result


def _writable(calendar):
    return bool(calendar) and calendar.get('accessRole') in ('owner', 'writer')


def _open_to_edits(cache):
    """Google events can be changed here only while the account of the copy is signed in, may write, and Google answers."""
    google = _google()
    try:
        account = google.calendar_account()
        return (
            bool(account) and account == cache.get('account') and google.can('write', account)
            and not google.login_expired(account) and _status['problem'] is None
        )
    except Exception:
        return False


class Refusal(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


READ_ONLY = 'Diesen Termin kannst du nur lesen, der Kalender ist schreibgeschützt.'
SIGNED_OUT = 'Die Anmeldung bei Google ist abgelaufen. Verbinde Google in den Einstellungen neu.'
UNREACHABLE = 'Google ist gerade nicht erreichbar. Die Änderung ist nicht gespeichert.'
CHANGED_THERE = 'Der Termin wurde gerade in Google geändert. Schau ihn dir noch einmal an.'
GONE_THERE = 'Den Termin gibt es in Google nicht mehr.'
NOTES_SHOWN = 2000


def _locate(cache, ref):
    for calendar in cache.get('calendars', []):
        prefix = f"g-{calendar['id']}-"
        if str(ref).startswith(prefix):
            key = str(ref)[len(prefix):]
            item = (cache.get('events', {}).get(calendar['id']) or {}).get(key)
            if item:
                return calendar, key, item
    return None, None, None


def _reachable(ref):
    """The Google event behind a page id, with a service that may change it. Refuses what cannot be changed right now."""
    if not connected():
        raise Refusal('Google ist nicht verbunden.', 409)
    cache = _load()
    calendar, key, item = _locate(cache or {}, ref)
    if not item:
        raise Refusal('Termin nicht gefunden', 404)
    google = _google()
    if google.login_expired():
        raise Refusal(SIGNED_OUT)
    if not _writable(calendar) or not google.can('write'):
        raise Refusal(READ_ONLY, 403)
    try:
        service, email = google.calendar_service()
    except Exception:
        service, email = None, None
    if service is None:
        if google.login_expired(email):
            raise Refusal(SIGNED_OUT)
        raise Refusal(UNREACHABLE, 503)
    if email != cache.get('account'):
        raise Refusal(READ_ONLY, 403)
    return calendar, key, item, service


def _kept_notes(before, after):
    """Pages see only the first NOTES_SHOWN characters of a description. Sent back unchanged, the rest must not get lost."""
    full = before.get('description') or ''
    if len(full) > NOTES_SHOWN and after.get('description') == full[:NOTES_SHOWN]:
        after['description'] = full


def _answer_of(request, calendar, key, service):
    try:
        return request.execute()
    except Exception as error:
        status = _status_of(error)
        if status == 412:
            if _refetch(service, calendar, key):
                raise Refusal(CHANGED_THERE) from error
            raise Refusal(GONE_THERE, 404) from error
        if status in GONE:
            _keep(calendar['id'], key, None)
            raise Refusal(GONE_THERE, 404) from error
        if status in (401, 403):
            raise Refusal(READ_ONLY, 403) from error
        if type(error).__name__ == 'RefreshError':
            raise Refusal(SIGNED_OUT) from error
        raise Refusal(UNREACHABLE, 503) from error


def edit_remote(ref, change):
    """Writes a change of a Google event straight to Google, onto the very state the copy shows, and keeps the answer in the copy.

    Only what the form changed is sent, so what the page cannot show stays as it is: a long description, a time zone, guests.
    """
    calendar, key, item, service = _reachable(ref)
    before = _local_fields(item)
    after = dict(before)
    change(after)
    _kept_notes(before, after)
    old, new = _body(before), _body(after)
    body = {name: value for name, value in new.items() if value != old.get(name)}
    if not body:
        return _shown(item, calendar)
    request = service.events().patch(calendarId=calendar['id'], eventId=key, body=body)
    if item.get('etag'):
        request.headers['If-Match'] = item['etag']
    fresh = _google().calendar_event_view(_answer_of(request, calendar, key, service), calendar)
    _keep(calendar['id'], key, fresh)
    return _shown(fresh, calendar)


def delete_remote(ref):
    calendar, key, item, service = _reachable(ref)
    request = service.events().delete(calendarId=calendar['id'], eventId=key)
    if item.get('etag'):
        request.headers['If-Match'] = item['etag']
    try:
        _answer_of(request, calendar, key, service)
    except Refusal as refusal:
        if refusal.status != 404:
            raise
    _keep(calendar['id'], key, None)


def _shown(item, calendar):
    shown = view(item)
    if shown:
        shown['editable'] = True
    return shown


def _refetch(service, calendar, key):
    """Takes what Google has now into the copy. False when Google no longer has the event."""
    try:
        event = _there(service, calendar['id'], key)
    except Exception:
        return True
    fresh = None if event is None or event.get('status') == 'cancelled' else _google().calendar_event_view(event, calendar)
    _keep(calendar['id'], key, fresh)
    return fresh is not None


def _keep(calendar_id, key, fresh):
    """Puts Google's answer into the copy at once. A check that is running then drops its older result."""
    with _store_lock:
        cache = _load()
        if cache is None or calendar_id not in cache.get('events', {}):
            return
        bucket = cache['events'][calendar_id]
        if fresh is None:
            bucket.pop(key, None)
        elif _in_window(fresh, cache):
            bucket[key] = fresh
        else:
            bucket.pop(key, None)
        _status['epoch'] += 1
        _save(cache)


def covers(start, end):
    cache = _load(shared=True)
    return bool(cache) and cache['start'] <= start and end <= cache['end']
