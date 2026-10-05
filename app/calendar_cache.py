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
FULL_SECONDS = 20 * 3600
OVERLAP = timedelta(minutes=2)
SOURCE = 'dem Google-Kalender'
KIND_WORDS = (
    ('training', ('training', 'sport', 'gym', 'fitness', 'schwimm', 'verein')),
    ('school', ('schule', 'school', 'iserv', 'kurs', 'uni', 'klasse')),
)
GONE = (404, 410)
PASSING_LIMITS = frozenset(('rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'backendError'))
CONFLICT = object()

log = logging.getLogger(__name__)

_sync_lock = threading.Lock()
_store_lock = threading.Lock()
_memory_lock = threading.Lock()
_queue_lock = threading.Lock()
_memory = {'signature': None, 'cache': None}
_status = {'checked': None, 'problem': None, 'epoch': 0}


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
    with _store_lock:
        for path in (CACHE_FILE, QUEUE_FILE):
            try:
                path.unlink()
            except OSError:
                pass
        with _memory_lock:
            _memory.update(signature=None, cache=None)
        _status.update(checked=None, problem=None, epoch=_status['epoch'] + 1)


def _status_of(error):
    return getattr(getattr(error, 'resp', None), 'status', None)


def _unreadable(error):
    """True when the account may not read a calendar or it is gone. A limit that passes is not that."""
    status = _status_of(error)
    if status != 403:
        return status in GONE
    try:
        reasons = {str(entry.get('reason')) for entry in json.loads(getattr(error, 'content', b'') or b'{}')['error']['errors']}
    except Exception:
        reasons = set()
    return not reasons & PASSING_LIMITS


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
    failed = set()
    for calendar in cache['calendars']:
        try:
            cache['events'][calendar['id']] = _load_calendar(service, cache, calendar)
        except Exception as error:
            log.warning('Google calendar skipped: %s', type(error).__name__)
            if _unreadable(error):
                continue
            failed.add(calendar['id'])
            kept = ((previous or {}).get('events') or {}).get(calendar['id'])
            if kept is not None:
                cache['events'][calendar['id']] = kept
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
    for calendar in list(cache['calendars']):
        name = calendar['id']
        try:
            items = google.list_calendar_events(service, name, updatedMin=cache['synced_at'], showDeleted=True, singleEvents=False)
        except Exception as error:
            if _status_of(error) == 410 or not _unreadable(error):
                raise
            cache['calendars'].remove(calendar)
            cache['events'].pop(name, None)
            changed = True
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


def _newer_there(service, calendar, key, item):
    """After a conflict: the event as Google has it now, if its change is newer than the one waiting here."""
    try:
        event = service.events().get(calendarId=calendar, eventId=key).execute()
    except Exception as error:
        if _status_of(error) not in GONE:
            raise
        return None
    here, there = _moment(item.get('updated_at') or item.get('created_at')), _moment(event.get('updated'))
    return event if here and there and there > here else None


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
    """Brings one changed event to Google. Returns (id, calendar, event), or None when the newer change was Google's."""
    key, stamp = str(item.get('id')), item.get('updated_at') or item.get('created_at')
    body = _body(item)
    remote = item.get('google_id')
    calendar = item.get('google_calendar') or target
    fresh = bool(item.get('google_new')) or not remote
    answer = None if fresh else _patch(service, calendar, remote, body, item.get('google_etag'))
    if answer is CONFLICT:
        theirs = _newer_there(service, calendar, remote, item)
        if theirs is not None and _give_way(key, stamp, theirs, {'id': calendar}):
            return None
        answer = _patch(service, calendar, remote, body)
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


def _push(service, cache, account=None):
    if not write_enabled():
        return False
    target = _primary(cache) or account or 'primary'
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
            'google_id': remote, 'google_calendar': calendar, 'google_account': account, 'google_new': None,
            'google_seen': answer.get('updated') or '', 'google_etag': answer.get('etag'),
        }
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
            if not view or (view.get('updated') or '') <= (item.get('google_seen') or ''):
                continue
            fields = {**_local_fields(view), 'google_seen': view.get('updated') or '', 'google_etag': view.get('etag') or ''}
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


def sync(full=False, today=None):
    if not connected():
        return None
    today = today or date.today()
    with _sync_lock:
        epoch = _status['epoch']
        try:
            service, email = _google().calendar_service()
        except Exception:
            service, email = None, None
        if service is None:
            problem = 'login' if not connected() or _google().login_expired(email) else 'offline'
            _status.update(checked=time.monotonic(), problem=problem)
            return problem
        cache = _load()
        try:
            known = cache is not None and cache.get('account') == email
            stale = (
                not known or cache.get('partial') or cache.get('full_day') != today.isoformat()
                or time.time() - float(cache.get('full_at') or 0) > FULL_SECONDS
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
            problem = 'offline' if failed else None
            _status.update(checked=time.monotonic(), problem=problem)
            return problem
        except Exception as error:
            log.warning('Google calendar sync failed: %s', type(error).__name__)
            problem = 'login' if type(error).__name__ == 'RefreshError' else 'offline'
            _status.update(checked=time.monotonic(), problem=problem)
            return problem


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
