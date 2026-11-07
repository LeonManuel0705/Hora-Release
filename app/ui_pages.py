# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import threading
import time
from datetime import date, datetime
from pathlib import Path

from flask import Blueprint, current_app, g, jsonify, render_template, request, send_file

from . import calendar_cache
from . import database as db
from . import transit_service
from . import ui_assets
from . import ui_data

bp = Blueprint('ui', __name__)

STORE_KEYS = {
    'app-timetable-edits', 'app-block-times', 'app-ab-swap', 'app-ab-weeks', 'app-subjects', 'app-teachers', 'app-rooms',
    'app-settings', 'app-motion', 'app-theme-choice', 'app-single-keys', 'app-task-filter', 'app-cal-view',
    'app-assistant-basic',
}

PAGES = {
    'home': ('/hub', 'app/home.html'),
    'tasks': ('/hub/tasks', 'app/tasks.html'),
    'calendar': ('/hub/calendar', 'app/calendar.html'),
    'school': ('/hub/school', 'app/school.html'),
    'vbb': ('/hub/vbb', 'app/transit.html'),
    'email': ('/hub/email', 'app/email.html'),
    'pomodoro': ('/hub/pomodoro', 'app/pomodoro.html'),
    'settings': ('/hub/settings', 'app/settings.html'),
}


def code_stamp():
    return max((path.stat().st_mtime_ns for path in Path(__file__).resolve().parent.glob('*.py')), default=0)


LOADED_CODE = code_stamp()


def script_json(value):
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return (text.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
            .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))


def ui_settings(store):
    choice = store.get('app-theme-choice')
    if choice not in ('light', 'dark'):
        choice = 'auto' if 'app-theme-choice' in store or db.get_user_theme() not in ('light', 'dark') else db.get_user_theme()
    motion = 'minimal' if store.get('app-motion') == 'minimal' else 'calm'
    return {'theme': choice, 'motion': motion}


def pinned_day():
    try:
        return date.fromisoformat(request.args.get('datum', ''))
    except ValueError:
        return None


GATED_PAGES = {
    'assistant': 'app/assistant.html',
}


def render_page(active):
    template = PAGES[active][1] if active in PAGES else GATED_PAGES[active]
    g.strict_csp = True
    store = db.get_ui_store()
    day = pinned_day()
    now = datetime.combine(day, datetime.now().time()) if day else datetime.now()
    data = ui_data.build(active, store, now)
    return render_template(
        template,
        active=active,
        ui=ui_settings(store),
        data_json=script_json(data),
        store_json=script_json(store),
        asset_version=int(time.time()),
        offline_worker=True,
        server_behind=code_stamp() != LOADED_CODE,
    )


def _page_view(active):
    def view():
        return render_page(active)
    view.__name__ = f'ui_page_{active}'
    return view


for _active, (_path, _template) in PAGES.items():
    bp.add_url_rule(_path, view_func=_page_view(_active))


@bp.route('/sw.js')
def service_worker():
    body = render_template(
        'app/sw.js',
        version=ui_assets.asset_digest(),
        assets=ui_assets.asset_urls(),
        pages=[path for path, _ in PAGES.values()],
    )
    return current_app.response_class(body, mimetype='text/javascript', headers={'Cache-Control': 'no-cache'})


@bp.route('/api/ui/store/<key>', methods=['PUT', 'DELETE'])
def store_value(key):
    if key not in STORE_KEYS:
        return jsonify({'success': False, 'error': 'Unbekannter Schlüssel'}), 404
    value = None
    if request.method == 'PUT':
        if not request.is_json:
            return jsonify({'success': False, 'error': 'JSON erwartet'}), 415
        value = request.get_json(silent=True)
        if value is None and request.get_data(as_text=True).strip() != 'null':
            return jsonify({'success': False, 'error': 'Ungültiges JSON'}), 400
    if key == 'app-subjects':
        value = ui_data.keep_used_subjects(value)
    if request.method == 'DELETE' and value is None:
        db.delete_ui_value(key)
        ui_data.mirror_store(key, None)
        return jsonify({'success': True})
    try:
        db.save_ui_value(key, value)
    except ValueError:
        return jsonify({'success': False, 'error': 'Zu groß'}), 413
    ui_data.mirror_store(key, value)
    return jsonify({'success': True})


@bp.route('/api/ui/subjects/use')
def subject_use():
    """How much hangs on each subject right now. The settings ask before a subject is deleted, because their own count is from when the page loaded."""
    return jsonify({'success': True, 'use': ui_data.subject_use()})


@bp.route('/api/ui/export')
def export_records():
    try:
        return jsonify({'success': True, 'data': ui_data.export_records()})
    except ui_data.StoreError:
        return _error('Die Schuldaten ließen sich nicht lesen', 500)


@bp.route('/api/ui/transit/<action>')
def transit(action):
    result, status = transit_service.handle(action, request.args)
    return jsonify(result), status


def _payload():
    if not request.is_json:
        return None
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else None


def _error(message, status=400):
    return jsonify({'success': False, 'error': message}), status


def _text(value, limit):
    return str(value or '').strip()[:limit]


def _subjects(put_aside=False):
    """The subjects a new entry may name. With put_aside also own ones that were deleted but kept: a task keeps its subject when it is restored or repeats."""
    return ui_data.school_setup(db.get_timetable_settings() or {})['shown' if put_aside else 'known']


def _task_columns(payload, subjects, creating):
    columns = {}
    if 'title' in payload or creating:
        title = _text(payload.get('title'), 300)
        if not title:
            raise ValueError('Titel fehlt')
        columns['title'] = title
    if 'subject' in payload:
        columns['subject'] = payload['subject'] if payload['subject'] in subjects else None
    if 'date' in payload:
        columns['due_date'] = ui_data.iso_day(payload['date'])
    if 'someday' in payload:
        columns['someday'] = 1 if payload['someday'] else 0
    if 'dueTime' in payload:
        columns['due_time'] = ui_data.clock(payload['dueTime'])
    if 'minutes' in payload:
        minutes = payload['minutes']
        columns['minutes'] = minutes if isinstance(minutes, int) and 0 < minutes <= 1440 else None
    if 'priority' in payload:
        columns['priority'] = 'high' if payload['priority'] else 'medium'
    if 'repeat' in payload:
        columns['repeat_type'] = payload['repeat'] if payload['repeat'] in ui_data.REPEATS else 'none'
    if 'notes' in payload:
        columns['description'] = _text(payload.get('notes'), 5000)
    if 'deadline' in payload:
        columns['deadline_ref'] = _text(payload.get('deadline'), 60) or None
    if 'source' in payload:
        columns['source'] = 'iserv' if payload['source'] == 'iserv' else 'own'
    return columns


def _task_row(task_id):
    conn = db.get_connection()
    cursor = conn.cursor()
    db._execute(cursor, 'SELECT * FROM hub_tasks WHERE id = ?', (task_id,))
    row = db._fetchone_dict(cursor)
    conn.close()
    return row


@bp.route('/api/ui/tasks', methods=['POST'])
def create_task():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    subjects = _subjects(put_aside=True)
    try:
        columns = _task_columns(payload, subjects, creating=True)
    except ValueError as error:
        return _error(str(error))
    done = bool(payload.get('done'))
    columns.setdefault('priority', 'medium')
    columns.setdefault('repeat_type', 'none')
    columns['completed'] = 1 if done else 0
    columns['completed_at'] = datetime.now().isoformat() if done else None
    names = list(columns)
    conn = db.get_connection()
    cursor = conn.cursor()
    db._execute(cursor, f"INSERT INTO hub_tasks ({', '.join(names)}) VALUES ({', '.join('?' for _ in names)})", [columns[name] for name in names])
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'task': ui_data.task_view(_task_row(task_id), subjects)})


@bp.route('/api/ui/tasks/<int:task_id>', methods=['PATCH', 'DELETE'])
def change_task(task_id):
    if not _task_row(task_id):
        return _error('Aufgabe nicht gefunden', 404)
    if request.method == 'DELETE':
        db.delete_hub_task(task_id)
        return jsonify({'success': True})
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    subjects = _subjects(put_aside=True)
    try:
        columns = _task_columns(payload, subjects, creating=False)
    except ValueError as error:
        return _error(str(error))
    if 'done' in payload:
        columns['completed'] = 1 if payload['done'] else 0
        columns['completed_at'] = datetime.now().isoformat() if payload['done'] else None
    if columns:
        assignments = ', '.join(f'{name} = ?' for name in columns)
        conn = db.get_connection()
        cursor = conn.cursor()
        db._execute(cursor, f'UPDATE hub_tasks SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [*columns.values(), task_id])
        conn.commit()
        conn.close()
    return jsonify({'success': True, 'task': ui_data.task_view(_task_row(task_id), subjects)})


def _deadline_ref(ref):
    prefix, _, item_id = str(ref).partition('-')
    if prefix not in ui_data.DEADLINE_KINDS or not item_id:
        return None, None
    return prefix, item_id


def _deadline_payload(prefix, payload, item, subjects, creating):
    if 'title' in payload or creating:
        title = _text(payload.get('title'), 300)
        if not title:
            raise ValueError('Titel fehlt')
        item['title'] = title
    if 'subject' in payload:
        item['subject_id'] = payload['subject'] if payload['subject'] in subjects else ''
    if 'date' in payload or creating:
        when = ui_data.iso_day(payload.get('date'))
        if not when:
            raise ValueError('Datum fehlt')
        item['due_date' if prefix == 'hw' else 'date'] = when
    if 'detail' in payload:
        item['notes' if prefix == 'hw' else 'topics'] = _text(payload.get('detail'), 2000)
    if prefix != 'hw' and 'time' in payload:
        item['time'] = ui_data.clock(payload.get('time')) or ''
    if prefix == 'hw' and 'status' in payload:
        item['completed'] = payload['status'] == 'abgegeben'


@bp.route('/api/ui/deadlines', methods=['POST'])
def create_deadline():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    prefix = ui_data.DEADLINE_PREFIXES.get(payload.get('kind'))
    if not prefix:
        return _error('Unbekannte Art')
    school = ui_data.school_setup(db.get_timetable_settings() or {})
    item = {'id': ui_data.short_id(), 'created_at': datetime.now().isoformat()}
    if prefix == 'hw':
        item.update({'subject_id': '', 'notes': '', 'completed': False})
    else:
        item.update({'subject_id': '', 'time': '', 'topics': ''})
    try:
        _deadline_payload(prefix, payload, item, school['known'], creating=True)
    except ValueError as error:
        return _error(str(error))
    name = ui_data.DEADLINE_KINDS[prefix][0]
    try:
        ui_data.modify_list(name, lambda items: items.append(item))
    except ui_data.StoreError:
        return _error('Die Schuldaten ließen sich nicht lesen', 500)
    view = ui_data.deadline_view(prefix, item, school, date.today())
    return jsonify({'success': True, 'deadline': view})


@bp.route('/api/ui/deadlines/<ref>', methods=['PATCH', 'DELETE'])
def change_deadline(ref):
    prefix, item_id = _deadline_ref(ref)
    if not prefix:
        return _error('Unbekannter Eintrag', 404)
    name = ui_data.DEADLINE_KINDS[prefix][0]
    school = ui_data.school_setup(db.get_timetable_settings() or {})
    payload = None
    if request.method == 'PATCH':
        payload = _payload()
        if payload is None:
            return _error('JSON erwartet')

    def change(items):
        for index, item in enumerate(items):
            if str(item.get('id')) == item_id:
                if payload is None:
                    items.pop(index)
                    return {}
                _deadline_payload(prefix, payload, item, school['known'], creating=False)
                item['updated_at'] = datetime.now().isoformat()
                return item
        return None

    try:
        found = ui_data.modify_list(name, change)
    except ui_data.StoreError:
        return _error('Die Schuldaten ließen sich nicht lesen', 500)
    except ValueError as error:
        return _error(str(error))
    if found is None:
        return _error('Eintrag nicht gefunden', 404)
    if payload is None:
        return jsonify({'success': True})
    return jsonify({'success': True, 'deadline': ui_data.deadline_view(prefix, found, school, date.today())})


@bp.route('/api/ui/grades', methods=['POST'])
def create_grade():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    subjects = _subjects()
    points = payload.get('points')
    if payload.get('subject') not in subjects:
        return _error('Fach fehlt')
    if not isinstance(points, int) or not 0 <= points <= 15:
        return _error('Punkte fehlen')
    kind = payload.get('type') if payload.get('type') in ui_data.GRADE_TYPES else 'sonstiges'
    item = {
        'id': ui_data.full_id(),
        'subject_id': payload['subject'],
        'points': points,
        'type': kind,
        'date': ui_data.iso_day(payload.get('date')) or date.today().isoformat(),
        'description': _text(payload.get('title'), 300),
        'semester': _text(payload.get('semester'), 12) or 'Q1',
        'grade_system': 'points',
        'value': None,
        'created_at': datetime.now().isoformat(),
    }
    try:
        ui_data.modify_list('grades', lambda items: items.append(item))
    except ui_data.StoreError:
        return _error('Die Noten ließen sich nicht lesen', 500)
    return jsonify({'success': True, 'grade': {'id': f"g-{item['id']}", 'subject': item['subject_id'], 'points': points, 'type': kind, 'semester': item['semester'], 'date': item['date'], 'title': item['description']}})


@bp.route('/api/ui/grades/<ref>', methods=['DELETE'])
def delete_grade(ref):
    if not str(ref).startswith('g-'):
        return _error('Unbekannte Note', 404)
    grade_id = ref[2:]

    def change(items):
        before = len(items)
        items[:] = [item for item in items if str(item.get('id')) != grade_id]
        return before != len(items)

    try:
        removed = ui_data.modify_list('grades', change)
    except ui_data.StoreError:
        return _error('Die Noten ließen sich nicht lesen', 500)
    return jsonify({'success': True}) if removed else _error('Note nicht gefunden', 404)


EVENT_CATEGORIES = {'school': 'school', 'training': 'training', 'private': 'personal'}


def _event_payload(payload, item, creating):
    if 'title' in payload or creating:
        title = _text(payload.get('title'), 300)
        if not title:
            raise ValueError('Titel fehlt')
        item['title'] = title
    if 'date' in payload or creating:
        when = ui_data.iso_day(payload.get('date'))
        if not when:
            raise ValueError('Datum fehlt')
        item['date'] = when
    if 'endDate' in payload:
        item['end_date'] = ui_data.iso_day(payload.get('endDate')) or ''
    if 'start' in payload:
        item['time'] = ui_data.clock(payload.get('start')) or ''
    if 'end' in payload:
        item['end_time'] = ui_data.clock(payload.get('end')) or ''
    if 'place' in payload:
        item['location'] = _text(payload.get('place'), 300)
    if 'notes' in payload:
        item['description'] = _text(payload.get('notes'), 5000)
    if 'kind' in payload:
        item['category'] = EVENT_CATEGORIES.get(payload.get('kind'), 'personal')


@bp.route('/api/ui/events', methods=['POST'])
def create_event():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    item = {'id': ui_data.full_id(), 'time': '', 'end_date': '', 'end_time': '', 'category': 'personal', 'description': '', 'location': '', 'created_at': datetime.now().isoformat()}
    try:
        _event_payload(payload, item, creating=True)
    except ValueError as error:
        return _error(str(error))
    send = calendar_cache.touch(item)
    try:
        ui_data.modify_list('calendar', lambda items: items.append(item))
    except ui_data.StoreError:
        return _error('Der Kalender ließ sich nicht lesen', 500)
    if send:
        calendar_cache.push_soon()
    return jsonify({'success': True, 'event': ui_data.event_view(item)})


@bp.route('/api/ui/events/<ref>', methods=['PATCH', 'DELETE'])
def change_event(ref):
    if not str(ref).startswith('loc-'):
        return _error('Nur eigene Termine lassen sich hier ändern', 404)
    event_id = ref[4:]
    payload = None
    if request.method == 'PATCH':
        payload = _payload()
        if payload is None:
            return _error('JSON erwartet')

    sending = []

    def change(items):
        for index, item in enumerate(items):
            if str(item.get('id')) == event_id:
                if payload is None:
                    sending.append(calendar_cache.drop(items.pop(index)))
                    return {}
                _event_payload(payload, item, creating=False)
                item['updated_at'] = datetime.now().isoformat()
                sending.append(calendar_cache.touch(item))
                return item
        return None

    try:
        found = ui_data.modify_list('calendar', change)
    except ui_data.StoreError:
        return _error('Der Kalender ließ sich nicht lesen', 500)
    except ValueError as error:
        return _error(str(error))
    if found is None:
        return _error('Termin nicht gefunden', 404)
    if any(sending):
        calendar_cache.push_soon()
    if payload is None:
        return jsonify({'success': True})
    return jsonify({'success': True, 'event': ui_data.event_view(found)})


# The page lets a new note have a title of 300 and a text of 5000 characters. The older interface set no limit, and
# such a note must survive an edit or a delete that is undone, so the bounds here are only there to keep the file sane.
NOTE_TITLE, NOTE_TEXT = 1000, 100000


@bp.route('/api/ui/notes', methods=['POST'])
def create_note():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    title = _text(payload.get('title'), NOTE_TITLE)
    if not title:
        return _error('Titel fehlt')
    try:
        created = datetime.fromisoformat(str(payload.get('created') or '')).isoformat()
    except ValueError:
        created = datetime.now().isoformat()
    note = {
        'id': ui_data.full_id(),
        'type': 'idea' if payload.get('type') == 'idea' else 'note',
        'title': title,
        'content': _text(payload.get('details'), NOTE_TEXT),
        'created_at': created,
    }
    try:
        ui_data.modify_list('notes', lambda items: items.append(note))
    except ui_data.StoreError:
        return _error('Die Notizen ließen sich nicht lesen', 500)
    return jsonify({'success': True, 'note': ui_data.note_view(note)})


@bp.route('/api/ui/notes/<ref>', methods=['PATCH', 'DELETE'])
def change_note(ref):
    payload = _payload() if request.method == 'PATCH' else {}
    if payload is None:
        return _error('JSON erwartet')
    if 'title' in payload and not _text(payload.get('title'), NOTE_TITLE):
        return _error('Titel fehlt')
    found = {}

    def change(items):
        for index, item in enumerate(items):
            if not isinstance(item, dict) or str(item.get('id')) != ref:
                continue
            if request.method == 'DELETE':
                del items[index]
            else:
                if not str(item.get('title') or '').strip():
                    # The page shows the first line of such a note as its title and sends only what changed.
                    # Stored the same way first, a change to one part cannot swallow the other.
                    shown = ui_data.note_view(item)
                    item['title'], item['content'] = shown['title'], shown['details']
                if 'title' in payload:
                    item['title'] = _text(payload.get('title'), NOTE_TITLE)
                if 'details' in payload:
                    item['content'] = _text(payload.get('details'), NOTE_TEXT)
                if payload.get('type') in ('note', 'idea'):
                    item['type'] = payload['type']
            found.update(item)
            return True
        return False

    try:
        changed = ui_data.modify_list('notes', change)
    except ui_data.StoreError:
        return _error('Die Notizen ließen sich nicht lesen', 500)
    return jsonify({'success': True, 'note': ui_data.note_view(found)}) if changed else _error('Notiz nicht gefunden', 404)


def _synced_macos(start, end):
    from .calendar_service import get_macos_calendar_events
    days = max(1, min(365, (date.fromisoformat(end) - date.today()).days))
    result = get_macos_calendar_events(days)
    if not result.get('success'):
        return None
    events = []
    for index, item in enumerate(result.get('events', [])):
        day = ui_data.iso_day(item.get('date'))
        if not day or day < start or day > end:
            continue
        events.append({
            'id': f'm-{day}-{index}',
            'date': day,
            'start': ui_data.clock(item.get('time')),
            'end': None,
            'title': str(item.get('title') or 'Termin'),
            'place': str(item.get('location') or ''),
            'kind': calendar_cache.kind_of(item.get('calendar'), item.get('title')),
            'notes': str(item.get('description') or '')[:2000],
            'source': 'dem Mac-Kalender',
            'synced': True,
        })
    return events


SYNC_PROBLEMS = {
    'login': 'Die Anmeldung bei Google ist abgelaufen. Verbinde Google in den Einstellungen neu.',
    'offline': 'Google ist gerade nicht erreichbar.',
}


def _google_range(start, end):
    from .google_oauth import fetch_google_calendar_events
    result = fetch_google_calendar_events(start_date=start, end_date=end)
    if not result.get('success'):
        return None
    hidden = calendar_cache.hidden_calendars()
    linked = {item.get('google_id') for item in ui_data.load_list('calendar') if item.get('google_id')}
    views = [calendar_cache.view(item) for item in result.get('events', []) if item.get('calendar_id') not in hidden and item.get('id') not in linked]
    return [view for view in views if view]


@bp.route('/api/ui/events/synced')
def synced_events():
    today = date.today()
    first, last = calendar_cache.window(today)
    start = ui_data.iso_day(request.args.get('start')) or first.isoformat()
    end = ui_data.iso_day(request.args.get('end')) or last.isoformat()
    if end < start or (date.fromisoformat(end) - date.fromisoformat(start)).days > 400:
        return _error('Zeitraum ungültig')
    if calendar_cache.connected():
        mode = request.args.get('frisch')
        problem = None
        if mode in ('1', 'alles') or calendar_cache.due():
            problem = calendar_cache.refresh(force=mode == 'alles')
        if calendar_cache.covers(start, end) or request.args.get('start') is None:
            events = calendar_cache.events(start, end)
        else:
            try:
                events = _google_range(start, end)
            except Exception:
                events = None
            if events is None:
                events, problem = calendar_cache.events(start, end), problem or 'offline'
        own = [view for view in (ui_data.event_view(item) for item in ui_data.load_list('calendar')) if view]
        first, last = calendar_cache.window(today)
        return jsonify({
            'success': True,
            'events': events,
            'own': own,
            'source': 'google',
            'stand': calendar_cache.stand(),
            'window': {'start': first.isoformat(), 'end': last.isoformat()},
            'problem': problem,
            'message': SYNC_PROBLEMS.get(problem, ''),
        })
    try:
        events = _synced_macos(start, end)
    except Exception:
        events = None
    return jsonify({'success': True, 'events': events or [], 'source': 'mac' if events is not None else None})


@bp.route('/api/ui/google/nudge', methods=['POST'])
def google_nudge():
    """A page came to the front. The background check follows soon, the answer does not wait for it."""
    if calendar_cache.connected():
        calendar_cache.nudge()
    return jsonify({'success': True, **calendar_cache.page_state()})


@bp.route('/api/ui/google/events')
def google_events():
    """The events as a page gets them when it is built, for a page that stays open while the copy changes."""
    today = pinned_day() or date.today()
    return jsonify({'success': True, 'events': ui_data.events(today), **calendar_cache.page_state()})


PLAN_PROBLEMS = {
    'setup': 'IServ ist nicht verbunden.',
    'login': 'Die Anmeldung bei IServ ist abgelaufen. Verbinde IServ in den Einstellungen neu.',
    'empty': 'IServ zeigt gerade keinen Vertretungsplan.',
    'offline': 'IServ ist gerade nicht erreichbar.',
}


def _plan_problem(result):
    if result.get('success') and not result.get('from_cache'):
        return None
    if result.get('cause') in PLAN_PROBLEMS:
        return result['cause']
    if result.get('needs_setup'):
        return 'setup'
    if result.get('needs_reconnect'):
        return 'login'
    if result.get('iserv_connected') or result.get('fetch_error') == 'Keine PDFs gefunden':
        return 'empty'
    return 'offline'


@bp.route('/api/ui/vplan')
def substitution_plan():
    from .iserv_service import get_iserv_service
    service = get_iserv_service()
    problem = None
    if request.args.get('frisch') == '1':
        try:
            problem = _plan_problem(service.get_vertretungsplan_pdfs())
        except Exception:
            problem = 'offline'
    cache = service.plan_cache() or {'files': [], 'cached_at': None}
    stamp = re.sub(r'\D', '', str(cache['cached_at'] or ''))[:14]
    files = [
        {'page': index, 'type': 'pdf' if entry['type'] == 'pdf' else 'image', 'url': f"/api/ui/vplan/datei/{index}?v={entry.get('digest') or stamp}"}
        for index, entry in enumerate(cache['files'], start=1)
    ]
    return jsonify({
        'success': True,
        'files': files,
        'cachedAt': str(cache['cached_at'] or '')[:16] or None,
        'problem': problem,
        'message': PLAN_PROBLEMS.get(problem, ''),
    })


@bp.route('/api/ui/vplan/datei/<int:page>')
def substitution_plan_file(page):
    from .iserv_service import get_iserv_service
    cache = get_iserv_service().plan_cache()
    files = cache['files'] if cache else []
    if not 1 <= page <= len(files):
        return _error('Seite nicht gefunden', 404)
    entry = files[page - 1]
    g.frame_same_origin = True
    response = send_file(entry['path'], mimetype=entry['content_type'], max_age=0)
    response.headers['Cache-Control'] = 'private, no-store'
    suffix = entry['path'].suffix
    response.headers['Content-Disposition'] = f'inline; filename="vertretungsplan-{page}{suffix}"'
    return response


def _weather_follows_home(refresh=False):
    """The town the forecast takes from home, as ui_data.weather_from_home tells it. With refresh the forecast for it is fetched."""
    settings = {'location_json': db.get_location_setting()}
    town = ui_data.weather_from_home(settings)
    if town is not None and refresh:
        ui_data.refresh_weather_soon(ui_data.home_weather_place())
    return town


@bp.route('/api/ui/places/<key>', methods=['PUT', 'DELETE'])
def save_place(key):
    if key not in ('home', 'school'):
        return _error('Unbekannter Ort', 404)
    from .vbb_service import get_vbb_service
    service = get_vbb_service()
    if request.method == 'DELETE':
        known = (service.get_known_locations().get('locations') or {}).get(key)
        service.delete_known_location(key)
        removed = ui_data.place_record(known)
        return jsonify({'success': True, 'removed': removed, **({'weatherFromHome': _weather_follows_home(), 'weatherCanFollowHome': False} if key == 'home' else {})})
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    try:
        lat, lon = float(payload.get('lat')), float(payload.get('lon'))
    except (TypeError, ValueError):
        return _error('Koordinaten fehlen')
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return _error('Koordinaten ungültig')
    name = _text(payload.get('name'), 120)
    if not name:
        return _error('Name fehlt')
    location = {
        'id': _text(payload.get('stop'), 120),
        'name': name,
        'type': 'stop' if payload.get('stop') else 'location',
        'latitude': lat,
        'longitude': lon,
        'address': _text(payload.get('area'), 120),
    }
    service.save_known_location(key, location)
    answer = {'success': True, 'place': ui_data.place_view('Zuhause' if key == 'home' else 'Schule', location)}
    if key == 'home':
        answer.update(weatherFromHome=_weather_follows_home(refresh=True), weatherCanFollowHome=ui_data.home_weather_place() is not None)
    return jsonify(answer)


@bp.route('/api/ui/weather/place', methods=['PUT'])
def weather_place():
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    name = _text(payload.get('name'), 80)
    if not name:
        if not ui_data.home_weather_place():
            return _error('Trag einen Ort ein, zum Beispiel Potsdam.')
        db.save_location_setting('')
        return jsonify({'success': True, 'place': '', 'weatherFromHome': _weather_follows_home(refresh=True)})
    try:
        place = ui_data.geocode(name)
    except Exception:
        return _error('Die Ortssuche ist gerade nicht erreichbar. Versuch es später noch einmal.', 502)
    if not place:
        return _error('Diesen Ort finde ich nicht. Versuch es mit dem Namen der Stadt.', 404)
    db.save_location_setting(json.dumps(place))
    ui_data.refresh_weather_soon(place)
    return jsonify({'success': True, 'place': place['city']})


def _mail_accounts():
    from .email_service import get_email_accounts
    from .google_oauth import get_google_accounts
    from .iserv_service import get_iserv_service
    accounts = []
    for item in get_email_accounts():
        if item.get('email'):
            accounts.append({'email': item['email'], 'kind': 'imap', 'name': item['email']})
    for item in get_google_accounts():
        if item.get('email'):
            accounts.append({'email': item['email'], 'kind': 'gmail', 'name': item['email']})
    status = get_iserv_service().get_status()
    if status.get('has_credentials') or status.get('connected'):
        username = status.get('username') or 'IServ'
        accounts.append({'email': f'{username}@iserv', 'kind': 'iserv', 'name': f'IServ ({username})'})
    return accounts


def _mail_view(account, item):
    stamp = str(item.get('date') or '').strip().replace(' ', 'T')[:16]
    try:
        datetime.fromisoformat(stamp)
    except ValueError:
        stamp = datetime.now().strftime('%Y-%m-%dT%H:%M')
    sender = str(item.get('from') or '')
    name = str(item.get('from_name') or sender.split('@')[0] or 'Unbekannt')
    return {
        'id': f"{account['email']}|{item.get('id')}",
        'account': account['email'],
        'uid': str(item.get('id')),
        'folder': 'inbox',
        'direction': 'in',
        'peer': {'name': name, 'role': 'other', 'detail': sender},
        'to': account['email'],
        'received': stamp,
        'read': bool(item.get('read')),
        'flagged': False,
        'subject': str(item.get('subject') or ''),
        'body': str(item.get('preview') or ''),
        'partial': True,
        'attachments': [],
    }


def _fetch_inbox(account, limit):
    from .email_service import fetch_emails
    from .google_oauth import fetch_gmail_messages
    from .iserv_service import get_iserv_service
    if account['kind'] == 'iserv':
        service = get_iserv_service()
        if not service.is_connected():
            service.connect()
        result = service.get_emails(limit=limit)
        items = []
        for entry in result.get('emails', []) if result.get('success') else []:
            if isinstance(entry, dict):
                items.append({
                    'id': entry.get('uid') or entry.get('id'),
                    'from': entry.get('from', entry.get('sender', '')),
                    'from_name': entry.get('from_name', ''),
                    'subject': entry.get('subject', ''),
                    'date': entry.get('date', ''),
                    'preview': entry.get('preview', entry.get('snippet', '')),
                    'read': entry.get('read', not entry.get('unseen', False)),
                })
        return result.get('success', False), items
    result = fetch_gmail_messages(account['email'], limit) if account['kind'] == 'gmail' else fetch_emails(account['email'], 'INBOX', limit)
    return result.get('success', False), result.get('emails', []) if result.get('success') else []


@bp.route('/api/ui/mail')
def mail_inbox():
    try:
        accounts = _mail_accounts()
    except Exception:
        return _error('Postfächer ließen sich nicht lesen', 500)
    messages, failed = [], []
    for account in accounts:
        try:
            ok, items = _fetch_inbox(account, 40)
        except Exception:
            ok, items = False, []
        if not ok:
            failed.append(account['name'])
        messages.extend(_mail_view(account, item) for item in items if item.get('id') is not None)
    archived = ui_data.archived_mails()
    sent_along = set()
    for message in messages:
        if message['id'] in archived:
            message['folder'] = 'archive'
            sent_along.add(message['id'])
    # A mailbox only sends its newest mails. Older archived ones are listed from what was kept of them, their text is fetched when one is opened.
    connected = {account['email']: account for account in accounts}
    for key, entry in archived.items():
        address, _, uid = key.partition('|')
        kept = entry.get('mail')
        if key in sent_along or address not in connected or not uid or not isinstance(kept, dict):
            continue
        view = _mail_view(connected[address], {**kept, 'id': uid, 'read': True})
        view.update(folder='archive', old=True)
        messages.append(view)
    return jsonify({'success': True, 'accounts': accounts, 'messages': messages, 'failed': failed})


MAIL_DRAFTS, MAIL_ARCHIVE, MAIL_BODY = 500, 2000, 100000
DRAFT_ID = r'draft-[0-9a-z-]{1,40}'
# Once a mail is out, only the id of its draft is kept for a while. A second page that still shows the draft
# can then neither send the mail again nor store the draft back.
SENT_DRAFTS = 200
ALREADY_SENT = 'Diese Mail ist schon rausgegangen'
# The drafts whose mail is being handed to the mail server right now. Two pages pressing "Senden" for the same
# draft at the same moment would otherwise both pass the look at what was sent before.
_sending_now = set()
_sending_lock = threading.Lock()


def _sent(item):
    return isinstance(item, dict) and bool(item.get('sent_at'))


@bp.route('/api/ui/mail/drafts')
def mail_draft_list():
    """The drafts once more. A page loaded while a mail was on its way asks again, in case that mail did not go out after all."""
    drafts, on_the_way = ui_data.mail_draft_state()
    return jsonify({'success': True, 'drafts': drafts, 'pending': on_the_way})


@bp.route('/api/ui/mail/drafts/<ref>', methods=['PUT', 'DELETE'])
def mail_draft(ref):
    """Keeps a mail that is being written, so that it outlives the page. Drafts stay on this device and are not sent anywhere."""
    if not re.fullmatch(DRAFT_ID, ref):
        return _error('Entwurf nicht gefunden', 404)
    draft = None
    if request.method == 'PUT':
        payload = _payload()
        if payload is None:
            return _error('JSON erwartet')
        draft = {
            'id': ref,
            'to': _text(payload.get('to'), 300),
            'subject': _text(payload.get('subject'), 300),
            'body': str(payload.get('body') or '')[:MAIL_BODY],
            'reply_to': _text(payload.get('replyTo'), 300) or None,
            'account': _text(payload.get('account'), 200) or None,
            'saved_at': datetime.now().isoformat(timespec='seconds'),
        }
        if payload.get('sending'):
            draft['sending_at'] = time.time()
        if not (draft['to'] or draft['subject'] or draft['body'].strip()):
            draft = None

    def change(items):
        if any(_sent(item) and item.get('id') == ref for item in items):
            return 'sent'
        kept = [item for item in items if not (isinstance(item, dict) and item.get('id') == ref)]
        # Something written is never dropped to make room: a further draft is refused instead.
        if draft and len(kept) == len(items) and sum(1 for item in kept if not _sent(item)) >= MAIL_DRAFTS:
            return 'full'
        items[:] = [*kept, draft] if draft else kept
        return 'stored'

    try:
        outcome = ui_data.modify_list('mail_drafts', change)
    except ui_data.StoreError:
        return _error('Die Entwürfe ließen sich nicht lesen', 500)
    if outcome == 'sent':
        # A delete has nothing left to do. Storing it again would bring back the draft of a mail that went out.
        return jsonify({'success': True}) if request.method == 'DELETE' else (jsonify({'success': False, 'error': ALREADY_SENT, 'sent': True}), 409)
    return jsonify({'success': True}) if outcome == 'stored' else _error('Zu viele Entwürfe. Räum zuerst den Ordner Entwürfe auf', 409)


@bp.route('/api/ui/mail/archive', methods=['PUT'])
def mail_archive():
    """Remembers which mails were put into the archive here. The mailbox itself is left as it is."""
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    key = _text(payload.get('id'), 500)
    if not key or '|' not in key:
        return _error('Mail fehlt')
    entry = None
    if payload.get('archived'):
        shown = payload.get('mail') if isinstance(payload.get('mail'), dict) else {}
        sender = shown.get('peer') if isinstance(shown.get('peer'), dict) else {}
        entry = {'id': key, 'at': datetime.now().isoformat(timespec='seconds')}
        if shown:
            entry['mail'] = {
                'subject': _text(shown.get('subject'), 300),
                'from_name': _text(sender.get('name'), 200),
                'from': _text(sender.get('detail'), 300),
                'date': _text(shown.get('received'), 16),
                'preview': _text(shown.get('body'), 300),
            }

    def change(items):
        kept = [item for item in items if not (isinstance(item, dict) and item.get('id') == key)]
        items[:] = ([*kept, entry] if entry else kept)[-MAIL_ARCHIVE:]
        return True

    try:
        ui_data.modify_list('mail_archive', change)
    except ui_data.StoreError:
        return _error('Das Archiv ließ sich nicht lesen', 500)
    return jsonify({'success': True})


def _mail_target():
    account = _text(request.args.get('account'), 200)
    uid = _text(request.args.get('id'), 200)
    if not account or not uid:
        return None, None
    return account, uid


@bp.route('/api/ui/mail/message', methods=['GET', 'DELETE'])
def mail_message():
    from .email_service import delete_email, get_email_detail
    from .google_oauth import delete_gmail_message, get_gmail_message_detail, get_google_accounts
    from .iserv_service import get_iserv_service
    account, uid = _mail_target()
    if not account:
        return _error('Mail fehlt')
    google = {item['email'] for item in get_google_accounts()}
    try:
        if request.method == 'DELETE':
            if account.endswith('@iserv'):
                return _error('IServ-Mails lassen sich hier noch nicht löschen', 400)
            result = delete_gmail_message(account, uid, permanent=False) if account in google else delete_email(account, uid)
            return jsonify({'success': True}) if result.get('success') else _error('Die Mail ließ sich nicht löschen')
        if account.endswith('@iserv'):
            service = get_iserv_service()
            if not service.is_connected():
                service.connect()
            result = service.get_email_detail(uid)
        elif account in google:
            result = get_gmail_message_detail(account, uid)
        else:
            result = get_email_detail(account, uid, 'INBOX')
    except Exception:
        return _error('Die Mail ließ sich nicht laden', 502)
    if result.get('gone'):
        return jsonify({'success': False, 'error': 'Diese Mail gibt es im Postfach nicht mehr', 'gone': True}), 404
    if not result.get('success'):
        return _error('Die Mail ließ sich nicht laden', 502)
    detail = result.get('email') or {}
    return jsonify({'success': True, 'body': str(detail.get('body') or ''), 'to': str(detail.get('to') or '')})


@bp.route('/api/ui/mail/send', methods=['POST'])
def mail_send():
    from .email_service import send_email
    from .google_oauth import get_google_accounts, send_gmail
    from .iserv_service import get_iserv_service
    payload = _payload()
    if payload is None:
        return _error('JSON erwartet')
    account = _text(payload.get('account'), 200)
    to = _text(payload.get('to'), 300)
    subject = _text(payload.get('subject'), 300) or '(ohne Betreff)'
    body = str(payload.get('body') or '')[:MAIL_BODY]
    if not account or not to:
        return _error('Absender oder Empfänger fehlt')
    # The page keeps the mail as a draft until it is out. What becomes of that draft is settled here, together with
    # the sending, because the page may be gone by the time the mail server answers.
    draft = _text(payload.get('draft'), 60)

    def settle_draft(outcome):
        """Marks the draft as on its way, as not sent, or as sent. Tells True if its mail went out before."""
        def change(items):
            found = next((item for item in items if isinstance(item, dict) and item.get('id') == draft), None)
            if _sent(found):
                return True
            if outcome == 'sent':
                others = [item for item in items if item is not found]
                gone = [item for item in others if _sent(item)][:-(SENT_DRAFTS - 1)]
                items[:] = [item for item in others if not any(item is old for old in gone)] + [{'id': draft, 'sent_at': time.time()}]
            elif found and outcome == 'sending':
                found['sending_at'] = time.time()
            elif found:
                found.pop('sending_at', None)
                found['unsent'] = True
            return False

        if not re.fullmatch(DRAFT_ID, draft):
            return False
        try:
            return ui_data.modify_list('mail_drafts', change)
        except ui_data.StoreError:
            return False

    with _sending_lock:
        taken = draft in _sending_now
        if draft and not taken:
            _sending_now.add(draft)
    if taken:
        return jsonify({'success': False, 'error': ALREADY_SENT, 'sent': True}), 409
    try:
        if settle_draft('sending'):
            return jsonify({'success': False, 'error': ALREADY_SENT, 'sent': True}), 409
        try:
            if account.endswith('@iserv'):
                service = get_iserv_service()
                if not service.is_connected():
                    service.connect()
                result = service.send_email(to=to, subject=subject, body=body)
            elif account in {item['email'] for item in get_google_accounts()}:
                result = send_gmail(account, to, subject, body)
            else:
                result = send_email(account, to, subject, body)
        except Exception:
            settle_draft('unsent')
            return _error('Senden ging gerade nicht', 502)
        if not result.get('success'):
            settle_draft('unsent')
            return _error('Der Mailserver hat die Nachricht nicht angenommen. Prüf die Adresse und versuch es noch einmal', 502)
        settle_draft('sent')
        return jsonify({'success': True})
    finally:
        _sending_now.discard(draft)
