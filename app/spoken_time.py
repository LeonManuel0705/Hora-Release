# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

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
SHORT_WEEKDAYS = ('mo', 'di', 'mi', 'do', 'fr', 'sa')
MONTHS = {'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6,
          'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12}
COUNTS = {'einem': 1, 'einer': 1, 'zwei': 2, 'drei': 3, 'vier': 4}

_NAME = rf'(?:{"|".join(WEEKDAYS)})'
_PART = r'(?:früh|morgens|vormittags?|mittags?|nachmittags?|abends?|nachts?)'
_START = r'(?<![\w.-])'
_END = r'(?![\w-])'
_LEAD = (
    r'(?P<lead>(?:(?:bis|ab|vor|nach|für|spätestens|noch|schon|erst|von|vom|seit|über|am|zum|den|dem'
    r'|übernächsten?|nächsten?|kommenden?|diesen|diesem|letzten?|vergangenen?|jeden|jedem)\s+)*)'
)
_OF_THE_CONTENT = frozenset(('von', 'vom', 'seit', 'über', 'letzte', 'letzten', 'vergangene', 'vergangenen', 'jeden', 'jedem'))
_DEADLINE = frozenset(('bis', 'spätestens', 'vor'))
# Words that number something: what follows them is no day and no clock.
_COUNTED = (
    r'(?:nr\.?|nummer|s\.|seiten?|aufgaben?|kapitel|abschnitt|teil|übung(?:en)?|lektion|arbeitsblatt|blatt|raum|zimmer|saal'
    r'|version|klasse|zeilen?|vers|unit|band|punkt|ziffer|note|schnitt|stufe|level|§)'
)
_NOT_A_DAY_BEFORE = re.compile(rf'(?<![\w.])(?:{_COUNTED}|auf|um)\s*$')
_NOT_A_DAY_AFTER = re.compile(r'\s*(?:uhr|stunden?|std|min|minuten|seiten?|punkte?|euro|€|%|prozent)\b')
_JOINED = re.compile(r'\s*(?:und|oder|sowie|bis|,|-|–)\s*$')
_NOT_TOMORROW_BEFORE = re.compile(r'(?<!\w)(?:am|jeden|jedem|guten|gestern|frühen|nächsten|das|der|den|dem|diesen|diesem|einen|einem)\s+$')
_UNIT = (
    r'(?:tage?n?|wochen?|monate?n?|jahre?n?|stunden?|std|minuten?|min|sekunden?|euro|€|cent|%|prozent|punkte?n?|noten?|stufen?|grad|seiten?'
    r'|zeilen?|wörter|worte|meter|cm|km|kg|gramm|stück|mal|plätze?|klassen?|runden?|sätze?|aufgaben?|vokabeln?|kapitel)'
)
_AMOUNT_VERB = re.compile(r'\b(?:erhöh|senk|verbesser|verschlechter|reduzier|verringer|verlänger|verkürz|steiger|kürz|vergrößer|verkleiner)\w*', re.IGNORECASE)
_RATIO_BEFORE = re.compile(r'(?<![\w.])(?:maßstab|verhältnis|stand|spielstand|ergebnis|quote|vers|kapitel|seite|s\.)\s*$')
_NOT_A_SPAN_BEFORE = re.compile(rf'(?<![\w.])(?:{_COUNTED}|vom|am|den|zum)\s*$')
_NOT_PM_BEFORE = re.compile(rf'(?<![\w.])(?:{_COUNTED}|und|oder|zwischen|bis)\s*$')

_RELATIVE = re.compile(
    rf'{_START}(?P<lead>(?:(?:bis|ab|vor|für|spätestens|noch|schon|erst|von|vom|seit)\s+)*)'
    rf'(?P<word>heute|today|übermorgen|morgen|tomorrow)(?:\s+(?P<part>{_PART}|morgen))?(?:\s+noch)?{_END}'
)
_WEEKDAY = re.compile(
    rf'{_START}{_LEAD}(?:(?P<next>nächste\s+woche)\s+)?(?P<name>{_NAME})(?:\s+(?P<part>{_PART}))?'
    rf'(?:\s+bis\s+(?:(?:zum|einschließlich)\s+)?(?P<last>{_NAME}))?'
    rf'(?:\s+(?:in\s+(?P<weeks>einer|\d|zwei|drei|vier)\s+wochen?|(?P<after>nächste\s+woche)))?{_END}'
)
_AHEAD = re.compile(rf'{_START}(?:(?:heute|bis)\s+)?in\s+(?P<count>\d{{1,3}}|einem|einer|zwei|drei|vier)\s+(?P<unit>tag(?:en)?|wochen?){_END}')
_NAMED_DAY = rf'(?:(?P<name>{_NAME}|{"|".join(SHORT_WEEKDAYS)})\.?,?\s+(?:den\s+)?)?'
_NUMERIC = re.compile(
    rf'(?<![\w.,:]){_LEAD}{_NAMED_DAY}(?:(?P<first>\d{{1,2}})\.\s*(?:-|–|bis)\s*)?'
    r'(?P<d>\d{1,2})\.\s?(?P<m>\d{1,2})(?P<close>\.(?P<y>\d{4}|\d{2})?)?(?![\d:])'
    r'(?P<range>\s*(?:bis(?:\s+zum)?|-|–)\s*(?P<d2>\d{1,2})\.\s?(?P<m2>\d{1,2})\.(?:\d{4}|\d{2})?(?![\d:]))?'
)
_MONTH = re.compile(
    rf'(?<![\w.,:]){_LEAD}{_NAMED_DAY}(?P<d>\d{{1,2}})\.\s*(?P<month>{"|".join(MONTHS)})(?:\s+(?P<y>\d{{4}}))?{_END}'
)

_CLOCK_LEAD = r'(?P<lead>(?:(?:um|bis|gegen|ab|vor|nach|von|at|spätestens|kurz|ca\.?|circa|etwa|so)\s+)*)'
_BEFORE = rf'(?:(?:(?:gegen|am|bis)\s+)?(?P<early>{_PART})\s+)?'
_AFTER = rf'(?:\s+(?P<late>{_PART})(?!\w))?'
_SPAN = re.compile(
    rf'{_START}(?P<lead>(?:(?:von|ab|zwischen|um)\s+)?)(?P<h>\d{{1,2}})(?:(?P<sep>[:.])(?P<min>\d{{2}}))?(?P<u1>\s*uhr)?'
    rf'\s*(?P<join>bis(?:\s+um)?|-|–|und)\s*(?P<h2>\d{{1,2}})(?:(?P<sep2>[:.])\d{{2}})?(?P<u2>\s*uhr)?{_END}{_AFTER}'
)
_WITH_UHR = re.compile(
    rf'{_START}{_BEFORE}{_CLOCK_LEAD}(?P<h>\d{{1,2}})(?:[:.](?P<min>\d{{2}}))?\s*(?P<uhr>uhr)(?:\s+(?P<past>\d{{2}})(?!\d))?{_END}{_AFTER}'
)
_COLON = re.compile(rf'{_START}{_BEFORE}{_CLOCK_LEAD}(?P<h>\d{{1,2}}):(?P<min>\d{{2}})(?!\d|:\d)(?:\s*(?P<half>am|pm)(?!\w))?{_AFTER}')
_DOTTED = re.compile(rf'{_START}{_BEFORE}(?P<lead>(?:(?:um|gegen)\s+)+)(?P<h>\d{{1,2}})\.(?P<min>\d{{2}})(?!\d|\.\d){_AFTER}')
_BARE = re.compile(rf'{_START}{_BEFORE}(?P<lead>(?:(?:um|gegen)\s+)+)(?P<h>\d{{1,2}})(?:\s?h)?(?!\w|:|\.\d|\s*(?:-|–)\s*\d){_AFTER}')
_SPOKEN = re.compile(
    rf'{_START}{_BEFORE}{_CLOCK_LEAD}(?:(?P<word>halb|dreiviertel|viertel\s+vor|viertel\s+nach|viertel)|(?P<off>\d{{1,2}})(?:\s+minuten)?\s+(?P<side>vor|nach))'
    rf'\s+(?P<h>\d{{1,2}})(?P<uhr>\s*uhr)?{_END}{_AFTER}'
)
_ENGLISH = re.compile(rf'{_START}(?P<lead>(?:(?:at|um|bis|ab|gegen)\s+)?)(?P<h>\d{{1,2}})\s*(?P<half>am|pm)(?!\w)')


class Day(NamedTuple):
    day: date
    span: tuple
    rank: int
    part: Optional[str]


class Clock(NamedTuple):
    text: str
    span: tuple


def _low(text):
    """Lower case that keeps every character in its place."""
    return ''.join(char.lower() if len(char.lower()) == 1 else char for char in text)


def _rank(lead):
    words = set(lead.split())
    if words & _OF_THE_CONTENT:
        return None
    return 0 if words & _DEADLINE else 2 if 'für' in words else 1


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


def _relative_days(low, today):
    for match in _RELATIVE.finditer(low):
        word, rank = match.group('word'), _rank(match.group('lead'))
        if rank is None or (word in ('morgen', 'tomorrow') and _NOT_TOMORROW_BEFORE.search(low[:match.start()])):
            continue
        ahead = {'heute': 0, 'today': 0, 'übermorgen': 2}.get(word, 1)
        part = match.group('part')
        yield Day(today + timedelta(days=ahead), match.span(), rank, 'früh' if part == 'morgen' else part)


def _weekdays(low, today):
    for match in _WEEKDAY.finditer(low):
        lead = match.group('lead').split()
        rank = _rank(match.group('lead'))
        if rank is None and not match.group('last'):
            continue
        index = WEEKDAYS.index(match.group('name'))
        weeks = match.group('weeks')
        if weeks or match.group('next') or match.group('after'):
            ahead = COUNTS.get(weeks) or int(weeks or 1)
            day = today - timedelta(days=today.weekday()) + timedelta(weeks=ahead, days=index)
        else:
            day = today + timedelta(days=(index - today.weekday()) % 7 or 7)
            if any(word.startswith('übernächste') for word in lead):
                day += timedelta(days=7)
        yield Day(day, match.span(), 1 if rank is None else rank, match.group('part'))


def _days_ahead(low, today):
    for match in _AHEAD.finditer(low):
        count = COUNTS.get(match.group('count')) or int(match.group('count'))
        days = count * (7 if match.group('unit').startswith('woche') else 1)
        yield Day(today + timedelta(days=days), match.span(), 1, None)


def _numeric_days(low, today):
    position, refused = 0, None
    while True:
        match = _NUMERIC.search(low, position)
        if not match:
            return
        found = _numeric_day(low, today, match, refused)
        if found:
            yield found
            position = match.end()
        else:
            refused = match.end('close') if match.group('close') else match.end('m')
            position = refused


def _numeric_day(low, today, match, refused):
    rank = _rank(match.group('lead'))
    led = bool(match.group('lead') or match.group('name'))
    before, after = low[:match.start()], low[match.end():]
    if not led:
        if not match.group('close') or _NOT_A_DAY_BEFORE.search(before):
            return None
        if refused is not None and _JOINED.fullmatch(low[refused:match.start()] or ' '):
            return None
    if _NOT_A_DAY_AFTER.match(after) or (match.group('lead').startswith('bis') and re.search(r'\d\.\d+\s*$', before)):
        return None
    year = int(match.group('y')) if match.group('y') else None
    first = match.group('first')
    day = _written_day(today, int(first or match.group('d')), int(match.group('m')), year)
    if not day:
        return None
    reaches = match.group('range') or first
    if reaches and year is None:
        start = _dated(today.year, int(match.group('m')), int(first or match.group('d')))
        last = _dated(today.year, int(match.group('m2') or match.group('m')), int(match.group('d2') or match.group('d')))
        if start and last and start < today <= last:
            return None
    if rank is None and not reaches:
        return None
    return Day(day, match.span(), 1 if rank is None else rank, None)


def _month_days(low, today):
    for match in _MONTH.finditer(low):
        rank = _rank(match.group('lead'))
        year = int(match.group('y')) if match.group('y') else None
        day = _written_day(today, int(match.group('d')), MONTHS[match.group('month')], year)
        if rank is not None and day:
            yield Day(day, match.span(), rank, None)


def _outermost(found):
    """Drops what lies inside a longer find, so "Montag, 19.10." is one day and "19:30 bis 22 Uhr" one clock."""
    kept = []
    for item in sorted(found, key=lambda item: (item.span[0] - item.span[1], item.span[0])):
        if not any(item.span[0] < other.span[1] and other.span[0] < item.span[1] for other in kept):
            kept.append(item)
    return kept


def find_day(text, today):
    """The day a text names for an entry: Day(day, span, rank, part), or None.

    A deadline ("bis Freitag") wins over a plain day, a plain day over one that
    something is meant for ("für Montag"); among equals the first one counts.
    """
    low = _low(text)
    found = [*_relative_days(low, today), *_weekdays(low, today), *_days_ahead(low, today), *_numeric_days(low, today), *_month_days(low, today)]
    return min(_outermost(found), key=lambda item: (item.rank, item.span[0]), default=None)


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


def _clocks(text, low, part):
    for match in _SPAN.finditer(low):
        before = low[:match.start()]
        timed = match.group('u1') or match.group('u2') or ':' in (match.group('sep') or '', match.group('sep2') or '')
        if not timed:
            # "Morgen von 8 bis 10 lernen": without "Uhr" only right beside the day, and not when it counts something.
            beside = before.rstrip().endswith('\x00') or low[match.end():].lstrip().startswith('\x00')
            if match.group('lead').strip() != 'von' or not beside or re.match(rf'\s*{_UNIT}\b', low[match.end():]):
                continue
        if (match.group('join') == 'und') != (match.group('lead').strip() == 'zwischen'):
            continue
        if _NOT_A_SPAN_BEFORE.search(before) or int(match.group('h2')) > 24:
            continue
        hour = _later(int(match.group('h')), match.group('late') or part)
        yield _clock(hour, int(match.group('min') or 0), match.span())

    for match in _WITH_UHR.finditer(low):
        minute, end = int(match.group('min') or 0), match.end()
        if match.group('past'):
            if match.group('min') or _counts_a_noun(text, int(match.group('past')), match.end('past')):
                end = match.end('uhr')
            else:
                minute = int(match.group('past'))
        late = match.group('late') if end == match.end() else None
        yield _clock(_later(int(match.group('h')), late or match.group('early') or part), minute, (match.start(), end))

    for match in _COLON.finditer(low):
        hour, end, half = int(match.group('h')), match.end(), match.group('half')
        if half == 'am' and low[match.end('half'):].strip(' .!,;'):
            half, end = None, match.end('min')
        if not match.group('lead') and not match.group('early') and not half:
            # "Maßstab 1:25" and "Johannes 3:16" are no clock; on its own a small hour only counts when written "03:16".
            if _RATIO_BEFORE.search(low[:match.start()]) or (hour < 5 and len(match.group('h')) == 1):
                continue
        if half:
            hour = hour % 12 + (12 if half == 'pm' else 0)
        late = match.group('late') if end == match.end() else None
        yield _clock(_later(hour, None if half else late or match.group('early') or part), int(match.group('min')), (match.start(), end))

    amount = bool(_AMOUNT_VERB.search(low))
    for form in (_DOTTED, _BARE):
        for match in form.finditer(low):
            position = match.end('h') if form is _BARE else match.end('min')
            if amount or re.match(rf'\s*{_UNIT}\b', low[position:]):
                continue
            # "gegen 3 Gegner spielen" names no hour, "um 7 Brötchen holen" does.
            if 'gegen' in match.group('lead') and re.match(r'\s+[A-ZÄÖÜ]', text[position:]):
                continue
            minute = int(match.group('min')) if form is _DOTTED else 0
            yield _clock(_later(int(match.group('h')), match.group('late') or match.group('early') or part), minute, match.span())

    for match in _SPOKEN.finditer(low):
        word, hour = match.group('word'), int(match.group('h'))
        led = bool(match.group('lead') or match.group('uhr'))
        if not 1 <= hour <= 24 or (not led and word != 'halb') or re.match(rf'\s*{_UNIT}\b', low[match.end('h'):]):
            continue
        if word:
            hour, minute = {'halb': (hour - 1, 30), 'dreiviertel': (hour - 1, 45), 'viertel': (hour - 1, 15)}.get(
                word, (hour - 1, 45) if word.endswith('vor') else (hour, 15))
        else:
            off = int(match.group('off'))
            if not 0 < off < 30:
                continue
            hour, minute = (hour - 1, 60 - off) if match.group('side') == 'vor' else (hour, off)
        yield _clock(_later(hour or 12, match.group('late') or match.group('early') or part), minute, match.span())

    for match in _ENGLISH.finditer(low):
        hour, half = int(match.group('h')), match.group('half')
        if not 1 <= hour <= 12 or (half == 'am' and match.group('lead').strip() != 'at'):
            continue
        if not match.group('lead') and _NOT_PM_BEFORE.search(low[:match.start()]):
            continue
        yield _clock(hour % 12 + (12 if half == 'pm' else 0), 0, match.span())


def find_clock(text, part=None):
    """The clock time a text names: Clock('HH:MM', span), or None. Of several the first one counts."""
    low = _low(text)
    found = [item for item in _clocks(text, low, part) if item]
    return min(_outermost(found), key=lambda item: item.span[0], default=None)


def masked(text, found):
    """The text with the words of a find blotted out, so that nothing else is read into them or across them."""
    if not found:
        return text
    start, end = found.span
    return text[:start] + '\x00' * (end - start) + text[end:]


def find(text, today):
    """Day, clock time and where the words of both stand: (date or None, 'HH:MM' or None, [spans])."""
    day = find_day(text, today)
    clock = find_clock(masked(text, day), day.part if day else None)
    spans = sorted(item.span for item in (day, clock) if item)
    return (day.day if day else None), (clock.text if clock else None), spans


def without(text, spans):
    """The text without the words in the spans, tidied up where they stood."""
    if not spans:
        return ' '.join(text.split())
    opens = not text[:min(start for start, _ in spans)].strip()
    for start, end in sorted(spans, reverse=True):
        text = text[:start] + ' ' + text[end:]
    text = re.sub(r'[(\[]\s*[)\]]', ' ', text)
    text = re.sub(r'\s+([,.;:!?])', r'\1', ' '.join(text.split()))
    text = re.sub(r'^[\s,;:.!?/@–-]+' if opens else r'^[\s,;:/@–-]+', '', text)
    return re.sub(r'(?:\s+[/@–-]|[\s,;:/@])+$', '', text)
