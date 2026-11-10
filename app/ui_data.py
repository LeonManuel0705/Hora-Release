# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import colorsys
import copy
import json
import re
import threading
import time
import uuid
import zlib
from datetime import date, datetime, timedelta

from . import brand
from . import database as db
from .crypto_utils import decrypt_file, encrypt_file
from .paths import DATA_DIR

HUES = {
    'rose': '#C1657E', 'ochre': '#9A6A1E', 'olive': '#6E6D0A', 'moss': '#669649', 'jade': '#0D7C59', 'teal': '#139999',
    'lake': '#0C7491', 'slate': '#5188CD', 'iris': '#635DAB', 'orchid': '#984979', 'brick': '#A34943', 'plum': '#A16FB8',
}
DEFAULT_BLOCKS = [('08:00', '09:30'), ('09:50', '11:20'), ('11:30', '13:00'), ('13:30', '15:00')]
DEFAULT_REFERENCE = '2026-01-12'
MAX_BLOCKS = 12
GRADES = range(5, 14)
COURSE_TYPES = ('LK', 'GK', 'SK')
REPEATS = ('daily', 'weekly', 'monthly')
STATES = [
    ('BW', 'Baden-Württemberg'), ('BY', 'Bayern'), ('BE', 'Berlin'), ('BB', 'Brandenburg'), ('HB', 'Bremen'),
    ('HH', 'Hamburg'), ('HE', 'Hessen'), ('MV', 'Mecklenburg-Vorpommern'), ('NI', 'Niedersachsen'),
    ('NW', 'Nordrhein-Westfalen'), ('RP', 'Rheinland-Pfalz'), ('SL', 'Saarland'), ('SN', 'Sachsen'),
    ('ST', 'Sachsen-Anhalt'), ('SH', 'Schleswig-Holstein'), ('TH', 'Thüringen'),
]
DEADLINE_KINDS = {'hw': ('homework', 'Hausaufgabe'), 'test': ('tests', 'Test'), 'exam': ('exams', 'Klausur'), 'talk': ('talks', 'Vortrag')}
DEADLINE_PREFIXES = {word: prefix for prefix, (_, word) in DEADLINE_KINDS.items()}
GRADE_TYPES = ('klausur', 'test', 'muendlich', 'vortrag', 'sonstiges')
WRITTEN_DAYS = 183
EVENT_KINDS = {'school': 'school', 'training': 'training'}
NOTIFY_DEFAULTS = {
    'enabled': True,
    'sound': True,
    'quiet': {'from': '22:00', 'to': '07:00'},
    'categories': [
        {'key': 'lessons', 'label': 'Nächste Stunde', 'detail': 'Fach und Raum vor Beginn', 'on': True, 'lead': 10,
         'leads': [[5, '5 Min. vorher'], [10, '10 Min. vorher'], [15, '15 Min. vorher']]},
        {'key': 'tests', 'label': 'Tests, Klausuren und Vorträge', 'detail': 'mit Lernstoff', 'on': True, 'lead': 1,
         'leads': [[1, 'am Vortag'], [2, '2 Tage vorher'], [3, '3 Tage vorher'], [7, '1 Woche vorher']]},
        {'key': 'homework', 'label': 'Hausaufgaben', 'detail': 'vor der Abgabe', 'on': True, 'lead': 1,
         'leads': [[1, 'am Vortag'], [2, '2 Tage vorher']]},
        {'key': 'events', 'label': 'Termine', 'detail': 'aus dem Kalender', 'on': True, 'lead': 15,
         'leads': [[5, '5 Min. vorher'], [15, '15 Min. vorher'], [30, '30 Min. vorher'], [60, '1 Std. vorher']]},
        {'key': 'tasks', 'label': 'Aufgaben', 'detail': 'wenn sie fällig werden', 'on': True},
        {'key': 'pomodoro', 'label': 'Pomodoro', 'detail': 'Ende jeder Arbeits- und Pausenphase', 'on': True},
    ],
}

FILES = {
    'subjects': 'school_subjects.json',
    'homework': 'school_homework.json',
    'tests': 'school_tests.json',
    'exams': 'school_exams.json',
    'talks': 'school_talks.json',
    'grades': 'school_grades.json',
    'calendar': 'school_calendar.json',
    'notes': 'quick_notes.json',
    'mail_drafts': 'mail_drafts.json',
    'mail_archive': 'mail_archive.json',
    'weather': 'weather_cache.json',
    'iserv': 'iserv_credentials.json',
    'google': 'google_tokens.json',
    'places': 'known_locations.json',
    'plan_meta': 'vertretungsplan_cache/cache_meta.json',
    'iserv_homework': 'iserv_homework.json',
    'sync': 'sync_state.json',
}

_cache = {}
_locks = {name: threading.Lock() for name in FILES}


class StoreError(Exception):
    pass


def _path(name):
    return DATA_DIR / FILES[name]


def _signature(path):
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size


def _read(name, strict=False):
    path = _path(name)
    try:
        signature = _signature(path)
    except OSError:
        return None
    hit = _cache.get(name)
    if hit and hit[0] == signature:
        return copy.deepcopy(hit[1])
    try:
        value = decrypt_file(path)
    except Exception as error:
        if strict:
            raise StoreError(name) from error
        return None
    try:
        signature = _signature(path)
    except OSError:
        pass
    _cache[name] = (signature, value)
    return copy.deepcopy(value)


def load_list(name):
    value = _read(name)
    return value if isinstance(value, list) else []


def load_dict(name):
    value = _read(name)
    return value if isinstance(value, dict) else {}


def whole_list(name):
    value = _read(name, strict=True)
    return value if isinstance(value, list) else []


def modify_list(name, change):
    with _locks[name]:
        path = _path(name)
        if path.exists():
            items = _read(name, strict=True)
            if not isinstance(items, list):
                raise StoreError(name)
        else:
            items = []
        result = change(items)
        encrypt_file(items, path)
        _cache[name] = (_signature(path), copy.deepcopy(items))
        return result


def modify_dict(name, change):
    """Like modify_list for a store that holds one record. One that cannot be read starts over: it only keeps state that comes back."""
    with _locks[name]:
        path = _path(name)
        value = _read(name) if path.exists() else None
        value = value if isinstance(value, dict) else {}
        result = change(value)
        path.parent.mkdir(parents=True, exist_ok=True)
        encrypt_file(value, path)
        _cache[name] = (_signature(path), copy.deepcopy(value))
        return result


def short_id():
    return uuid.uuid4().hex[:8]


def full_id():
    return str(uuid.uuid4())


def slug(text):
    text = str(text or '').lower()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        text = text.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-') or 'fach'


def _norm(name):
    return re.sub(r'\s+(lk|gk|sk)$', '', str(name or '').strip().casefold())


def _hex_rgb(color):
    match = re.fullmatch(r'#?([0-9a-fA-F]{6})', str(color or '').strip())
    if not match:
        return None
    value = match.group(1)
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def hue_for(color, seed):
    rgb = _hex_rgb(color)
    names = list(HUES)
    if rgb is None:
        return names[zlib.crc32(seed.encode('utf-8')) % len(names)]
    hue, saturation, _ = colorsys.rgb_to_hsv(*rgb)
    if saturation < 0.15:
        return 'slate'

    def distance(name):
        other, _, _ = colorsys.rgb_to_hsv(*_hex_rgb(HUES[name]))
        gap = abs(hue - other)
        return min(gap, 1 - gap)

    return min(names, key=distance)


def _short(name):
    clean = re.sub(r'[^A-Za-zÄÖÜäöüß]', '', _norm(name).title()) or 'Fach'
    return clean[:3]


def clock(value):
    match = re.fullmatch(r'\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*', str(value or ''))
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return f'{hour:02d}:{minute:02d}'


def iso_day(value):
    text = str(value or '').strip()[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def week_type(day, reference, ab_on):
    if not ab_on:
        return 'A'
    monday = day - timedelta(days=day.weekday())
    return 'A' if ((monday - date.fromisoformat(reference)).days // 7) % 2 == 0 else 'B'


def school_setup(settings):
    subjects = load_list('subjects')
    entries = db.get_timetable_entries()
    catalog = {}
    names = {}
    for item in subjects:
        key = str(item.get('id') or '').strip()
        name = str(item.get('name') or '').strip()
        if not key or not name or key in catalog:
            continue
        course = item.get('course_type') if item.get('course_type') in COURSE_TYPES else 'GK'
        label = f'{name} LK' if course == 'LK' and not name.endswith(' LK') else name
        catalog[key] = {'name': label, 'label': label, 'short': _short(name), 'hue': hue_for(item.get('color'), key), 'type': course}
        names.setdefault(_norm(name), key)
    for entry in entries:
        name = str(entry.get('subject') or '').strip()
        if not name or _norm(name) in names:
            continue
        key = f's-{slug(name)}'
        while key in catalog:
            key = f'{key}-x'
        course = entry.get('subject_type') if entry.get('subject_type') in COURSE_TYPES else 'GK'
        label = f'{name} LK' if course == 'LK' and not name.endswith(' LK') else name
        catalog[key] = {'name': label, 'label': label, 'short': _short(name), 'hue': hue_for(entry.get('color'), key), 'type': course}
        names[_norm(name)] = key

    periods = []
    for period in db.get_timetable_periods():
        start, end = clock(period.get('start_time')), clock(period.get('end_time'))
        number = period.get('period_number')
        if isinstance(number, int) and start and end and start < end:
            periods.append({'n': number, 'start': start, 'end': end})
    periods.sort(key=lambda block: block['n'])
    if not periods:
        highest = max((int(entry.get('block') or 0) for entry in entries), default=len(DEFAULT_BLOCKS))
        periods = [{'n': index + 1, 'start': start, 'end': end} for index, (start, end) in enumerate(DEFAULT_BLOCKS[:max(1, highest)])]
    known = {block['n'] for block in periods}

    timetable = {week: {str(day): [] for day in range(1, 6)} for week in ('A', 'B')}
    for entry in entries:
        try:
            day, block = int(entry.get('day')), int(entry.get('block'))
        except (TypeError, ValueError):
            continue
        key = names.get(_norm(entry.get('subject')))
        if not key or not 1 <= day <= 5 or block not in known:
            continue
        week = entry.get('week') or 'both'
        weeks = ('A', 'B') if week == 'both' else (week,) if week in ('A', 'B') else ()
        lesson = {'block': block, 'subject': key, 'room': str(entry.get('room') or '').strip()[:12], 'teacher': str(entry.get('teacher') or '').strip()}
        for name in weeks:
            day_list = [item for item in timetable[name][str(day)] if item['block'] != block]
            day_list.append(dict(lesson))
            timetable[name][str(day)] = sorted(day_list, key=lambda item: item['block'])

    reference = iso_day((settings or {}).get('reference_date')) or DEFAULT_REFERENCE
    ab_on = (settings or {}).get('has_ab_weeks') != 0
    subjects_view = {key: {k: v for k, v in info.items() if k != 'type'} for key, info in catalog.items()}
    courses = {key: {'type': info['type']} for key, info in catalog.items()}
    known = {**subjects_view, **custom_subjects(catalog)}
    shown = {**known, **custom_subjects(catalog, put_aside=True)}
    return {
        'subjects': subjects_view, 'known': known, 'shown': shown, 'courses': courses, 'blocks': periods, 'timetable': timetable,
        'abReference': reference, 'abWeeks': ab_on,
    }


def is_own_subject(own):
    """Whether what the settings store under a key is an own subject that can be shown."""
    if not isinstance(own, dict) or not own.get('custom') or not isinstance(own.get('name'), str) or not own['name'].strip():
        return False
    return isinstance(own.get('hue'), str) and own['hue'] in HUES


def custom_subjects(catalog, put_aside=False):
    """The subjects made in the settings. With put_aside those that were deleted but kept, because grades or entries hang on them.

    New entries only take the first kind ('known'), what is stored is shown for both ('shown').
    """
    saved = db.get_ui_store().get('app-subjects')
    items = saved.get('items') if isinstance(saved, dict) else None
    if not isinstance(items, dict):
        return {}
    removed = saved.get('removed') if isinstance(saved.get('removed'), list) else []
    result = {}
    for key, own in items.items():
        if key in catalog or (key in removed) != put_aside or not is_own_subject(own):
            continue
        name = own['name'].strip()[:32]
        label = f'{name} LK' if own.get('type') == 'LK' else name
        result[key] = {'name': label, 'label': label, 'short': _short(name), 'hue': own['hue']}
    return result


def _is_clock(value):
    return isinstance(value, str) and re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', value) is not None


def _block_times(base, saved):
    def valid(blocks):
        ordered = sorted(blocks, key=lambda block: block['n'])
        return all(
            _is_clock(block.get('start')) and _is_clock(block.get('end')) and block['start'] < block['end']
            and (not index or ordered[index - 1]['end'] <= block['start'])
            for index, block in enumerate(ordered)
        )

    fresh = [dict(block) for block in base]
    if isinstance(saved, list):
        merged = []
        for block in base:
            own = next((item for item in saved if isinstance(item, dict) and item.get('n') == block['n']), None)
            fits = own and _is_clock(own.get('start')) and _is_clock(own.get('end'))
            merged.append({**block, 'start': own['start'], 'end': own['end']} if fits else dict(block))
        return merged if valid(merged) else fresh
    blocks = saved.get('blocks') if isinstance(saved, dict) and saved.get('v') == 2 else None
    if not isinstance(blocks, list) or not blocks or len(blocks) > MAX_BLOCKS or not all(isinstance(item, dict) and isinstance(item.get('n'), int) for item in blocks):
        return fresh
    ordered = sorted(blocks, key=lambda item: item['n'])
    result = [{'n': index + 1, 'start': item.get('start'), 'end': item.get('end')} for index, item in enumerate(ordered)]
    numbers = {item['n'] for item in blocks}
    return result if all(index + 1 in numbers for index in range(len(result))) and valid(result) else fresh


def _slug(text):
    text = str(text).lower()
    for letter, plain in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        text = text.replace(letter, plain)
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def _teachers(stored, saved):
    """The teachers as the settings list them, by the id the pages use, each with the name to show."""
    own = saved.get('items') if isinstance(saved.get('items'), dict) else {}
    removed = {key for key in saved.get('removed', ()) if isinstance(key, str)} if isinstance(saved.get('removed'), list) else set()
    teachers = {}
    for entry in stored:
        name = entry.get('teacher')
        key = f't-{_slug(name)}' if name else ''
        if not key or key in teachers or key in removed:
            continue
        match = re.fullmatch(r'(Frau|Herr)\s+(.+)', name)
        teachers[key] = f'{match.group(1)} {match.group(2)}' if match else name
    for key, value in own.items():
        if key in removed or not isinstance(value, dict) or not isinstance(value.get('name'), str) or not value['name'].strip():
            continue
        if key not in teachers and not value.get('custom'):
            continue
        title = value.get('title') if value.get('title') in ('Frau', 'Herr') else ''
        teachers[key] = f"{title} {value['name'].strip()[:40]}".strip()
    return teachers


def effective_school(settings=None, store=None):
    """The school data as the pages show it: the stored plan with the edits from the settings on top."""
    settings = settings if settings is not None else (db.get_timetable_settings() or {})
    store = store if store is not None else db.get_ui_store()
    school = school_setup(settings)

    def saved(key):
        value = store.get(key)
        return value if isinstance(value, dict) else {}

    own_subjects = saved('app-subjects')
    items = own_subjects.get('items') if isinstance(own_subjects.get('items'), dict) else {}
    removed = set(own_subjects.get('removed')) if isinstance(own_subjects.get('removed'), list) else set()
    subjects = {}
    for key, info in school['subjects'].items():
        own = items.get(key) if isinstance(items.get(key), dict) else {}
        base_type = school['courses'].get(key, {}).get('type', 'GK')
        kind = own.get('type') if own.get('type') in COURSE_TYPES else base_type
        name = own['name'].strip()[:32] if isinstance(own.get('name'), str) else ''
        if name or kind != base_type:
            plain = re.sub(r'\s+(LK|GK)$', '', info['name'])
            label = f"{name or plain}{' LK' if kind == 'LK' else ''}"
        else:
            label = info['name']
        subjects[key] = {'name': label, 'type': kind, 'retired': key in removed}
    for key, own in items.items():
        if key in subjects or not isinstance(own, dict) or not own.get('custom'):
            continue
        name = own['name'].strip()[:32] if isinstance(own.get('name'), str) else ''
        if not name or own.get('hue') not in HUES:
            continue
        kind = own.get('type') if own.get('type') in COURSE_TYPES else 'GK'
        subjects[key] = {'name': f"{name}{' LK' if kind == 'LK' else ''}", 'type': kind, 'retired': key in removed}

    stored = [entry for days in school['timetable'].values() for entries in days.values() for entry in entries]
    teachers = _teachers(stored, saved('app-teachers'))
    for key, info in subjects.items():
        own = items.get(key) if isinstance(items.get(key), dict) else {}
        first = next((entry['teacher'] for entry in stored if entry['subject'] == key and entry.get('teacher')), '')
        chosen = own['teacher'] if isinstance(own.get('teacher'), str) else (f't-{_slug(first)}' if first else '')
        info['teacher'] = teachers.get(chosen, '')

    def teacher_of(key, own=''):
        return (teachers.get(own) if isinstance(own, str) else None) or subjects[key]['teacher']

    blocks = _block_times(school['blocks'], store.get('app-block-times'))
    known = {block['n'] for block in blocks}

    def active(key):
        return key in subjects and not subjects[key]['retired']

    timetable = {
        week: {
            dow: [{**entry, 'teacher': teacher_of(entry['subject'])} for entry in entries if active(entry['subject']) and entry['block'] in known]
            for dow, entries in days.items()
        }
        for week, days in school['timetable'].items()
    }
    edits = store.get('app-timetable-edits')
    for key, value in (edits.items() if isinstance(edits, dict) else ()):
        match = re.fullmatch(r'([AB]):([1-5]):(\d{1,2})', str(key))
        if not match or int(match.group(3)) not in known:
            continue
        if value is not None and not (isinstance(value, dict) and active(value.get('subject'))):
            continue
        week, dow, block = match.group(1), match.group(2), int(match.group(3))
        entries = [entry for entry in timetable.setdefault(week, {}).get(dow, []) if entry['block'] != block]
        if value:
            entries.append({'block': block, 'subject': value['subject'], 'room': str(value.get('room') or '').strip()[:12], 'teacher': teacher_of(value['subject'], value.get('teacher'))})
        timetable[week][dow] = sorted(entries, key=lambda entry: entry['block'])

    reference = date.fromisoformat(school['abReference'])
    if store.get('app-ab-swap') is True:
        reference += timedelta(days=7)
    return {
        'subjects': subjects,
        'blocks': blocks,
        'timetable': timetable,
        'abReference': reference.isoformat(),
        'abWeeks': school['abWeeks'] and store.get('app-ab-weeks') is not False,
        'holidays': [(item['date'], item['endDate'] or item['date'], item['title']) for item in holidays(date.today())],
    }


def holiday_on(school, day):
    iso = day.isoformat()
    return next((title or 'Schulfrei' for first, last, title in school.get('holidays', ()) if first <= iso <= last), None)


def lessons_on(school, day):
    if day.weekday() > 4 or holiday_on(school, day):
        return []
    week = week_type(day, school['abReference'], school['abWeeks'])
    times = {block['n']: block for block in school['blocks']}
    result = []
    for entry in school['timetable'].get(week, {}).get(str(day.weekday() + 1), []):
        block = times.get(entry['block'])
        if not block:
            continue
        result.append({
            'block': entry['block'], 'start': block['start'], 'end': block['end'], 'week': week,
            'key': entry['subject'], 'subject': school['subjects'][entry['subject']]['name'],
            'room': entry.get('room') or '', 'teacher': entry.get('teacher') or '',
        })
    return result


def lesson_block(school, subject_key, day_iso):
    if not subject_key or not day_iso:
        return None
    day = date.fromisoformat(day_iso)
    if day.weekday() > 4:
        return None
    week = week_type(day, school['abReference'], school['abWeeks'])
    for lesson in school['timetable'][week][str(day.weekday() + 1)]:
        if lesson['subject'] == subject_key:
            return lesson['block']
    return None


def deadline_view(prefix, item, school, today):
    _, kind = DEADLINE_KINDS[prefix]
    when = iso_day(item.get('due_date') if prefix == 'hw' else item.get('date'))
    if not when:
        return None
    subject_key = str(item.get('subject_id') or '')
    if subject_key not in school['shown']:
        subject_key = None
    detail = item.get('notes') if prefix == 'hw' else item.get('topics')
    view = {
        'id': f"{prefix}-{item.get('id')}",
        'kind': kind,
        'title': str(item.get('title') or kind),
        'subject': subject_key,
        'date': when,
        'detail': str(detail or ''),
        'status': 'abgegeben' if prefix == 'hw' and item.get('completed') else 'offen',
    }
    if prefix != 'hw' and clock(item.get('time')):
        view['time'] = clock(item.get('time'))
    block = lesson_block(school, subject_key, when)
    if block:
        view['block'] = block
    return view


def deadlines(school, today, iserv_homework=None):
    horizon_back = (today - timedelta(days=14)).isoformat()
    written_back = (today - timedelta(days=WRITTEN_DAYS)).isoformat()
    result = []

    def keep(view, homework):
        if not view or view['date'] < (horizon_back if homework else written_back):
            return
        if homework and view['status'] == 'abgegeben' and view['date'] < today.isoformat():
            return
        result.append(view)

    own = set()
    for prefix, (name, _) in DEADLINE_KINDS.items():
        for item in load_list(name):
            view = deadline_view(prefix, item, school, today)
            if view and prefix == 'hw':
                own.add((view['title'].casefold(), view['date']))
            keep(view, prefix == 'hw')
    if iserv_homework:
        # Homework taken over from IServ by hand in the older interface is there already as one's own, listed or ticked off.
        for item in iserv_homework['items']:
            if f"{ISERV_PREFIX}{item['id']}" in iserv_homework['hidden']:
                continue
            view = iserv_homework_view(item, school, iserv_homework['done'])
            if view and (view['title'].casefold(), view['date']) not in own:
                keep(view, True)
    result.sort(key=lambda item: (item['date'], item.get('block') or 0))
    return result


def task_rows():
    conn = db.get_connection()
    cursor = conn.cursor()
    db._execute(cursor, 'SELECT * FROM hub_tasks')
    rows = db._fetchall_dict(cursor)
    conn.close()
    return rows


def _done_at(value):
    text = str(value or '')
    try:
        stamp = datetime.fromisoformat(text.replace('Z', '').replace(' ', 'T')[:26])
    except ValueError:
        return None, None
    return stamp.date().isoformat(), f'{stamp.hour}:{stamp.minute:02d}'


def task_view(row, subjects):
    due = iso_day(row.get('due_date'))
    due_time = clock(row.get('due_time'))
    subject_key = row.get('subject') if row.get('subject') in subjects else None
    view = {
        'id': str(row['id']),
        'title': str(row.get('title') or ''),
        'subject': subject_key,
        'date': due,
        'minutes': row.get('minutes') if isinstance(row.get('minutes'), int) and row.get('minutes') > 0 else 20,
        'priority': row.get('priority') == 'high',
        'done': bool(row.get('completed')),
        'notes': str(row.get('description') or ''),
        'source': row.get('source') or 'own',
    }
    if due_time:
        view['dueTime'] = f'{int(due_time[:2])}:{due_time[3:]}'
        view['anchor'] = f"bis {view['dueTime']}"
    if row.get('someday') and not due:
        view['someday'] = True
    if row.get('repeat_type') in REPEATS:
        view['repeat'] = row['repeat_type']
    if row.get('deadline_ref'):
        view['deadline'] = str(row['deadline_ref'])
    if view['done']:
        done_day, done_time = _done_at(row.get('completed_at'))
        view['doneDay'] = done_day
        view['doneAt'] = done_time
    return view


def tasks(subjects, today):
    today_iso = today.isoformat()
    recent = (today - timedelta(days=14)).isoformat()
    plan, pool = [], []
    for row in task_rows():
        view = task_view(row, subjects)
        if view['done']:
            done_day = view.get('doneDay') or ''
            if done_day == today_iso:
                plan.append(view)
            elif done_day >= recent:
                pool.append(view)
            continue
        if view.get('someday'):
            pool.append(view)
        elif not view['date'] or view['date'] <= today_iso:
            plan.append(view)
        else:
            pool.append(view)
    return plan, pool


EVENT_REPEATS = ('daily', 'weekly', 'monthly', 'yearly')
# Google takes reminders up to four weeks ahead. -1 means none at all, a missing value the default of the settings.
REMINDER_RANGE = (-1, 40320)


def recurrence_rule(value):
    """A repeat rule as events keep it, {freq, interval, until, count, exceptions}, or None. Same shape as recurrence.js."""
    if not isinstance(value, dict) or value.get('freq') not in EVENT_REPEATS:
        return None
    try:
        interval = min(12, max(1, int(value.get('interval') or 1)))
    except (TypeError, ValueError):
        interval = 1
    try:
        count = int(value.get('count') or 0)
    except (TypeError, ValueError):
        count = 0
    count = min(1000, count) if count >= 1 else None
    until = None if count else iso_day(value.get('until'))
    exceptions = value.get('exceptions') if isinstance(value.get('exceptions'), list) else []
    days = sorted({day for day in (iso_day(item) for item in exceptions[:500]) if day})
    return {'freq': value['freq'], 'interval': interval, 'until': until, 'count': count, 'exceptions': days}


def nth_day(first, rule, index):
    """The day a rule comes round for the index-th time, or None where that day does not exist (31.4., 29.2.)."""
    step = index * rule['interval']
    if rule['freq'] in ('daily', 'weekly'):
        return first + timedelta(days=step * (7 if rule['freq'] == 'weekly' else 1))
    months = first.month - 1 + (step if rule['freq'] == 'monthly' else step * 12)
    try:
        return first.replace(year=first.year + months // 12, month=months % 12 + 1)
    except ValueError:
        return None


def series_last_day(view):
    """The last day an event view reaches, every repetition included, or None for a series without end."""
    first = date.fromisoformat(view['date'])
    span = (date.fromisoformat(view['endDate']) - first).days if view.get('endDate') else 0
    rule = recurrence_rule(view.get('recurrence'))
    if not rule:
        return view.get('endDate') or view['date']
    if rule['until']:
        last = max(date.fromisoformat(rule['until']), first)
    elif rule['count']:
        last, produced, index = first, 0, 0
        while produced < rule['count'] and index < 20000:
            day = nth_day(first, rule, index)
            index += 1
            if day:
                last, produced = day, produced + 1
    else:
        return None
    return (last + timedelta(days=span)).isoformat()


def reminder_minutes(value):
    """Minutes before the start, -1 for none, or None for the default. Raises ValueError for anything else."""
    if value is None or value == '':
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError('Erinnerung ungültig')
    try:
        minutes = int(value)
    except ValueError:
        raise ValueError('Erinnerung ungültig') from None
    if not REMINDER_RANGE[0] <= minutes <= REMINDER_RANGE[1]:
        raise ValueError('Erinnerung ungültig')
    return minutes


def event_view(item):
    when = iso_day(item.get('date'))
    if not when:
        return None
    end_day = iso_day(item.get('end_date'))
    view = {
        'id': f"loc-{item.get('id')}",
        'date': when,
        'start': clock(item.get('time')),
        'end': clock(item.get('end_time')),
        'title': str(item.get('title') or 'Termin'),
        'place': str(item.get('location') or ''),
        'kind': EVENT_KINDS.get(item.get('category'), 'private'),
        'notes': str(item.get('description') or ''),
        'synced': False,
    }
    if end_day and end_day > when:
        view['endDate'] = end_day
    rule = recurrence_rule(item.get('recurrence'))
    if rule:
        view['recurrence'] = rule
    try:
        minutes = reminder_minutes(item.get('reminder_minutes'))
    except ValueError:
        minutes = None
    if minutes is not None:
        view['reminderMinutes'] = minutes
    if item.get('google_id') and not item.get('google_new'):
        view['google'] = True
    if item.get('google_dirty'):
        from . import calendar_cache
        view['elsewhere' if calendar_cache.waits_elsewhere(item) else 'pending'] = True
    return view


def events(today):
    start = (today - timedelta(days=400)).isoformat()
    end = (today + timedelta(days=400)).isoformat()
    result = []
    for item in load_list('calendar'):
        view = event_view(item)
        last = series_last_day(view) if view else None
        if view and (last is None or last >= start) and view['date'] <= end:
            result.append(view)
    return _with_synced(result, today)


def _with_synced(own, today):
    from . import calendar_cache
    try:
        first, last = calendar_cache.window(today)
        synced = calendar_cache.events(first.isoformat(), last.isoformat()) if calendar_cache.connected() else []
        own = calendar_cache.own_views(own)
    except Exception:
        synced = []
    seen = {(item['title'], item['date'], item['start'] or '') for item in own}
    result = own + [item for item in synced if (item['title'], item['date'], item['start'] or '') not in seen]
    result.sort(key=lambda item: (item['date'], item['start'] or ''))
    return result


def holidays(today):
    start = (today - timedelta(days=400)).isoformat()
    end = (today + timedelta(days=400)).isoformat()
    result = []
    for row in db.get_holidays_for_date_range(start, end):
        when = iso_day(row.get('date'))
        if not when:
            continue
        end_day = iso_day(row.get('end_date'))
        result.append({
            'id': f"h-{row.get('id')}",
            'title': str(row.get('name') or 'Feiertag'),
            'date': when,
            'endDate': end_day if end_day and end_day > when else None,
            'type': 'ferien' if row.get('type') == 'schulferien' else 'feiertag',
        })
    return result


WEATHER_MAX_AGE = timedelta(minutes=30)
_weather_state = {'running': False}
_weather_lock = threading.Lock()


def weather_location(settings):
    """The place the forecast is for: the one set in the settings, otherwise home."""
    return chosen_weather_place(settings) or home_weather_place()


def home_weather_place():
    """Home as the place for the forecast. The coordinates are rounded, the forecast needs no street."""
    home = known_places().get('home')
    if not isinstance(home, dict):
        return None
    lat, lon = home.get('latitude'), home.get('longitude')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    return {'city': home_town(home), 'lat': round(lat, 1), 'lon': round(lon, 1), 'home': True}


def home_town(home):
    """The town of the home address, '' where it does not name one: a street or a stop is no name for the weather."""
    address, name = str(home.get('address') or ''), str(home.get('name') or '')
    for text in (address, name):
        after_postcode = re.search(r'\b\d{5}\s+([^\d,][^,]*)', text)
        if after_postcode:
            return after_postcode.group(1).strip()[:80]
    last = address.split(',')[-1].strip()
    return last[:80] if last and not any(char.isdigit() for char in last) else ''


def same_place(one, other):
    close = lambda key: isinstance(one.get(key), (int, float)) and isinstance(other.get(key), (int, float)) and abs(one[key] - other[key]) < 0.05
    return one.get('city') == other.get('city') and close('lat') and close('lon')


def weather_from_home(settings):
    """None while the forecast has a place of its own or no home to go by. Otherwise the town of home, '' where its address names none."""
    if chosen_weather_place(settings):
        return None
    place = home_weather_place()
    return place['city'] if place else None


def chosen_weather_place(settings):
    try:
        value = json.loads((settings or {}).get('location_json') or 'null')
    except (TypeError, ValueError):
        return None
    if not isinstance(value, dict):
        return None
    lat, lon, city = value.get('lat'), value.get('lon'), str(value.get('city') or '').strip()
    if not city or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    return {'city': city, 'lat': lat, 'lon': lon}


def geocode(name):
    import requests
    response = requests.get(
        'https://geocoding-api.open-meteo.com/v1/search',
        params={'name': name, 'count': 1, 'language': 'de'},
        timeout=6,
    )
    response.raise_for_status()
    results = response.json().get('results') or []
    if not results or not isinstance(results[0], dict):
        return None
    first = results[0]
    lat, lon = first.get('latitude'), first.get('longitude')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    return {'city': str(first.get('name') or name).strip()[:80], 'lat': lat, 'lon': lon}


def refresh_weather(location):
    import requests
    response = requests.get(
        'https://api.open-meteo.com/v1/forecast',
        params={
            'latitude': location['lat'],
            'longitude': location['lon'],
            'current': 'temperature_2m,weather_code,wind_speed_10m',
            'hourly': 'temperature_2m,precipitation_probability,weather_code',
            'daily': 'temperature_2m_max,temperature_2m_min,weather_code',
            'timezone': 'Europe/Berlin',
            'forecast_days': 2,
        },
        timeout=8,
    )
    response.raise_for_status()
    data = response.json()
    now = datetime.now()
    value = {
        'current': data.get('current'),
        'daily': data.get('daily'),
        'hourly': data.get('hourly'),
        'location': location,
        'timestamp': now.isoformat(),
        'fetched_at': now.strftime('%Y-%m-%d %H:%M:%S'),
    }
    path = _path('weather')
    with _locks['weather']:
        encrypt_file(value, path)
        _cache['weather'] = (_signature(path), copy.deepcopy(value))


def refresh_weather_soon(location):
    with _weather_lock:
        if _weather_state['running']:
            return
        _weather_state['running'] = True

    def run():
        try:
            refresh_weather(location)
        except Exception:
            pass
        finally:
            with _weather_lock:
                _weather_state['running'] = False

    threading.Thread(target=run, name='weather-refresh', daemon=True).start()


def weather(settings, now):
    cache = load_dict('weather')
    location = weather_location(settings)
    cached_place = cache.get('location') if isinstance(cache.get('location'), dict) else {}
    try:
        fetched = datetime.fromisoformat(str(cache.get('timestamp') or ''))
    except ValueError:
        fetched = None
    # canFollowHome tells the page that home counts here while no place of its own is set, fromHome that it does right now.
    nothing = {'place': location['city'] if location else '', 'fromHome': bool(location and location.get('home')), 'canFollowHome': True, 'high': None, 'low': None, 'wind': None, 'hours': []}
    if not location:
        # What the cache still holds is for a place that is no longer set, and nothing would refresh it.
        return nothing
    current_place = same_place(cached_place, location)
    if not fetched or now - fetched > WEATHER_MAX_AGE or not isinstance(cache.get('hourly'), dict) or not current_place:
        refresh_weather_soon(location)
    if not current_place:
        return nothing
    day = now.date().isoformat()
    tomorrow = (now.date() + timedelta(days=1)).isoformat()

    def rounded(value):
        return round(value) if isinstance(value, (int, float)) else None

    hourly = cache.get('hourly') if isinstance(cache.get('hourly'), dict) else {}
    times = hourly.get('time') if isinstance(hourly.get('time'), list) else []
    temps = hourly.get('temperature_2m') if isinstance(hourly.get('temperature_2m'), list) else []
    rains = hourly.get('precipitation_probability') if isinstance(hourly.get('precipitation_probability'), list) else []
    codes = hourly.get('weather_code') if isinstance(hourly.get('weather_code'), list) else []
    hours, morning = [], None
    for index, stamp in enumerate(times):
        stamp = str(stamp)
        temp = rounded(temps[index]) if index < len(temps) else None
        if len(stamp) < 13 or temp is None or not stamp[11:13].isdigit():
            continue
        hour = int(stamp[11:13])
        rain = (rounded(rains[index]) if index < len(rains) else None) or 0
        item = {'h': hour, 'temp': temp, 'rain': rain}
        code = codes[index] if index < len(codes) else None
        if isinstance(code, int):
            item['code'] = code
        if stamp.startswith(day):
            hours.append(item)
        elif stamp.startswith(tomorrow) and hour == 7:
            morning = item
    daily = cache.get('daily') if isinstance(cache.get('daily'), dict) else {}
    dates = daily.get('time') if isinstance(daily.get('time'), list) else []

    def today_value(key):
        values = daily.get(key)
        if day not in dates or not isinstance(values, list):
            return None
        index = dates.index(day)
        return rounded(values[index]) if index < len(values) else None

    current = cache.get('current') if isinstance(cache.get('current'), dict) else {}
    fresh = str(current.get('time') or '').startswith(day)
    view = {
        **nothing,
        'high': today_value('temperature_2m_max'),
        'low': today_value('temperature_2m_min'),
        'wind': rounded(current.get('wind_speed_10m')) if fresh else None,
        'hours': hours,
    }
    if fresh and isinstance(current.get('weather_code'), int):
        view['code'] = current['weather_code']
    if morning:
        view['tomorrowMorning'] = morning
    return view


# What IServ gives on the desktop for sure. Homework is named only once a fetch brought some.
ISERV_FEATURES = ['Vertretungsplan', 'E-Mail']
ISERV_PREFIX = 'iserv.'
ISERV_PARTS = ('plan', 'mail', 'homework')


def iserv_account():
    credentials = load_dict('iserv')
    username = str(credentials.get('username') or '')
    school = str(credentials.get('iserv_url') or '').replace('https://', '').replace('http://', '').strip('/')
    return {
        'connected': bool(username), 'name': username, 'school': school, 'features': list(ISERV_FEATURES),
        'account': f'{username}@{school.lower()}' if username else '',
    }


def iserv_key():
    return iserv_account()['account']


def mark_synced(source, part, account):
    """Notes that a part of a source just gave data. The pages call this time Stand, so only what really came counts."""
    stamp = datetime.now().isoformat(timespec='minutes')

    def change(state):
        entry = state.get(source) if isinstance(state.get(source), dict) else {}
        if entry.get('account') != account:
            entry = {'account': account, 'since': stamp}
        entry[part] = stamp
        state[source] = entry

    modify_dict('sync', change)


def iserv_parts(account):
    """When each part of IServ last came, for the account signed in now.

    The plan also counts from its own copy, which older versions kept without naming the account. That copy only counts
    when nothing says another account came since: no record yet, or one of this account that began before it.
    """
    entry = load_dict('sync').get('iserv') if account else None
    parts = {part: None for part in ISERV_PARTS}
    mine = isinstance(entry, dict) and entry.get('account') == account
    if mine:
        parts.update({part: entry[part] for part in ISERV_PARTS if isinstance(entry.get(part), str)})
    if account and (entry is None or mine):
        kept = str(load_dict('plan_meta').get('cached_at') or '')[:16]
        since = str(entry.get('since') or '') if mine else ''
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', kept) and kept >= since and kept > (parts['plan'] or ''):
            parts['plan'] = kept
    return parts


def note_iserv_account(account, before):
    """An account was signed in, before was the one signed in until then.

    For another account, times and unread mails kept for the last one no longer count, nor the plan copy from before.
    """
    def change(state):
        entry = state.get('iserv')
        same = entry.get('account') == account if isinstance(entry, dict) else account == before
        if not same:
            state['iserv'] = {'account': account, 'since': datetime.now().isoformat(timespec='minutes')}
            _drop_unread(state, _is_iserv_mailbox)

    if account:
        modify_dict('sync', change)


def forget_iserv():
    """IServ was disconnected: its times go, and so do the unread mails of its mailbox."""
    def change(state):
        state.pop('iserv', None)
        _drop_unread(state, _is_iserv_mailbox)

    modify_dict('sync', change)


HOMEWORK_MAX_AGE = timedelta(minutes=30)
_homework_state = {'running': False}
_homework_lock = threading.Lock()


def iserv_homework_state(account):
    """The homework the last fetch brought for this account, and which of it is ticked off or hidden here."""
    stored = load_dict('iserv_homework')
    if not account or stored.get('account') != account:
        return {'items': [], 'done': set(), 'hidden': set(), 'tried': None}
    items = [item for item in stored.get('items') or [] if isinstance(item, dict) and item.get('id')]
    marks = lambda key: {str(value) for value in stored.get(key) or [] if isinstance(value, str)}
    return {'items': items, 'done': marks('done'), 'hidden': marks('hidden'), 'tried': stored.get('tried_at')}


def change_iserv_homework(account, change):
    def apply(state):
        if state.get('account') != account:
            state.clear()
            state['account'] = account
        return change(state)

    return modify_dict('iserv_homework', apply)


def refresh_iserv_homework():
    """Fetches the homework from IServ now. What failed leaves the last list as it was."""
    from .iserv_service import get_iserv_service
    account = iserv_key()
    if not account:
        return {'success': False, 'cause': 'setup'}
    result = get_iserv_service().get_homework()
    stamp = datetime.now().isoformat(timespec='minutes')

    def change(state):
        state['tried_at'] = stamp
        if result.get('success'):
            state['items'] = result['exercises']

    change_iserv_homework(account, change)
    if result.get('success'):
        mark_synced('iserv', 'homework', account)
    return result


def refresh_iserv_homework_soon():
    with _homework_lock:
        if _homework_state['running']:
            return
        _homework_state['running'] = True

    def run():
        try:
            refresh_iserv_homework()
        except Exception:
            pass
        finally:
            with _homework_lock:
                _homework_state['running'] = False

    threading.Thread(target=run, name='iserv-homework', daemon=True).start()


def homework_due(state):
    now = datetime.now()
    try:
        tried = datetime.fromisoformat(str(state.get('tried') or ''))
    except ValueError:
        return True
    return not now - HOMEWORK_MAX_AGE < tried <= now


def _local_day(value):
    text = str(value or '').strip()
    if len(text) > 10:
        try:
            stamp = datetime.fromisoformat(text.replace('Z', '+00:00'))
        except ValueError:
            stamp = None
        if stamp is not None:
            return (stamp.astimezone() if stamp.tzinfo else stamp).date().isoformat()
    return iso_day(text)


def course_subject(course, school):
    """The subject an IServ course stands for: the same name, else the longest subject name it starts with or holds as a word."""
    wanted = _norm(course)
    if not wanted:
        return None
    names = {}
    for key, info in school['shown'].items():
        names.setdefault(_norm(info.get('name')), key)
    if wanted in names:
        return names[wanted]
    found, length = None, 0
    for name, key in names.items():
        if len(name) > length and len(name) >= 3 and (wanted.startswith(name) or f' {name}' in wanted):
            found, length = key, len(name)
    return found


def iserv_homework_view(item, school, done):
    when = _local_day(item.get('due'))
    if not when:
        return None
    item_id = f"{ISERV_PREFIX}{item['id']}"
    subject_key = course_subject(item.get('course'), school)
    finished = item_id in done or str(item.get('status')) in ('done', 'submitted')
    view = {
        'id': f'hw-{item_id}', 'kind': 'Hausaufgabe', 'title': str(item.get('title') or '') or 'Hausaufgabe', 'subject': subject_key,
        'date': when, 'detail': str(item.get('course') or ''), 'status': 'abgegeben' if finished else 'offen', 'origin': 'iserv',
    }
    block = lesson_block(school, subject_key, when)
    if block:
        view['block'] = block
    return view


def sync_status(iserv, now):
    from . import calendar_cache
    try:
        google = calendar_cache.stand() if calendar_cache.connected() else None
    except Exception:
        google = None
    parts = iserv_parts(iserv['account']) if iserv['connected'] else {part: None for part in ISERV_PARTS}
    stamps = [stamp for stamp in parts.values() if stamp]
    return {
        'iserv': iserv['connected'],
        'iservAvailable': True,
        'rendered': now.isoformat(timespec='minutes'),
        'synced': {'iserv': max(stamps) if stamps else None, 'google': google},
        'iservParts': parts,
    }


def known_grade(settings, store):
    """The class the student said they are in, or None while nobody asked.

    Every new row starts at class 10 with points. Saving a class, here or in the older class screen, sets marks for a
    class up to 10, so a 10 only counts together with marks.
    """
    saved = store.get('app-settings') if isinstance(store.get('app-settings'), dict) else {}
    grade = (saved.get('school') if isinstance(saved.get('school'), dict) else {}).get('grade')
    if isinstance(grade, int) and not isinstance(grade, bool) and grade in GRADES:
        return grade
    settings = settings or {}
    level = settings.get('class_level')
    if not isinstance(level, int) or isinstance(level, bool) or level not in GRADES:
        return None
    return level if level != 10 or settings.get('grade_system') == 'marks' else None


def current_semester(today, grade):
    """The term grades are filed under now, or an empty one while the class is unknown, so no class is guessed."""
    return semester_for(today, grade) if grade else ''


def build(active, store, now):
    today = now.date()
    settings = db.get_timetable_settings() or {}
    school = school_setup(settings)
    plan, pool = tasks(school['shown'], today)
    iserv = iserv_account()
    homework = iserv_homework_state(iserv['account']) if iserv['connected'] else None
    if homework is not None and homework_due(homework):
        refresh_iserv_homework_soon()
    data = {
        'user': {'state': settings.get('bundesland') or '', 'grade': known_grade(settings, store), 'iserv': 'desktop'},
        'blocks': school['blocks'],
        'subjects': school['subjects'],
        'courses': school['courses'],
        'timetable': school['timetable'],
        'abReference': school['abReference'],
        'changes': [],
        'tasks': plan,
        'taskPool': pool,
        'deadlines': deadlines(school, today, homework),
        'events': events(today),
        'holidays': holidays(today),
        'transit': way_home(settings, store, now),
        'weather': weather(settings, now),
        'status': sync_status(iserv, now),
        'mailUnread': len(mail_unread_ids(iserv)),
    }
    data['status'].update(google_status())
    if not school['abWeeks']:
        store.setdefault('app-ab-weeks', False)
    if active in PAGE_BUILDERS:
        data['page'] = PAGE_BUILDERS[active](data, school, settings, today, iserv)
    return data


def google_status():
    """What the pages need to know about Google before they ask: whether it can be connected here, and how the copy stands."""
    from . import calendar_cache
    try:
        return {'googleConfigured': calendar_cache.configured(), 'gmailViaGoogle': calendar_cache.gmail_offered(), 'google': calendar_cache.page_state()['google']}
    except Exception:
        return {'googleConfigured': False, 'gmailViaGoogle': False, 'google': None}


def page_assistant(data, school, settings, today, iserv):
    from . import local_ai
    return {'install': local_ai.status()}


def page_pomodoro(data, school, settings, today, iserv):
    return {'stats': {name: db.get_pomodoro_stats(name) for name in ('today', 'week', 'month')}}


def page_bookmarks(data, school, settings, today, iserv):
    from . import site_icons
    links = [{'id': str(row['id']), 'title': row.get('title') or '', 'url': row.get('url') or '', 'category': row.get('category') or 'Other',
              'icon': site_icons.known(row.get('url') or '')}
             for row in db.get_hub_bookmarks()]
    return {'bookmarks': links}


def page_calendar(data, school, settings, today, iserv):
    from . import calendar_cache
    code = settings.get('bundesland') or ''
    first, last = calendar_cache.window(today)
    google = calendar_cache.connected()
    sync = {
        'source': 'google' if google else None,
        'write': google and calendar_cache.write_enabled(),
        'stand': calendar_cache.stand() if google else None,
        'state': calendar_cache.page_state()['google'] if google else None,
        'window': {'start': first.isoformat(), 'end': last.isoformat()},
    }
    if sync['write']:
        sync.update(calendar_cache.page_calendars())
    return {'region': dict(STATES).get(code, ''), 'events': [], 'holidays': data['holidays'], 'notes': {}, 'sync': sync}


def semester_for(today, level):
    if isinstance(level, int) and level >= 11:
        first = 'Q1' if level == 11 else 'Q3'
        second = 'Q2' if level == 11 else 'Q4'
        return first if today.month >= 8 or today.month == 1 else second
    half = 1 if today.month >= 8 or today.month == 1 else 2
    return f'{level or 10}/{half}'


def school_year(day):
    return day.year if day.month >= 8 else day.year - 1


# The pages used to file grades under class 10 while nobody had named a class.
GUESSED_TERM = re.compile(r'10/[12]')


def grade_term(stored, day, grade, today):
    """The term a grade belongs to, read without rewriting what is stored.

    A grade stored without a term, or under the class 10 the pages once assumed, takes its term from its own date and
    the class known now. While no class is known, such grades of this school year count as the current ones.
    """
    stored = str(stored or '')
    if stored and not GUESSED_TERM.fullmatch(stored):
        return stored
    year = school_year(day)
    if grade is None:
        if year == school_year(today):
            return ''
        return stored or f'{year}/{(year + 1) % 100:02d}'
    then = min(13, max(5, grade - (school_year(today) - year)))
    # A class setting nobody moved on to the next year must not relabel real class 10 grades.
    if stored and then <= 10:
        return stored
    return semester_for(day, then)


def grade_day(item, today):
    day = iso_day(item.get('date'))
    return date.fromisoformat(day) if day else today


def grade_view(item, subjects, grade, today):
    subject_key = str(item.get('subject_id') or '')
    points = item.get('points')
    if subject_key not in subjects or not isinstance(points, (int, float)):
        return None
    return {
        'id': f"g-{item.get('id')}",
        'subject': subject_key,
        'points': int(round(points)),
        'type': item.get('type') if item.get('type') in GRADE_TYPES else 'sonstiges',
        'semester': grade_term(item.get('semester'), grade_day(item, today), grade, today),
        'date': iso_day(item.get('date')) or today.isoformat(),
        'title': str(item.get('description') or ''),
    }


def page_school(data, school, settings, today, iserv):
    semester = current_semester(today, data['user']['grade'])
    grades = []
    history = {}
    for item in load_list('grades'):
        entry = grade_view(item, school['shown'], data['user']['grade'], today)
        if not entry:
            continue
        if entry['semester'] == semester:
            grades.append(entry)
        else:
            history.setdefault(entry['subject'], {}).setdefault(entry['semester'], []).append(entry['points'])
    history = {key: {term: round(sum(values) / len(values)) for term, values in terms.items()} for key, terms in history.items()}
    return {'courses': school['courses'], 'history': history, 'grades': grades, 'exams': [], 'changes': [], 'seminar': None, 'semester': semester}


def place_view(name, value):
    if not isinstance(value, dict):
        return None
    lat, lon = value.get('latitude'), value.get('longitude')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    stop = str(value.get('id') or '')
    usable = stop if stop.startswith('de-') else None
    return {'id': usable or f'{lat},{lon}', 'name': name, 'detail': str(value.get('name') or value.get('address') or ''), 'stop': usable, 'lat': lat, 'lon': lon}


def place_record(value):
    if not isinstance(value, dict) or not value.get('name'):
        return None
    lat, lon = value.get('latitude'), value.get('longitude')
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    return {
        'name': str(value['name']),
        'area': str(value.get('address') or ''),
        'lat': lat,
        'lon': lon,
        'stop': str(value.get('id') or '') if value.get('type') == 'stop' else '',
    }


def place_line(value):
    if not isinstance(value, dict):
        return ''
    name = str(value.get('name') or '').strip()
    area = str(value.get('address') or '').strip()
    return f'{name}, {area}' if name and area and area not in name else name


def known_places():
    try:
        from .vbb_service import get_vbb_service
        places = get_vbb_service().get_known_locations().get('locations')
        return places if isinstance(places, dict) else {}
    except Exception:
        return load_dict('places')


NO_TRANSIT = {'line': '', 'mode': '', 'from': '', 'to': '', 'walkMinutes': 0, 'departures': [], 'delays': {}}
WAY_HOME_FRESH = 180
WAY_HOME_BEFORE, WAY_HOME_AFTER = timedelta(minutes=90), timedelta(hours=2)
_way_home = {'key': None, 'at': None, 'value': None, 'running': False}
_way_home_lock = threading.Lock()


def school_end(settings, store, day):
    """When the last lesson of the day ends in the plan as the pages show it, with the changes from the settings."""
    lessons = lessons_on(effective_school(settings, store), day)
    return datetime.combine(day, datetime.strptime(lessons[-1]['end'], '%H:%M').time()) if lessons else None


def way_home(settings, store, now):
    """The next departures from school home, from about the last lesson on. The page gets the copy, a fetch runs beside it."""
    known = known_places()
    origin, target = place_view('Schule', known.get('school')), place_view('Zuhause', known.get('home'))
    if not origin or not target:
        return copy.deepcopy(NO_TRANSIT)
    end = school_end(settings, store, now.date())
    if not end or not end - WAY_HOME_BEFORE <= now <= end + WAY_HOME_AFTER:
        return copy.deepcopy(NO_TRANSIT)
    key = (origin['id'], target['id'], end.isoformat())
    with _way_home_lock:
        current = _way_home['key'] == key
        value = copy.deepcopy(_way_home['value']) if current else None
        fresh = current and _way_home['at'] is not None and time.monotonic() - _way_home['at'] < WAY_HOME_FRESH
    if not fresh:
        refresh_way_home_soon(key, origin['id'], target['id'], target['detail'] or 'Zuhause', max(now, end))
    return value or copy.deepcopy(NO_TRANSIT)


def refresh_way_home(key, origin, target, name, leave):
    from . import transit_service
    body, status = transit_service.handle('verbindungen', {'von': origin, 'nach': target, 'zeit': leave.astimezone().isoformat(timespec='seconds'), 'ankunft': '0'})
    value = transit_service.way_home(body.get('journeys') or [], name) if status == 200 else None
    with _way_home_lock:
        kept = _way_home['value'] if _way_home['key'] == key else None
        _way_home.update(key=key, at=time.monotonic(), value=value or kept)


def refresh_way_home_soon(key, origin, target, name, leave):
    with _way_home_lock:
        if _way_home['running']:
            return
        _way_home['running'] = True

    def run():
        try:
            refresh_way_home(key, origin, target, name, leave)
        except Exception:
            pass
        finally:
            with _way_home_lock:
                _way_home['running'] = False

    threading.Thread(target=run, name='way-home', daemon=True).start()


def page_transit(data, school, settings, today, iserv):
    known = known_places()
    places = {}
    home = place_view('Zuhause', known.get('home'))
    school_place = place_view('Schule', known.get('school'))
    if home:
        places['home'] = home
    if school_place:
        places['school'] = school_place
    return {'places': places, 'attribution': 'Transitous, DELFI e.V. und Verkehrsverbünde'}


def note_view(item):
    title = str(item.get('title') or '').strip()
    details = str(item.get('content') or '').strip()
    if not title:
        # The older interface saved notes without a title: their first line stands in for it, the rest stays the text.
        first, _, rest = details.partition('\n')
        title, details = first.strip()[:300], f'{first.strip()[300:]}\n{rest}'.strip()
    return {
        'id': str(item.get('id') or ''),
        'type': 'idea' if item.get('type') == 'idea' else 'note',
        'title': title,
        'details': details,
        'created': str(item.get('created_at') or '')[:19],
    }


def notes():
    """Notes and ideas from the quick note sheet, newest first."""
    try:
        stored = load_list('notes')
    except StoreError:
        return []
    kept = sorted((item for item in stored if isinstance(item, dict) and item.get('id')), key=lambda item: str(item.get('created_at') or ''), reverse=True)
    return [view for view in map(note_view, kept) if view['title']]


def page_tasks(data, school, settings, today, iserv):
    return {'notes': notes()}


def _views(make, items):
    views = (make(item) for item in items if isinstance(item, dict))
    return [view for view in views if view]


def export_records():
    settings = db.get_timetable_settings() or {}
    school = school_setup(settings)
    today = date.today()
    grade = known_grade(settings, {})
    dated = []
    for prefix, (name, _) in DEADLINE_KINDS.items():
        dated.extend(_views(lambda item: deadline_view(prefix, item, school, today), whole_list(name)))
    kept = [item for item in whole_list('notes') if isinstance(item, dict) and item.get('id')]
    known = known_places()
    places = {}
    for key in ('home', 'school'):
        place = place_record(known.get(key))
        if place:
            places[key] = place
    return {
        'tasks': [task_view(row, school['shown']) for row in task_rows()],
        'deadlines': dated,
        'grades': _views(lambda item: grade_view(item, school['shown'], grade, today), whole_list('grades')),
        'notes': [view for view in map(note_view, kept) if view['title']],
        'events': _views(event_view, whole_list('calendar')),
        'places': places,
    }


# How long a mail may be on its way, in seconds: the page waits some before it sends, then the mail server has its say.
MAIL_SENDING = 90
# A send belongs to the process that runs it. What an earlier run of the app left "on its way" never went out.
STARTED = time.time()


def mail_draft_state(now=None):
    """The drafts as the mail page shows them, newest first, and how many mails are on their way right now.

    A mail stays a stored draft until it is out. While it is on its way it is not listed, or a page loaded in that
    moment would offer it for sending a second time. If it never went out, it is listed and says so.
    The times are seconds since 1970, so that a change of the clock does not move them.
    """
    try:
        stored = load_list('mail_drafts')
    except StoreError:
        return [], 0
    now = time.time() if now is None else now
    drafts, on_the_way = [], 0
    for item in stored:
        if not isinstance(item, dict) or not item.get('id') or item.get('sent_at'):
            continue
        started = item.get('sending_at')
        if isinstance(started, (int, float)) and started >= STARTED and 0 <= now - started < MAIL_SENDING:
            on_the_way += 1
            continue
        drafts.append({
            'id': str(item.get('id') or ''), 'to': str(item.get('to') or ''), 'subject': str(item.get('subject') or ''), 'body': str(item.get('body') or ''),
            'replyTo': item.get('reply_to') or None, 'account': item.get('account') or None, 'saved': str(item.get('saved_at') or ''),
            'unsent': bool(started or item.get('unsent')),
        })
    return sorted(drafts, key=lambda draft: draft['saved'], reverse=True), on_the_way


def mail_drafts(now=None):
    return mail_draft_state(now)[0]


def archived_mails():
    """The mails put into the archive, by id. Each keeps what its row shows, so that it stays listed once the mailbox no longer sends it."""
    try:
        return {str(item.get('id')): item for item in load_list('mail_archive') if isinstance(item, dict) and item.get('id')}
    except StoreError:
        return {}


MAIL_UNREAD = 2000


def note_unread(views, answered, current=None):
    """Keeps by id which mails in the inbox are unread, so that every page can count them without asking a mailbox.

    Only the mailboxes that answered are replaced. One that failed keeps what it had, one that is gone from current loses it.
    """
    fresh = {view['id'] for view in views if view.get('folder') == 'inbox' and not view.get('read')}

    def change(state):
        mail = state.get('mail') if isinstance(state.get('mail'), dict) else {}
        kept = {
            mail_id for mail_id in mail.get('unread') or []
            if isinstance(mail_id, str) and mail_id.split('|', 1)[0] not in answered and (current is None or mail_id.split('|', 1)[0] in current)
        }
        state['mail'] = {'unread': sorted(kept | fresh)[:MAIL_UNREAD]}

    modify_dict('sync', change)


def note_read(mail_ids):
    def change(state):
        mail = state.get('mail') if isinstance(state.get('mail'), dict) else {}
        state['mail'] = {'unread': [mail_id for mail_id in mail.get('unread') or [] if mail_id not in mail_ids]}

    if mail_ids and set(mail_ids) & set(mail_unread_ids()):
        modify_dict('sync', change)


def _mailbox_of(mail_id):
    return mail_id.split('|', 1)[0]


def _is_iserv_mailbox(mailbox):
    return mailbox.endswith('@iserv')


def _drop_unread(state, gone):
    mail = state.get('mail') if isinstance(state.get('mail'), dict) else {}
    state['mail'] = {'unread': [mail_id for mail_id in mail.get('unread') or [] if isinstance(mail_id, str) and not gone(_mailbox_of(mail_id))]}


def mail_unread_ids(iserv=None):
    """The unread mails kept from the last fetch. With the IServ account given, mails of an IServ mailbox that is not its own drop out."""
    mail = load_dict('sync').get('mail')
    ids = [mail_id for mail_id in (mail.get('unread') or []) if isinstance(mail_id, str)] if isinstance(mail, dict) else []
    if iserv is None:
        return ids
    own = f"{iserv['name']}@iserv" if iserv.get('connected') else None
    return [mail_id for mail_id in ids if not _is_iserv_mailbox(_mailbox_of(mail_id)) or _mailbox_of(mail_id) == own]


def forget_mailbox(mailbox):
    """A mailbox was removed: its unread mails no longer count."""
    if mailbox and any(_mailbox_of(mail_id) == mailbox for mail_id in mail_unread_ids()):
        modify_dict('sync', lambda state: _drop_unread(state, lambda name: name == mailbox))


def page_email(data, school, settings, today, iserv):
    drafts, on_the_way = mail_draft_state()
    return {'messages': [], 'contacts': [], 'drafts': drafts, 'draftsPending': on_the_way}


def subject_use():
    """How many grades and how many dated entries of any kind each subject has. A subject that has some is kept when it is deleted."""
    use = {}
    for name, field in (('grades', 'grades'), *((store, 'entries') for store, _ in DEADLINE_KINDS.values())):
        try:
            items = load_list(name)
        except StoreError:
            continue
        for item in items:
            key = item.get('subject_id') if isinstance(item, dict) else None
            if isinstance(key, str) and key:
                use.setdefault(key, {'grades': 0, 'entries': 0})[field] += 1
    return use


def keep_used_subjects(value):
    """What to store for the own subjects, given what the page wants stored.

    The page decides from numbers it read when it loaded. An own subject that still has grades or entries is
    therefore never dropped here, only put aside: its grades stay visible and it can be brought back.
    """
    before = db.get_ui_store().get('app-subjects')
    old = before.get('items') if isinstance(before, dict) and isinstance(before.get('items'), dict) else {}
    wanted = value.get('items') if isinstance(value, dict) and isinstance(value.get('items'), dict) else {}
    use = subject_use()
    lost = [key for key, own in old.items() if is_own_subject(own) and not is_own_subject(wanted.get(key)) and any(use.get(key, {}).values())]
    if not lost:
        return value
    kept = dict(value) if isinstance(value, dict) else {}
    kept['items'] = {**wanted, **{key: old[key] for key in lost}}
    removed = kept.get('removed') if isinstance(kept.get('removed'), list) else []
    kept['removed'] = [*removed, *(key for key in lost if key not in removed)]
    return kept


def google_account():
    from . import calendar_cache
    try:
        return calendar_cache.settings_view()
    except Exception:
        return {'configured': False, 'connected': False, 'calendars': []}


def page_settings(data, school, settings, today, iserv):
    chosen = (chosen_weather_place(settings) or {}).get('city') or ''
    followed = weather_from_home(settings)
    city = chosen or followed or ''
    known = known_places()
    return {
        'school': {
            'name': iserv['school'],
            'town': city or '',
            'state': settings.get('bundesland') or '',
            'grade': data['user']['grade'],
            'semester': current_semester(today, data['user']['grade']),
            'birthday': iso_day(settings.get('birthday')) or '',
        },
        'states': [{'code': code, 'name': name} for code, name in STATES],
        'courses': school['courses'],
        'accounts': {
            'iserv': {key: value for key, value in iserv.items() if key != 'account'},
            'google': google_account(),
        },
        'notifications': copy.deepcopy(NOTIFY_DEFAULTS),
        'subjectUse': subject_use(),
        'places': {
            'weather': chosen,
            'weatherFromHome': followed,
            'weatherCanFollowHome': home_weather_place() is not None,
            'home': place_line(known.get('home')),
            'school': place_line(known.get('school')),
        },
        'about': {'version': '', 'license': 'PolyForm Noncommercial 1.0.0', 'website': brand.WEBSITE, 'source': brand.REPOSITORY},
    }


PAGE_BUILDERS = {
    'tasks': page_tasks,
    'calendar': page_calendar,
    'school': page_school,
    'vbb': page_transit,
    'email': page_email,
    'settings': page_settings,
    'assistant': page_assistant,
    'pomodoro': page_pomodoro,
    'bookmarks': page_bookmarks,
}


def _update_settings(columns):
    conn = db.get_connection()
    cursor = conn.cursor()
    db._execute(cursor, 'SELECT id FROM hub_timetable_settings ORDER BY id DESC LIMIT 1')
    row = db._fetchone_dict(cursor)
    names = list(columns)
    if row:
        assignments = ', '.join(f'{name} = ?' for name in names)
        db._execute(cursor, f'UPDATE hub_timetable_settings SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [*columns.values(), row['id']])
    else:
        db._execute(cursor, f"INSERT INTO hub_timetable_settings ({', '.join(names)}) VALUES ({', '.join('?' for _ in names)})", list(columns.values()))
    conn.commit()
    conn.close()


def mirror_store(key, value):
    if key == 'app-ab-weeks':
        _update_settings({'has_ab_weeks': 0 if value is False else 1})
    elif key == 'app-theme-choice' and value in ('light', 'dark'):
        db.save_user_theme(theme=value)
    elif key == 'app-settings' and isinstance(value, dict):
        school = value.get('school') if isinstance(value.get('school'), dict) else {}
        columns = {}
        grade = school.get('grade')
        if isinstance(grade, int) and 5 <= grade <= 13:
            columns['class_level'] = grade
            columns['grade_system'] = 'points' if grade >= 11 else 'marks'
        if 'birthday' in school:
            columns['birthday'] = iso_day(school.get('birthday')) or None
        if columns:
            _update_settings(columns)
