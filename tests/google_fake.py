# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import itertools
import json
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace


def local_stamp(day, clock):
    return datetime.fromisoformat(f'{day}T{clock}:00').astimezone().isoformat()


def _moment(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00'))


class FakeHttpError(Exception):
    def __init__(self, status, reason=None):
        super().__init__(f'HTTP {status}')
        self.resp = SimpleNamespace(status=status)
        reasons = [reason] if isinstance(reason, str) else list(reason or [])
        self.content = json.dumps({'error': {'errors': [{'reason': item} for item in reasons]}}).encode()


class _Call:
    def __init__(self, run):
        self._run = run
        self.headers = {}

    def execute(self):
        return self._run(self)


class _Calendars(dict):
    """The calendars of the account: tests read and change them like a dict, the code calls them like the API."""

    def __init__(self, api, entries):
        super().__init__(entries)
        self._api = api

    def __call__(self):
        return self._api()


class _Batch:
    """Runs its requests one after the other and hands each answer to the callback, like the real batch does. Without
    network the whole batch fails, a refusal of a single request reaches only its callback."""

    def __init__(self, google, callback):
        self._google = google
        self._callback = callback
        self._items = []

    def add(self, request, callback=None, request_id=None):
        self._items.append((request_id or str(len(self._items) + 1), request, callback or self._callback))

    def execute(self):
        self._google._guard('batch', size=len(self._items))
        for request_id, request, callback in self._items:
            try:
                answer, error = request.execute(), None
            except FakeHttpError as failure:
                answer, error = None, failure
            callback(request_id, answer, error)


class FakeGoogle:
    """Stands in for the Calendar API as far as the sync uses it.

    Like the real service it merges a patch into the stored event at every
    depth, refuses an event that has both a day and a time, only takes ids made
    of a-v and 0-9, answers 409 for an id that is taken and 412 for a patch or a
    delete whose If-Match no longer fits, keeps deleted events as cancelled ones
    and only lists them when asked to, and refuses writes to a calendar the
    account may only read. With quiet_patch it takes a patch of a deleted event
    without complaint and stamps it, the worst the real one may do.
    """

    def __init__(self, primary='me@example.org'):
        self.primary = primary
        self.calendars = _Calendars(self._calendars_api, {primary: {'id': primary, 'summary': 'Privat', 'primary': True, 'backgroundColor': '#4285f4', 'accessRole': 'owner'}})
        self.store = {primary: {}}
        self.calls = []
        self.offline = False
        self.broken = {}
        self.lost_answers = set()
        self.hooks = {}
        self.quiet_patch = False
        self.write_budget = None
        self._ids = itertools.count(1)
        self._last = datetime.now(timezone.utc)

    def _now(self, age=0):
        moment = datetime.now(timezone.utc) - timedelta(seconds=age)
        if not age:
            moment = max(moment, self._last + timedelta(milliseconds=1))
            self._last = moment
        return moment.strftime('%Y-%m-%dT%H:%M:%S.') + f'{moment.microsecond // 1000:03d}Z'

    def _calendar(self, key):
        key = self.primary if key == 'primary' else key
        if key not in self.store:
            raise FakeHttpError(404)
        return key

    def _writable(self, calendar):
        key = self._calendar(calendar)
        if self.calendars.get(key, {}).get('accessRole', 'owner') not in ('owner', 'writer'):
            raise FakeHttpError(403, 'requiredAccessLevel')
        if self.write_budget is not None:
            if self.write_budget <= 0:
                raise FakeHttpError(403, 'rateLimitExceeded')
            self.write_budget -= 1
        return self.store[key]

    def _readable(self, calendar):
        if calendar in self.broken:
            status = self.broken[calendar]
            if isinstance(status, tuple):
                raise FakeHttpError(*status)
            raise FakeHttpError(status) if status else OSError('connection reset')
        return self.store[calendar]

    def _stamped(self, event, age=0):
        stamp = self._now(age)
        event.update(updated=stamp, etag=f'"{stamp}"')
        return event

    def add_calendar(self, key, name, role='owner', color='#0b8043'):
        self.calendars[key] = {'id': key, 'summary': name, 'primary': False, 'backgroundColor': color, 'accessRole': role}
        self.store[key] = {}

    def remove_calendar(self, key):
        del self.calendars[key]
        del self.store[key]

    def put(self, calendar, title, day, start=None, end=None, key=None, age=0, **extra):
        calendar = self._calendar(calendar)
        key = key or f'ev{next(self._ids)}'
        if start:
            when = {'start': {'dateTime': local_stamp(day, start)}, 'end': {'dateTime': local_stamp(day, end or start)}}
        else:
            last = extra.pop('end_day', day)
            when = {'start': {'date': day}, 'end': {'date': last}}
        self.store[calendar][key] = self._stamped({'id': key, 'summary': title, 'status': 'confirmed', **when, **extra}, age)
        return key

    def change(self, calendar, key, age=0, **values):
        event = self.store[self._calendar(calendar)][key]
        event.update(values)
        self._stamped(event, age)

    def cancel(self, calendar, key, age=0):
        self.change(calendar, key, age, status='cancelled')

    def live(self, calendar='primary'):
        return [event for event in self.store[self._calendar(calendar)].values() if event['status'] != 'cancelled']

    def _guard(self, name, **details):
        self.calls.append((name, details))
        hook = self.hooks.get(name)
        if hook:
            hook(details)
        if self.offline:
            raise OSError('offline')

    def _answer(self, name, value):
        if name in self.lost_answers:
            self.lost_answers.discard(name)
            raise OSError('the answer was lost')
        return value

    @staticmethod
    def _merged(event, body):
        def merge(old, new):
            result = dict(old)
            for key, value in new.items():
                if value is None:
                    result.pop(key, None)
                elif isinstance(value, dict):
                    result[key] = merge(result[key] if isinstance(result.get(key), dict) else {}, value)
                else:
                    result[key] = value
            return result

        result = merge(event, body)
        for side in ('start', 'end'):
            if 'date' in result.get(side, {}) and 'dateTime' in result.get(side, {}):
                raise FakeHttpError(400)
        return result

    def new_batch_http_request(self, callback=None):
        return _Batch(self, callback)

    def calendarList(self):
        def listing(pageToken=None):
            def run(call):
                self._guard('calendarList.list')
                return {'items': [dict(item) for item in self.calendars.values()]}
            return _Call(run)

        def get(calendarId):
            def run(call):
                self._guard('calendarList.get', calendar=calendarId)
                key = self.primary if calendarId == 'primary' else calendarId
                if key not in self.calendars:
                    raise FakeHttpError(404)
                return dict(self.calendars[key])
            return _Call(run)
        return SimpleNamespace(list=listing, get=get)

    def _calendars_api(self):
        def insert(body):
            def run(call):
                self._guard('calendars.insert', body=body)
                key = f'c{next(self._ids)}@group.calendar.google.com'
                self.add_calendar(key, body['summary'], role='owner', color='#9fe1e7')
                self.calendars[key].update(description=body.get('description', ''), timeZone=body.get('timeZone', ''))
                return {'id': key, 'summary': body['summary']}
            return _Call(run)

        def delete(calendarId):
            def run(call):
                self._guard('calendars.delete', calendar=calendarId)
                if calendarId not in self.calendars or calendarId == self.primary:
                    raise FakeHttpError(404)
                if self.calendars[calendarId].get('accessRole') != 'owner':
                    raise FakeHttpError(403, 'forbidden')
                self.remove_calendar(calendarId)
                return ''
            return _Call(run)
        return SimpleNamespace(insert=insert, delete=delete)

    def events(self):
        def first_day(event):
            start = event['start']
            return (start.get('date') or start.get('dateTime'))[:10]

        def last_day(event):
            end = event['end']
            return (end.get('date') or end.get('dateTime'))[:10]

        def listing(calendarId, maxResults=250, pageToken=None, **params):
            def run(call):
                self._guard('events.list', calendar=calendarId, **params)
                items = list(self._readable(self._calendar(calendarId)).values())
                if params.get('singleEvents'):
                    items = [event for event in items if not event.get('recurrence')]
                else:
                    items = [event for event in items if not event.get('recurringEventId')]
                if 'updatedMin' in params:
                    limit = _moment(params['updatedMin'])
                    items = [event for event in items if _moment(event['updated']) >= limit]
                if not params.get('showDeleted'):
                    items = [event for event in items if event['status'] != 'cancelled']
                if 'timeMin' in params:
                    low, high = params['timeMin'][:10], params['timeMax'][:10]
                    items = [event for event in items if last_day(event) >= low and first_day(event) <= high]
                return {'items': [dict(event) for event in items]}
            return _Call(run)

        def get(calendarId, eventId):
            def run(call):
                self._guard('events.get', calendar=calendarId, event=eventId)
                bucket = self._readable(self._calendar(calendarId))
                if eventId not in bucket:
                    raise FakeHttpError(404)
                return dict(bucket[eventId])
            return _Call(run)

        def insert(calendarId, body):
            def run(call):
                self._guard('events.insert', calendar=calendarId, body=body)
                bucket = self._writable(calendarId)
                key = body.get('id') or f'ev{next(self._ids)}'
                if 'id' in body and not re.fullmatch(r'[a-v0-9]{5,1024}', key):
                    raise FakeHttpError(400)
                if any(value is None for part in (body, *(item for item in body.values() if isinstance(item, dict))) for value in part.values()):
                    raise FakeHttpError(400)
                if key in bucket:
                    raise FakeHttpError(409)
                bucket[key] = self._stamped({**self._merged({'status': 'confirmed'}, body), 'id': key})
                return self._answer('events.insert', dict(bucket[key]))
            return _Call(run)

        def patch(calendarId, eventId, body):
            def run(call):
                self._guard('events.patch', calendar=calendarId, event=eventId, body=body)
                bucket = self._writable(calendarId)
                if eventId not in bucket:
                    raise FakeHttpError(404)
                if call.headers.get('If-Match') not in (None, bucket[eventId].get('etag')):
                    raise FakeHttpError(412)
                if bucket[eventId]['status'] == 'cancelled':
                    if not self.quiet_patch:
                        raise FakeHttpError(404)
                    return dict(self._stamped(bucket[eventId]))
                bucket[eventId] = self._stamped(self._merged(bucket[eventId], body))
                return self._answer('events.patch', dict(bucket[eventId]))
            return _Call(run)

        def delete(calendarId, eventId):
            def run(call):
                self._guard('events.delete', calendar=calendarId, event=eventId)
                bucket = self._writable(calendarId)
                if eventId not in bucket:
                    raise FakeHttpError(404)
                if bucket[eventId]['status'] == 'cancelled':
                    raise FakeHttpError(410)
                if call.headers.get('If-Match') not in (None, bucket[eventId].get('etag')):
                    raise FakeHttpError(412)
                bucket[eventId]['status'] = 'cancelled'
                self._stamped(bucket[eventId])
                return ''
            return _Call(run)

        return SimpleNamespace(list=listing, get=get, insert=insert, patch=patch, delete=delete)

    def count(self, name):
        return sum(1 for call, _ in self.calls if call == name)
