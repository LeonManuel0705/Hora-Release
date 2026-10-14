# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import database as db
from app import ui_data
from app.crypto_utils import decrypt_file

ROOT = Path(__file__).resolve().parent.parent
PHONE = ROOT / 'flutter_app' / 'lib' / 'web_ui'
SCRIPTS = ROOT / 'app' / 'static' / 'app' / 'js'
PAGES = ['/hub', '/hub/tasks', '/hub/calendar', '/hub/school']


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    from app import app as app_module
    from app.app import app

    app.config['TESTING'] = True
    with app.test_client() as client:
        client.get(f'/hub?token={app_module.API_TOKEN}')
        yield client
    # The data folder is shared by all tests of a run, and the assistant reads presentations straight from it.
    ui_data.modify_list('talks', lambda items: items.clear())


def page_data(client, path):
    html = client.get(path).get_data(as_text=True)
    match = re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S)
    return json.loads(match.group(1))


def day(offset):
    return (date.today() + timedelta(days=offset)).isoformat()


def own_subject(client, key, removed=False):
    own = {'custom': True, 'name': 'Geografie', 'short': 'Geo', 'hue': 'moss', 'type': 'GK', 'teacher': '', 'room': ''}
    assert client.put('/api/ui/store/app-subjects', json={'items': {key: own}, 'removed': [key] if removed else []}).status_code == 200


def create(client, **fields):
    body = {'kind': 'Vortrag', 'title': 'Stadtklima', 'date': day(5), **fields}
    return client.post('/api/ui/deadlines', json=body)


def listed(client, path, ref):
    return [item for item in page_data(client, path)['deadlines'] if item['id'] == ref]


def test_a_presentation_is_entered_changed_and_removed_like_a_test(client):
    own_subject(client, 'geo-talk')
    talk = create(client, subject='geo-talk', detail='10 Minuten, mit Handout').get_json()['deadline']
    assert talk['kind'] == 'Vortrag' and talk['id'].startswith('talk-')
    assert (talk['title'], talk['subject'], talk['date'], talk['detail'], talk['status']) == ('Stadtklima', 'geo-talk', day(5), '10 Minuten, mit Handout', 'offen')
    for path in PAGES:
        assert listed(client, path, talk['id']) == [talk], path

    changed = client.patch(f"/api/ui/deadlines/{talk['id']}", json={'title': 'Stadtgrün', 'date': day(8), 'detail': '', 'time': '9:50'}).get_json()['deadline']
    assert (changed['kind'], changed['title'], changed['date'], changed['detail'], changed['time']) == ('Vortrag', 'Stadtgrün', day(8), '', '09:50')
    assert listed(client, '/hub/school', talk['id']) == [changed]

    assert client.delete(f"/api/ui/deadlines/{talk['id']}").status_code == 200
    assert client.delete(f"/api/ui/deadlines/{talk['id']}").status_code == 404
    assert client.patch(f"/api/ui/deadlines/{talk['id']}", json={'title': 'Zu spät'}).status_code == 404
    assert listed(client, '/hub/school', talk['id']) == []


def test_presentations_have_a_file_of_their_own_that_outlives_the_running_app(client):
    talk = create(client, title='Klimawandel in der Arktis').get_json()['deadline']
    on_disk = lambda: [item['title'] for item in decrypt_file(ui_data.DATA_DIR / 'school_talks.json')]
    assert 'Klimawandel in der Arktis' in on_disk()
    assert b'Klimawandel' not in (ui_data.DATA_DIR / 'school_talks.json').read_bytes()
    for name in ('tests', 'exams', 'homework'):
        assert 'Klimawandel in der Arktis' not in [item['title'] for item in ui_data.load_list(name)]

    ui_data._cache.clear()
    assert [item['title'] for item in listed(client, '/hub/school', talk['id'])] == ['Klimawandel in der Arktis']
    assert client.delete(f"/api/ui/deadlines/{talk['id']}").status_code == 200
    assert 'Klimawandel in der Arktis' not in on_disk()


def test_a_presentation_needs_a_title_a_date_and_its_own_word(client):
    assert create(client, title=' ').status_code == 400
    assert create(client, date='bald').status_code == 400
    for word in ('Referat', 'vortrag', 'talk', None):
        assert create(client, kind=word).status_code == 400, word
    assert client.patch('/api/ui/deadlines/talk-', json={'title': 'Ohne Nummer'}).status_code == 404
    assert client.delete('/api/ui/deadlines/talk-gibtsnicht').status_code == 404


def test_a_presentation_takes_only_subjects_that_can_be_chosen(client):
    own_subject(client, 'geo-gone', removed=True)
    assert create(client, subject='geo-gone').get_json()['deadline']['subject'] is None
    assert create(client, subject='nirgends').get_json()['deadline']['subject'] is None


def test_a_held_presentation_stays_in_the_page_data_as_long_as_a_written_test(client):
    for offset in (-3, -100, -300):
        assert create(client, title=f'Vortrag {offset}', date=day(offset)).status_code == 200
    titles = [item['title'] for item in page_data(client, '/hub')['deadlines']]
    assert [title for title in titles if title.startswith('Vortrag -')] == ['Vortrag -100', 'Vortrag -3']


def test_an_own_subject_with_nothing_but_a_presentation_is_put_aside_not_dropped(client):
    own_subject(client, 'geo-vortrag')
    talk = create(client, subject='geo-vortrag').get_json()['deadline']
    assert client.get('/api/ui/subjects/use').get_json()['use']['geo-vortrag'] == {'grades': 0, 'entries': 1}
    assert page_data(client, '/hub/settings')['page']['subjectUse']['geo-vortrag'] == {'grades': 0, 'entries': 1}

    assert client.put('/api/ui/store/app-subjects', json={'items': {}, 'removed': []}).status_code == 200
    stored = db.get_ui_store()['app-subjects']
    assert set(stored['items']) == {'geo-vortrag'} and stored['removed'] == ['geo-vortrag']
    assert [item['subject'] for item in listed(client, '/hub/school', talk['id'])] == ['geo-vortrag']

    assert client.delete(f"/api/ui/deadlines/{talk['id']}").status_code == 200
    assert 'geo-vortrag' not in client.get('/api/ui/subjects/use').get_json()['use']
    assert client.delete('/api/ui/store/app-subjects').status_code == 200
    assert 'app-subjects' not in db.get_ui_store()


def test_a_grade_can_be_marked_as_a_presentation(client):
    own_subject(client, 'geo-note')
    semester = page_data(client, '/hub/school')['page']['semester']
    grade = client.post('/api/ui/grades', json={'subject': 'geo-note', 'points': 13, 'type': 'vortrag', 'semester': semester, 'title': 'Stadtklima'}).get_json()['grade']
    assert grade['type'] == 'vortrag'
    shown = [item for item in page_data(client, '/hub/school')['page']['grades'] if item['id'] == grade['id']]
    assert [(item['type'], item['points'], item['title']) for item in shown] == [('vortrag', 13, 'Stadtklima')]
    other = client.post('/api/ui/grades', json={'subject': 'geo-note', 'points': 9, 'type': 'referat', 'semester': semester}).get_json()['grade']
    assert other['type'] == 'sonstiges'
    for item in (grade, other):
        assert client.delete(f"/api/ui/grades/{item['id']}").status_code == 200


def test_every_kind_of_entry_has_its_word_its_store_and_its_file():
    assert ui_data.DEADLINE_KINDS['talk'] == ('talks', 'Vortrag')
    assert ui_data.DEADLINE_PREFIXES == {'Hausaufgabe': 'hw', 'Test': 'test', 'Klausur': 'exam', 'Vortrag': 'talk'}
    stores = [store for store, _ in ui_data.DEADLINE_KINDS.values()]
    assert all(store in ui_data.FILES and store in ui_data._locks for store in stores)
    assert len({ui_data.FILES[store] for store in stores}) == len(stores)


def phone_table(name):
    source = (PHONE / 'ui_data.dart').read_text(encoding='utf-8')
    body = re.search(rf'^const {name} = \{{(.*?)\}};$', source, re.M).group(1)
    return dict(re.findall(r"'([^']+)': '([^']+)'", body))


def test_the_phone_keeps_the_same_kinds_as_the_server():
    assert phone_table('uiDeadlineKinds') == {prefix: word for prefix, (_, word) in ui_data.DEADLINE_KINDS.items()}
    assert set(phone_table('uiDeadlineTables')) == set(ui_data.DEADLINE_KINDS)
    assert set(phone_table('uiGradeWords')) == set(ui_data.GRADE_TYPES)
    assert set(phone_table('uiGradeTypes').values()) <= set(ui_data.GRADE_TYPES)
    made = re.search(r'for \(final table in const \[(.*?)\]\)', (PHONE / 'ui_db.dart').read_text(encoding='utf-8')).group(1)
    assert set(re.findall(r"'(\w+)'", made)) == set(phone_table('uiDeadlineTables').values()) - {'homework'}


def test_the_pages_know_the_same_kinds_as_the_server():
    core = (SCRIPTS / 'core.js').read_text(encoding='utf-8')
    school = (SCRIPTS / 'pages' / 'school.js').read_text(encoding='utf-8')
    table = core.split('export const ASSESSMENTS = {', 1)[1].split('};', 1)[0]
    words = {word for _, word in ui_data.DEADLINE_KINDS.values()}
    assert set(re.findall(r'^  (\w+): \{', table, re.M)) == words - {'Hausaufgabe'}
    changeable = re.search(r'const editable = .*?/\^\(([a-z|]+)\)-/', school).group(1)
    assert set(changeable.split('|')) == {*ui_data.DEADLINE_KINDS, 'new'}
    grades = re.search(r'^const GRADE_TYPES = \{(.*?)\};$', school, re.M).group(1)
    assert re.findall(r'(\w+): "', grades) == list(ui_data.GRADE_TYPES)


def test_the_reminder_switch_for_tests_names_presentations_too():
    label = lambda categories: next(item['label'] for item in categories if item['key'] == 'tests')
    assert label(ui_data.NOTIFY_DEFAULTS['categories']) == 'Tests, Klausuren und Vorträge'
    assert "'key': 'tests', 'label': 'Tests, Klausuren und Vorträge'" in (PHONE / 'ui_data.dart').read_text(encoding='utf-8')


def test_kinds_and_their_reminders_hold_up_under_node():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'kinds_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


NOTHING_ELSE = lambda: ([], [], [], [], [])


def test_the_assistant_lists_presentations_where_it_lists_tests_and_exams(client):
    from app import assistant_service as ai

    own_subject(client, 'geo-ai')
    create(client, title='Stadtklima', subject='geo-ai', date=day(1), detail='10 Minuten, mit Handout')
    create(client, title='Wüstenbildung', subject='geo-ai', date=day(0))
    create(client, title='Plattentektonik', subject='geo-ai', date=day(-2))

    context = ai.build_context(NOTHING_ELSE)
    section = context.split('--- Anstehende Tests, Klausuren und Vorträge ---\n', 1)[1].split('\n\n', 1)[0].splitlines()
    assert [line.split(' am ')[0] for line in section] == ['  - Vortrag: Wüstenbildung [Geografie]', '  - Vortrag: Stadtklima [Geografie]']
    assert section[1].endswith('(morgen). Notiz: 10 Minuten, mit Handout')
    assert 'Plattentektonik' not in context and 'Lernstoff' not in context

    tomorrow = ai.quick_answer('Was steht morgen an?', NOTHING_ELSE)
    assert '**Vortrag:** Stadtklima [Geografie]' in tomorrow and 'Wüstenbildung' not in tomorrow

    listed = ai.quick_answer('Klausuren', NOTHING_ELSE)
    assert listed.split('**Vorträge:**\n', 1)[1].splitlines() == [
        f'  • Wüstenbildung [Geografie] – {ai._format_date_de(day(0))}',
        f'  • Stadtklima [Geografie] – {ai._format_date_de(day(1))}',
    ]

    week = ai.quick_answer('Wochenübersicht', NOTHING_ELSE)
    assert f'**Vorträge diese Woche:**\n  • Wüstenbildung [Geografie] am {ai._format_date_de(day(0))}' in week and 'Plattentektonik' not in week

    countdown = ai.quick_answer('Deadlines', NOTHING_ELSE)
    assert '🟡 Vortrag: Wüstenbildung [Geografie] – **HEUTE!**' in countdown and '🟡 Vortrag: Stadtklima [Geografie] – **morgen!**' in countdown
    assert 'Plattentektonik' not in countdown


def test_the_assistant_lists_tests_and_exams_as_before_next_to_presentations(client):
    from app import assistant_service as ai

    exams = [{'id': 'e1', 'title': 'Analysis', 'subject_id': '', 'date': day(2), 'topics': 'Ableitungen'}]
    tests = [{'id': 't1', 'title': 'Vektoren', 'subject_id': '', 'date': day(1), 'topics': ''}]
    school = lambda: ([], [], exams, tests, [])
    before = {message: ai.quick_answer(message, school) for message in ('Klausuren', 'Was steht morgen an?', 'Wochenübersicht', 'Deadlines')}
    assert 'Vortr' not in ''.join(before.values())
    assert '  - Klausur: Analysis am ' in ai.build_context(school) and 'Lernstoff: Ableitungen' in ai.build_context(school)

    create(client, title='Stadtklima', date=day(1))
    after = {message: ai.quick_answer(message, school) for message in before}
    assert after['Klausuren'] == before['Klausuren'] + f"\n\n**Vorträge:**\n  • Stadtklima – {ai._format_date_de(day(1))}"
    assert after['Was steht morgen an?'] == before['Was steht morgen an?'] + '\n**Vortrag:** Stadtklima'
    assert after['Deadlines'].replace('  🟡 Vortrag: Stadtklima [] – **morgen!**\n', '') == before['Deadlines']
    assert ai.quick_answer('Klausuren', NOTHING_ELSE) == f"**Anstehende Prüfungen:**\n\n**Vorträge:**\n  • Stadtklima – {ai._format_date_de(day(1))}"


def test_without_anything_announced_the_assistant_says_so_for_all_three(client):
    from app import assistant_service as ai

    assert ai.quick_answer('Klausuren', NOTHING_ELSE) == 'Keine anstehenden Klausuren, Tests oder Vorträge.'
    assert 'Anstehende Tests' not in ai.build_context(NOTHING_ELSE)


def test_a_question_about_the_own_next_presentation_is_not_looked_up_on_wikipedia():
    from app import research_service

    for question in ('Was ist der nächste Vortrag?', 'Was war der letzte Vortrag in Geografie?', 'Was ist der nächste Test?'):
        assert not research_service.wants_research(question), question
    assert research_service.wants_research('Was ist ein Vortrag?')
