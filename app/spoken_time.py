# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Finds the day and the clock time a German sentence names as the moment of an entry.

Only what clearly says when something is due counts. A date that belongs to the
content ("Mitschrift vom 1.10.", "Quelle vom 28.6.1914"), the number of a page
or an exercise ("Übung 4.2.", "Seiten von 3 bis 5") and an amount ("um 2 Punkte
verbessern") are left where they are, because a wrong day on an entry is worse
than a missing one.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import NamedTuple, Optional

WEEKDAYS = ('montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag')
# Days in a list ("Mo, Mi und Fr") name a rhythm, so none of them counts. Short names count as written ("Do", not "do")
# unless "am" or "bis" stands before them, and only where nothing else can be meant: never after "mit", never in front of
# a name ("Fr. Müller", "Di Maria") unless a clock time stands before them, and at the start of a sentence only with a
# dot, a time or a time of day and without a comma behind them ("So, ..." and "So ein Tag" stay text). The quick fields
# of the app read days by the same rules (shell.js, shortDay).
SHORT_WEEKDAYS = ('Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So')
MONTHS = {'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6,
          'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12}
COUNTS = {'einem': 1, 'einer': 1, 'zwei': 2, 'drei': 3, 'vier': 4}

_NAME = rf'(?:{"|".join(WEEKDAYS)})'
_ADVERB = r'(?:früh|morgens|vormittags|mittags|nachmittags|abends|nachts)'
_NOUN = r'(?:vormittag|mittag|nachmittag|abend|nacht)'
_PART = rf'(?:{_ADVERB}|{_NOUN})'
_START = r'(?<![\w.-])'
_END = r'(?![\w-])'
_LEAD = (
    r'(?P<lead>(?:(?:bis|ab|vor|nach|für|spätestens|noch|schon|bereits|erst|von|vom|seit|über|am|zum|den|dem|auf(?=\s+de[nm]\s)'
    r'|übernächsten?|nächsten?|kommenden?|diesen|diesem|letzten?|vergangenen?|jeden|jedem)\s+)*)'
)
_OF_THE_CONTENT = frozenset(('von', 'vom', 'seit', 'über', 'letzte', 'letzten', 'vergangene', 'vergangenen', 'jeden', 'jedem'))
_DEADLINE = frozenset(('bis', 'spätestens', 'vor'))
_EARLY = frozenset(('schon', 'bereits'))
_PLAIN = 2
# Words that number something: "Kapitel 12.10." is a chapter, no day.
_LABEL = (
    r'(?<![\w.])(?:nr\.?|s\.|aufg\.?|abb\.?|tab\.?|m|§|nummer|seiten?|aufgaben?|kapitel|abschnitt|teil|übung(?:en)?|lektion|blatt|raum|zimmer'
    r'|saal|version|klasse|zeilen?|vers|unit|band|punkt|ziffer|note|schnitt|stufe|level|thema|abbildung|tabelle|material|folie|paragraph'
    r'|artikel|ziel|schritt|szene|strophe|grafik|diagramm|modul|absatz|auf|um)'
)
_NOT_A_DAY_BEFORE = re.compile(rf'{_LABEL}\s*$')
# At the end of a longer word, and for a few words of their own, it can be either: "Hausaufgabe 2.3." is a number,
# "Hausaufgaben 12.10." a day. There only a date within the next NEAR days counts as one.
_MAYBE_A_LABEL_BEFORE = re.compile(
    r'(?:\w(?:blatt|aufgaben?|übung(?:en)?|kapitel|seiten?|abschnitt|lektion|folie|abbildung|tabelle|thema|material|raum|zimmer|saal'
    r'|paragraph|artikel|ziel|schritt|phase|szene|strophe)|(?<![\w.])(?:versuch|station|phase|quelle))\s*$')
NEAR = 21
_LISTED = re.compile(r'\b(?:und|oder|sowie)\s*$')
_NOT_TOMORROW_BEFORE = re.compile(
    rf'(?<!\w)(?:am|jeden|jedem|guten|gestern|heute|frühen|nächsten|das|der|den|dem|diesen|diesem|einen|einem|{_NAME}'
    rf'|(?:{"|".join(SHORT_WEEKDAYS)})\.?)\s+$')
# Behind a weekday: a date or a count of weeks that was not understood. The weekday alone would then be the wrong day.
_UNREAD_AFTER = re.compile(rf'\s*[,(–-]?\s*(?:de[nmr]\s+)?\d{{1,2}}\.\s?(?:\d{{1,2}}\.|(?:{"|".join(MONTHS)})\b)|\s+in\s+\S+\s+wochen?\b')
# What a number measures ("um 2 Punkte", "5:30 pro km") and, in _UNIT, also what it may simply count ("halb 10 Seiten").
_MEASURE = (
    r'(?:tage?n?|wochen?|monate?n?|jahre?n?|stunden?|std|minuten?|min|sekunden?|euro|€|cent|%|prozent|punkte?n?|noten?|stufen?|grad'
    r'|meter|cm|km|kg|kilo|kilogramm|gramm|liter|ml|stück|mal|pro)'
)
_UNIT = rf'(?:{_MEASURE}|seiten?|zeilen?|wörter|worte|plätze?|klassen?|runden?|sätze?|aufgaben?|vokabeln?|kapitel)'
_AMOUNT_VERB = re.compile(
    r'\b(?:erhöh|senk|verbesser|verschlechter|reduzier|verringer|verlänger|verkürz|steiger|kürz|vergrößer|verkleiner|ergänz|erweiter|aufstock)\w*')
_NOT_A_DAY_AFTER = re.compile(r'\s*(?:uhr|stunden?|std|min|minuten|seiten?|punkte?|euro|€|%|prozent|km|meter|m|cm|kg|kilo|gramm|g|liter|l|grad|mal)\b')
_HAND_IN = re.compile(r'\b(?:abgeb|abzugeb|hochlad|hochzulad|einreich|einzureich|einsend|abschick|korrigier)\w*')
# In front of a clock only a word that really carries a number counts, and only right in front of it:
# "Übungsblatt 3 bis 18 Uhr", but "Proberaum 17 bis 19 Uhr", "Hausaufgaben 8 bis 10 Uhr" and "Kapitel 4 8 bis 10 Uhr".
_NUMBERED = (
    r'(?:\w*(?:blatt|aufgabe)|(?<![\w.])(?:nr\.?|nummer|s\.|seiten?|aufgaben|aufg\.?|kapitel|abschnitt|teil|übung(?:en)?|lektion|unit|klasse'
    r'|zeilen?|vers|punkt))'
)
_NUMBERED_BEFORE = re.compile(rf'{_NUMBERED}\s*$')
_NUMBERED_STRETCH_BEFORE = re.compile(rf'{_NUMBERED}\s*(?:\d{{1,3}}\s*)?$')
_RATIO_BEFORE = re.compile(r'(?<![\w.])(?:maßstab|verhältnis|stand|spielstand|ergebnis|quote|vers|kapitel|seite|s\.|bestzeit|rekord|pace|tempo|laufzeit|dauer)\s*$')
_NOT_A_SPAN_BEFORE = re.compile(r'(?<![\w.])(?:vom|am|den|zum)\s*$')
# Things that carry a date of their own. In "Protokoll vom 30.9. bis 12.10. abtippen" the first date names the protocol and only
# the second one says when, so a stretch behind such a word that has already begun is read that way. "Praktikum vom 12.10. bis
# 16.10." stays a stretch of days.
_DATED_THING_BEFORE = re.compile(
    r'(?:protokoll|mitschrift|notizen|hefteintrag|tafelbild|blatt|hausaufgaben?|aufgaben?|übung(?:en)?|zusammenfassung|brief|mail'
    r'|nachricht|rechnung|quelle|text|artikel|zeitung|bericht|aufsatz|test|klausur|arbeit|stunde|unterricht|sitzung|besprechung'
    r'|vortrag|präsentation|folien|video|aufnahme|fotos?|stoff)\s*$'
)
_NOT_PM_BEFORE = re.compile(rf'(?:{_LABEL}|(?<![\w.])(?:und|oder|zwischen|bis))\s*$')

_RELATIVE = re.compile(
    rf'{_START}(?P<lead>(?:(?:bis|ab|vor|für|spätestens|noch|schon|bereits|erst|von|vom|seit)\s+)*)'
    rf'(?P<word>heute|today|übermorgen|morgen|tomorrow)(?:\s+(?P<part>{_PART}|morgen))?(?:\s+noch)?{_END}'
)
_WEEK = r'(?:(?:in\s+)?der\s+)?(?:übernächste[rn]?|nächste[rn]?|kommende[rn]?|diese[rn]?)\s+woche'
_WEEKDAY = re.compile(
    rf'{_START}{_LEAD}(?:(?P<week>{_WEEK})\s+(?:am\s+)?)?(?:(?P<name>{_NAME})|(?P<short>{"|".join(SHORT_WEEKDAYS)})\.?)(?:\s+(?P<part>{_PART}|morgen))?'
    rf'(?P<range>\s+bis\s+(?:(?:zum|einschließlich)\s+)?(?P<last>{_NAME}|{"|".join(SHORT_WEEKDAYS)}))?'
    rf'(?:\s+(?:in\s+(?P<weeks>einer|\d|zwei|drei|vier)\s+wochen?|(?P<after>{_WEEK})))?{_END}'
)
_AHEAD = re.compile(rf'{_START}(?:(?:heute|bis)\s+)?in\s+(?P<count>\d{{1,3}}|einem|einer|zwei|drei|vier)\s+(?P<unit>tag(?:en)?|wochen?){_END}')
_SHORT_DAY = re.compile(rf'(?<![\w.–/-])(?:{"|".join(SHORT_WEEKDAYS)})(?![\w-])', re.IGNORECASE)
_SHORT_BEFORE_DATE = re.compile(r'\.?,?\s+(?:den\s+)?\d{1,2}\.')
_SHORT_MARKED = re.compile(r'(?<!\w)(?:am|bis|zum|ab|spätestens)\s+$', re.IGNORECASE)
_SHORT_NOT_AFTER = re.compile(r'(?<!\w)(?:herr|frau|hr\.|fr\.|dr\.|prof\.)\s*$|[–/-]\s*$', re.IGNORECASE)
_SHORT_LISTED = re.compile(r'\s*[–/-]\s*(?:mo|di|mi|do|fr|sa|so)(?!\w)', re.IGNORECASE)
_SHORT_NAMED = re.compile(r'\s*[,.]?\s*[A-ZÄÖÜ]')
_CLOCK_BEFORE = re.compile(rf'(?:\d|uhr|{_ADVERB})\s*[,.]?\s*$', re.IGNORECASE)
_SHORT_WITH = re.compile(r'(?<!\w)mit\s+$', re.IGNORECASE)
_DAY_ANY = rf'(?:(?i:{_NAME})|{"|".join(SHORT_WEEKDAYS)})'
_SHORT_RANGE = re.compile(rf'\s+bis\s+(?:(?:zum|einschließlich)\s+)?(?:{_NAME}|{"|".join(SHORT_WEEKDAYS)})(?!\w)', re.IGNORECASE)
_LIST_AFTER = re.compile(rf'\.?\s*(?:,|&|(?i:und|oder))\s*{_DAY_ANY}(?!\w)')
_LIST_BEFORE = re.compile(rf'(?<!\w){_DAY_ANY}\.?\s*(?:,|&|(?i:und|oder))\s*$')
_TITLE_BEFORE = re.compile(r'(?<!\w)(?:herr|frau|hr\.|fr\.|dr\.|prof\.)\s*$', re.IGNORECASE)
# "früh" and "morgen" are left out here: "So früh wie möglich" and "So, morgen ..." name no day.
_DAYTIME = r'(?:vormittags?|mittags?|nachmittags?|abends?|nachts?|morgens)'
_DAYTIME_AFTER = re.compile(rf'\s+{_DAYTIME}(?!\w)', re.IGNORECASE)
_ANY_DAYTIME = re.compile(rf'(?<!\w){_DAYTIME}(?!\w)', re.IGNORECASE)
_ANY_CLOCK = re.compile(
    r'(?<![\d.:])(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:[01]?\d|2[0-3])(?:\.[0-5]\d)?\s*uhr(?!\w))|(?<!\w)(?:um|ab|gegen)\s+(?:[01]?\d|2[0-3])(?!\d)',
    re.IGNORECASE)
_SO_WORD = re.compile(r'\s+(?!(?:um|ab|gegen)(?!\w))[a-zäöüß]')
_NAMED_DAY = (
    rf'(?:(?P<name>{_NAME}|{"|".join(SHORT_WEEKDAYS)})\.?(?:\s*,\s*|\s*[–-]\s+|\s*(?P<open>\()\s*|\s+)(?:de[nmr]\s+)?)?'
)
_NAMED_AFTER = rf'(?(open)\s*\))(?:\s*\(\s*{_NAME}\s*\)|\s*,\s*{_NAME}(?=\s*(?:$|[,.;!?]|(?:um|ab|gegen)\b|\d)))?'
_NUMERIC = re.compile(
    rf'(?<![\w.,:]){_LEAD}{_NAMED_DAY}(?:(?P<first>\d{{1,2}})\.\s*(?:-|–|bis)\s*)?'
    r'(?P<d>\d{1,2})\.\s?(?P<m>\d{1,2})(?P<close>\.(?P<y>\d{4}|\d{2})?)?(?![\d:])'
    r'(?P<range>\s*(?:bis(?:\s+zum)?|-|–)\s*(?P<d2>\d{1,2})\.\s?(?P<m2>\d{1,2})\.(?:\d{4}|\d{2})?(?![\d:]))?'
    rf'{_NAMED_AFTER}'
)
_MONTH = re.compile(
    rf'(?<![\w.,:]){_LEAD}{_NAMED_DAY}(?:(?P<first>\d{{1,2}})\.\s*(?:-|–|bis(?:\s+zum)?)\s*)?'
    rf'(?P<d>\d{{1,2}})\.\s*(?P<month>{"|".join(MONTHS)})(?:\s+(?P<y>\d{{4}}))?{_END}{_NAMED_AFTER}'
)

_CLOCK_LEAD = r'(?P<lead>(?:(?:um|bis|gegen|ab|vor|nach|von|at|spätestens|kurz|ca\.?|circa|etwa|so)\s+)*)'
# "abends um 8" and "gegen Abend 19 Uhr" name the time of day, the noun alone ("Bunter Abend 19 Uhr") does not.
_BEFORE = rf'(?:(?:(?:gegen|am|bis)\s+(?P<early>{_PART})|(?P<early2>{_ADVERB}))\s+)?'
_AFTER = rf'(?:\s+(?:am\s+(?P<late>{_NOUN})|(?P<late2>{_ADVERB}))(?!\w))?'
_SPAN = re.compile(
    rf'{_START}(?P<lead>(?:(?:von|ab|zwischen|um)\s+)?)(?P<h>\d{{1,2}})(?:(?P<sep>[:.])(?P<min>\d{{2}}))?(?P<u1>\s*uhr)?'
    rf'\s*(?P<join>bis(?:\s+um)?|-|–|und)\s*(?P<h2>\d{{1,2}})(?:(?P<sep2>[:.])\d{{2}})?(?P<u2>\s*uhr)?{_END}{_AFTER}'
)
_WITH_UHR = re.compile(
    rf'{_START}{_BEFORE}{_CLOCK_LEAD}(?P<h>\d{{1,2}})(?:[:.](?P<min>\d{{2}}))?\s*(?P<uhr>uhr)(?:\s+(?P<past>\d{{1,2}})(?!\d|\.\s*\S))?{_END}{_AFTER}'
)
_COLON = re.compile(rf'{_START}{_BEFORE}{_CLOCK_LEAD}(?P<h>\d{{1,2}}):(?P<min>\d{{2}})(?!\d|:\d)(?:\s*(?P<half>am|pm)(?!\w))?{_AFTER}')
_DOTTED = re.compile(rf'{_START}{_BEFORE}(?P<lead>(?:(?:um|gegen)\s+)+)(?P<h>\d{{1,2}})\.(?P<min>\d{{2}})(?!\d|\.\d){_AFTER}')
_BARE = re.compile(rf'{_START}{_BEFORE}(?P<lead>(?:(?:um|gegen)\s+)+)(?P<h>\d{{1,2}})(?:\s?h)?(?!\w|:|\.\d|\s*(?:-|–)\s*\d){_AFTER}')
_SPOKEN = re.compile(
    rf'{_START}{_BEFORE}{_CLOCK_LEAD}'
    r'(?:(?P<word>halb|dreiviertel|viertel\s+vor|viertel\s+nach|viertel)|(?P<off>\d{1,2})(?P<minutes>\s+minuten)?\s+(?P<side>vor|nach))'
    rf'\s+(?P<h>\d{{1,2}})(?P<uhr>\s*uhr)?{_END}{_AFTER}'
)
_ENGLISH = re.compile(rf'{_START}(?P<lead>(?:(?:at|um|bis|ab|gegen)\s+)?)(?P<h>\d{{1,2}})\s*(?P<half>am|pm)(?!\w)')


class Day(NamedTuple):
    day: date
    span: tuple
    rank: int
    part: Optional[str]


class Clock(NamedTuple):
    text: Optional[str]
    span: tuple


def _low(text):
    """Lower case that keeps every character in its place."""
    return ''.join(char.lower() if len(char.lower()) == 1 else char for char in text)


def _listed(text, start, end):
    return bool(_LIST_BEFORE.search(text[:start]) or _LIST_AFTER.match(text, end))


def _short_day(text, match):
    """The way a short day name is meant to be read, written as the day ("Do"), or None when it may be anything else."""
    word, before = match.group(), text[:match.start()]
    dotted = text[match.end():match.end() + 1] == '.'
    after = text[match.end() + dotted:]
    if _SHORT_LISTED.match(after) or _SHORT_NOT_AFTER.search(before) or _listed(text, match.start(), match.end()):
        return None
    day = word[0].upper() + word[1].lower()
    if _SHORT_MARKED.search(before):
        return day
    if word != day or _SHORT_WITH.search(before):
        return None
    if _SHORT_BEFORE_DATE.match(text, match.end()) or _DAYTIME_AFTER.match(after):
        return day
    named = _SHORT_NAMED.match(after)
    if before.strip():
        return None if named and (day == 'Fr' or not _CLOCK_BEFORE.search(before)) else day
    if after.lstrip().startswith(',') or (named and day == 'Fr') or (day == 'So' and not dotted and _SO_WORD.match(after)):
        return None
    return day if dotted or _SHORT_RANGE.match(after) or _ANY_CLOCK.search(text) or _ANY_DAYTIME.search(text) else None


def _low_but_short_days(text):
    low = _low(text)
    for match in _SHORT_DAY.finditer(text):
        day = _short_day(text, match)
        if day:
            low = low[:match.start()] + day + low[match.end():]
    return low


def _rank(lead):
    words = set(lead.split())
    if words & _OF_THE_CONTENT:
        return None
    return 0 if words & _DEADLINE else 1 if words & _EARLY else 3 if 'für' in words else _PLAIN


def _dated(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _written_day(today, day, month, year):
    """The day a written date means, or None when it lies behind us or far away and so belongs to the content."""
    if year is not None:
        year += 2000 if year < 100 else 0
        found = _dated(year, month, day) if today.year <= year <= today.year + 10 else None
        return found if found and found >= today else None
    found = _dated(today.year, month, day)
    if found and found < today:
        found = _dated(today.year + 1, month, day)
    return found


def _stretch(today, first, last, year=None):
    """The day a stretch of days stands for, as (day, begun), or None when it lies behind us.

    That is its first day, or today while it lasts. Without a year the stretch
    still to come counts, the running one included, and one across the turn of
    the year ends in the next year.
    """
    if year is not None:
        year += 2000 if year < 100 else 0
        if not today.year - 1 <= year <= today.year + 10:
            return None
    for start_year in [year] if year is not None else [today.year - 1, today.year, today.year + 1]:
        start = _dated(start_year, first[1], first[0])
        end = _dated(start_year + (1 if (last[1], last[0]) < (first[1], first[0]) else 0), last[1], last[0])
        if start and end and end >= today:
            return max(start, today), start < today
    return None


def _relative_days(low, today):
    for match in _RELATIVE.finditer(low):
        word, rank = match.group('word'), _rank(match.group('lead'))
        if rank is None or (word in ('morgen', 'tomorrow') and _NOT_TOMORROW_BEFORE.search(low[:match.start()])):
            continue
        ahead = {'heute': 0, 'today': 0, 'übermorgen': 2}.get(word, 1)
        part = match.group('part')
        yield Day(today + timedelta(days=ahead), match.span(), rank, 'früh' if part == 'morgen' else part)


def _weekdays(text, low, today):
    position = 0
    while True:
        match = _WEEKDAY.search(low, position)
        if not match:
            return
        position = match.end()
        named = 'name' if match.group('name') else 'short'
        if _TITLE_BEFORE.search(low[:match.start()]) or _listed(text, match.start(named), match.end(named)):
            continue
        words = set(match.group('lead').split())
        rank, span = _rank(match.group('lead')), match.span()
        if match.group('range'):
            if (words - {'von'}) & (_OF_THE_CONTENT | {'für'}):
                # "für Freitag bis Mittwoch" is no stretch of days: the second one is a deadline of its own.
                span = (match.start(), match.start('range'))
                position = match.start('range')
            else:
                rank = _PLAIN
        if rank is None:
            continue
        index = WEEKDAYS.index(match.group('name')) if match.group('name') else SHORT_WEEKDAYS.index(match.group('short'))
        week, weeks = match.group('week') or match.group('after'), match.group('weeks')
        ranged = span == match.span()
        if week and ranged:
            words_of_week = week.split()[-2]
            ahead = 2 if words_of_week.startswith('über') else 0 if words_of_week.startswith('diese') else 1
            day = today - timedelta(days=today.weekday()) + timedelta(weeks=ahead, days=index)
            if day < today:
                continue
        elif weeks and ranged:
            day = today + timedelta(days=(index - today.weekday()) % 7, weeks=COUNTS.get(weeks) or int(weeks))
        else:
            if _UNREAD_AFTER.match(low[span[1]:]):
                continue
            day = today + timedelta(days=(index - today.weekday()) % 7 or 7)
            if any(word.startswith('übernächste') for word in words):
                day += timedelta(days=7)
        part = match.group('part')
        yield Day(day, span, rank, 'früh' if part == 'morgen' else part)


def _days_ahead(low, today):
    for match in _AHEAD.finditer(low):
        count = COUNTS.get(match.group('count')) or int(match.group('count'))
        days = count * (7 if match.group('unit').startswith('woche') else 1)
        yield Day(today + timedelta(days=days), match.span(), _PLAIN, None)


def _numeric_days(low, today):
    """Dates written with numbers. A number that turns out to be none is remembered: what is listed after it is none either."""
    position, refused = 0, None
    while True:
        match = _NUMERIC.search(low, position)
        if not match:
            return
        found = _numeric_day(low, today, match, refused)
        if isinstance(found, Day):
            yield found
            position, refused = match.end(), None
        else:
            position = match.end('close') if match.group('close') else match.end('m')
            refused = (position, int(match.group('first') or match.group('d'))) if found else None


def _numeric_day(low, today, match, refused):
    """The day of one written date, True when it is the number of something instead, False when it is no day for another reason."""
    rank = _rank(match.group('lead'))
    led = bool(match.group('lead') or match.group('name'))
    before, after = low[:match.start()], low[match.end():]
    number = int(match.group('first') or match.group('d'))
    if not led:
        if not match.group('close') or _NOT_A_DAY_BEFORE.search(before):
            return True
        if _MAYBE_A_LABEL_BEFORE.search(before):
            near = _written_day(today, number, int(match.group('m')), int(match.group('y')) if match.group('y') else None)
            if not near or (near - today).days > NEAR:
                return True
        between = low[refused[0]:match.start()].strip() if refused else ''
        if refused and (_LISTED.search(before) or (between and not between.strip(',;–-'))):
            return True
    elif refused and match.group('lead').split()[:1] == ['bis'] and not low[refused[0]:match.start()].strip():
        # "Kapitel 3.1. bis 3.4." goes on in the same or the next chapter, a deadline behind it ("... bis 12.10.") does not.
        # Without a closing dot on either side ("12.10 bis 16.10") nothing says whether these are days at all.
        if number in (refused[1], refused[1] + 1) or not match.group('close'):
            return True
    if _NOT_A_DAY_AFTER.match(after):
        return False
    year = int(match.group('y')) if match.group('y') else None
    reaches = match.group('range') or match.group('first')
    if reaches:
        last = (int(match.group('d2') or match.group('d')), int(match.group('m2') or match.group('m')))
        found = _stretch(today, (number, int(match.group('m'))), last, year)
        if not found or (found[1] and _DATED_THING_BEFORE.search(before)):
            return False
        day = found[0]
    else:
        day = _written_day(today, number, int(match.group('m')), year)
        if not day:
            return False
    if rank is None and not reaches:
        return not match.group('close')
    return Day(day, match.span(), _PLAIN if rank is None else rank, None)


def _month_days(low, today):
    for match in _MONTH.finditer(low):
        rank, first, month = _rank(match.group('lead')), match.group('first'), MONTHS[match.group('month')]
        year = int(match.group('y')) if match.group('y') else None
        if first:
            found = _stretch(today, (int(first), month), (int(match.group('d')), month), year)
            if not found or (found[1] and _DATED_THING_BEFORE.search(low[:match.start()])):
                continue
            day = found[0]
        else:
            day = _written_day(today, int(match.group('d')), month, year)
            if not day or rank is None:
                continue
        yield Day(day, match.span(), _PLAIN if rank is None else rank, None)


def _outermost(found):
    """Drops what lies inside a longer find, so "Montag, 19.10." is one day and "19:30 bis 22 Uhr" one clock."""
    kept = []
    for item in sorted(found, key=lambda item: (item.span[0] - item.span[1], item.span[0])):
        if not any(item.span[0] < other.span[1] and other.span[0] < item.span[1] for other in kept):
            kept.append(item)
    return kept


def days(text, today):
    """Every day a text names, the one that counts for the entry first.

    A deadline ("bis Freitag", "schon am Mittwoch") wins over a plain day, a
    plain day over one that something is meant for ("für Montag"); among equals
    the first one counts.
    """
    low = _low_but_short_days(text)
    found = [*_relative_days(low, today), *_weekdays(text, low, today), *_days_ahead(low, today), *_numeric_days(low, today), *_month_days(low, today)]
    return sorted(_outermost(found), key=lambda item: (item.rank, item.span[0]))


def find_day(text, today):
    """The day a text names for an entry: Day(day, span, rank, part), or None."""
    return next(iter(days(text, today)), None)


def _later(hour, part):
    """The hour in 24-hour terms once the time of day is known: "um 8 abends" is 20 Uhr."""
    if not part:
        return hour
    if part.startswith(('nachmittag', 'abend')) and 1 <= hour < 12:
        return hour + 12
    if part.startswith('nacht'):
        return 0 if hour == 12 else hour + 12 if 9 <= hour < 12 else hour
    if part.startswith('mittag') and 1 <= hour <= 4:
        return hour + 12
    return hour


def _clock(hour, minute, span):
    return Clock(f'{hour:02d}:{minute:02d}', span) if 0 <= hour < 24 and 0 <= minute < 60 else None


def _counts_a_noun(text, number, position):
    """True when a number after "Uhr" counts what follows it ("8 Uhr 20 Vokabeln") instead of being the minutes ("8 Uhr 15 Mathe")."""
    rest = text[position:]
    if re.match(rf'\s+{_UNIT}\b', rest, re.IGNORECASE):
        return True
    return number % 15 != 0 and bool(re.match(r'\s+[A-ZÄÖÜ]', rest))


def _time_of_day(match, part, whole=True):
    groups = match.groupdict()
    late = (groups.get('late') or groups.get('late2')) if whole else None
    return late or groups.get('early') or groups.get('early2') or part


def _numbers_something(low, start, end, numbered=_NUMBERED_BEFORE):
    """True when the number at `start` belongs to what stands before it ("Aufgabe 3").

    A word in front and a verb for handing in behind are enough ("Protokoll 2
    bis 15 Uhr abgeben"). Behind the day, behind another number or at the very
    start a number has nothing to belong to ("Freitag 8 bis 10 Uhr Aufsatz abgeben").
    """
    word_before = low[:start].rstrip()[-1:].isalpha()
    return bool(numbered.search(low[:start]) or (word_before and _HAND_IN.search(low[end:])))


def _clocks(text, low, part):
    """Every clock time in the text. A stretch of time that is none also yields its span, as a find without a clock, so that its end is not read alone."""
    for match in _SPAN.finditer(low):
        before, lead = low[:match.start()], match.group('lead').strip()
        timed = match.group('u1') or match.group('u2') or ':' in (match.group('sep') or '', match.group('sep2') or '')
        if not timed:
            # "Morgen von 8 bis 10 lernen": without "Uhr" only right beside the day, and not when it counts something.
            beside = before.rstrip().endswith('\x00') or low[match.end():].lstrip().startswith('\x00')
            if lead != 'von' or not beside or re.match(rf'\s*{_UNIT}\b', low[match.end():]):
                continue
        if (match.group('join') == 'und') != (lead == 'zwischen'):
            continue
        first, last = int(match.group('h')), int(match.group('h2'))
        if _NOT_A_SPAN_BEFORE.search(before) or last > 24:
            continue
        if not lead and not match.group('u1') and match.group('sep') != ':':
            # "Protokoll 2 bis 15 Uhr abgeben" has a number and a deadline: the clock behind "bis" is found on its own below.
            if match.group('join').startswith('bis') and _numbers_something(low, match.start(), match.end()):
                continue
            # "Training 8 bis 10 Uhr" is a stretch of time. What is neither stays as it is written.
            if first >= last or _NUMBERED_BEFORE.search(before):
                yield Clock(None, match.span())
                continue
        yield _clock(_later(first, _time_of_day(match, part)), int(match.group('min') or 0), match.span())

    for match in _WITH_UHR.finditer(low):
        minute, end = int(match.group('min') or 0), match.end()
        if match.group('past'):
            if match.group('min') or _counts_a_noun(text, int(match.group('past')), match.end('past')):
                end = match.end('uhr')
            else:
                minute = int(match.group('past'))
        yield _clock(_later(int(match.group('h')), _time_of_day(match, part, end == match.end())), minute, (match.start(), end))

    for match in _COLON.finditer(low):
        hour, end, half = int(match.group('h')), match.end(), match.group('half')
        if half == 'am' and low[match.end('half'):].strip(' .!,;'):
            half, end = None, match.end('min')
        if re.match(rf'\s*{_MEASURE}\b', low[match.end('min'):]):
            continue
        if not match.group('lead') and not match.group('early') and not match.group('early2') and not half:
            # "Maßstab 1:25" and "Johannes 3:16" are no clock; on its own a small hour only counts when written "03:16".
            if _RATIO_BEFORE.search(low[:match.start()]) or (hour < 5 and len(match.group('h')) == 1):
                continue
        if half:
            hour = hour % 12 + (12 if half == 'pm' else 0)
        yield _clock(_later(hour, None if half else _time_of_day(match, part, end == match.end())), int(match.group('min')), (match.start(), end))

    amount = bool(_AMOUNT_VERB.search(low))
    for form in (_DOTTED, _BARE):
        for match in form.finditer(low):
            position = match.end('h') if form is _BARE else match.end('min')
            if amount or re.match(rf'\s*{_MEASURE}\b', low[position:]):
                continue
            # "gegen 3 Gegner spielen" and "um 4 Häuser drehen" name no hour, "um 7 Brötchen holen" and "nachmittags um 4 Zahnarzt" do.
            small = int(match.group('h')) < 6 and not _time_of_day(match, part)
            if ('gegen' in match.group('lead') or small) and re.match(r'\s+[A-ZÄÖÜ]', text[position:]):
                continue
            minute = int(match.group('min')) if form is _DOTTED else 0
            yield _clock(_later(int(match.group('h')), _time_of_day(match, part)), minute, match.span())

    for match in _SPOKEN.finditer(low):
        word, hour = match.group('word'), int(match.group('h'))
        # "Halb 10 Seiten gelesen haben" counts pages. After "um" or with "Uhr" only a real measure speaks against a clock.
        counted = _MEASURE if match.group('lead') or match.group('uhr') else _UNIT
        if not 1 <= hour <= 24 or re.match(rf'\s*{counted}\b', low[match.end('h'):]):
            continue
        if word:
            if not (match.group('lead') or match.group('uhr') or word == 'halb'):
                continue
            hour, minute = {'halb': (hour - 1, 30), 'dreiviertel': (hour - 1, 45), 'viertel': (hour - 1, 15)}.get(
                word, (hour - 1, 45) if word.endswith('vor') else (hour, 15))
        else:
            # "um 5 vor 8" and "Treffen 5 vor 8 Uhr" are a clock. In "Aufgabe 3 vor 8 Uhr abgeben" the 3 belongs to the exercise.
            off, sure = int(match.group('off')), match.group('minutes') or set(match.group('lead').split()) & {'um', 'gegen'}
            if not 0 < off < 30 or not (sure or match.group('uhr')):
                continue
            # The number may also close a stretch of numbers: "Seiten 12 bis 15 nach 16 Uhr lesen".
            if not sure and _numbers_something(low, match.start(), match.end(), _NUMBERED_STRETCH_BEFORE):
                continue
            hour, minute = (hour - 1, 60 - off) if match.group('side') == 'vor' else (hour, off)
        yield _clock(_later(hour or 12, _time_of_day(match, part)), minute, match.span())

    for match in _ENGLISH.finditer(low):
        hour, half = int(match.group('h')), match.group('half')
        if not 1 <= hour <= 12 or (half == 'am' and match.group('lead').strip() != 'at'):
            continue
        if not match.group('lead') and _NOT_PM_BEFORE.search(low[:match.start()]):
            continue
        yield _clock(hour % 12 + (12 if half == 'pm' else 0), 0, match.span())


def _beside(text, span, others):
    """True when a find stands right next to one of the other spans, with nothing but a comma between."""
    return any(not text[other[1]:span[0]].strip(' ,') if other[1] <= span[0] else not text[span[1]:other[0]].strip(' ,')
               for other in others if other[1] <= span[0] or span[1] <= other[0])


def find_clock(text, part=None, other_days=()):
    """The clock time a text names: Clock('HH:MM', span), or None. Of several the first one counts.

    The day of the entry is expected blotted out (see masked). A clock right
    beside another day belongs to that day ("für die Party am Samstag um 15
    Uhr") and is left alone, unless it also stands beside the day of the entry.
    """
    for start, end in other_days:
        text = text[:start] + '\x02' * (end - start) + text[end:]
    low = _low(text)

    def counts(span):
        ours = text[:span[0]].rstrip(' ,').endswith('\x00') or text[span[1]:].lstrip(' ,').startswith('\x00')
        return ours or not _beside(text, span, other_days)

    found = [item for item in _outermost(item for item in _clocks(text, low, part) if item) if item.text and counts(item.span)]
    return min(found, key=lambda item: item.span[0], default=None)


def masked(text, *found):
    """The text with the words of the finds blotted out, so that nothing else is read into them or across them."""
    for item in found:
        if item:
            start, end = item.span
            text = text[:start] + '\x00' * (end - start) + text[end:]
    return text


def sorted_out(found, day=None):
    """The finds that name the day of the entry (the first one, or `day`) and those that name another day."""
    day = day or (found[0].day if found else None)
    return [item for item in found if item.day == day], [item for item in found if item.day != day]


def time_of_day(found):
    return next((item.part for item in found if item.part), None)


def find(text, today):
    """Day, clock time and where the words of both stand: (date or None, 'HH:MM' or None, [spans])."""
    ours, others = sorted_out(days(text, today))
    clock = find_clock(masked(text, *ours), time_of_day(ours), [other.span for other in others])
    spans = sorted(item.span for item in (*ours, clock) if item)
    return (ours[0].day if ours else None), (clock.text if clock else None), spans


def without(text, spans):
    """The text without the words in the spans, tidied up where they stood."""
    if not spans:
        return ' '.join(text.split())
    opens = not text[:min(start for start, _ in spans)].strip()
    for start, end in sorted(spans, reverse=True):
        text = text[:start] + ' ' + text[end:]
    text = re.sub(r'[(\[][\s,;:.–-]*[)\]]', ' ', text)
    text = re.sub(r'\s+([,.;:!?])', r'\1', ' '.join(text.split()))
    text = re.sub(r'^[\s,;:.!?/@–-]+' if opens else r'^[\s,;:/@–-]+', '', text)
    return re.sub(r'(?:\s+[/@–-]|[\s,;:/@])+$', '', text)
