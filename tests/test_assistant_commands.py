# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import time
from datetime import date, datetime, timedelta

import pytest

from app import assistant_service as ai
from app import database as db
from app import offline_tools
from app import research_service

TASKS = ('Mathe', 'Referat', 'Einkaufen', 'Wäsche waschen', 'Klausur', 'Bewerbung schreiben', 'Binomialverteilung üben', 'Sportfest Punktesystem bauen', 'Biologie Protokoll')


def day(offset):
    return (date.today() + timedelta(days=offset)).isoformat()


def next_weekday(number):
    ahead = (number - date.today().weekday()) % 7 or 7
    return day(ahead)


def coming(number, month):
    this_year = date(date.today().year, month, number)
    return (this_year if this_year >= date.today() else date(this_year.year + 1, month, number)).isoformat()


def stretch(first, last):
    today = date.today()
    for year in (today.year - 1, today.year, today.year + 1):
        start = date(year, first[1], first[0])
        end = date(year + ((last[1], last[0]) < (first[1], first[0])), last[1], last[0])
        if end >= today:
            return max(start, today).isoformat()


@pytest.fixture
def tasks(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    for title in TASKS:
        db.create_hub_task(title=title)
    return lambda: {task['title']: (bool(task['completed']), task.get('due_date'), task.get('due_time')) for task in db.get_hub_tasks('all')}


@pytest.fixture
def school():
    homework = [
        {'id': 'h1', 'title': 'S. 45 Nr. 3 und 4', 'subject_id': 'ma', 'due_date': day(1), 'completed': False},
        {'id': 'h2', 'title': 'Mathe Arbeitsblatt Vektoren', 'subject_id': 'ma', 'due_date': day(3), 'completed': False},
        {'id': 'h3', 'title': 'Gedichtanalyse Rilke', 'subject_id': 'de', 'due_date': day(2), 'completed': False},
    ]
    subjects = [{'id': 'ma', 'name': 'Mathe'}, {'id': 'de', 'name': 'Deutsch'}, {'id': 'pb', 'name': 'Politische Bildung'}]
    exams = [{'id': 'e1', 'title': 'Klausur Analysis', 'subject_id': 'ma', 'date': day(9), 'topics': 'Ableitungen'}]
    tests = [{'id': 't1', 'title': 'Soziale Ungleichheit', 'subject_id': 'pb', 'date': day(3), 'topics': 'Milieus'}]
    load = lambda: (subjects, homework, exams, tests, [{'subject_id': 'ma', 'points': 11, 'date': day(-10)}])
    load.homework = homework
    return load


@pytest.mark.parametrize('message', [
    'Mach Aufgabe 3 für mich',
    'Mach mir bitte Aufgabe 4b',
    'Machen wir Aufgabe 5 zusammen?',
    'Mache gerade Aufgabe 3 und komme nicht weiter',
    'Macht die Aufgabe 2 überhaupt Sinn?',
    'Mache ich die Aufgabe so richtig?',
    'Machst du mir eine Aufgabe?',
    'Mach die Aufgabe fertig',
    'Leg los mit Aufgabe 2',
    'Macht der Termin am Freitag Sinn?',
    'Mach einen Termin mit dem Lehrer aus, wie formuliere ich das?',
    'Erstelle einen Lernplan für den Termin am Freitag',
    'Erstelle mir eine Aufgabe zur Integralrechnung zum Üben',
    'Erstelle eine Aufgabe zum Thema Lyrik',
    'Erstelle mir eine Übungsaufgabe zur Kurvendiskussion',
    'Aufgabe: Berechne die Nullstellen von f(x) = x^2 - 4',
    'Aufgabe: Analysiere das Gedicht im Hinblick auf die Epoche',
    'Aufgabe 3: Bestimme die Ableitung',
    'Speicher das als Aufgabe',
    'Mach mal ne Aufgabe draus',
    'Erinnere mich nochmal, wie die pq-Formel geht',
    'Erinnerst du mich morgen an Mathe?',
    'Soll ich eine Aufgabe erstellen?',
    'Neue Aufgabe?',
    'Bin mit Mathe noch nicht fertig',
    'Ich bin mit dem Referat noch nicht fertig',
    'Das Referat ist noch lange nicht fertig',
    'Mit dem Referat werde ich nie fertig',
    'Ist das Referat schon fertig',
    'Wäsche waschen nicht geschafft',
    'Mathe Hausaufgabe nicht fertig',
    'Wann bin ich mit Mathe fertig',
    'Wie werde ich schneller mit Mathe fertig',
    'Nach Mathe bin ich immer fix und fertig',
    'Hab ich die Bewerbung schreiben schon erledigt',
    'Ich bin fertig',
    'Endlich geschafft',
    'Ich habe die Hausaufgabe erledigt, kannst du sie prüfen?',
    'Erstelle mir eine Aufgabe in Mathe',
    'Erstelle mir eine Aufgabe dazu',
    'Erstelle noch eine Aufgabe aber schwerer',
    'Erstelle eine Aufgabe zum Thema Analysis: Kurvendiskussion',
    'Erstelle eine neue Aufgabe Einkaufen morgen',
    'Mach die Aufgabe',
    'Mach die Aufgabe ein bisschen schwerer',
    'Mach den Termin an einem anderen Tag',
    'Mach mir die Aufgabe: Bestimme die Nullstellen von x hoch 2 minus 4',
    'Neue Aufgabe verstehe ich nicht',
    'Neuer Termin steht fest',
    'Aufgabe: Erläutern Sie den Begriff der Gewaltenteilung',
    'Aufgabe: Ein Auto fährt mit 50 km/h, wie lange braucht es für 120 km',
    'Aufgabe: Gegeben sind die Punkte A(1|2|3) und B(4|5|6)',
    'Aufgabe: Wie lautet die Ableitung von sin x',
    'Termin: Wann schreiben wir eigentlich Mathe',
    'Trag mir ein Gedicht vor',
    'Trag mir bitte ein paar Fakten zu Goethe zusammen',
    'Erinnere mich nochmal an die Formel',
    'Erinnere mich an die binomischen Formeln',
    'Erinnere mich daran wie man Brüche kürzt',
    'Bin fertig',
    'Sport geschafft!',
    'Bio geschafft',
    'Erledigt: plan',
    'Fertig: jetzt erklär mir bitte Aufgabe 3',
    'Mach bitte meine Deutsch Hausaufgabe fertig',
    'Ist die Deutsch Hausaufgabe fertig',
    'Hat Ben die Deutsch Hausaufgabe fertig',
    'Deutsch Hausaufgabe halb fertig',
    'Deutsch Hausaufgabe morgen fertig',
    'Deutsch Hausaufgabe muss bis morgen fertig',
    'Wegen Deutsch Hausaufgabe fix und fertig',
    'Ha, endlich fertig',
    'Aufgabe: Vokabeln lernen',
    'Aufgabe: Peter hat 5 Äpfel und isst 2 davon',
    'Task: Translate the following sentence into German',
    'Mach die Aufgabe: Seite 45 Nr. 3',
    'Schreib mir die Aufgabe: Erörterung zum Thema Handyverbot',
    'Neue Aufgabe: Erkläre mir den Unterschied zwischen Mitose und Meiose',
    'Neue Aufgabe: Ein Zug fährt mit 80 km/h von A nach B, wie lange braucht er für 200 km',
    'Nicht vergessen: du sollst auf Deutsch antworten',
    'Todo: erklär mir das nochmal',
    'Erinnere mich bloß nicht an morgen',
    'Erinnere mich nicht an die Klausur morgen',
    'Erinnere mich an das, was wir heute in Mathe gemacht haben',
    'Erinnere mich an den Stoff von heute',
    'Erinnere mich an den Montag als wir die Klausur geschrieben haben',
    'Neue Aufgabe: Kannst du mir das bitte erklären',
    'Erstelle eine Aufgabe: Berechne die Ableitung von x hoch 3',
])
def test_a_message_that_is_no_command_changes_nothing(tasks, school, message):
    before = tasks()
    assert ai.quick_answer(message, school) is None
    ai.offline_response(message, school)
    assert tasks() == before
    assert not any(item['completed'] for item in school.homework)


@pytest.mark.parametrize('message, title, due, clock', [
    ('Neue Aufgabe: Einkaufen gehen morgen um 15 Uhr', 'Einkaufen gehen', day(1), '15:00'),
    ('Neue Aufgabe: Referat abgeben übermorgen', 'Referat abgeben', day(2), None),
    ('Neue Aufgabe: Vokabeln lernen um 8.10 Uhr', 'Vokabeln lernen', None, '08:10'),
    ('Erstelle eine Aufgabe: Vokabeln lernen', 'Vokabeln lernen', None, None),
    ('Erstell mir bitte ne Aufgabe für morgen: Deutsch Aufsatz', 'Deutsch Aufsatz', day(1), None),
    ('Bitte erstelle einen Termin für Freitag: Nachhilfe', 'Nachhilfe', next_weekday(4), None),
    ('Leg eine Aufgabe an: Bio Referat vorbereiten bis Montag', 'Bio Referat vorbereiten', next_weekday(0), None),
    ('Notier dir den Termin: Elternabend 12.10.', 'Elternabend', coming(12, 10), None),
    ('Neue Aufgabe: Bis Freitag Referat fertig machen', 'Referat fertig machen', next_weekday(4), None),
    ('Neue Aufgabe: Am Montag Bio lernen', 'Bio lernen', next_weekday(0), None),
    ('Neue Aufgabe: Für morgen Vokabeln lernen', 'Vokabeln lernen', day(1), None),
    ('Neue Aufgabe: Mathe Nr. 2.3 und 2.4', 'Mathe Nr. 2.3 und 2.4', None, None),
    ('Neue Aufgabe: 1.5 Stunden Mathe üben', '1.5 Stunden Mathe üben', None, None),
    ('Neue Aufgabe: Montagsmaler vorbereiten', 'Montagsmaler vorbereiten', None, None),
    ('Neue Aufgabe: Guten Morgen Karte schreiben', 'Guten Morgen Karte schreiben', None, None),
    ('Erstelle eine Aufgabe "Mathe lernen"', 'Mathe lernen', None, None),
    ('Erstelle eine Aufgabe namens Mathe lernen', 'Mathe lernen', None, None),
    ('Erinnere mich morgen früh um 7 an Sport', 'Sport', day(1), '07:00'),
    ('Erinnere mich heute Abend an die Wäsche', 'Wäsche', day(0), None),
    ('Neue Aufgabe: Geschenk kaufen bis zum 20.10.', 'Geschenk kaufen', coming(20, 10), None),
    ('Neue Aufgabe: Geschenk kaufen bis zum 20.10. um 15 Uhr', 'Geschenk kaufen', coming(20, 10), '15:00'),
    ('Termin: Museum 21.10.', 'Museum', coming(21, 10), None),
    ('Neue Aufgabe: Abgabe zum 31.12.', 'Abgabe', coming(31, 12), None),
    ('Neue Aufgabe: Paket abholen bis 18 Uhr', 'Paket abholen', None, '18:00'),
    ('Neue Aufgabe: Bis 15 Uhr Paket abholen', 'Paket abholen', None, '15:00'),
    ('Termin: Friseur gegen 16 Uhr', 'Friseur', None, '16:00'),
    ('Termin: Nachhilfe von 15 bis 16 Uhr', 'Nachhilfe', None, '15:00'),
    ('Neue Aufgabe: Zahnarzt 15 Uhr 30', 'Zahnarzt', None, '15:30'),
    ('Erinnere mich um 7 Uhr 30 an den Bus', 'Bus', None, '07:30'),
    ('Erinnere mich morgen um halb 8 an den Bus', 'Bus', day(1), '07:30'),
    ('Neue Aufgabe: Aufsatz um 1 Seite kürzen', 'Aufsatz um 1 Seite kürzen', None, None),
    ('Neue Aufgabe: Mathe um 2 Noten verbessern', 'Mathe um 2 Noten verbessern', None, None),
    ('Neue Aufgabe: Mathe Aufgaben 2.1 bis 2.5', 'Mathe Aufgaben 2.1 bis 2.5', None, None),
    ('Neue Aufgabe: Mathe lernen (morgen)', 'Mathe lernen', day(1), None),
    ('Neue Aufgabe: Mathe lernen am 12.10', 'Mathe lernen', coming(12, 10), None),
    ('Neue Aufgabe: Salat 5 pm kaufen', 'Salat kaufen', None, '17:00'),
    ('Erstelle eine Aufgabe "Tims Geschenk kaufen"', 'Tims Geschenk kaufen', None, None),
    ('Erstelle eine Aufgabe: herausfinden, wer Goethe war', 'herausfinden, wer Goethe war', None, None),
    ('Neue Aufgabe: Praktikum vom 12.10. bis 16.10.', 'Praktikum', stretch((12, 10), (16, 10)), None),
    ('Neue Aufgabe: Montag bis Freitag Vokabeln lernen', 'Vokabeln lernen', next_weekday(0), None),
    ('Neue Aufgabe um 15:30: Zahnarzt anrufen', 'Zahnarzt anrufen', None, '15:30'),
    ('Erinnere mich um 18 Uhr ans Training', 'Training', None, '18:00'),
    ('Erinnere mich daran dass ich morgen Mathe lernen muss', 'Mathe lernen', day(1), None),
    ('Erinnere mich morgen nochmal an den Termin', 'Termin', day(1), None),
    ('Termin: Zahnarzt Montag 15:00', 'Zahnarzt', next_weekday(0), '15:00'),
    ('Trag ein: Zahnarzt am Freitag um 14 Uhr', 'Zahnarzt', next_weekday(4), '14:00'),
    ('Erinnere mich morgen an den Arzttermin', 'Arzttermin', day(1), None),
    ('Erinnere mich übermorgen an das Geschenk', 'Geschenk', day(2), None),
    ('Todo: Zimmer aufräumen', 'Zimmer aufräumen', None, None),
    ('Nicht vergessen: Sportzeug einpacken', 'Sportzeug einpacken', None, None),
])
def test_a_creation_command_makes_the_task_it_names(tasks, school, message, title, due, clock):
    answer = ai.quick_answer(message, school)
    assert title in answer
    created = {name: entry for name, entry in tasks().items() if name not in TASKS}
    assert list(created) == [title]
    assert created[title] == (False, due, clock)


@pytest.mark.parametrize('message', ['Erstelle eine Aufgabe', 'Neue Aufgabe', 'Erinnere mich'])
def test_a_creation_command_without_a_title_asks_for_one(tasks, school, message):
    before = tasks()
    assert 'Schreib zum Beispiel' in ai.quick_answer(message, school)
    assert tasks() == before


@pytest.mark.parametrize('message, title', [
    ('Erledigt: Einkaufen', 'Einkaufen'),
    ('Einkaufen erledigt', 'Einkaufen'),
    ('Hab Einkaufen erledigt', 'Einkaufen'),
    ('Mathe ist erledigt', 'Mathe'),
    ('Referat geschafft!', 'Referat'),
    ('Aufgabe erledigt: Wäsche waschen', 'Wäsche waschen'),
    ('Erledigt: Bewerbung', 'Bewerbung schreiben'),
    ('Biologie Protokoll abgehakt', 'Biologie Protokoll'),
])
def test_a_done_command_ticks_the_one_task_it_names(tasks, school, message, title):
    ai.quick_answer(message, school)
    assert [name for name, entry in tasks().items() if entry[0]] == [title]


def test_a_done_command_that_fits_several_tasks_asks_which(tasks, school):
    db.create_hub_task(title='Bewerbung abschicken')
    answer = ai.quick_answer('Bewerbung erledigt', school)
    assert 'Welche Aufgabe' in answer and 'Bewerbung abschicken' in answer and 'Wäsche waschen' not in answer
    assert not any(entry[0] for entry in tasks().values())
    db.create_hub_task(title='Mathe lernen')
    ai.quick_answer('Mathe erledigt', school)
    assert [name for name, entry in tasks().items() if entry[0]] == ['Mathe']


@pytest.mark.parametrize('message, offered', [
    ('Sportfest erledigt', 'Sportfest Punktesystem bauen'),
    ('Die Bewerbung ist fertig!', 'Bewerbung schreiben'),
    ('Biologie geschafft', 'Biologie Protokoll'),
])
def test_a_weak_fit_asks_back_instead_of_ticking(tasks, school, message, offered):
    answer = ai.quick_answer(message, school)
    assert 'Welche Aufgabe' in answer and offered in answer and 'Einkaufen' not in answer.split('Sag z.B.')[0]
    assert not any(entry[0] for entry in tasks().values())


def test_a_few_words_after_a_question_from_the_assistant_are_its_answer(tasks, school):
    asked = [{'role': 'user', 'content': 'Hilf mir bei Aufgabe 3'}, {'role': 'assistant', 'content': 'Bist du mit Teil a schon fertig?'}]
    for reply in ('Fertig', 'Test', '3/4', 'Alles fertig', 'Diese Woche', 'Sportfest fertig', 'Stundenplan morgen', 'Ja, fertig', 'Was steht an'):
        assert ai.quick_answer(reply, school, asked) is None
    assert not any(done for done, _, _ in tasks().values())
    assert 'Wochenübersicht' in ai.quick_answer('Diese Woche', school)
    for unasked in ('Alles fertig', 'Sportfest fertig'):
        assert 'Welche Aufgabe' in ai.quick_answer(unasked, school)
    assert 'Offene Hausaufgaben' in ai.quick_answer('Welche Hausaufgaben habe ich?', school, asked)
    assert 'erledigt' in ai.quick_answer('Einkaufen erledigt', school, asked)
    assert 'Bewerbung schreiben' in ai.quick_answer('Erledigt: Bewerbung', school, asked)
    for title in ('Blatt Analysis', 'Blatt Stochastik'):
        db.create_hub_task(title=title)
    assert 'Welche Aufgabe' in ai.quick_answer('Erledigt: Blatt', school, asked)
    greeted = [{'role': 'assistant', 'content': 'Guten Tag! Für heute ist keine Aufgabe offen. Was möchtest du wissen?'}]
    assert 'Klausur Analysis' in ai.quick_answer('Klausuren', school, greeted)


def test_one_subject_with_one_open_homework_is_enough_to_tick_it(tasks, school):
    ai.quick_answer('Deutsch Hausaufgabe fertig', school)
    assert [item['id'] for item in school.homework if item['completed']] == ['h3']


def test_homework_is_ticked_only_when_one_fits(tasks, school):
    answer = ai.quick_answer('HA erledigt: Mathe', school)
    assert 'Welche Hausaufgabe' in answer and 'Rilke' not in answer
    assert not any(item['completed'] for item in school.homework)
    ai.quick_answer('Hausaufgabe erledigt: Rilke', school)
    assert [item['id'] for item in school.homework if item['completed']] == ['h3']


@pytest.mark.parametrize('message, expected', [
    ('Welche Hausaufgaben habe ich?', 'Offene Hausaufgaben (3)'),
    ('Habe ich heute Hausaufgaben auf?', 'Offene Hausaufgaben (3)'),
    ('Offene Aufgaben', 'Offene Aufgaben (9)'),
    ('Überfällige Aufgaben', 'überfällig'),
    ('Wann ist die nächste Klausur?', 'Klausur Analysis'),
    ('Kannst du mir meine Noten zeigen?', 'Notenübersicht'),
    ('Servus', 'Was möchtest du wissen?'),
    ('Erledigt', 'Welche Aufgabe möchtest du abhaken?'),
])
def test_plain_lookups_are_answered_from_the_stored_data(tasks, school, message, expected):
    before = tasks()
    assert expected in ai.quick_answer(message, school)
    assert tasks() == before


def test_a_greeting_in_front_does_not_move_the_timetable_to_tomorrow(tasks, school):
    answer = ai.quick_answer('Guten Morgen, wie sieht mein Stundenplan aus?', school)
    assert ai.DAY_NAMES_DE[date.today().weekday()] in answer


def test_another_day_gets_its_own_summary(tasks, school):
    db.create_hub_task(title='Sportzeug packen', due_date=day(1))
    db.create_hub_task(title='Geschenk kaufen', due_date=day(3))
    answer = ai.quick_answer('Was steht morgen an?', school)
    tomorrow = date.today() + timedelta(days=1)
    assert answer.startswith(f'**{ai.DAY_NAMES_DE[tomorrow.weekday()]}, {tomorrow.strftime("%d.%m.%Y")}**')
    assert 'Sportzeug packen' in answer and 'S. 45 Nr. 3 und 4' in answer
    assert 'Geschenk kaufen' not in answer and 'Rilke' not in answer and 'Soziale Ungleichheit' not in answer
    later = ai.quick_answer(f'Was habe ich am {ai.DAY_NAMES_DE[(date.today() + timedelta(days=3)).weekday()]}?', school)
    assert 'Geschenk kaufen' in later and 'Test:** Soziale Ungleichheit [Politische Bildung]' in later and 'Mathe Arbeitsblatt Vektoren' in later


@pytest.mark.parametrize('message', [
    'Was muss ich bis morgen erledigen?',
    'Was steht nächste Woche an?',
    'Stundenplan nächste Woche',
    'Stundenplan am 14.10.',
    'Welche Hausaufgaben habe ich bis morgen?',
    'Welche Aufgaben habe ich heute?',
    'Was muss ich für die Klausur machen?',
    'Ich habe morgen eine Klausur',
    'Wie spät fängt morgen die Schule an?',
    '3 mal 4 Stunden lernen reicht das für die Klausur?',
    'Aufgabe',
    'Übungsaufgabe',
])
def test_questions_beyond_a_stored_view_go_to_the_model(tasks, school, message):
    assert ai.quick_answer(message, school) is None


def test_dates_and_times_are_read_as_written():
    monday = datetime(2026, 10, 5, 9, 0)
    assert ai._parse_date_nl('Referat abgeben übermorgen', monday) == '2026-10-07'
    assert ai._parse_date_nl('Referat abgeben morgen', monday) == '2026-10-06'
    assert ai._parse_date_nl('Vokabeln lernen um 8.10 Uhr', monday) is None
    assert ai._parse_date_nl('Elternabend 12.10.', monday) == '2026-10-12'
    assert ai._parse_time_nl('Vokabeln lernen um 8.10 Uhr') == '08:10'
    assert ai._parse_time_nl('Zahnarzt Montag 15:00') == '15:00'
    assert ai._parse_time_nl('Elternabend 12.10.') is None
    assert ai._parse_time_nl('Geschenk kaufen bis zum 20.10.') is None
    assert ai._parse_time_nl('Referat 24.12.') is None
    assert ai._parse_date_nl('Kapitel 3.1 bis 3.4 lesen', monday) is None
    assert ai._parse_date_nl('Abgabe am 15.04.2027', monday) == '2027-04-15'
    assert ai._parse_date_nl('15. Oktober 2027', monday) == '2027-10-15'
    assert ai._parse_date_nl('Freitag, 16.10.', monday) == '2026-10-16'


def test_an_endless_or_absurd_command_neither_hangs_nor_breaks(tasks, school):
    for message in ('Erinnere mich' + ' bitte' * 22, 'Erinnere mich' + ' nochmal' * 22, 'Erinnere mich ' + 'daran, ' * 22, 'Neue Aufgabe: ' + '12.10. bis 13.10. - ' * 14):
        started = time.perf_counter()
        ai.quick_answer(message, school)
        assert time.perf_counter() - started < 1
    assert 'Abgabe in 99999999 Tagen' in ai.quick_answer('Neue Aufgabe: Abgabe in 99999999 Tagen', school)
    assert tasks()['Abgabe in 99999999 Tagen'] == (False, None, None)


def test_without_a_model_a_bare_exercise_line_is_offered_as_a_task(tasks, school):
    answer = ai.offline_response('Aufgabe: Vokabeln lernen', school)
    assert answer == 'Soll das eine Aufgabe werden? Dann schreib: "Neue Aufgabe: Vokabeln lernen"'
    assert set(tasks()) == set(TASKS)
    assert 'Vokabeln lernen' in ai.offline_response('Neue Aufgabe: Vokabeln lernen', school)


def test_the_clock_and_the_calculator_only_answer_what_was_asked():
    assert offline_tools.try_offline_tool('Wie spät ist es?')
    assert offline_tools.try_offline_tool('Wie viel Uhr ist es?')
    assert offline_tools.try_offline_tool('Bis wie spät hat die Bibliothek offen?') is None
    assert offline_tools.try_offline_tool('3 mal 4 Stunden lernen reicht das?') is None
    assert '12' in offline_tools.try_offline_tool('Was ist 3 mal 4?')


@pytest.mark.parametrize('message', [
    'Was sind meine Noten in Mathe?',
    'Wer ist mein Mathelehrer?',
    'Was ist morgen in der ersten Stunde?',
    'Was ist heute in Mathe dran?',
])
def test_questions_about_the_own_day_are_not_looked_up_on_wikipedia(message):
    assert not research_service.wants_research(message)
    for question in ('Wer war Goethe?', 'Was ist Meinungsfreiheit?', 'Was sind die Aufgaben des Bundestags?'):
        assert research_service.wants_research(question)
    for question in ('Was war die letzte Note in Physik?', 'Was ist in der dritten Stunde dran?', 'Was ist in Mathe dran?'):
        assert not research_service.wants_research(question)


def test_a_question_on_how_to_do_something_gets_no_study_plan_brief():
    assert not ai._PLAN_REQUEST.search('Wie soll ich das Gedicht von Rilke interpretieren?')
    assert ai._PLAN_REQUEST.search('Wie soll ich für die Klausur lernen?')
    assert ai._PLAN_REQUEST.search('Kannst du mir einen Lernplan für den PB-Test geben?')
    assert ai._PLAN_REQUEST.search('Wie bereite ich mich auf die Klausur vor?')
    assert ai._PLAN_REQUEST.search('Wie bereite ich mich auf die Arbeit am Freitag vor?')
    assert ai._PLAN_REQUEST.search('Wie bereite ich mich auf die Arbeit in Mathe vor?')
    assert not ai._PLAN_REQUEST.search('Wie bereite ich mich auf die Arbeit im Praktikum vor?')
    assert not ai._PLAN_REQUEST.search('Wie bereite ich mich auf die Arbeit in der Firma vor?')
    assert not ai._PLAN_REQUEST.search('Vorbereitung aufs Vorstellungsgespräch')


def test_grades_given_as_marks_are_not_read_as_zero_points(tasks, school):
    marks = [{'subject_id': 'ma', 'points': 0, 'value': 2.0, 'grade_system': 'marks', 'date': day(-3)}]
    load = lambda: (school()[0], [], [], [], marks)
    context = ai.build_context(load)
    assert 'Mathe: Note 2' in context and 'Mathe: 0' not in context
    assert 'Ø 2.0' in ai.quick_answer('Noten', load)
