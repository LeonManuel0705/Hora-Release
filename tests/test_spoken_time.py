# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import time
from datetime import date

import pytest

from app import spoken_time

MONDAY = date(2026, 10, 5)


def read(text, today=MONDAY):
    day, clock, spans = spoken_time.find(text, today)
    return spoken_time.without(text, spans), day.isoformat() if day else None, clock


@pytest.mark.parametrize('text, rest, day, clock', [
    ('Vokabeln lernen morgen', 'Vokabeln lernen', '2026-10-06', None),
    ('Übermorgen früh Sportzeug einpacken', 'Sportzeug einpacken', '2026-10-07', None),
    ('Aufsatz bis nächsten Freitag 18 Uhr abgeben', 'Aufsatz abgeben', '2026-10-09', '18:00'),
    ('Mathe bis zum Freitag', 'Mathe', '2026-10-09', None),
    ('Klausur übernächsten Montag', 'Klausur', '2026-10-19', None),
    ('Mathe nächste Woche Mittwoch', 'Mathe', '2026-10-14', None),
    ('Referat Freitag in einer Woche', 'Referat', '2026-10-16', None),
    ('Freitag bis Montag Zimmer streichen', 'Zimmer streichen', '2026-10-09', None),
    ('Praktikum von Montag bis Freitag', 'Praktikum', '2026-10-12', None),
    ('Klausur am Montag, 19.10.', 'Klausur', '2026-10-19', None),
    ('Arzt Freitag 9.10. 15 Uhr', 'Arzt', '2026-10-09', '15:00'),
    ('Abgabe am 15. Oktober 2027', 'Abgabe', '2027-10-15', None),
    ('Abgabe am 4.10.', 'Abgabe', '2027-10-04', None),
    ('Praktikum 12.-16.10.', 'Praktikum', '2026-10-12', None),
    ('Ferien vom 19.10. bis zum 30.10.', 'Ferien', '2026-10-19', None),
    ('Protokoll vom 30.9. bis 12.10. abtippen', 'Protokoll vom 30.9. abtippen', '2026-10-12', None),
    ('Quelle vom 28.6.1914 analysieren bis 12.10.', 'Quelle vom 28.6.1914 analysieren', '2026-10-12', None),
    ('Mathe Aufgaben bis 12.10. machen', 'Mathe Aufgaben machen', '2026-10-12', None),
    ('Buch in 3 Tagen zurückgeben', 'Buch zurückgeben', '2026-10-08', None),
    ('Heute in einer Woche Referat', 'Referat', '2026-10-12', None),
    ('Zahnarzt um 15.30.', 'Zahnarzt.', None, '15:30'),
    ('Wecker um 6 stellen', 'Wecker stellen', None, '06:00'),
    ('Treffen um 7, danach Schule', 'Treffen, danach Schule', None, '07:00'),
    ('Um 8 Uhr 20 Vokabeln abfragen', '20 Vokabeln abfragen', None, '08:00'),
    ('Um 8 Uhr 15 Mathe', 'Mathe', None, '08:15'),
    ('Zahnarzt 15 Uhr 30', 'Zahnarzt', None, '15:30'),
    ('18 Uhr 30 Abendessen', 'Abendessen', None, '18:30'),
    ('Nachhilfe 15-16 Uhr', 'Nachhilfe', None, '15:00'),
    ('Konzert 19:30 bis 22 Uhr', 'Konzert', None, '19:30'),
    ('Handwerker zwischen 15 und 16 Uhr', 'Handwerker', None, '15:00'),
    ('S. 12 bis 15 Uhr lesen', 'S. 12 lesen', None, '15:00'),
    ('Morgen von 8 bis 10 lernen', 'lernen', '2026-10-06', '08:00'),
    ('Mittagessen um halb 1', 'Mittagessen', None, '12:30'),
    ('Bus um Viertel vor 8 Uhr', 'Bus', None, '07:45'),
    ('Bus um dreiviertel 8', 'Bus', None, '07:45'),
    ('Bus um 5 vor 8 Uhr', 'Bus', None, '07:55'),
    ('Kino heute Abend um 8', 'Kino', '2026-10-05', '20:00'),
    ('Kino um 8 Uhr abends', 'Kino', None, '20:00'),
    ('Training morgen Nachmittag um 4', 'Training', '2026-10-06', '16:00'),
    ('Treffen gegen Abend 19 Uhr am Bahnhof', 'Treffen am Bahnhof', None, '19:00'),
    ('Meeting at 9:30 pm', 'Meeting', None, '21:30'),
    ('Flight at 12 am', 'Flight', None, '00:00'),
    ('Treffen um 3 am Brunnen', 'Treffen am Brunnen', None, '03:00'),
    ('Treffen 9:30 am Bahnhof', 'Treffen am Bahnhof', None, '09:30'),
    ('Zahnarzt - morgen 8 Uhr', 'Zahnarzt', '2026-10-06', '08:00'),
    ('Zahnarzt (Freitag 15 Uhr)', 'Zahnarzt', '2026-10-09', '15:00'),
    ('Klausur am Montag, dem 19.10.', 'Klausur', '2026-10-19', None),
    ('Klausur am Montag (19.10.)', 'Klausur', '2026-10-19', None),
    ('Klausur am 19.10. (Montag)', 'Klausur', '2026-10-19', None),
    ('Ausflug So 11.10.', 'Ausflug', '2026-10-11', None),
    ('Arzt in der nächsten Woche am Mittwoch', 'Arzt', '2026-10-14', None),
    ('Arzt übernächste Woche Montag', 'Arzt', '2026-10-19', None),
    ('Für Montag Morgen Sportzeug packen', 'Sportzeug packen', '2026-10-12', None),
    ('Geschenk für Freitag bis Mittwoch kaufen', 'Geschenk für Freitag kaufen', '2026-10-07', None),
    ('Stoff vom Freitag bis Mittwoch nachholen', 'Stoff vom Freitag nachholen', '2026-10-07', None),
    ('Klausur am Freitag schon am Mittwoch', 'Klausur am Freitag', '2026-10-07', None),
    ('Kapitel 3.1. bis 3.4. lesen bis 12.10.', 'Kapitel 3.1. bis 3.4. lesen', '2026-10-12', None),
    ('Aufgaben 2.1 bis 2.5 bis 12.10.', 'Aufgaben 2.1 bis 2.5', '2026-10-12', None),
    ('Vorbereitung auf den 12.10.', 'Vorbereitung', '2026-10-12', None),
    ('Aufgabe 3 vor 8 Uhr abgeben', 'Aufgabe 3 abgeben', None, '08:00'),
    ('Übungsblatt 3 bis 18 Uhr abgeben', 'Übungsblatt 3 abgeben', None, '18:00'),
    ('Protokoll 2 bis 15 Uhr abgeben', 'Protokoll 2 abgeben', None, '15:00'),
    ('Bunter Abend 19 Uhr in der Aula', 'Bunter Abend in der Aula', None, '19:00'),
    ('Um 12 Uhr Mittag essen mit Oma', 'Mittag essen mit Oma', None, '12:00'),
    ('Erinnerung 10 Minuten vor 8 Uhr', 'Erinnerung', None, '07:50'),
    ('Kuchen für die Party am Samstag um 15 Uhr backen bis Freitag', 'Kuchen für die Party am Samstag um 15 Uhr backen', '2026-10-09', None),
    ('Bis Freitag 18 Uhr für Montag lernen', 'für Montag lernen', '2026-10-09', '18:00'),
])
def test_the_words_for_when_are_read_and_taken_out(text, rest, day, clock):
    assert read(text) == (rest, day, clock)


@pytest.mark.parametrize('text', [
    'Seiten von 3 bis 5 lesen',
    'Aufgaben von 1 bis 10 lösen',
    'Kapitel 3.1 bis 3.4 lesen',
    '1.5 Stunden Mathe üben',
    'Mitschrift vom 1.10. abschreiben',
    'Stoff von Freitag nachholen',
    'Für die Zukunft von morgen lernen',
    'Quelle vom 28.6.1914 analysieren',
    'Referat zum 9. November 1989',
    'Abgabe 12.10.2025',
    'Feier am 31.4.',
    'Abgabe in 99999999 Tagen',
    'Übung 4.2. machen',
    'Mathe Nr. 2.3. und 2.4.',
    'Treffen in Raum 2.11.',
    'Schnitt verbessern auf 2.3.',
    'Mathe 3. und 4. Stunde nachholen',
    'Tabletten am Morgen nehmen',
    'Jeden Morgen 10 Minuten lesen',
    'Guten Morgen Karte schreiben',
    'Das Morgen planen',
    'Jeden Montag Training',
    'Montagmorgen Sportzeug',
    'Rufe den Montag-Kurs an',
    'Heute-Journal schauen',
    'Note um 1 in Mathe verbessern',
    'Taschengeld um 2.50 Euro erhöhen',
    'Aufsatz um 1 Seite kürzen',
    'gegen 3 Gegner spielen',
    'Maßstab 1:25 umrechnen',
    'Bibel Johannes 3:16 lesen',
    '5 vor 12 Aktion planen',
    'Halb 10 Seiten gelesen haben',
    'Kapitel 3 pm lesen',
    'Mathe 5 am Buch',
    'Treffen um 25 Uhr',
    'Film von 1984 ansehen',
    'Kapitel von 1.1 bis 1.4 lesen',
    'Kapitel 3.1. lesen und 3.2. zusammenfassen',
    'M 2.1. und M 2.2. lesen',
    'Übungsblatt 4.2. bearbeiten',
    'Hausaufgabe 2.3. machen',
    'Thema 2.3. wiederholen',
    'Rechnung 28.9.2026 bezahlen',
    'Arzt Montag in fünf Wochen',
    'Präsentation um 3 Folien ergänzen',
    'Video 12:30 Minuten schneiden',
    'Urlaub 12.10 und 14.10 eintragen',
    'Praktikum 12.10 bis 16.10',
])
def test_what_belongs_to_the_content_stays_where_it_is(text):
    assert read(text) == (text, None, None)


@pytest.mark.parametrize('text, rest, day', [
    ('Bis Freitag Referat für Montag vorbereiten', 'Referat für Montag vorbereiten', '2026-10-09'),
    ('Am Freitag für Dienstag lernen', 'für Dienstag lernen', '2026-10-09'),
    ('Heute für morgen lernen', 'für morgen lernen', '2026-10-05'),
    ('Am 12.10. für die Klausur am 20.10. lernen', 'für die Klausur am 20.10. lernen', '2026-10-12'),
    ('Für Montag das Referat bis Freitag fertig machen', 'Für Montag das Referat fertig machen', '2026-10-09'),
])
def test_of_two_days_the_deadline_counts_and_only_its_words_go(text, rest, day):
    assert read(text) == (rest, day, None)


@pytest.mark.parametrize('today, text, day', [
    (date(2026, 10, 7), 'Mathe am Mittwoch', '2026-10-14'),
    (date(2026, 10, 7), 'Mathe am Freitag', '2026-10-09'),
    (date(2026, 10, 7), 'Mathe nächste Woche Montag', '2026-10-12'),
    (date(2026, 10, 7), 'Arzt Montag in einer Woche', '2026-10-19'),
    (date(2026, 10, 11), 'Arzt Freitag in einer Woche', '2026-10-23'),
    (date(2026, 10, 5), 'Abgabe Montag in zwei Wochen', '2026-10-19'),
    (date(2026, 10, 7), 'Abgabe am 7.10.', '2026-10-07'),
    (date(2026, 12, 31), 'Feuerwerk morgen', '2027-01-01'),
    (date(2026, 12, 31), 'Abgabe am 2.1.', '2027-01-02'),
    (date(2026, 12, 31), 'Abgabe am Freitag', '2027-01-01'),
    (date(2028, 2, 28), 'Abgabe am 29.2.', '2028-02-29'),
])
def test_days_are_counted_from_the_day_it_is(today, text, day):
    assert read(text, today)[1] == day


def test_every_find_lies_inside_the_text_and_none_reaches_into_another():
    texts = [
        'Aufsatz bis diesen Freitag 18 Uhr bei Frau Busch abgeben',
        'Bis nächsten Freitag um 18 Uhr Aufsatz abgeben',
        'Morgen früh um 7 Uhr 30 und um 8 Uhr an die Tabletten denken',
        'heute morgen um 7 Uhr bis Freitag am 12.10. ' * 6,
        'von 1 bis ' * 28,
        '12.10. bis 13.10. - ' * 14,
        '1.' * 140,
        'halb ' * 55,
        'nächsten ' * 30 + 'montag',
    ]
    for text in texts:
        started = time.perf_counter()
        day, clock, spans = spoken_time.find(text, MONDAY)
        assert time.perf_counter() - started < 0.5
        assert all(0 <= start < end <= len(text) for start, end in spans)
        assert all(first[1] <= second[0] for first, second in zip(spans, spans[1:]))
        assert '\x00' not in spoken_time.without(text, spans)
