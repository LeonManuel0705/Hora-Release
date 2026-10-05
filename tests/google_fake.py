# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

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
        self.content = json.dumps({'error': {'errors': [{'reason': reason}] if reason else []}}).encode()


class _Call:
    def __init__(self, run):
        self._run = run
        self.headers = {}

    def execute(self):
        return self._run(self)


class FakeGoogle:
    """Stands in for the Calendar API as far as the sync uses it.

    Like the real service it merges a patch into the stored event, refuses an
    event that has both a day and a time, only takes ids made of a-v and 0-9,
    answers 409 for an id that is taken and 412 for a patch whose If-Match no
    longer fits, keeps deleted events as cancelled ones and only lists them
    when asked to.
    """

    def __init__(self, primary='me@example.org'):
        self.primary = primary
        self.calendars = {primary: {'id': primary, 'summary': 'Privat', 'primary': True, 'backgroundColor': '#4285f4'}}
        self.store = {primary: {}}
        self.calls = []
        self.offline = False
        self.broken = {}
        self.lost_answers = set()
        self.hooks = {}
        self.quiet_patch = False
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

    def add_calendar(self, key, name):
        self.calendars[key] = {'id': key, 'summary': name, 'primary': False, 'backgroundColor': '#0b8043'}
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
        result = dict(event)
        for key, value in body.items():
            if isinstance(value, dict):
                mixed = {**(result.get(key) if isinstance(result.get(key), dict) else {}), **value}
                result[key] = {name: item for name, item in mixed.items() if item is not None}
            elif value is None:
                result.pop(key, None)
            else:
                result[key] = value
        for side in ('start', 'end'):
            if 'date' in result.get(side, {}) and 'dateTime' in result.get(side, {}):
                raise FakeHttpError(400)
        return result

    def calendarList(self):
        def listing(pageToken=None):
            def run(call):
                self._guard('calendarList.list')
                return {'items': list(self.calendars.values())}
            return _Call(run)
        return SimpleNamespace(list=listing)

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
                bucket = self.store[self._calendar(calendarId)]
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
                bucket = self.store[self._calendar(calendarId)]
                if eventId not in bucket:
                    raise FakeHttpError(404)
                if call.headers.get('If-Match') not in (None, bucket[eventId].get('etag')):
                    raise FakeHttpError(412)
                if bucket[eventId]['status'] == 'cancelled':
                    if not self.quiet_patch:
                        raise FakeHttpError(404)
                    return dict(bucket[eventId])
                bucket[eventId] = self._stamped(self._merged(bucket[eventId], body))
                return self._answer('events.patch', dict(bucket[eventId]))
            return _Call(run)

        def delete(calendarId, eventId):
            def run(call):
                self._guard('events.delete', calendar=calendarId, event=eventId)
                bucket = self.store[self._calendar(calendarId)]
                if eventId not in bucket:
                    raise FakeHttpError(404)
                if bucket[eventId]['status'] == 'cancelled':
                    raise FakeHttpError(410)
                bucket[eventId]['status'] = 'cancelled'
                self._stamped(bucket[eventId])
                return ''
            return _Call(run)

        return SimpleNamespace(list=listing, get=get, insert=insert, patch=patch, delete=delete)

    def count(self, name):
        return sum(1 for call, _ in self.calls if call == name)
