// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../brand.dart';
import '../build_info.dart';
import '../providers/app_provider.dart';
import '../services/holiday_service.dart';
import '../services/site_icons.dart';
import '../services/iserv_service.dart' show IServService;
import 'ui_db.dart';
import 'ui_transit.dart';
import 'ui_weather.dart';

const uiHues = <String, String>{
  'rose': '#C1657E', 'ochre': '#9A6A1E', 'olive': '#6E6D0A', 'moss': '#669649', 'jade': '#0D7C59', 'teal': '#139999',
  'lake': '#0C7491', 'slate': '#5188CD', 'iris': '#635DAB', 'orchid': '#984979', 'brick': '#A34943', 'plum': '#A16FB8',
};
const uiDefaultBlocks = [('08:00', '09:30'), ('09:50', '11:20'), ('11:30', '13:00'), ('13:30', '15:00')];
const uiCourseTypes = {'LK', 'GK', 'SK'};
const uiRepeats = {'daily', 'weekly', 'monthly'};
const uiStates = [
  ('BW', 'Baden-Württemberg'), ('BY', 'Bayern'), ('BE', 'Berlin'), ('BB', 'Brandenburg'), ('HB', 'Bremen'),
  ('HH', 'Hamburg'), ('HE', 'Hessen'), ('MV', 'Mecklenburg-Vorpommern'), ('NI', 'Niedersachsen'),
  ('NW', 'Nordrhein-Westfalen'), ('RP', 'Rheinland-Pfalz'), ('SL', 'Saarland'), ('SN', 'Sachsen'),
  ('ST', 'Sachsen-Anhalt'), ('SH', 'Schleswig-Holstein'), ('TH', 'Thüringen'),
];
const uiDeadlineKinds = {'hw': 'Hausaufgabe', 'test': 'Test', 'exam': 'Klausur', 'talk': 'Vortrag'};
const uiDeadlineTables = {'hw': 'homework', 'test': 'tests', 'exam': 'exams', 'talk': 'talks'};
final uiDeadlinePrefixes = {for (final entry in uiDeadlineKinds.entries) entry.value: entry.key};
// The older screens offer "Referat" as a kind of grade. It is the same thing and is shown as a presentation.
const uiGradeTypes = {'Klausur': 'klausur', 'Test': 'test', 'Mündlich': 'muendlich', 'Vortrag': 'vortrag', 'Referat': 'vortrag'};
const uiGradeWords = {'klausur': 'Klausur', 'test': 'Test', 'muendlich': 'Mündlich', 'vortrag': 'Vortrag', 'sonstiges': 'Sonstige'};
const uiMarks = [6.0, 5.3, 5.0, 4.7, 4.3, 4.0, 3.7, 3.3, 3.0, 2.7, 2.3, 2.0, 1.7, 1.3, 1.0, 0.7];
const iservPrefix = 'iserv.';

Map<String, Object?> uiNotifyDefaults() => {
      'enabled': false,
      'sound': true,
      'quiet': {'from': '22:00', 'to': '07:00'},
      'categories': [
        {'key': 'lessons', 'label': 'Nächste Stunde', 'detail': 'Fach und Raum vor Beginn', 'on': true, 'lead': 10,
          'leads': [[5, '5 Min. vorher'], [10, '10 Min. vorher'], [15, '15 Min. vorher']]},
        {'key': 'tests', 'label': 'Tests, Klausuren und Vorträge', 'detail': 'mit Lernstoff', 'on': true, 'lead': 1,
          'leads': [[1, 'am Vortag'], [2, '2 Tage vorher'], [3, '3 Tage vorher'], [7, '1 Woche vorher']]},
        {'key': 'homework', 'label': 'Hausaufgaben', 'detail': 'vor der Abgabe', 'on': true, 'lead': 1,
          'leads': [[1, 'am Vortag'], [2, '2 Tage vorher']]},
        {'key': 'events', 'label': 'Termine', 'detail': 'aus dem Kalender', 'on': true, 'lead': 15,
          'leads': [[5, '5 Min. vorher'], [15, '15 Min. vorher'], [30, '30 Min. vorher'], [60, '1 Std. vorher']]},
        {'key': 'tasks', 'label': 'Aufgaben', 'detail': 'wenn sie fällig werden', 'on': true},
        {'key': 'pomodoro', 'label': 'Pomodoro', 'detail': 'Ende jeder Arbeits- und Pausenphase', 'on': true},
      ],
    };

String two(int value) => value.toString().padLeft(2, '0');

String isoOf(DateTime day) => '${day.year.toString().padLeft(4, '0')}-${two(day.month)}-${two(day.day)}';

String hm(DateTime time) => '${two(time.hour)}:${two(time.minute)}';

String shortClock(String value) => '${int.parse(value.substring(0, 2))}:${value.substring(3)}';

DateTime dayOf(String iso) => DateTime(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));

int daysBetween(DateTime from, DateTime to) =>
    DateTime.utc(to.year, to.month, to.day).difference(DateTime.utc(from.year, from.month, from.day)).inDays;

DateTime? stamp(Object? value) {
  final text = '${value ?? ''}'.trim();
  if (text.isEmpty) return null;
  final parsed = DateTime.tryParse(text);
  if (parsed == null) return null;
  return parsed.isUtc ? parsed.toLocal() : parsed;
}

String? isoDay(Object? value) {
  final text = '${value ?? ''}'.trim();
  if (text.length < 10) return null;
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text.substring(0, 10));
  if (match == null) return null;
  final year = int.parse(match[1]!), month = int.parse(match[2]!), day = int.parse(match[3]!);
  final date = DateTime(year, month, day);
  if (date.year != year || date.month != month || date.day != day) return null;
  return isoOf(date);
}

String? localDay(Object? value) {
  final text = '${value ?? ''}'.trim();
  if (text.length > 10) {
    final parsed = stamp(text);
    if (parsed != null) return isoOf(parsed);
  }
  return isoDay(text);
}

String? clock(Object? value) {
  final match = RegExp(r'^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$').firstMatch('${value ?? ''}');
  if (match == null) return null;
  final hour = int.parse(match[1]!), minute = int.parse(match[2]!);
  if (hour > 23 || minute > 59) return null;
  return '${two(hour)}:${two(minute)}';
}

const uiEventRepeats = {'daily', 'weekly', 'monthly', 'yearly'};
const uiReminderRange = (-1, 40320);

/// A repeat rule as events keep it, {freq, interval, until, count, exceptions}, or null. Same shape as recurrence.js.
Map<String, Object?>? recurrenceRule(Object? value) {
  if (value is String && value.trim().startsWith('{')) {
    try {
      value = jsonDecode(value);
    } catch (_) {
      return null;
    }
  }
  if (value is! Map || !uiEventRepeats.contains(value['freq'])) return null;
  int? whole(Object? item) => item is num ? item.round() : int.tryParse('${item ?? ''}');
  final interval = math.max(1, math.min(12, whole(value['interval']) ?? 1));
  final counted = whole(value['count']) ?? 0;
  final count = counted >= 1 ? math.min(counted, 1000) : null;
  final exceptions = value['exceptions'] is List ? (value['exceptions'] as List).take(500) : const [];
  return {
    'freq': value['freq'],
    'interval': interval,
    'until': count == null ? isoDay(value['until']) : null,
    'count': count,
    'exceptions': ({for (final day in exceptions) isoDay(day)}..remove(null)).cast<String>().toList()..sort(),
  };
}

DateTime? _nthDay(DateTime first, Map<String, Object?> rule, int index) {
  final step = index * (rule['interval'] as int);
  if (rule['freq'] == 'daily' || rule['freq'] == 'weekly') {
    return DateTime(first.year, first.month, first.day + step * (rule['freq'] == 'weekly' ? 7 : 1));
  }
  final day = DateTime(first.year, first.month + (rule['freq'] == 'monthly' ? step : step * 12), first.day);
  return day.day == first.day ? day : null;
}

/// The last day an event view reaches, every repetition included, or null for a series without end.
String? seriesLastDay(Map<String, Object?> view) {
  final first = dayOf(view['date'] as String);
  final span = view['endDate'] is String ? daysBetween(first, dayOf(view['endDate'] as String)) : 0;
  final rule = recurrenceRule(view['recurrence']);
  if (rule == null) return (view['endDate'] as String?) ?? view['date'] as String;
  DateTime last;
  if (rule['until'] != null) {
    final until = dayOf(rule['until'] as String);
    last = until.isBefore(first) ? first : until;
  } else if (rule['count'] != null) {
    last = first;
    var produced = 0;
    for (var index = 0; produced < (rule['count'] as int) && index < 20000; index++) {
      final day = _nthDay(first, rule, index);
      if (day == null) continue;
      last = day;
      produced++;
    }
  } else {
    return null;
  }
  return isoOf(DateTime(last.year, last.month, last.day + span));
}

/// Minutes before the start, -1 for none, null for the default of the settings. Throws FormatException otherwise.
int? reminderMinutes(Object? value) {
  if (value == null || value == '') return null;
  final minutes = value is num && value == value.roundToDouble() ? value.toInt() : value is String ? int.tryParse(value) : null;
  if (minutes == null || minutes < uiReminderRange.$1 || minutes > uiReminderRange.$2) throw const FormatException('Erinnerung ungültig');
  return minutes;
}

String text(Object? value, [int limit = 1 << 20]) {
  final result = '${value ?? ''}'.trim();
  return result.length > limit ? result.substring(0, limit) : result;
}

String slug(Object? value) {
  var result = '${value ?? ''}'.toLowerCase();
  for (final (from, to) in const [('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')]) {
    result = result.replaceAll(from, to);
  }
  result = result.replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
  return result.isEmpty ? 'fach' : result;
}

String norm(Object? name) => '${name ?? ''}'.trim().toLowerCase().replaceFirst(RegExp(r'\s+(lk|gk|sk)$'), '');

String shortName(String name) {
  final letters = RegExp(r'[A-Za-zÄÖÜäöüß]');
  final buffer = StringBuffer();
  var wordStart = true;
  for (final char in norm(name).split('')) {
    if (letters.hasMatch(char)) {
      buffer.write(wordStart ? char.toUpperCase() : char);
      wordStart = false;
    } else {
      wordStart = true;
    }
  }
  final clean = buffer.isEmpty ? 'Fach' : buffer.toString();
  return clean.length > 3 ? clean.substring(0, 3) : clean;
}

(double, double, double)? _rgb(Object? color) {
  final match = RegExp(r'^(?:#|0x)?(?:[0-9a-fA-F]{2})?([0-9a-fA-F]{6})$').firstMatch('${color ?? ''}'.trim());
  if (match == null) return null;
  final value = match[1]!;
  double part(int start) => int.parse(value.substring(start, start + 2), radix: 16) / 255;
  return (part(0), part(2), part(4));
}

(double, double) _hueSaturation((double, double, double) rgb) {
  final (r, g, b) = rgb;
  final high = math.max(r, math.max(g, b));
  final low = math.min(r, math.min(g, b));
  if (high == low) return (0, 0);
  final spread = high - low;
  final rc = (high - r) / spread, gc = (high - g) / spread, bc = (high - b) / spread;
  final raw = r == high ? bc - gc : g == high ? 2.0 + rc - bc : 4.0 + gc - rc;
  return ((raw / 6.0) % 1.0, spread / high);
}

int _stableHash(String seed) => seed.codeUnits.fold(7, (hash, unit) => (hash * 31 + unit) & 0x3fffffff);

String hueFor(Object? color, String seed) {
  final names = uiHues.keys.toList();
  final rgb = _rgb(color);
  if (rgb == null) return names[_stableHash(seed) % names.length];
  final (hue, saturation) = _hueSaturation(rgb);
  if (saturation < 0.15) return 'slate';
  double distance(String name) {
    final (other, _) = _hueSaturation(_rgb(uiHues[name])!);
    final gap = (hue - other).abs();
    return math.min(gap, 1 - gap);
  }

  return names.reduce((best, name) => distance(name) < distance(best) ? name : best);
}

int pointsOfMark(num mark) {
  var best = 0;
  for (var points = 0; points < uiMarks.length; points++) {
    if ((uiMarks[points] - mark).abs() < (uiMarks[best] - mark).abs()) best = points;
  }
  return best;
}

String semesterFor(DateTime today, int level) {
  final firstHalf = today.month >= 8 || today.month == 1;
  if (level >= 11) {
    if (level == 11) return firstHalf ? 'Q1' : 'Q2';
    return firstHalf ? 'Q3' : 'Q4';
  }
  return '$level/${firstHalf ? 1 : 2}';
}

int schoolYearOf(DateTime day) => day.month >= 8 ? day.year : day.year - 1;

// The pages used to file grades under class 10 while nobody had named a class.
final _guessedTerm = RegExp(r'^10/[12]$');

/// The term a grade belongs to, read without rewriting what is stored. A grade stored without a term, or under the
/// class 10 the pages once assumed, takes its term from its own date and the class known now. While no class is known,
/// such grades of this school year count as the current ones.
String gradeTerm(String stored, DateTime day, int? level, DateTime today) {
  if (stored.isNotEmpty && !_guessedTerm.hasMatch(stored)) return stored;
  final year = schoolYearOf(day);
  if (level == null) {
    if (year == schoolYearOf(today)) return '';
    return stored.isNotEmpty ? stored : '$year/${((year + 1) % 100).toString().padLeft(2, '0')}';
  }
  final then = math.min(13, math.max(5, level - (schoolYearOf(today) - year)));
  // A class setting nobody moved on to the next year must not relabel real class 10 grades.
  if (stored.isNotEmpty && then <= 10) return stored;
  return semesterFor(day, then);
}

String stateCode(String? name) {
  if (name == null) return '';
  if (uiStates.any((state) => state.$1 == name)) return name;
  return HolidayService.bundeslandCodes[name] ?? '';
}

String? stateName(String code) {
  for (final (key, name) in uiStates) {
    if (key == code) return name;
  }
  return null;
}

class School {
  School({
    required this.subjects,
    required this.known,
    required this.courses,
    required this.blocks,
    required this.timetable,
    required this.abReference,
    required this.abWeeks,
    required this.names,
    this.abSwapped = false,
  });

  final Map<String, Map<String, Object?>> subjects;
  final Map<String, Map<String, Object?>> known;
  final Map<String, Map<String, Object?>> courses;
  final List<Map<String, Object?>> blocks;
  final Map<String, Map<String, List<Map<String, Object?>>>> timetable;
  final String abReference;
  final bool abWeeks;
  final Map<String, String> names;
  // The page applies the swap to abReference itself, as on the desktop. Weeks counted here include it.
  final bool abSwapped;

  String weekOf(DateTime day) {
    if (!abWeeks) return 'A';
    final reference = dayOf(abReference);
    return AppProvider.weekTypeFrom(day, abSwapped ? reference.add(const Duration(days: 7)) : reference);
  }

  int? blockFor(String? subjectKey, String? dayIso) {
    if (subjectKey == null || dayIso == null) return null;
    final day = dayOf(dayIso);
    if (day.weekday > 5) return null;
    for (final lesson in timetable[weekOf(day)]!['${day.weekday}']!) {
      if (lesson['subject'] == subjectKey) return lesson['block'] as int;
    }
    return null;
  }

  String? keyForCourse(String? course) {
    final wanted = norm(course);
    if (wanted.isEmpty) return null;
    if (names.containsKey(wanted)) return names[wanted];
    String? found;
    var length = 0;
    names.forEach((name, key) {
      if (name.length > length && name.length >= 3 && (wanted.startsWith(name) || wanted.contains(' $name'))) {
        found = key;
        length = name.length;
      }
    });
    return found;
  }
}

const uiNoTransit = <String, Object?>{'line': '', 'mode': '', 'from': '', 'to': '', 'walkMinutes': 0, 'departures': <Object?>[], 'delays': <String, Object?>{}};

/// The next departures from school home, as the desktop gives them: kept here, fetched beside the page from about the last lesson on.
class UiWayHome {
  UiWayHome._();

  static final instance = UiWayHome._();
  static const fresh = Duration(minutes: 3);
  static const before = Duration(minutes: 90), after = Duration(hours: 2);

  String? _key;
  DateTime? _at;
  Map<String, Object?>? _value;
  Future<void>? _running;

  @visibleForTesting
  Future<void>? get running => _running;

  @visibleForTesting
  void forget() {
    _key = _at = _value = _running = null;
  }

  static DateTime? _moment(Object? value) => stamp(value);

  /// The first ride of the next connections home, of the line and stop the soonest one takes. Cancelled ones are left out.
  static Map<String, Object?>? view(List<Object?> journeys, String target) {
    final rides = <(Map, int)>[];
    for (final journey in journeys.whereType<Map>()) {
      final legs = (journey['legs'] as List? ?? const []).whereType<Map>().toList();
      final index = legs.indexWhere((leg) => leg['category'] != 'fuss' && leg['category'] != 'rad');
      if (index < 0 || journey['cancelled'] == true) continue;
      rides.add((legs[index], legs.take(index).fold<int>(0, (sum, leg) => sum + ((leg['minutes'] as num?)?.toInt() ?? 0))));
    }
    if (rides.isEmpty) return null;
    final (first, walk) = rides.first;
    final departures = <String>[];
    final delays = <String, Object?>{};
    for (final (leg, _) in rides) {
      final from = leg['from'] as Map;
      if (leg['line'] != first['line'] || from['name'] != (first['from'] as Map)['name']) continue;
      final planned = _moment(from['planned'] ?? from['time']), actual = _moment(from['time']);
      if (planned == null) continue;
      final text = '${planned.hour}:${two(planned.minute)}';
      if (departures.contains(text)) continue;
      departures.add(text);
      final late = actual == null ? 0 : (actual.difference(planned).inSeconds / 60).round();
      if (late > 0) delays[text] = late;
    }
    return {'line': first['line'], 'mode': first['category'], 'from': (first['from'] as Map)['name'], 'to': target, 'walkMinutes': walk, 'departures': departures, 'delays': delays};
  }

  Map<String, Object?> shown(String key, Future<(Map<String, Object?>, int)> Function() fetch, String target) {
    final current = _key == key;
    final value = current ? _value : null;
    final stale = !current || _at == null || DateTime.now().difference(_at!) >= fresh;
    if (stale && _running == null) {
      _running = () async {
        Map<String, Object?>? found;
        try {
          final (body, status) = await fetch();
          if (status == 200) found = view(body['journeys'] as List? ?? const [], target);
        } catch (_) {}
        final kept = _key == key ? _value : null;
        _key = key;
        _at = DateTime.now();
        _value = found ?? kept;
      }()
          .whenComplete(() => _running = null);
    }
    return value == null ? Map.of(uiNoTransit) : Map.of(value);
  }
}

class UiData {
  UiData(this.db, this.prefs, this.now, {this.browser = false});

  final Database db;
  final SharedPreferences prefs;
  final DateTime now;
  final bool browser;

  DateTime get today => DateTime(now.year, now.month, now.day);
  String get todayIso => isoOf(today);
  int? get knownClassLevel {
    final saved = prefs.getInt('school_class_level');
    if (saved != null && saved >= 5 && saved <= 13) return saved;
    final year = prefs.getInt('graduation_year');
    return year == null ? null : levelForGraduation(year, today);
  }

  int get classLevel => knownClassLevel ?? 10;

  // The term grades are filed under now, or an empty one while the class is unknown, so no class is guessed.
  String get currentSemester {
    final level = knownClassLevel;
    return level == null ? '' : semesterFor(today, level);
  }

  // The welcome asks for the graduation year. Counted as in Brandenburg, where the Abitur comes after class 12.
  static int levelForGraduation(int year, DateTime today) {
    final started = today.month >= 8 ? today.year : today.year - 1;
    return math.min(13, math.max(5, 12 - (year - (started + 1))));
  }

  Future<School> school() async {
    var subjectRows = await db.query('subjects', orderBy: 'id ASC');
    final lessonRows = await db.query('lessons', orderBy: 'day_of_week ASC, lesson_number ASC');
    final known = {for (final row in subjectRows) norm(row['name'])};
    final missing = <String, Map<String, Object?>>{};
    for (final lesson in lessonRows) {
      final name = text(lesson['subject']);
      final key = norm(name);
      if (name.isEmpty || known.contains(key) || missing.containsKey(key)) continue;
      missing[key] = lesson;
    }
    if (missing.isNotEmpty) {
      final created = DateTime.now().toIso8601String();
      for (final lesson in missing.values) {
        await db.insert('subjects', {
          'name': text(lesson['subject']),
          'teacher': lesson['teacher'],
          'room': lesson['room'],
          'color': lesson['color'],
          'created_at': created,
        });
      }
      subjectRows = await db.query('subjects', orderBy: 'id ASC');
    }

    final subjects = <String, Map<String, Object?>>{};
    final courses = <String, Map<String, Object?>>{};
    final names = <String, String>{};
    for (final row in subjectRows) {
      final key = '${row['id']}';
      final name = text(row['name']);
      if (name.isEmpty || subjects.containsKey(key)) continue;
      final course = uiCourseTypes.contains(row['course_type']) ? row['course_type'] as String : 'GK';
      final label = course == 'LK' && !name.endsWith(' LK') ? '$name LK' : name;
      final short = text(row['short_name']);
      subjects[key] = {
        'name': label,
        'label': label,
        'short': short.isNotEmpty ? (short.length > 4 ? short.substring(0, 4) : short) : shortName(name),
        'hue': hueFor(row['color'], key),
      };
      courses[key] = {'type': course};
      names.putIfAbsent(norm(name), () => key);
    }

    final blocks = <Map<String, Object?>>[];
    for (final row in await db.query('timetable_periods', orderBy: 'period_number ASC')) {
      final start = clock(row['start_time']), end = clock(row['end_time']);
      final number = row['period_number'];
      if (number is int && start != null && end != null && start.compareTo(end) < 0) {
        blocks.add({'n': number, 'start': start, 'end': end});
      }
    }
    if (blocks.isEmpty) {
      final seen = <int>{};
      for (final lesson in lessonRows) {
        final number = lesson['lesson_number'];
        final start = clock(lesson['start_time']), end = clock(lesson['end_time']);
        if (number is int && start != null && end != null && start.compareTo(end) < 0 && seen.add(number)) {
          blocks.add({'n': number, 'start': start, 'end': end});
        }
      }
      blocks.sort((a, b) => (a['n'] as int).compareTo(b['n'] as int));
    }
    if (blocks.isEmpty) {
      for (var index = 0; index < uiDefaultBlocks.length; index++) {
        blocks.add({'n': index + 1, 'start': uiDefaultBlocks[index].$1, 'end': uiDefaultBlocks[index].$2});
      }
    }
    final numbers = {for (final block in blocks) block['n'] as int};

    final abWeeks = prefs.getBool('ab_weeks_enabled') ?? true;
    final timetable = {
      for (final week in const ['A', 'B']) week: {for (var day = 1; day <= 5; day++) '$day': <Map<String, Object?>>[]},
    };
    for (final lesson in lessonRows) {
      final day = lesson['day_of_week'], number = lesson['lesson_number'];
      final key = names[norm(lesson['subject'])];
      if (day is! int || number is! int || key == null || day < 1 || day > 5 || !numbers.contains(number)) continue;
      final week = '${lesson['week_type'] ?? 'both'}';
      final weeks = !abWeeks || week == 'both' ? const ['A', 'B'] : week == 'A' || week == 'B' ? [week] : const <String>[];
      for (final name in weeks) {
        final list = timetable[name]!['$day']!..removeWhere((item) => item['block'] == number);
        list.add({'block': number, 'subject': key, 'room': text(lesson['room'], 12), 'teacher': text(lesson['teacher'])});
        list.sort((a, b) => (a['block'] as int).compareTo(b['block'] as int));
      }
    }

    await AppProvider.settleWeekRule(db, prefs, now);
    final reference = AppProvider.abReferenceOf(prefs);

    final store = await UiDb.store(db);
    final custom = customSubjects(store['app-subjects'], subjects);
    return School(
      subjects: subjects,
      known: {...subjects, ...custom},
      courses: courses,
      blocks: blocks,
      timetable: timetable,
      abReference: isoOf(reference),
      abWeeks: abWeeks,
      names: names,
      abSwapped: store['app-ab-swap'] == true,
    );
  }

  static Map<String, Map<String, Object?>> customSubjects(Object? saved, Map<String, Object?> catalog) {
    final items = saved is Map ? saved['items'] : null;
    if (items is! Map) return {};
    final removed = (saved as Map)['removed'] is List ? saved['removed'] as List : const [];
    final result = <String, Map<String, Object?>>{};
    items.forEach((key, own) {
      if (key is! String || catalog.containsKey(key) || removed.contains(key) || own is! Map || own['custom'] != true) return;
      final raw = own['name'] is String ? (own['name'] as String).trim() : '';
      final name = raw.length > 32 ? raw.substring(0, 32) : raw;
      if (name.isEmpty || !uiHues.containsKey(own['hue'])) return;
      final label = own['type'] == 'LK' ? '$name LK' : name;
      result[key] = {'name': label, 'label': label, 'short': shortName(name), 'hue': own['hue']};
    });
    return result;
  }

  Map<String, Object?>? deadlineView(String prefix, Map<String, Object?> row, School school) {
    final kind = uiDeadlineKinds[prefix]!;
    final when = localDay(prefix == 'hw' ? row['due_date'] : row['date']);
    if (when == null) return null;
    var subjectKey = row['subject_id'] == null ? null : '${row['subject_id']}';
    if (!school.known.containsKey(subjectKey)) subjectKey = null;
    final view = <String, Object?>{
      'id': '$prefix-${row['id']}',
      'kind': kind,
      'title': text(row['title']).isEmpty ? kind : text(row['title']),
      'subject': subjectKey,
      'date': when,
      'detail': text(row['notes']),
      'status': prefix == 'hw' && row['completed'] == 1 ? 'abgegeben' : 'offen',
    };
    final time = prefix == 'hw' ? null : clock(row['time']);
    if (time != null) view['time'] = time;
    final block = school.blockFor(subjectKey, when);
    if (block != null) view['block'] = block;
    return view;
  }

  Map<String, Object?>? iservView(Map<String, Object?> row, School school, Set<String> done) {
    final when = localDay(row['due_date']);
    if (when == null) return null;
    final id = '$iservPrefix${row['id']}';
    final subjectKey = school.keyForCourse(row['course'] as String?);
    final finished = done.contains(id) || '${row['status']}' == 'done' || '${row['status']}' == 'submitted';
    final view = <String, Object?>{
      'id': 'hw-$id',
      'kind': 'Hausaufgabe',
      'title': text(row['title']).isEmpty ? 'Hausaufgabe' : text(row['title']),
      'subject': subjectKey,
      'date': when,
      'detail': text(row['course']),
      'status': finished ? 'abgegeben' : 'offen',
      'origin': 'iserv',
    };
    final block = school.blockFor(subjectKey, when);
    if (block != null) view['block'] = block;
    return view;
  }

  Future<List<Map<String, Object?>>> deadlines(School school) async {
    final back = isoOf(today.subtract(const Duration(days: 14)));
    final writtenBack = isoOf(today.subtract(const Duration(days: 183)));
    final result = <Map<String, Object?>>[];
    void keep(Map<String, Object?>? view, bool homework) {
      if (view == null) return;
      final date = view['date'] as String;
      if (date.compareTo(homework ? back : writtenBack) < 0) return;
      if (homework && view['status'] == 'abgegeben' && date.compareTo(todayIso) < 0) return;
      result.add(view);
    }

    for (final entry in uiDeadlineTables.entries) {
      for (final row in await db.query(entry.value)) {
        keep(deadlineView(entry.key, row, school), entry.key == 'hw');
      }
    }
    final done = await UiDb.idSet(db, UiDb.iservDoneKey);
    final hidden = await UiDb.idSet(db, UiDb.iservHiddenKey);
    for (final row in await db.query('iserv_exercises')) {
      if (hidden.contains('$iservPrefix${row['id']}')) continue;
      keep(iservView(row, school, done), true);
    }
    result.sort((a, b) {
      final byDate = (a['date'] as String).compareTo(b['date'] as String);
      return byDate != 0 ? byDate : ((a['block'] as int?) ?? 0).compareTo((b['block'] as int?) ?? 0);
    });
    return result;
  }

  static Map<String, Object?> taskView(Map<String, Object?> row, Map<String, Object?> subjects) {
    final dueStamp = stamp(row['due_date']);
    final due = dueStamp == null ? null : isoOf(dueStamp);
    final minutes = row['estimated_minutes'];
    final subject = row['subject'];
    final view = <String, Object?>{
      'id': '${row['id']}',
      'title': text(row['title']),
      'subject': subjects.containsKey(subject) ? subject : null,
      'date': due,
      'minutes': minutes is int && minutes > 0 ? minutes : 20,
      'priority': row['priority'] == 'high',
      'done': row['completed'] == 1,
      'notes': text(row['description']),
      'source': row['source'] ?? 'own',
    };
    if (dueStamp != null && (dueStamp.hour != 0 || dueStamp.minute != 0)) {
      final time = '${dueStamp.hour}:${two(dueStamp.minute)}';
      view['dueTime'] = time;
      view['anchor'] = 'bis $time';
    }
    if (row['someday'] == 1 && due == null) view['someday'] = true;
    if (uiRepeats.contains(row['repeat_type'])) view['repeat'] = row['repeat_type'];
    if (row['deadline_ref'] != null && '${row['deadline_ref']}'.isNotEmpty) view['deadline'] = '${row['deadline_ref']}';
    if (view['done'] == true) {
      final finished = stamp(row['completed_at']) ?? stamp(row['updated_at']);
      view['doneDay'] = finished == null ? null : isoOf(finished);
      view['doneAt'] = finished == null ? null : '${finished.hour}:${two(finished.minute)}';
    }
    return view;
  }

  Future<(List<Map<String, Object?>>, List<Map<String, Object?>>)> tasks(Map<String, Object?> subjects) async {
    final recent = isoOf(today.subtract(const Duration(days: 14)));
    final plan = <Map<String, Object?>>[], pool = <Map<String, Object?>>[];
    for (final row in await db.query('tasks', orderBy: 'created_at ASC')) {
      final view = taskView(row, subjects);
      if (view['done'] == true) {
        final doneDay = (view['doneDay'] as String?) ?? '';
        if (doneDay == todayIso) {
          plan.add(view);
        } else if (doneDay.compareTo(recent) >= 0) {
          pool.add(view);
        }
        continue;
      }
      final date = view['date'] as String?;
      if (view['someday'] == true) {
        pool.add(view);
      } else if (date == null || date.compareTo(todayIso) <= 0) {
        plan.add(view);
      } else {
        pool.add(view);
      }
    }
    return (plan, pool);
  }

  static String eventKind(Object? category) => category == 'school' || category == 'iserv'
      ? 'school'
      : category == 'training'
          ? 'training'
          : 'private';

  static Map<String, Object?>? eventView(Map<String, Object?> row) {
    final start = stamp(row['start_time']);
    if (start == null) return null;
    final end = stamp(row['end_time']) ?? start;
    final allDay = row['all_day'] == 1;
    final date = isoOf(start);
    var last = isoOf(end);
    if (allDay && end.isAfter(start) && end.hour == 0 && end.minute == 0 && last.compareTo(date) > 0) {
      last = isoOf(end.subtract(const Duration(days: 1)));
    }
    final id = '${row['id']}';
    final view = <String, Object?>{
      'id': 'loc-$id',
      'date': date,
      'start': allDay ? null : hm(start),
      'end': allDay || !end.isAfter(start) ? null : hm(end),
      'title': text(row['title']).isEmpty ? 'Termin' : text(row['title']),
      'place': text(row['location']),
      'kind': eventKind(row['category']),
      'notes': text(row['description']),
      'synced': false,
    };
    if (last.compareTo(date) > 0) view['endDate'] = last;
    final rule = recurrenceRule(row['recurrence']);
    if (rule != null) view['recurrence'] = rule;
    final minutes = row['reminder_minutes'];
    if (minutes is int && minutes >= uiReminderRange.$1 && minutes <= uiReminderRange.$2) view['reminderMinutes'] = minutes;
    return view;
  }

  Future<List<Map<String, Object?>>> _ownEvents() => db.query(
        'events',
        where: "category NOT IN ('holiday', 'vacation') AND id NOT LIKE 'iserv\\_%' ESCAPE '\\'",
      );

  Future<List<Map<String, Object?>>> events() async {
    final start = isoOf(today.subtract(const Duration(days: 42)));
    final end = isoOf(today.add(const Duration(days: 120)));
    final result = <Map<String, Object?>>[];
    for (final row in await _ownEvents()) {
      final view = eventView(row);
      if (view == null) continue;
      final last = seriesLastDay(view);
      if ((last == null || last.compareTo(start) >= 0) && (view['date'] as String).compareTo(end) <= 0) result.add(view);
    }
    result.sort((a, b) {
      final byDate = (a['date'] as String).compareTo(b['date'] as String);
      return byDate != 0 ? byDate : ((a['start'] as String?) ?? '').compareTo((b['start'] as String?) ?? '');
    });
    return result;
  }

  Future<List<Map<String, Object?>>> holidays() async {
    final start = isoOf(today.subtract(const Duration(days: 400)));
    final end = isoOf(today.add(const Duration(days: 400)));
    final result = <Map<String, Object?>>[];
    final seen = <String>{};
    for (final row in await db.query('events', where: "category IN ('holiday', 'vacation')", orderBy: 'start_time ASC')) {
      final from = stamp(row['start_time']);
      if (from == null) continue;
      final date = isoOf(from);
      final until = stamp(row['end_time']);
      final last = until == null ? date : isoOf(until);
      if (last.compareTo(start) < 0 || date.compareTo(end) > 0) continue;
      final title = text(row['title']).isEmpty ? 'Feiertag' : text(row['title']);
      if (!seen.add('$date|$title')) continue;
      result.add({
        'id': 'h-${row['id']}',
        'title': title,
        'date': date,
        'endDate': last.compareTo(date) > 0 ? last : null,
        'type': row['category'] == 'vacation' ? 'ferien' : 'feiertag',
      });
    }
    return result;
  }

  Future<Map<String, Object?>> iservAccount() async {
    final rows = await db.query('iserv_credentials', limit: 1);
    final row = rows.isEmpty ? null : rows.first;
    final username = text(row?['username']);
    final server = text(row?['iserv_url']).replaceFirst(RegExp(r'^https?://'), '').replaceFirst(RegExp(r'/+$'), '');
    return {
      'connected': username.isNotEmpty,
      'name': username,
      'school': server,
      'features': browser ? <String>[] : ['Vertretungsplan'],
    };
  }

  static String? minuteOf(Object? value) {
    final parsed = stamp(value);
    return parsed == null ? null : '${isoOf(parsed)}T${hm(parsed)}';
  }

  Future<String?> _newest(String table, String column) async {
    try {
      final rows = await db.rawQuery('SELECT MAX($column) AS newest FROM $table');
      return minuteOf(rows.first['newest']);
    } catch (_) {
      return null;
    }
  }

  /// When IServ last gave data on this phone, read from what its copies hold. The phone has no mail and no Google.
  Future<Map<String, Object?>> syncStatus(Map<String, Object?> iserv) async {
    final connected = iserv['connected'] == true && !browser;
    final parts = <String, String?>{'plan': null, 'mail': null, 'homework': null};
    final stamps = <String>[];
    if (connected) {
      parts['plan'] = await _newest('vertretungsplan_cache', 'fetched_at');
      final homework = [await _newest('iserv_exercises', 'cached_at'), minuteOf(prefs.getString(IServService.homeworkSyncedKey))].nonNulls.toList()..sort();
      parts['homework'] = homework.isEmpty ? null : homework.last;
      stamps.addAll([
        ...parts.values.nonNulls,
        ...[await _newest('iserv_events', 'cached_at'), await _newest('iserv_notifications', 'cached_at')].nonNulls,
      ]);
    }
    stamps.sort();
    return {
      'iserv': connected,
      'iservAvailable': !browser,
      'rendered': '${isoOf(now)}T${hm(now)}',
      'synced': {'iserv': stamps.isEmpty ? null : stamps.last, 'google': null},
      'iservParts': parts,
    };
  }

  Future<List<Map<String, Object?>>> iservHomework() async =>
      [for (final view in await deadlines(await school())) if (view['origin'] == 'iserv') view];

  Future<Map<String, Object?>> build(String active, Map<String, Object?> store) async {
    final setup = await school();
    final (plan, pool) = await tasks(setup.known);
    final iserv = await iservAccount();
    final holidayList = await holidays();
    final data = <String, Object?>{
      'user': {'state': stateCode(prefs.getString('user_bundesland')), 'grade': knownClassLevel, 'iserv': browser ? '' : 'android'},
      'blocks': setup.blocks,
      'subjects': setup.subjects,
      'courses': setup.courses,
      'timetable': setup.timetable,
      'abReference': setup.abReference,
      'changes': <Object?>[],
      'tasks': plan,
      'taskPool': pool,
      'deadlines': await deadlines(setup),
      'events': await events(),
      'holidays': holidayList,
      'transit': await wayHome(setup, store, holidayList),
      'weather': UiWeather.instance.view(prefs, now),
      'status': await syncStatus(iserv),
      'mailUnread': 0,
    };
    (data['status'] as Map<String, Object?>)['googleConfigured'] = false;
    if (!setup.abWeeks) store.putIfAbsent('app-ab-weeks', () => false);
    final page = switch (active) {
      'tasks' => {'notes': await notes()},
      'calendar' => pageCalendar(holidayList),
      'school' => await pageSchool(setup),
      'vbb' => await pageTransit(),
      'email' => pageEmail(),
      'bookmarks' => await pageBookmarks(),
      'settings' => await pageSettings(setup, iserv),
      _ => null,
    };
    if (page != null) data['page'] = page;
    return data;
  }

  Map<String, Object?> pageCalendar(List<Map<String, Object?>> holidayList) {
    final code = stateCode(prefs.getString('user_bundesland'));
    return {'region': stateName(code) ?? '', 'events': <Object?>[], 'holidays': holidayList, 'notes': <String, Object?>{}};
  }

  static String gradeType(Object? stored) => uiGradeTypes[stored] ?? 'sonstiges';

  Map<String, Object?>? gradeView(Map<String, Object?> row, School setup) {
    final subjectKey = '${row['subject_id']}';
    if (!setup.known.containsKey(subjectKey)) return null;
    final value = row['value'];
    final points = row['grade_system'] == 'marks' && value is num ? pointsOfMark(value) : row['points'];
    if (points is! num) return null;
    return {
      'id': 'g-${row['id']}',
      'subject': subjectKey,
      'points': points.round(),
      'type': gradeType(row['type']),
      'semester': gradeTerm(text(row['semester']), DateTime.tryParse(localDay(row['date']) ?? '') ?? today, knownClassLevel, today),
      'date': localDay(row['date']) ?? todayIso,
      'title': text(row['notes']),
    };
  }

  Future<Map<String, Object?>> pageSchool(School setup) async {
    final semester = currentSemester;
    final grades = <Map<String, Object?>>[];
    final history = <String, Map<String, List<int>>>{};
    for (final row in await db.query('grades', orderBy: 'date ASC')) {
      final entry = gradeView(row, setup);
      if (entry == null) continue;
      if (entry['semester'] == semester) {
        grades.add(entry);
      } else {
        history.putIfAbsent(entry['subject'] as String, () => {}).putIfAbsent(entry['semester'] as String, () => []).add(entry['points'] as int);
      }
    }
    final averages = {
      for (final subject in history.entries)
        subject.key: {
          for (final term in subject.value.entries) term.key: (term.value.reduce((a, b) => a + b) / term.value.length).round(),
        },
    };
    return {
      'courses': setup.courses,
      'history': averages,
      'grades': grades,
      'exams': <Object?>[],
      'changes': <Object?>[],
      'seminar': null,
      'semester': semester,
    };
  }

  static Map<String, Object?>? placeView(String name, Map<String, Object?>? row) {
    if (row == null) return null;
    final lat = row['latitude'], lon = row['longitude'];
    if (lat is! num || lon is! num || (lat == 0 && lon == 0)) return null;
    final stop = text(row['vbb_id']);
    final usable = stop.startsWith('de-') ? stop : null;
    return {
      'id': usable ?? '$lat,$lon',
      'name': name,
      'detail': text(row['name']),
      'stop': usable,
      'lat': lat,
      'lon': lon,
    };
  }

  /// The block times as the settings changed them, read like the desktop reads them.
  static List<Map<String, Object?>> blockTimes(List<Map<String, Object?>> base, Object? saved) {
    final pattern = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');
    bool isClock(Object? value) => value is String && pattern.hasMatch(value);
    bool valid(List<Map<String, Object?>> blocks) {
      final ordered = [...blocks]..sort((a, b) => (a['n'] as int).compareTo(b['n'] as int));
      for (var index = 0; index < ordered.length; index++) {
        final block = ordered[index];
        if (!isClock(block['start']) || !isClock(block['end']) || '${block['start']}'.compareTo('${block['end']}') >= 0) return false;
        if (index > 0 && '${ordered[index - 1]['end']}'.compareTo('${block['start']}') > 0) return false;
      }
      return true;
    }

    if (saved is List) {
      final merged = <Map<String, Object?>>[];
      for (final block in base) {
        final own = saved.whereType<Map>().where((item) => item['n'] == block['n']).firstOrNull;
        merged.add(own != null && isClock(own['start']) && isClock(own['end']) ? {...block, 'start': own['start'], 'end': own['end']} : {...block});
      }
      return valid(merged) ? merged : base;
    }
    final blocks = saved is Map && saved['v'] == 2 && saved['blocks'] is List ? (saved['blocks'] as List).whereType<Map>().toList() : null;
    if (blocks == null || blocks.isEmpty || blocks.length > 8 || blocks.any((item) => item['n'] is! int)) return base;
    final ordered = [...blocks]..sort((a, b) => (a['n'] as int).compareTo(b['n'] as int));
    final result = [for (var index = 0; index < ordered.length; index++) <String, Object?>{'n': index + 1, 'start': ordered[index]['start'], 'end': ordered[index]['end']}];
    final numbers = {for (final item in blocks) item['n']};
    final complete = [for (var number = 1; number <= result.length; number++) numbers.contains(number)].every((found) => found);
    return complete && valid(result) ? result : base;
  }

  /// When the last lesson of today ends in the plan as the pages show it, with the changes from the settings.
  DateTime? schoolEnd(School setup, Map<String, Object?> store, List<Map<String, Object?>> holidayList) {
    if (today.weekday > 5) return null;
    if (holidayList.any((item) => '${item['date']}'.compareTo(todayIso) <= 0 && '${item['endDate'] ?? item['date']}'.compareTo(todayIso) >= 0)) return null;
    final week = setup.weekOf(today);
    final day = '${today.weekday}';
    final taken = {for (final lesson in setup.timetable[week]![day]!) lesson['block'] as int};
    final edits = store['app-timetable-edits'];
    if (edits is Map) {
      for (final entry in edits.entries) {
        final match = RegExp(r'^([AB]):([1-5]):(\d{1,2})$').firstMatch('${entry.key}');
        if (match == null || match[1] != week || match[2] != day) continue;
        final value = entry.value;
        if (value is Map && value['subject'] != null) {
          taken.add(int.parse(match[3]!));
        } else if (value == null) {
          taken.remove(int.parse(match[3]!));
        }
      }
    }
    final ends = [for (final block in blockTimes(setup.blocks, store['app-block-times'])) if (taken.contains(block['n'])) '${block['end']}']..sort();
    if (ends.isEmpty) return null;
    return DateTime(today.year, today.month, today.day, int.parse(ends.last.substring(0, 2)), int.parse(ends.last.substring(3, 5)));
  }

  Future<Map<String, Object?>> wayHome(School setup, Map<String, Object?> store, List<Map<String, Object?>> holidayList) async {
    final known = await knownPlaces();
    final origin = placeView('Schule', known['school']), target = placeView('Zuhause', known['home']);
    if (origin == null || target == null) return Map.of(uiNoTransit);
    final end = schoolEnd(setup, store, holidayList);
    if (end == null || now.isBefore(end.subtract(UiWayHome.before)) || now.isAfter(end.add(UiWayHome.after))) return Map.of(uiNoTransit);
    final leave = now.isAfter(end) ? now : end;
    final name = text(target['detail']).isEmpty ? 'Zuhause' : text(target['detail']);
    return UiWayHome.instance.shown(
      '${origin['id']}|${target['id']}|${end.toIso8601String()}',
      () => UiTransit.instance.handle('verbindungen', {'von': '${origin['id']}', 'nach': '${target['id']}', 'zeit': leave.toUtc().toIso8601String(), 'ankunft': '0'}),
      name,
    );
  }

  Future<Map<String, Map<String, Object?>>> knownPlaces() async {
    final rows = await db.query('vbb_known_locations', where: "key IN ('home', 'school')");
    return {for (final row in rows) row['key'] as String: row};
  }

  Future<Map<String, Object?>> pageTransit() async {
    final known = await knownPlaces();
    final places = <String, Object?>{};
    final home = placeView('Zuhause', known['home']);
    final schoolPlace = placeView('Schule', known['school']);
    if (home != null) places['home'] = home;
    if (schoolPlace != null) places['school'] = schoolPlace;
    return {'places': places, 'attribution': 'Transitous, DELFI e.V. und Verkehrsverbünde'};
  }

  static Map<String, Object?>? placeRecord(Map<String, Object?>? row) {
    if (row == null || text(row['name']).isEmpty) return null;
    final lat = row['latitude'], lon = row['longitude'];
    if (lat is! num || lon is! num) return null;
    return {'name': text(row['name'], 200), 'area': '', 'lat': lat, 'lon': lon, 'stop': row['type'] == 'stop' ? text(row['vbb_id'], 120) : ''};
  }

  static Map<String, Object?>? noteView(Map<String, Object?> row) {
    var title = text(row['title']);
    var details = text(row['content']);
    if (title.isEmpty) {
      final split = details.indexOf('\n');
      final first = (split < 0 ? details : details.substring(0, split)).trim();
      final rest = split < 0 ? '' : details.substring(split + 1);
      title = first.length > 300 ? first.substring(0, 300) : first;
      details = '${first.length > 300 ? first.substring(300) : ''}\n$rest'.trim();
    }
    if (title.isEmpty) return null;
    final created = text(row['created_at']);
    return {
      'id': '${row['id']}',
      'type': row['type'] == 'idea' ? 'idea' : 'note',
      'title': title,
      'details': details,
      'created': created.length > 19 ? created.substring(0, 19) : created,
    };
  }

  Future<List<Map<String, Object?>>> notes() async =>
      [for (final row in await db.query('quick_notes', orderBy: 'created_at DESC')) noteView(row)].nonNulls.toList();

  Future<Map<String, Object?>> exportRecords() async {
    final setup = await school();
    final dated = <Map<String, Object?>>[];
    for (final entry in uiDeadlineTables.entries) {
      for (final row in await db.query(entry.value)) {
        final view = deadlineView(entry.key, row, setup);
        if (view != null) dated.add(view);
      }
    }
    final known = await knownPlaces();
    final places = <String, Object?>{};
    for (final key in const ['home', 'school']) {
      final place = placeRecord(known[key]);
      if (place != null) places[key] = place;
    }
    return {
      'tasks': [for (final row in await db.query('tasks', orderBy: 'created_at ASC')) taskView(row, setup.known)],
      'deadlines': dated,
      'grades': [for (final row in await db.query('grades', orderBy: 'date ASC')) gradeView(row, setup)].nonNulls.toList(),
      'notes': await notes(),
      'events': [for (final row in await _ownEvents()) eventView(row)].nonNulls.toList(),
      'places': places,
    };
  }

  Map<String, Object?> pageEmail() => {'messages': <Object?>[], 'contacts': <Object?>[], 'native': true};

  static Map<String, Object?> bookmarkView(Map<String, Object?> row) =>
      {'id': text(row['id']), 'title': text(row['title']), 'url': text(row['url']), 'category': text(row['category']).isEmpty ? 'Other' : text(row['category'])};

  Future<Map<String, Object?>> pageBookmarks() async => {
        'bookmarks': [
          for (final row in await db.query('bookmarks', orderBy: 'created_at DESC')) {...bookmarkView(row), 'icon': await knownSiteIcon(text(row['url']))},
        ],
      };

  Future<Map<String, Object?>> pageSettings(School setup, Map<String, Object?> iserv) async {
    final known = await knownPlaces();
    final city = prefs.getString('weather_city') ?? '';
    return {
      'school': {
        'name': iserv['school'],
        'town': city,
        'state': stateCode(prefs.getString('user_bundesland')),
        'grade': knownClassLevel,
        'semester': currentSemester,
        'birthday': isoDay(prefs.getString('user_birthday')) ?? '',
      },
      'states': [for (final (code, name) in uiStates) {'code': code, 'name': name}],
      'courses': setup.courses,
      'accounts': {
        'iserv': browser ? {...iserv, 'unavailable': true} : iserv,
        'google': {'connected': false, 'calendars': <Object?>[], 'unavailable': true},
      },
      'notifications': uiNotifyDefaults(),
      'places': {
        'weather': city,
        'home': text(known['home']?['name']),
        'school': text(known['school']?['name']),
      },
      'about': {'version': BuildInfo.version, 'license': 'PolyForm Noncommercial 1.0.0', 'website': Brand.website, 'source': Brand.repository},
      'native': !browser,
    };
  }
}
