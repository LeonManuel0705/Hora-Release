# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

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
    ('Zahnarzt Montag 15.30 Uhr', 'Zahnarzt', '2026-10-12', '15:30'),
    ('Samstag 5.5 km joggen', '5.5 km joggen', '2026-10-10', None),
    ('Ab Montag 2 Wochen Praktikum', '2 Wochen Praktikum', '2026-10-12', None),
    ('Arzt am Mittwoch der nächsten Woche', 'Arzt', '2026-10-14', None),
    ('Zahnarzt am 12.10., Montag um 15 Uhr', 'Zahnarzt', '2026-10-12', '15:00'),
    ('Mathe Hausaufgaben 12.10.', 'Mathe Hausaufgaben', '2026-10-12', None),
    ('Lernphase 12.10. bis 16.10.', 'Lernphase', '2026-10-12', None),
    ('Praktikum 8 bis 17 Uhr', 'Praktikum', None, '08:00'),
    ('Nachhilfe 4 bis 5 Uhr', 'Nachhilfe', None, '04:00'),
    ('Proberaum 17 bis 19 Uhr', 'Proberaum', None, '17:00'),
    ('Bücher abgeben 10 bis 12 Uhr', 'Bücher abgeben', None, '10:00'),
    ('Musikraum 15-16 Uhr', 'Musikraum', None, '15:00'),
    ('Aufgaben 1 bis 5 vor 8 Uhr abgeben', 'Aufgaben 1 bis 5 abgeben', None, '08:00'),
    ('Seiten 12 bis 15 nach 16 Uhr lesen', 'Seiten 12 bis 15 lesen', None, '16:00'),
    ('Treffen 5 vor 8 Uhr', 'Treffen', None, '07:55'),
    ('Klausur ist schon am Mittwoch, bis Dienstag lernen', 'Klausur ist schon am Mittwoch, lernen', '2026-10-06', None),
])
def test_the_words_for_when_are_read_and_taken_out(text, rest, day, clock):
    assert read(text) == (rest, day, clock)


@pytest.mark.parametrize('today, text, rest, day', [
    (date(2026, 10, 5), 'Praktikum vom 12.10. bis 16.10.', 'Praktikum', '2026-10-12'),
    (date(2026, 10, 12), 'Praktikum vom 12.10. bis 16.10.', 'Praktikum', '2026-10-12'),
    (date(2026, 10, 14), 'Praktikum vom 12.10. bis 16.10.', 'Praktikum', '2026-10-14'),
    (date(2026, 10, 16), 'Praktikum vom 12.10. bis 16.10.', 'Praktikum', '2026-10-16'),
    (date(2026, 10, 17), 'Praktikum vom 12.10. bis 16.10.', 'Praktikum', '2027-10-12'),
    (date(2026, 10, 14), 'Praktikum 12.-16.10.', 'Praktikum', '2026-10-14'),
    (date(2026, 10, 14), 'Praktikum vom 12. bis 16. Oktober', 'Praktikum', '2026-10-14'),
    (date(2026, 10, 20), 'Praktikum vom 12. bis 16. Oktober', 'Praktikum', '2027-10-12'),
    (date(2026, 12, 20), 'Skifahren vom 28.12. bis 3.1.', 'Skifahren', '2026-12-28'),
    (date(2026, 12, 30), 'Skifahren vom 28.12. bis 3.1.', 'Skifahren', '2026-12-30'),
    (date(2027, 1, 2), 'Skifahren vom 28.12. bis 3.1.', 'Skifahren', '2027-01-02'),
    (date(2026, 10, 14), 'Praktikum vom 12.10.2026 bis 16.10.2026', 'Praktikum', '2026-10-14'),
    (date(2026, 10, 20), 'Praktikum vom 12.10.2026 bis 16.10.2026', 'Praktikum vom 12.10.2026 bis 16.10.2026', None),
    (date(2026, 10, 14), 'Protokoll vom 12.10. bis 16.10. abtippen', 'Protokoll vom 12.10. abtippen', '2026-10-16'),
    (date(2026, 10, 5), 'Protokoll vom 12.10. bis 16.10. abtippen', 'Protokoll abtippen', '2026-10-12'),
])
def test_a_stretch_of_days_stands_for_its_first_day_or_for_today_while_it_lasts(today, text, rest, day):
    assert read(text, today)[:2] == (rest, day)


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
    'Kapitel 12.10. lesen',
    'Mathe Hausaufgaben 2.3.',
    'Versuch 3.2. auswerten',
    'Training 22 bis 2 Uhr',
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



@pytest.mark.parametrize('today, text, day', [
    (date(2026, 10, 5), 'Übungsblatt 4.2. bearbeiten', None),
    (date(2027, 1, 25), 'Übungsblatt 4.2. bearbeiten', '2027-02-04'),
    (date(2027, 1, 25), 'Übung 4.2. machen', None),
    (date(2026, 10, 5), 'Feuerwehrübung 14.10. 18 Uhr', '2026-10-14'),
    (date(2026, 10, 5), 'Feuerwehrübung 14.11. 18 Uhr', None),
])
def test_behind_a_word_that_may_number_something_only_a_near_date_is_a_day(today, text, day):
    assert read(text, today)[1] == day


@pytest.mark.parametrize('text, rest, day, clock', [
    ('Zahnarzt Do 15:30–16:15', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Zahnarzt Do 15:30-16:15', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Zahnarzt Do. 15 Uhr', 'Zahnarzt', '2026-10-08', '15:00'),
    ('Do 15:30 Zahnarzt', 'Zahnarzt', '2026-10-08', '15:30'),
    ('15:30 Do Zahnarzt', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Zahnarzt 15:30 Do', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Zahnarzt Do', 'Zahnarzt', '2026-10-08', None),
    ('Zahnarzt am do 15:30', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Zahnarzt Do mit Mama', 'Zahnarzt mit Mama', '2026-10-08', None),
    ('Brunch So 10 Uhr', 'Brunch', '2026-10-11', '10:00'),
    ('Mi 18 Uhr Kino', 'Kino', '2026-10-07', '18:00'),
    ('Zahnarzt Do morgen 8 Uhr', 'Zahnarzt', '2026-10-08', '08:00'),
    ('Kino Fr', 'Kino', '2026-10-09', None),
    ('Do Zahnarzt 15:30–16:15', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Do. Zahnarzt 15:30', 'Zahnarzt', '2026-10-08', '15:30'),
    ('Do. Zahnarzt', 'Zahnarzt', '2026-10-08', None),
    ('Mo Training 18 Uhr', 'Training', '2026-10-12', '18:00'),
    ('Sa nachmittags Fußball', 'Fußball', '2026-10-10', None),
    ('Mi Training abends', 'Training abends', '2026-10-07', None),
    ('So 10 Uhr Brunch', 'Brunch', '2026-10-11', '10:00'),
    ('So gegen 15 Uhr Kaffee', 'Kaffee', '2026-10-11', '15:00'),
    ('Mi Amor anrufen um 15 Uhr', 'Amor anrufen', '2026-10-07', '15:00'),
    ('Kino Do Abend', 'Kino', '2026-10-08', None),
    ('Kino Do Abend 8 Uhr', 'Kino', '2026-10-08', '20:00'),
    ('Do Abend 7 bis 9 Uhr Kino', 'Kino', '2026-10-08', '19:00'),
    ('Kino Fr Abend 20 Uhr', 'Kino', '2026-10-09', '20:00'),
    ('Mo bis Fr Praktikum', 'Praktikum', '2026-10-12', None),
    ('Praktikum Mo bis Fr', 'Praktikum', '2026-10-12', None),
    ('Praktikum Mo bis Freitag 8 Uhr', 'Praktikum', '2026-10-12', '08:00'),
    ('Treffen Freitag und so', 'Treffen und so', '2026-10-09', None),
])
def test_a_short_weekday_counts_where_nothing_else_can_be_meant(text, rest, day, clock):
    assert read(text) == (rest, day, clock)


@pytest.mark.parametrize('text, rest, clock', [
    ('Gespräch mit Fr. Müller 15 Uhr', 'Gespräch mit Fr. Müller', '15:00'),
    ('Treffen mit Di Maria um 15 Uhr', 'Treffen mit Di Maria', '15:00'),
    ('Fr. Dr. Weber anrufen um 15 Uhr', 'Fr. Dr. Weber anrufen', '15:00'),
    ('Lady Di Doku schauen um 20 Uhr', 'Lady Di Doku schauen', '20:00'),
    ('Anruf bei Mi Amor 15 Uhr', 'Anruf bei Mi Amor', '15:00'),
    ('Fr Müller anrufen 15 Uhr', 'Fr Müller anrufen', '15:00'),
    ('Zahnarzt do 15:30', 'Zahnarzt do', '15:30'),
    ('Mo-Fr Praktikum 8 Uhr', 'Mo-Fr Praktikum', '08:00'),
    ('Praktikum Mo - Fr 8 Uhr', 'Praktikum Mo - Fr', '08:00'),
    ('Treffen mit Mo um 19 Uhr', 'Treffen mit Mo', '19:00'),
    ('Pizza mit Sa', 'Pizza mit Sa', None),
    ('Gym Mo, Mi, Fr 7 Uhr', 'Gym Mo, Mi, Fr', '07:00'),
    ('Training Mo und Mi 18 Uhr', 'Training Mo und Mi', '18:00'),
    ('Training Montag und Mittwoch 18 Uhr', 'Training Montag und Mittwoch', '18:00'),
    ('Lauftreff Di oder Do 18 Uhr', 'Lauftreff Di oder Do', '18:00'),
    ('Frau Freitag anrufen 15 Uhr', 'Frau Freitag anrufen', '15:00'),
    ('Herr Montag kommt 15 Uhr', 'Herr Montag kommt', '15:00'),
    ('Do Zahnarzt', 'Do Zahnarzt', None),
    ('So ein Tag', 'So ein Tag', None),
    ('So, noch Mathe lernen 15 Uhr', 'So, noch Mathe lernen', '15:00'),
    ('Do, Zahnarzt 15 Uhr', 'Do, Zahnarzt', '15:00'),
    ('So viel lernen 15 Uhr', 'So viel lernen', '15:00'),
    ('So früh wie möglich anrufen', 'So früh wie möglich anrufen', None),
])
def test_a_short_weekday_in_a_name_a_list_or_opening_a_sentence_without_a_time_stays_text(text, rest, clock):
    assert read(text) == (rest, None, clock)
