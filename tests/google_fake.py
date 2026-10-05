# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import itertools
from datetime import datetime, timezone
from types import SimpleNamespace


def local_stamp(day, clock):
    return datetime.fromisoformat(f'{day}T{clock}:00').astimezone().isoformat()


class FakeHttpError(Exception):
    def __init__(self, status):
        super().__init__(f'HTTP {status}')
        self.resp = SimpleNamespace(status=status)


class _Call:
    def __init__(self, run):
        self._run = run

    def execute(self):
        return self._run()


class FakeGoogle:
    def __init__(self, primary='me@example.org'):
        self.primary = primary
        self.calendars = {primary: {'id': primary, 'summary': 'Privat', 'primary': True, 'backgroundColor': '#4285f4'}}
        self.store = {primary: {}}
        self.calls = []
        self.offline = False
        self._ids = itertools.count(1)
        self._clock = itertools.count(1)

    def _now(self):
        return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:') + f'{next(self._clock) % 60:02d}.000Z'

    def _calendar(self, key):
        key = self.primary if key == 'primary' else key
        if key not in self.store:
            raise FakeHttpError(404)
        return key

    def add_calendar(self, key, name):
        self.calendars[key] = {'id': key, 'summary': name, 'primary': False, 'backgroundColor': '#0b8043'}
        self.store[key] = {}

    def put(self, calendar, title, day, start=None, end=None, key=None, **extra):
        calendar = self._calendar(calendar)
        key = key or f'ev{next(self._ids)}'
        if start:
            when = {'start': {'dateTime': local_stamp(day, start)}, 'end': {'dateTime': local_stamp(day, end or start)}}
        else:
            last = extra.pop('end_day', day)
            when = {'start': {'date': day}, 'end': {'date': last}}
        self.store[calendar][key] = {'id': key, 'summary': title, 'status': 'confirmed', 'updated': self._now(), **when, **extra}
        return key

    def cancel(self, calendar, key):
        event = self.store[self._calendar(calendar)][key]
        event.update(status='cancelled', updated=self._now())

    def _guard(self, name, **details):
        self.calls.append((name, details))
        if self.offline:
            raise OSError('offline')

    def calendarList(self):
        def listing(pageToken=None):
            def run():
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
            def run():
                self._guard('events.list', calendar=calendarId, **params)
                bucket = self.store[self._calendar(calendarId)]
                items = list(bucket.values())
                if 'updatedMin' in params:
                    limit = params['updatedMin']
                    items = [event for event in items if event['updated'][:19] + 'Z' >= limit]
                else:
                    items = [event for event in items if event['status'] != 'cancelled']
                if 'timeMin' in params:
                    low, high = params['timeMin'][:10], params['timeMax'][:10]
                    items = [event for event in items if last_day(event) >= low and first_day(event) <= high]
                return {'items': [dict(event) for event in items]}
            return _Call(run)

        def insert(calendarId, body):
            def run():
                self._guard('events.insert', calendar=calendarId, body=body)
                calendar = self._calendar(calendarId)
                key = f'ev{next(self._ids)}'
                self.store[calendar][key] = {'id': key, 'status': 'confirmed', 'updated': self._now(), **body}
                return dict(self.store[calendar][key])
            return _Call(run)

        def patch(calendarId, eventId, body):
            def run():
                self._guard('events.patch', calendar=calendarId, event=eventId, body=body)
                bucket = self.store[self._calendar(calendarId)]
                if eventId not in bucket or bucket[eventId]['status'] == 'cancelled':
                    raise FakeHttpError(404)
                bucket[eventId].update(body, updated=self._now())
                return dict(bucket[eventId])
            return _Call(run)

        def delete(calendarId, eventId):
            def run():
                self._guard('events.delete', calendar=calendarId, event=eventId)
                bucket = self.store[self._calendar(calendarId)]
                if eventId not in bucket or bucket[eventId]['status'] == 'cancelled':
                    raise FakeHttpError(410)
                bucket[eventId].update(status='cancelled', updated=self._now())
                return ''
            return _Call(run)

        return SimpleNamespace(list=listing, insert=insert, patch=patch, delete=delete)

    def count(self, name):
        return sum(1 for call, _ in self.calls if call == name)
