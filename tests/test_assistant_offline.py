# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""End-to-end tests for the assistant's offline surface.

Covers the paths that must work without any LLM backend:
- Wikipedia routing + entity extraction
- Offline tools (math, dates, units)
- offline_response branch dispatch
- extract_ollama_actions / stripping
"""
import os
import sys
import pytest

os.environ.setdefault('SECRET_KEY', 'test-secret-for-assistant')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import offline_tools
from app import research_service as rs
from app.assistant_service import (
    extract_ollama_actions,
    is_data_query,
    offline_response,
    _detect_creation_intent,
)


# ---------- Offline tools: math ----------

@pytest.mark.parametrize('msg,expected_in', [
    ('2 + 2',                           '4'),
    ('2+2',                             '4'),
    ('3 * (4+5)',                       '27'),
    ('Berechne 15 * 7',                 '105'),
    ('Was ist 100 / 4?',                '25'),
    ('7 mal 8',                         '56'),
    ('20 minus 5',                      '15'),
    ('50 durch 4',                      '12,5'),
    ('2 hoch 10',                       '1024'),
    ('15% von 200',                     '30'),
    ('wurzel aus 16',                   '4'),
    ('Wurzel aus 144',                  '12'),
])
def test_calc_offline(msg, expected_in):
    out = offline_tools.try_calc(msg)
    assert out is not None, f'no calc match for {msg!r}'
    assert expected_in in out, f'{msg!r} → {out!r} missing {expected_in!r}'


def test_calc_rejects_non_math():
    assert offline_tools.try_calc('Wer ist Einstein?') is None
    assert offline_tools.try_calc('Hallo') is None


# ---------- Offline tools: date ----------

def test_date_today():
    r = offline_tools.try_date_math('Welcher Wochentag ist heute?')
    assert r and 'Heute ist' in r


def test_date_tomorrow():
    r = offline_tools.try_date_math('Welcher Wochentag ist morgen?')
    assert r and 'Morgen ist' in r


def test_date_specific():
    r = offline_tools.try_date_math('Welcher Wochentag ist der 24.12.2026?')
    assert r
    assert '24.12.2026' in r
    assert 'Donnerstag' in r


def test_date_days_until():
    r = offline_tools.try_date_math('Wie viele Tage bis zum 01.01.2030?')
    assert r and ('Tage' in r or 'heute' in r)


def test_time():
    r = offline_tools.try_date_math('Wie spät ist es?')
    assert r and 'Uhr' in r


# ---------- Offline tools: unit conversion ----------

@pytest.mark.parametrize('msg,expected_in', [
    ('100 km in meilen',            '62'),
    ('20 grad celsius in fahrenheit', '68'),
    ('0 C in F',                    '32'),
    ('1 kg in pfund',               '2,2'),
    ('100 F in C',                  '37'),
])
def test_unit_conversion(msg, expected_in):
    r = offline_tools.try_unit_convert(msg)
    assert r is not None, f'no conversion for {msg!r}'
    assert expected_in in r, f'{msg!r} → {r!r} missing {expected_in!r}'


# ---------- Wikipedia: entity extraction ----------

@pytest.mark.parametrize('msg,expected', [
    ('Gib mir Infos zu Albert Einstein',                         'Albert Einstein'),
    ('Wer war Johann Wolfgang von Goethe?',                      'Johann Wolfgang von Goethe'),
    ('Gib mir Informationen über Albert Einstein, den Physiker', 'Albert Einstein'),
    ('Infos zu Angela Götzensperger bitte',                      'Angela Götzensperger'),
    ('Was war die Französische Revolution?',                     'Französische Revolution'),
    ('Erkläre mir die Relativitätstheorie',                      'Relativitätstheorie'),
    ('Schreibe mir eine Biografie von Marie Curie',              'Marie Curie'),
    ('Wer ist Albert Einstein (der Physiker)?',                  'Albert Einstein'),
    ('Wer war Ludwig van Beethoven?',                            'Ludwig van Beethoven'),
    ('Infos zu Otto von Bismarck bitte',                         'Otto von Bismarck'),
    ('Was hat Einstein erfunden?',                               'Einstein'),
    ('Gib mir Infos zu der Person Albert Einstein und was er gemacht hat (bzw schreibe mir eine Biografie)',
        'Albert Einstein'),
])
def test_entity_extraction(msg, expected):
    got = rs.extract_entity(msg)
    assert got == expected, f'{msg!r} → {got!r}, expected {expected!r}'


def test_wants_research_positive():
    for q in ['Wer ist Goethe?', 'Infos zu X', 'Was hat Caesar gemacht?', 'Schreibe mir eine Biografie von Y']:
        assert rs.wants_research(q), f'should want research: {q!r}'


def test_wants_research_negative():
    for q in ['Löse x^2 = 4', 'Berechne 3+5', '2+2', 'Was ist 100 + 200?']:
        assert not rs.wants_research(q), f'should NOT want research: {q!r}'


# ---------- offline_response dispatch ----------

def test_offline_math_goes_to_tools():
    r = offline_response('2+2')
    assert '4' in r, r


def test_offline_date_goes_to_tools():
    r = offline_response('Welcher Wochentag ist heute?')
    assert 'Heute ist' in r, r


def test_offline_unit_goes_to_tools():
    r = offline_response('100 km in meilen')
    assert '62' in r, r


def test_offline_greeting_is_word_bounded():
    # "nothing" contains "hi" as substring — MUST NOT trigger greeting.
    r = offline_response('Total random question that matches nothing at all')
    assert 'Guten' not in r, f'word-boundary regression: {r!r}'


def test_offline_greeting_positive():
    r = offline_response('Hi')
    assert 'Guten' in r or 'Hallo' in r


def test_offline_summary_not_exams():
    # "berühmteste" contains "test" — MUST NOT trigger exam list.
    msg = 'Fasse mir folgenden Text zusammen: "Lore Lay ist eine Ballade von Clemens Brentano. Die berühmteste Verarbeitung ist..."'
    r = offline_response(msg)
    assert 'Klausur' not in r and 'Prüfung' not in r, f'false-positive test→exams: {r!r}'


def test_offline_tagesuebersicht_with_heute():
    r = offline_response('Was steht heute an?')
    # Real day summary uses the word 'Unterricht' or 'Aufgaben' or a day name.
    assert any(k in r for k in ['Unterricht', 'Aufgaben', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Wochenende'])


def test_offline_unknown_is_honest():
    r = offline_response('quaxiborpthingamajig nonsense gobbledy')
    assert 'konnte' in r.lower() or 'nicht' in r.lower(), f'expected honest fallback, got: {r!r}'


# ---------- Action extraction ----------

def test_extract_closed_action():
    cleaned, actions = extract_ollama_actions(
        'Antwort. [ACTION]{"type":"create_task","title":"Test"}[/ACTION] Ende.'
    )
    assert 'ACTION' not in cleaned
    assert len(actions) == 1
    assert actions[0]['title'] == 'Test'


def test_extract_orphan_action_after_separator():
    cleaned, actions = extract_ollama_actions(
        'Die Antwort.\n\n---\n{"type":"create_task","title":"Foo"}'
    )
    assert '---' not in cleaned
    assert 'type' not in cleaned
    assert len(actions) == 1


def test_extract_incomplete_action_dropped():
    cleaned, actions = extract_ollama_actions(
        'Die Antwort ist 42.\n\n[ACTION]{"type": "'
    )
    assert '[ACTION]' not in cleaned
    assert 'type' not in cleaned
    assert actions == []


def test_extract_no_action_unchanged():
    cleaned, actions = extract_ollama_actions('Eine ganz normale Antwort.')
    assert cleaned == 'Eine ganz normale Antwort.'
    assert actions == []


# ---------- is_data_query routing ----------

def test_is_data_query_math_excluded():
    assert not is_data_query('Löse x^2 - 4 = 0')
    assert not is_data_query('Berechne 2+2')


def test_is_data_query_long_content_excluded():
    long_msg = 'Fasse diesen Text zusammen: ' + ('Dies ist ein langer Text. ' * 30)
    assert not is_data_query(long_msg)


def test_is_data_query_berühmteste_not_test():
    msg = 'Fasse mir folgenden Text zusammen: Die berühmteste Verarbeitung ist...'
    assert not is_data_query(msg)


def test_is_data_query_positives():
    for q in ['Was steht heute an?', 'Hilfe', 'Hi', 'Wann ist die nächste Klausur?']:
        assert is_data_query(q), f'should be data query: {q!r}'


def test_creation_intent():
    assert _detect_creation_intent('Erstelle eine neue Aufgabe')
    assert _detect_creation_intent('Erinnere mich morgen an den Arzttermin')
    assert not _detect_creation_intent('Erkläre mir die Ballade')
    assert not _detect_creation_intent('Wer ist Einstein?')


# ---------- only plain lookups and clear commands skip the model ----------

@pytest.mark.parametrize('message', [
    'Kannst du mir erstmal einen Lernplan für den PB-Test geben?',
    'Erstelle mir einen Lernplan für Mathe',
    'Wann ist mein Mathetest?',
    'Gib mir Tipps für die Klausur',
    'Ich bin fertig mit Mathe, was soll ich jetzt lernen?',
    'Wie sind meine Noten in Mathe?',
    'Welche Hausaufgaben habe ich in Deutsch?',
    'Hilf mir bei der Interpretation von Faust',
    'Was ist ein Test auf Signifikanz?',
    'Ich habe meine Hausaufgaben noch nicht gemacht',
    'Wie bereite ich mich auf die Prüfung vor?',
])
def test_requests_that_need_thought_go_to_the_model(message):
    assert not is_data_query(message)


@pytest.mark.parametrize('message', [
    'Hallo', 'Guten Abend', 'Was steht heute an?', 'Stundenplan morgen', 'Welche Hausaufgaben habe ich?',
    'Noten', 'Wann ist die nächste Klausur?', 'Offene Aufgaben', 'Was kannst du?', 'Hilfe',
    'Neue Aufgabe: Einkaufen morgen um 15 Uhr', 'Erinnere mich morgen an den Arzttermin',
    'Erledigt: Einkaufen', 'Einkaufen erledigt',
])
def test_plain_lookups_and_commands_stay_fast(message):
    assert is_data_query(message)


@pytest.mark.parametrize('message', [
    'Erstelle mir einen Lernplan für den PB-Test',
    'Ich muss morgen Mathe lernen, wie fange ich an?',
    'Kannst du mir eine Zusammenfassung erstellen?',
])
def test_a_request_for_help_never_creates_a_task(message):
    assert not _detect_creation_intent(message)


def test_the_title_of_a_created_task_drops_the_command_words():
    from app.assistant_service import _extract_title_from_nl
    assert _extract_title_from_nl('Erstelle eine neue Aufgabe: Einkaufen morgen') == 'Einkaufen'
    assert _extract_title_from_nl('Erstelle eine neue Aufgabe Einkaufen morgen') is None
    assert _extract_title_from_nl('Neue Aufgabe: Referat gliedern am Freitag') == 'Referat gliedern'
    assert _extract_title_from_nl('Erinnere mich an den Arzttermin morgen um 15 Uhr') == 'Arzttermin'
    assert _extract_title_from_nl('Trag ein: Zahnarzt') == 'Zahnarzt'


def _school_with_a_test():
    from datetime import date, timedelta
    soon = (date.today() + timedelta(days=3)).isoformat()
    subjects = [{'id': 'pb', 'name': 'Politische Bildung'}, {'id': 'ma', 'name': 'Mathe'}]
    tests = [{'id': 't1', 'subject_id': 'pb', 'title': 'Soziale Ungleichheit', 'date': soon, 'topics': 'Milieus, Gini-Koeffizient'}]
    return subjects, [], [], tests, []


def test_without_a_model_a_plan_request_gets_a_plan_not_the_test_list():
    answer = offline_response('Kannst du mir einen Lernplan für den PB-Test geben?', _school_with_a_test)
    assert answer.startswith('**Lernplan: Politische Bildung**')
    assert 'Milieus' in answer
    assert 'Anstehende Prüfungen' not in answer


def test_quick_answer_is_exact_or_absent():
    from app.assistant_service import quick_answer
    assert '30' in quick_answer('15% von 200')
    assert quick_answer('Kannst du mir erstmal einen Lernplan für den PB-Test geben?', _school_with_a_test) is None
    assert 'Soziale Ungleichheit' in quick_answer('Wann ist die nächste Klausur?', _school_with_a_test)


def test_the_model_sees_what_a_test_covers_and_how_far_away_it_is():
    from app.assistant_service import build_context
    context = build_context(_school_with_a_test)
    assert 'Test: Soziale Ungleichheit [Politische Bildung]' in context
    assert '(in 3 Tagen)' in context
    assert 'Lernstoff: Milieus, Gini-Koeffizient' in context


def test_grades_reach_the_model_as_points():
    from app.assistant_service import build_context
    subjects, homework, exams, tests, _ = _school_with_a_test()
    grades = [{'subject_id': 'ma', 'points': 11, 'date': '2026-09-20'}]
    context = build_context(lambda: (subjects, homework, exams, tests, grades))
    assert 'Mathe: 11' in context
