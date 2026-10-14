# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

from datetime import date, datetime
from itertools import product

from app import assistant_service as ai
from app import spoken_time

MONDAY = date(2026, 10, 5)

TITLES = [
    ('Zahnarzt', None),
    ('Elternabend', None),
    ('Referat Bio', None),
    ('Hausaufgaben', None),
    ('Proberaum', None),
    ('Übungsblatt 3', None),
    ('Mathe S. 45 Nr. 3', None),
    ('Mathe', 'lernen'),
    ('Aufsatz', 'abgeben'),
    ('Oma', 'anrufen'),
    ('Vokabeln Unit 2', 'lernen'),
]
DAYS = [
    ('heute', '2026-10-05', None),
    ('morgen', '2026-10-06', None),
    ('übermorgen', '2026-10-07', None),
    ('heute Abend', '2026-10-05', 'pm'),
    ('morgen Nachmittag', '2026-10-06', 'pm'),
    ('morgen früh', '2026-10-06', None),
    ('am Freitag', '2026-10-09', None),
    ('Freitag', '2026-10-09', None),
    ('Freitag Abend', '2026-10-09', 'pm'),
    ('bis Freitag', '2026-10-09', None),
    ('bis zum Freitag', '2026-10-09', None),
    ('spätestens Donnerstag', '2026-10-08', None),
    ('bis nächsten Montag', '2026-10-12', None),
    ('am kommenden Dienstag', '2026-10-06', None),
    ('übernächsten Montag', '2026-10-19', None),
    ('diese Woche Freitag', '2026-10-09', None),
    ('nächste Woche Mittwoch', '2026-10-14', None),
    ('am Mittwoch nächster Woche', '2026-10-14', None),
    ('Freitag in einer Woche', '2026-10-16', None),
    ('in 3 Tagen', '2026-10-08', None),
    ('am 12.10.', '2026-10-12', None),
    ('12.10.', '2026-10-12', None),
    ('bis 12.10.', '2026-10-12', None),
    ('bis zum 14.10.', '2026-10-14', None),
    ('am 12.10.2026', '2026-10-12', None),
    ('am Montag, 19.10.', '2026-10-19', None),
    ('am Montag, dem 19.10.', '2026-10-19', None),
    ('am 3. November', '2026-11-03', None),
    ('', None, None),
]
CLOCKS = [
    ('um 15 Uhr', 15, 0, None),
    ('15 Uhr', 15, 0, None),
    ('um 15.30 Uhr', 15, 30, None),
    ('15.30 Uhr', 15, 30, None),
    ('um 15:30', 15, 30, None),
    ('15:30', 15, 30, None),
    ('15:30 Uhr', 15, 30, None),
    ('um 8', 8, 0, None),
    ('um 8 Uhr', 8, 0, None),
    ('8 Uhr', 8, 0, None),
    ('um 7.30', 7, 30, None),
    ('7 Uhr 30', 7, 30, None),
    ('18 Uhr 30', 18, 30, None),
    ('gegen 16 Uhr', 16, 0, None),
    ('ab 17 Uhr', 17, 0, None),
    ('bis 18 Uhr', 18, 0, None),
    ('von 8 bis 10 Uhr', 8, 0, None),
    ('von 8 Uhr bis 10 Uhr', 8, 0, None),
    ('8 bis 10 Uhr', 8, 0, None),
    ('8-10 Uhr', 8, 0, None),
    ('8:00 bis 9:30', 8, 0, None),
    ('um halb 8', 7, 30, None),
    ('um Viertel vor 8', 7, 45, None),
    ('um Viertel nach 7', 7, 15, None),
    ('um 5 vor 8', 7, 55, None),
    ('um 8 Uhr abends', 8, 0, 'pm'),
    ('abends um 8', 8, 0, 'pm'),
    ('', None, None, None),
]


def sentences():
    """Every title with every day and every clock in every usual position, with what it means."""
    for (thing, verb), (day_words, day, day_part), (clock_words, hour, minute, clock_part) in product(TITLES, DAYS, CLOCKS):
        if not day_words and not clock_words:
            continue
        title = f'{thing} {verb}' if verb else thing
        if hour is not None and (day_part or clock_part) and hour < 12:
            hour += 12
        clock = None if hour is None else f'{hour:02d}:{minute:02d}'
        orders = [
            ' '.join(filter(None, (title, day_words, clock_words))),
            ' '.join(filter(None, (day_words, clock_words, title))),
            ' '.join(filter(None, (title, clock_words, day_words))),
        ]
        # "Aufsatz 8 bis 10 Uhr abgeben" is left out: there the 8 may number the essay, and the sentence tests pin that reading.
        if verb and not (verb == 'abgeben' and not day_words and clock_words == '8 bis 10 Uhr'):
            orders.append(' '.join(filter(None, (thing, day_words, clock_words, verb))))
        for text in orders:
            # So is "7 Uhr 30 Vokabeln ...", where the 30 may count the words.
            if ' Uhr 30 Vokabeln' not in text:
                yield text[0].upper() + text[1:], title, day, clock


def read(text):
    day, clock, spans = spoken_time.find(text, MONDAY)
    return spoken_time.without(text, spans), day.isoformat() if day else None, clock


def test_every_usual_way_to_say_when_is_read_wherever_it_stands():
    cases = [(text, read(text), tuple(meant)) for text, *meant in sentences()]
    wrong = [case for case in cases if case[1] != case[2]]
    listed = '; '.join(f'{text!r} gave {got}, meant {meant}' for text, got, meant in wrong[:12])
    assert not wrong, f'{len(wrong)} of {len(cases)} read wrongly, the first: {listed}'


def test_commands_and_reminders_read_the_same_wherever_the_words_stand(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(MONDAY.year, MONDAY.month, MONDAY.day, 15, 0)

    monkeypatch.setattr(ai, 'datetime', Clock)
    wrong = []
    for (thing, verb), (day_words, day, day_part), (clock_words, hour, minute, clock_part) in product(TITLES, DAYS, CLOCKS):
        if verb or thing not in ('Zahnarzt', 'Hausaufgaben', 'Mathe S. 45 Nr. 3') or not (day_words or clock_words):
            continue
        if hour is not None and (day_part or clock_part) and hour < 12:
            hour += 12
        meant = (thing, day, None if hour is None else f'{hour:02d}:{minute:02d}')
        when = ' '.join(filter(None, (day_words, clock_words)))
        for message in (
            f'Erinnere mich {when} an {thing}',
            f'Erinnere mich an {thing} {when}',
            f'Neue Aufgabe {when}: {thing}',
            f'Erstelle einen Termin {when}: {thing}',
            f'Erstelle eine Aufgabe "{thing}" {when}',
        ):
            got = ai._creation(message)
            if got != meant:
                wrong.append(f'{message!r} gave {got}, meant {meant}')
    assert not wrong, f'{len(wrong)} read wrongly, the first: ' + '; '.join(wrong[:12])

