# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

"""A local copy of the connected Google calendar for a window around today.

Pages read the copy, so opening the calendar never waits for Google. A sync
first sends what changed in the app, then asks Google only for what changed
since the last check. Once a day the whole window is loaded again, because the
window moves with the date. Events made in the app keep living in the app and
carry the id of their Google twin, so the twin is never shown a second time.
"""

import copy
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone

from . import database as db
from . import ui_data
from .crypto_utils import decrypt_file, encrypt_file
from .paths import DATA_DIR

CACHE_FILE = DATA_DIR / 'google_calendar_cache.json'
QUEUE_FILE = DATA_DIR / 'google_calendar_queue.json'
CACHE_VERSION = 1
BACK_DAYS = 62
AHEAD_DAYS = 93
CHECK_SECONDS = 60
FULL_SECONDS = 20 * 3600
OVERLAP = timedelta(minutes=2)
SOURCE = 'dem Google-Kalender'
KIND_WORDS = (
    ('training', ('training', 'sport', 'gym', 'fitness', 'schwimm', 'verein')),
    ('school', ('schule', 'school', 'iserv', 'kurs', 'uni', 'klasse')),
)
GONE = (404, 410)

log = logging.getLogger(__name__)

_sync_lock = threading.Lock()
_memory_lock = threading.Lock()
_queue_lock = threading.Lock()
_memory = {'signature': None, 'cache': None}
_status = {'checked': None, 'problem': None}


def _google():
    from . import google_oauth
    return google_oauth


def connected():
    try:
        return bool(_google().load_tokens())
    except Exception:
        return False


def write_enabled():
    settings = db.get_ui_store().get('app-settings')
    google = settings.get('google') if isinstance(settings, dict) else None
    return not (isinstance(google, dict) and google.get('write') is False)


def hidden_calendars():
    settings = db.get_ui_store().get('app-settings')
    google = settings.get('google') if isinstance(settings, dict) else None
    calendars = google.get('calendars') if isinstance(google, dict) else None
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
    for path in (CACHE_FILE, QUEUE_FILE):
        try:
            path.unlink()
        except OSError:
            pass
    with _memory_lock:
        _memory.update(signature=None, cache=None)
    _status.update(checked=None, problem=None)


def _status_of(error):
    return getattr(getattr(error, 'resp', None), 'status', None)


def _stamp(moment):
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


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


def _pull_full(service, email, today):
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
    cache = {
        'version': CACHE_VERSION,
        'account': email,
        'start': start.isoformat(),
        'end': end.isoformat(),
        'full_at': time.time(),
        'full_day': today.isoformat(),
        'synced_at': _stamp(began - OVERLAP),
        'calendars': [
            {'id': item.get('id'), 'summary': item.get('summary', 'Kalender'), 'backgroundColor': item.get('backgroundColor', '#4285f4'), 'primary': bool(item.get('primary'))}
            for item in calendars if item.get('id')
        ],
        'events': {},
    }
    for calendar in cache['calendars']:
        try:
            cache['events'][calendar['id']] = _load_calendar(service, cache, calendar)
        except Exception as error:
            log.warning('Google calendar skipped: %s', type(error).__name__)
    return cache


def _pull_changes(service, cache):
    google = _google()
    began = datetime.now(timezone.utc)
    changed = False
    cancelled = set()
    seen = {}
    for calendar in cache['calendars']:
        bucket = cache['events'].setdefault(calendar['id'], {})
        items = google.list_calendar_events(service, calendar['id'], updatedMin=cache['synced_at'], showDeleted=True, singleEvents=False)
        if any(item.get('recurrence') or item.get('recurringEventId') for item in items):
            fresh = _load_calendar(service, cache, calendar)
            if fresh != bucket:
                cache['events'][calendar['id']] = fresh
                changed = True
            cancelled.update(item['id'] for item in items if item.get('status') == 'cancelled' and item.get('id'))
            continue
        for item in items:
            key = item.get('id')
            if not key:
                continue
            if item.get('status') == 'cancelled':
                cancelled.add(key)
                changed = bucket.pop(key, None) is not None or changed
                continue
            view = google.calendar_event_view(item, calendar)
            seen[key] = view
            if not _in_window(view, cache):
                changed = bucket.pop(key, None) is not None or changed
            elif bucket.get(key) != view:
                bucket[key] = view
                changed = True
    cache['synced_at'] = _stamp(began - OVERLAP)
    return changed, cancelled, seen


def _body(item):
    body = {'summary': item.get('title') or 'Termin', 'description': item.get('description') or '', 'location': item.get('location') or ''}
    first = item['date']
    last = max(item.get('end_date') or first, first)
    start, end = ui_data.clock(item.get('time')), ui_data.clock(item.get('end_time'))
    if start:
        begin = datetime.fromisoformat(f'{first}T{start}:00')
        finish = datetime.fromisoformat(f'{last}T{end}:00') if end else begin + timedelta(hours=1)
        if finish <= begin:
            finish = begin + timedelta(hours=1)
        body['start'] = {'dateTime': begin.astimezone().isoformat()}
        body['end'] = {'dateTime': finish.astimezone().isoformat()}
    else:
        body['start'] = {'date': first}
        body['end'] = {'date': (date.fromisoformat(last) + timedelta(days=1)).isoformat()}
    return body


def _mark(item_id, stamp, values):
    def change(items):
        for item in items:
            if str(item.get('id')) == item_id:
                item.update(values)
                if (item.get('updated_at') or item.get('created_at')) == stamp:
                    item.pop('google_dirty', None)
                return True
        return False
    return ui_data.modify_list('calendar', change)


def _push_deletes(service, target):
    with _queue_lock:
        queue = _queue()
        if not queue:
            return False
        waiting = []
        for entry in queue:
            try:
                service.events().delete(calendarId=entry.get('calendar') or target, eventId=entry['id']).execute()
            except Exception as error:
                if _status_of(error) not in GONE:
                    waiting.append(entry)
        if waiting:
            encrypt_file(waiting, QUEUE_FILE)
        else:
            QUEUE_FILE.unlink()
        return len(waiting) < len(queue)


def _push(service, cache):
    target = _primary(cache) or 'primary'
    sent = _push_deletes(service, target)
    if not write_enabled():
        return sent
    for item in ui_data.load_list('calendar'):
        if not item.get('google_dirty') or not ui_data.iso_day(item.get('date')):
            continue
        stamp = item.get('updated_at') or item.get('created_at')
        body = _body(item)
        calendar = item.get('google_calendar') or target
        try:
            if item.get('google_id'):
                try:
                    service.events().patch(calendarId=calendar, eventId=item['google_id'], body=body).execute()
                    remote = item['google_id']
                except Exception as error:
                    if _status_of(error) not in GONE:
                        raise
                    remote = service.events().insert(calendarId=target, body=body).execute().get('id')
                    calendar = target
            else:
                remote = service.events().insert(calendarId=target, body=body).execute().get('id')
                calendar = target
        except Exception as error:
            log.warning('Event not sent to Google: %s', type(error).__name__)
            continue
        if remote:
            _mark(str(item.get('id')), stamp, {'google_id': remote, 'google_calendar': calendar})
            sent = True
    return sent


def _lookup(cache, item):
    calendar = item.get('google_calendar')
    if calendar in (None, 'primary'):
        calendar = _primary(cache)
    return (cache.get('events', {}).get(calendar) or {}).get(item.get('google_id'))


def _local_fields(view):
    last = view.get('end_date') or view.get('start_date')
    if view.get('all_day') and last:
        last = (date.fromisoformat(last) - timedelta(days=1)).isoformat()
    first = view.get('start_date')
    return {
        'title': view.get('title') or 'Termin',
        'date': first,
        'end_date': last if last and last > first else '',
        'time': '' if view.get('all_day') else ui_data.clock(view.get('start_time')) or '',
        'end_time': '' if view.get('all_day') else ui_data.clock(view.get('end_time')) or '',
        'location': view.get('location') or '',
        'description': view.get('description') or '',
    }


def _adopt(cache, cancelled, seen):
    def change(items):
        changed = False
        for item in list(items):
            remote = item.get('google_id')
            if not remote or item.get('google_dirty'):
                continue
            if remote in cancelled:
                items.remove(item)
                changed = True
                continue
            view = seen.get(remote) or _lookup(cache, item)
            if not view:
                continue
            fields = _local_fields(view)
            if any((item.get(key) or '') != value for key, value in fields.items()):
                item.update(fields)
                changed = True
        return changed
    if not any(item.get('google_id') for item in ui_data.load_list('calendar')):
        return False
    return ui_data.modify_list('calendar', change)


def sync(full=False, today=None):
    if not connected():
        return None
    today = today or date.today()
    with _sync_lock:
        try:
            service, email = _google().calendar_service()
        except Exception:
            service, email = None, None
        if service is None:
            problem = 'offline' if connected() else 'login'
            _status.update(checked=time.monotonic(), problem=problem)
            return problem
        cache = _load()
        try:
            stale = (
                cache is None or cache.get('account') != email or cache.get('full_day') != today.isoformat()
                or time.time() - float(cache.get('full_at') or 0) > FULL_SECONDS
            )
            _push(service, cache)
            cancelled, seen = set(), {}
            if full or stale:
                cache, changed = _pull_full(service, email, today), True
            else:
                try:
                    changed, cancelled, seen = _pull_changes(service, cache)
                except Exception as error:
                    if _status_of(error) not in (400, 410):
                        raise
                    cache, changed = _pull_full(service, email, today), True
            _adopt(cache, cancelled, seen)
            if changed:
                _save(cache)
            else:
                with _memory_lock:
                    if _memory['cache'] is not None:
                        _memory['cache']['synced_at'] = cache['synced_at']
            _status.update(checked=time.monotonic(), problem=None)
            return None
        except Exception as error:
            log.warning('Google calendar sync failed: %s', type(error).__name__)
            _status.update(checked=time.monotonic(), problem='offline')
            return 'offline'


def _checked_lately():
    checked = _status['checked']
    return checked is not None and time.monotonic() - checked < CHECK_SECONDS


def refresh(force=False):
    if not connected():
        return None
    if not force and _load(shared=True) is not None and _checked_lately():
        return _status['problem']
    return sync(full=force)


def due():
    return connected() and (_load(shared=True) is None or not _checked_lately())


def push_soon():
    if not connected():
        return

    def run():
        with _sync_lock:
            try:
                service, _ = _google().calendar_service()
                if service is None:
                    return
                _push(service, _load())
            except Exception as error:
                log.warning('Google calendar push failed: %s', type(error).__name__)

    _spawn(run)


def _spawn(run):
    threading.Thread(target=run, name='calendar-push', daemon=True).start()


def touch(item):
    if not connected() or not write_enabled():
        return False
    item['google_dirty'] = True
    return True


def drop(item):
    remote = item.get('google_id')
    if not remote or not connected():
        return False
    with _queue_lock:
        encrypt_file([*_queue(), {'calendar': item.get('google_calendar') or 'primary', 'id': remote}], QUEUE_FILE)
    return True


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
    result = {
        'id': f"g-{item.get('calendar_id', '')}-{item.get('id', '')}",
        'date': day,
        'start': None if item.get('all_day') else ui_data.clock(item.get('start_time')),
        'end': None if item.get('all_day') else ui_data.clock(item.get('end_time')),
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
    result = []
    for calendar_id, bucket in cache.get('events', {}).items():
        if calendar_id in hidden:
            continue
        for key, item in bucket.items():
            if key in linked:
                continue
            shown = view(item)
            if shown and (shown.get('endDate') or shown['date']) >= start and shown['date'] <= end:
                result.append(shown)
    result.sort(key=lambda item: (item['date'], item['start'] or ''))
    return result


def covers(start, end):
    cache = _load(shared=True)
    return bool(cache) and cache['start'] <= start and end <= cache['end']
