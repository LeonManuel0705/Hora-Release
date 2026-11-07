# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

from datetime import datetime, timedelta, timezone

import pytest

from app import transit_service
from app import ui_data

LOCAL = datetime(2026, 11, 6, 15, 0).astimezone().tzinfo


def stamp(hour, minute):
    return datetime(2026, 11, 6, hour, minute, tzinfo=LOCAL).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def leg(category, line='', stop='', planned=None, actual=None, minutes=5):
    return {'category': category, 'line': line, 'from': {'name': stop, 'planned': planned, 'time': actual or planned}, 'minutes': minutes}


def journey(*legs, cancelled=False):
    return {'legs': list(legs), 'cancelled': cancelled}


FOUND = [
    journey(leg('fuss', minutes=4), leg('bus', '612', 'Schulzentrum', stamp(15, 12), stamp(15, 15)), leg('regio', 'RE1', 'Bahnhof', stamp(15, 40))),
    journey(leg('fuss', minutes=4), leg('bus', '612', 'Schulzentrum', stamp(15, 32))),
    journey(leg('fuss', minutes=9), leg('tram', '91', 'Am Markt', stamp(15, 20))),
    journey(leg('fuss', minutes=4), leg('bus', '612', 'Schulzentrum', stamp(15, 52)), cancelled=True),
    journey(leg('fuss', minutes=4), leg('bus', '612', 'Schulzentrum', stamp(16, 12))),
]


def test_the_way_home_lists_the_first_ride_of_the_same_line_and_stop():
    view = transit_service.way_home(FOUND, 'Lindenallee')
    assert view == {
        'line': '612', 'mode': 'bus', 'from': 'Schulzentrum', 'to': 'Lindenallee', 'walkMinutes': 4,
        'departures': ['15:12', '15:32', '16:12'], 'delays': {'15:12': 3},
    }


def test_walking_only_or_nothing_found_gives_no_way_home():
    assert transit_service.way_home([journey(leg('fuss', minutes=20))], 'Zuhause') is None
    assert transit_service.way_home([], 'Zuhause') is None


@pytest.fixture
def places(monkeypatch):
    known = {
        'home': {'name': 'Lindenallee', 'latitude': 52.52, 'longitude': 13.4, 'id': 'de-home'},
        'school': {'name': 'Schulzentrum', 'latitude': 52.51, 'longitude': 13.41, 'id': 'de-school'},
    }
    monkeypatch.setattr(ui_data, 'known_places', lambda: known)
    monkeypatch.setattr(ui_data, 'school_end', lambda settings, store, day: datetime.combine(day, datetime.strptime('15:00', '%H:%M').time()))
    ui_data._way_home.update(key=None, at=None, value=None, running=False)
    asked = []

    def handle(action, args):
        asked.append((action, args))
        return {'journeys': FOUND}, 200

    monkeypatch.setattr(transit_service, 'handle', handle)
    monkeypatch.setattr(ui_data, 'refresh_way_home_soon', lambda *args: ui_data.refresh_way_home(*args))
    yield known, asked
    ui_data._way_home.update(key=None, at=None, value=None, running=False)


def test_the_page_shows_the_copy_and_the_fetch_runs_beside_it(places):
    known, asked = places
    now = datetime(2026, 11, 6, 14, 10)
    first = ui_data.way_home({}, {}, now)
    assert first['departures'] == [] and len(asked) == 1
    action, args = asked[0]
    assert action == 'verbindungen' and (args['von'], args['nach'], args['ankunft']) == ('de-school', 'de-home', '0')
    assert datetime.fromisoformat(args['zeit']).replace(tzinfo=None) == datetime(2026, 11, 6, 15, 0)
    second = ui_data.way_home({}, {}, now)
    assert second['departures'] == ['15:12', '15:32', '16:12'] and second['from'] == 'Schulzentrum'
    assert len(asked) == 1


def test_the_way_home_is_only_asked_for_around_the_end_of_school(places):
    _, asked = places
    for hour, minute in ((10, 0), (13, 29), (17, 1), (21, 0)):
        assert ui_data.way_home({}, {}, datetime(2026, 11, 6, hour, minute)) == ui_data.NO_TRANSIT
    assert asked == []


def test_without_both_places_or_lessons_nothing_is_fetched(places, monkeypatch):
    known, asked = places
    monkeypatch.setattr(ui_data, 'school_end', lambda settings, store, day: None)
    assert ui_data.way_home({}, {}, datetime(2026, 11, 6, 14, 30)) == ui_data.NO_TRANSIT
    del known['home']
    assert ui_data.way_home({}, {}, datetime(2026, 11, 6, 14, 30)) == ui_data.NO_TRANSIT
    assert asked == []


def test_a_failed_fetch_keeps_what_came_before(places, monkeypatch):
    _, asked = places
    now = datetime(2026, 11, 6, 15, 5)
    ui_data.way_home({}, {}, now)
    assert ui_data.way_home({}, {}, now)['departures']
    monkeypatch.setattr(transit_service, 'handle', lambda action, args: ({'error': 'Fahrplan gerade nicht erreichbar'}, 504))
    ui_data._way_home['at'] -= ui_data.WAY_HOME_FRESH + 1
    ui_data.way_home({}, {}, now)
    assert ui_data.way_home({}, {}, now)['departures'] == ['15:12', '15:32', '16:12']


def test_the_end_of_school_follows_the_plan_the_pages_show(monkeypatch):
    school = {'blocks': [{'n': 1, 'start': '08:00', 'end': '09:30'}, {'n': 2, 'start': '09:50', 'end': '11:20'}], 'abReference': '2026-01-12', 'abWeeks': False, 'holidays': [],
              'timetable': {'A': {'5': [{'block': 1, 'subject': 'ma'}, {'block': 2, 'subject': 'de'}]}}, 'subjects': {'ma': {'name': 'Mathe'}, 'de': {'name': 'Deutsch'}}}
    monkeypatch.setattr(ui_data, 'effective_school', lambda settings, store: school)
    friday, saturday = datetime(2026, 11, 6).date(), datetime(2026, 11, 7).date()
    assert ui_data.school_end({}, {}, friday) == datetime(2026, 11, 6, 11, 20)
    assert ui_data.school_end({}, {}, saturday) is None
    assert ui_data.school_end({}, {}, friday + timedelta(days=7)) == datetime(2026, 11, 13, 11, 20)
