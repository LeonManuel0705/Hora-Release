// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import '../brand.dart';
import 'ui_data.dart' show daysBetween, dayOf, isoOf, uiCourseTypes, uiHues, uiNotifyDefaults;

// The phone plans its reminders ahead with the same rules app/static/app/js/reminders.js applies
// minute by minute in the open page, read from the same page data and store, so both agree on
// what to remind of. Keys are the page's keys, which lets the bridge drop the page's copy.

const uiReminderMorning = 7 * 60;
const uiReminderEvening = 18 * 60;
const _noteLimit = 160;

class UiReminder {
  const UiReminder({required this.key, required this.at, required this.title, required this.body, required this.kind, this.silent = false, this.until});

  final String key;
  final DateTime at;
  final String title;
  final String body;
  final String kind;
  final bool silent;
  final DateTime? until;

  String get fingerprint => [at.millisecondsSinceEpoch, title, body, silent, until?.millisecondsSinceEpoch ?? ''].join('\u0001');
}

class UiReminderCategory {
  const UiReminderCategory(this.on, this.lead);

  final bool on;
  final Object? lead;

  int leadOr(int fallback) {
    final value = lead;
    final number = value is num
        ? value
        : value is bool
            ? (value ? 1 : 0)
            : value is String
                ? num.tryParse(value.trim()) ?? 0
                : 0;
    return number.isNaN || number == 0 ? fallback : number.round();
  }
}

class UiReminderPrefs {
  const UiReminderPrefs({required this.enabled, required this.sound, required this.quietFrom, required this.quietTo, required this.categories});

  factory UiReminderPrefs.read(Object? saved) {
    final notify = _map(_map(saved)['notify']);
    final chosen = _map(notify['categories']);
    final quiet = _map(notify['quiet']);
    final defaults = uiNotifyDefaults();
    UiReminderCategory category(Map<String, Object?> base) {
      final own = _map(chosen[base['key']]);
      return UiReminderCategory(own.containsKey('on') ? _truthy(own['on']) : base['on'] != false, own.containsKey('lead') ? own['lead'] : base['lead']);
    }

    return UiReminderPrefs(
      enabled: notify['enabled'] is bool ? notify['enabled'] as bool : defaults['enabled'] == true,
      sound: notify['sound'] != false,
      quietFrom: _minuteOf(quiet['from']) ?? 22 * 60,
      quietTo: _minuteOf(quiet['to']) ?? 7 * 60,
      categories: {for (final base in _list(defaults['categories']).map(_map)) '${base['key']}': category(base)},
    );
  }

  final bool enabled;
  final bool sound;
  final int quietFrom;
  final int quietTo;
  final Map<String, UiReminderCategory> categories;

  UiReminderCategory operator [](String key) => categories[key] ?? const UiReminderCategory(false, null);

  bool quiet(int minute) {
    if (quietFrom == quietTo) return false;
    return quietFrom < quietTo ? minute >= quietFrom && minute < quietTo : minute >= quietFrom || minute < quietTo;
  }

  int? get morning {
    for (var minute = uiReminderMorning; minute < 24 * 60; minute++) {
      if (!quiet(minute)) return minute;
    }
    return null;
  }

  int? get evening => quiet(uiReminderEvening) ? morning : uiReminderEvening;
}

Map<String, Object?> _map(Object? value) => value is Map ? value.cast<String, Object?>() : const {};

List<Object?> _list(Object? value) => value is List ? value : const [];

bool _truthy(Object? value) => switch (value) {
      null => false,
      bool flag => flag,
      num number => number != 0 && !number.isNaN,
      String text => text.isNotEmpty,
      _ => true,
    };

String _text(Object? value) => value == null ? '' : '$value';

final _clock = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');

bool _isClock(Object? value) => value is String && _clock.hasMatch(value);

int? _minuteOf(Object? value) {
  final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(_text(value));
  if (match == null) return null;
  final hour = int.parse(match[1]!), minute = int.parse(match[2]!);
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

String _hm(Object? value) => _text(value).replaceFirst(RegExp(r'^0(?=\d)'), '');

String _clockText(int minute) => '${minute ~/ 60}:${(minute % 60).toString().padLeft(2, '0')}';

String _plainName(Object? text) => _text(text).replaceFirst(RegExp(r'\s+(LK|GK)$'), '');

DateTime _at(DateTime day, int minute) => DateTime(day.year, day.month, day.day, 0, minute);

class _Lesson {
  const _Lesson(this.block, this.subject, this.room, this.start, this.end);

  final int block;
  final String subject;
  final String room;
  final int start;
  final int end;
}

class _School {
  _School(Map<String, Object?> data, Map<String, Object?> store) {
    final base = _map(data['subjects']);
    final ready = data['timetable'] is Map && data['blocks'] is List && data['subjects'] is Map;
    _resolveSubjects(base, _map(data['courses']), _map(store['app-subjects']));
    final blocks = ready ? _resolveBlocks(_list(data['blocks']), store['app-block-times']) : const <(int, int, int)>[];
    for (final (n, start, end) in blocks) {
      _blocks[n] = (start, end);
    }
    if (ready) _resolveTimetable(_map(data['timetable']), store['app-timetable-edits']);
    abWeeks = store['app-ab-weeks'] != false;
    final reference = _text(data['abReference']);
    final parsed = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(reference) ? dayOf(reference) : null;
    abReference = parsed == null || store['app-ab-swap'] != true ? parsed : DateTime(parsed.year, parsed.month, parsed.day + 7);
    for (final item in _list(data['holidays'])) {
      final holiday = _map(item);
      final first = _text(holiday['date']);
      if (first.isEmpty) continue;
      final last = _text(holiday['endDate']);
      _holidays.add((first, last.isEmpty ? first : last));
    }
  }

  final labels = <String, String>{};
  final retired = <String>{};
  final _blocks = <int, (int, int)>{};
  final _timetable = <String, Map<String, List<(int, String, String)>>>{};
  final _holidays = <(String, String)>[];
  late final bool abWeeks;
  late final DateTime? abReference;

  bool active(Object? key) => key is String && labels.containsKey(key) && !retired.contains(key);

  String label(Object? key) {
    final name = key is String ? key : '';
    return labels[name] ?? (name.isEmpty ? 'Ohne Fach' : name);
  }

  void _resolveSubjects(Map<String, Object?> base, Map<String, Object?> courses, Map<String, Object?> saved) {
    final items = _map(saved['items']);
    final removed = {for (final item in _list(saved['removed'])) if (item is String) item};
    String make(String label, String type, Map<String, Object?> own) {
      final kind = uiCourseTypes.contains(own['type']) ? own['type'] as String : type;
      final raw = own['name'] is String ? (own['name'] as String).trim() : '';
      final name = raw.length > 32 ? raw.substring(0, 32) : raw;
      final suffix = kind == 'LK' ? ' LK' : '';
      return name.isNotEmpty || kind != type ? '${name.isNotEmpty ? name : _plainName(label)}$suffix' : label;
    }

    base.forEach((key, value) {
      final info = _map(value);
      final label = _text(info['label'] ?? info['name']);
      final course = _map(courses[key])['type'];
      final type = uiCourseTypes.contains(course) ? course as String : RegExp(r'\sLK$').hasMatch(label) ? 'LK' : 'GK';
      labels[key] = make(label, type, _map(items[key]));
      if (removed.contains(key)) retired.add(key);
    });
    items.forEach((key, value) {
      final own = _map(value);
      if (labels.containsKey(key) || base.containsKey(key) || !_truthy(own['custom'])) return;
      final name = own['name'] is String ? (own['name'] as String).trim() : '';
      if (name.isEmpty || !uiHues.containsKey(own['hue'])) return;
      labels[key] = make(name, 'GK', own);
      if (removed.contains(key)) retired.add(key);
    });
  }

  static bool _ordered(List<(int, Object?, Object?)> blocks) {
    final sorted = [...blocks]..sort((a, b) => a.$1.compareTo(b.$1));
    for (var index = 0; index < sorted.length; index++) {
      final (_, start, end) = sorted[index];
      if (!_isClock(start) || !_isClock(end) || _minuteOf(start)! >= _minuteOf(end)!) return false;
      if (index > 0 && _minuteOf(sorted[index - 1].$3)! > _minuteOf(start)!) return false;
    }
    return true;
  }

  static List<(int, int, int)> _resolveBlocks(List<Object?> base, Object? saved) {
    final defaults = <(int, Object?, Object?)>[
      for (final item in base)
        if (_map(item)['n'] is num) ((_map(item)['n'] as num).toInt(), _map(item)['start'], _map(item)['end']),
    ];
    List<(int, int, int)> usable(List<(int, Object?, Object?)> list) => [
          for (final (n, start, end) in list)
            if (_isClock(start) && _isClock(end)) (n, _minuteOf(start)!, _minuteOf(end)!),
        ];
    if (saved is List) {
      (int, Object?, Object?) merge((int, Object?, Object?) block) {
        final own = saved.map(_map).where((item) => item['n'] is num && item['n'] == block.$1).firstOrNull;
        return own != null && _isClock(own['start']) && _isClock(own['end']) ? (block.$1, own['start'], own['end']) : block;
      }

      final merged = defaults.map(merge).toList();
      return usable(_ordered(merged) ? merged : defaults);
    }
    final own = _map(saved);
    final list = _list(own['blocks']);
    if (own['v'] != 2 || list.isEmpty) return usable(defaults);
    final numbered = [for (final item in list) _map(item)]..sort((a, b) => ((a['n'] as num?) ?? 0).compareTo((b['n'] as num?) ?? 0));
    final blocks = [for (var index = 0; index < numbered.length; index++) (index + 1, numbered[index]['start'], numbered[index]['end'])];
    final complete = [for (var n = 1; n <= list.length; n++) n].every((n) => list.any((item) => _map(item)['n'] is num && (_map(item)['n'] as num) == n));
    return usable(complete && _ordered(blocks) ? blocks : defaults);
  }

  void _resolveTimetable(Map<String, Object?> base, Object? edits) {
    base.forEach((week, days) {
      final table = _timetable[week] = {};
      _map(days).forEach((dow, entries) {
        table[dow] = [
          for (final entry in _list(entries).map(_map))
            if (active(entry['subject']) && entry['block'] is num && _blocks.containsKey((entry['block'] as num).toInt()))
              ((entry['block'] as num).toInt(), entry['subject'] as String, _text(entry['room'])),
        ];
      });
    });
    if (edits is! Map) return;
    final cell = RegExp(r'^([AB]):([1-5]):(\d{1,2})$');
    edits.forEach((key, value) {
      final match = cell.firstMatch('$key');
      if (match == null || !_blocks.containsKey(int.parse(match[3]!))) return;
      if (value != null && !(value is Map && active(value['subject']))) return;
      final block = int.parse(match[3]!);
      final table = _timetable.putIfAbsent(match[1]!, () => {});
      final day = [...?table[match[2]!]]..removeWhere((entry) => entry.$1 == block);
      if (value is Map) {
        final room = _text(value['room']).trim();
        day.add((block, value['subject'] as String, room.length > 12 ? room.substring(0, 12) : room));
      }
      table[match[2]!] = day..sort((a, b) => a.$1.compareTo(b.$1));
    });
  }

  String weekOf(DateTime day) {
    final reference = abReference;
    if (!abWeeks || reference == null) return 'A';
    final monday = DateTime(day.year, day.month, day.day - (day.weekday - 1));
    return (daysBetween(reference, monday) / 7).floor() % 2 == 0 ? 'A' : 'B';
  }

  bool holiday(DateTime day) {
    final iso = isoOf(day);
    return _holidays.any((range) => range.$1.compareTo(iso) <= 0 && range.$2.compareTo(iso) >= 0);
  }

  List<_Lesson> lessons(DateTime day) {
    if (day.weekday > 5 || holiday(day)) return const [];
    return [
      for (final (block, subject, room) in _timetable[weekOf(day)]?['${day.weekday}'] ?? const <(int, String, String)>[])
        _Lesson(block, subject, room, _blocks[block]!.$1, _blocks[block]!.$2),
    ];
  }
}

const _grace = 5;

String _whenText(int days) => days == 0 ? 'heute' : days == 1 ? 'morgen' : 'in $days Tagen';

String _capitalized(String text) => text.isEmpty ? text : '${text[0].toUpperCase()}${text.substring(1)}';

String _noteOf(Map<String, Object?> item) {
  final lines = [
    for (final line in _text(item['detail']).split('\n'))
      line.replaceFirst(RegExp(r'^\s*[-–•*]\s+'), '').trim().replaceFirst(RegExp(r'[,;]$'), ''),
  ].where((line) => line.isNotEmpty).toList();
  if (lines.isEmpty) return '';
  final text = lines.reduce((all, line) => '$all${RegExp(r'[.:!?]$').hasMatch(all) ? ' ' : ', '}$line');
  final word = item['kind'] == 'Test' || item['kind'] == 'Klausur' ? 'Lernstoff' : 'Notiz';
  if (text.length <= _noteLimit) return '\n$word: $text';
  final cut = text.substring(0, _noteLimit - 1).replaceFirst(RegExp(r'[\uD800-\uDBFF]$'), '').trimRight();
  return '\n$word: $cut…';
}

class _Planner {
  _Planner(this.prefs, this.school);

  final UiReminderPrefs prefs;
  final _School school;
  final reminders = <UiReminder>[];

  int? _awake(int target) {
    for (var minute = target; minute < target + _grace; minute++) {
      if (minute >= 0 && minute < 24 * 60 && !prefs.quiet(minute)) return minute;
    }
    return null;
  }

  void _add(String key, DateTime day, int? minute, String title, String body, String kind, {DateTime? until}) {
    if (minute == null) return;
    reminders.add(UiReminder(key: key, at: _at(day, minute), title: title, body: body, kind: kind, silent: !prefs.sound, until: until));
  }

  void lessons(DateTime day) {
    if (!prefs['lessons'].on) return;
    final lead = prefs['lessons'].leadOr(10);
    for (final lesson in school.lessons(day)) {
      final room = lesson.room.isEmpty ? '' : ' in ${lesson.room}';
      _add('lesson:${isoOf(day)}:${lesson.block}', day, _awake(lesson.start - lead), Brand.name, '${school.label(lesson.subject)} um ${_clockText(lesson.start)}$room.', 'lessons',
          until: _at(day, lesson.end));
    }
  }

  void deadlines(DateTime day, List<Map<String, Object?>> items) {
    for (final item in items) {
      final homework = item['kind'] == 'Hausaufgabe';
      final category = prefs[homework ? 'homework' : 'tests'];
      final date = _text(item['date']);
      if (!category.on || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date)) continue;
      final days = daysBetween(day, dayOf(date));
      if (days < 0 || days > category.leadOr(1)) continue;
      if (homework && item['status'] == 'abgegeben') continue;
      final course = _truthy(item['subject']) ? ', ${school.label(item['subject'])}' : '';
      final time = _text(item['time']);
      final body = homework
          ? 'Fällig ${_whenText(days)}$course'
          : '${_capitalized(_whenText(days))}${time.isEmpty ? '' : ' um ${_hm(time)}'}$course${_noteOf(item)}';
      _add('deadline:${item['id']}:${isoOf(day)}', day, days == 0 ? prefs.morning : prefs.evening, '${_text(item['kind'])}: ${_text(item['title'])}', body, homework ? 'homework' : 'tests');
    }
  }

  void events(DateTime day, List<Map<String, Object?>> items) {
    if (!prefs['events'].on) return;
    final fallback = prefs['events'].leadOr(15);
    for (final event in items) {
      final start = _minuteOf(event['start']);
      final date = _text(event['date']);
      if (start == null || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date)) continue;
      final own = event.containsKey('reminderMinutes') && event['reminderMinutes'] != null;
      final minutes = event['reminderMinutes'];
      if (own && (minutes is! num || minutes < 0)) continue;
      final lead = own ? (minutes as num).round() : fallback;
      final begins = _at(dayOf(date), start);
      final at = _at(dayOf(date), start - lead);
      if (!own && start - lead < 0) continue;
      if (isoOf(at) != isoOf(day)) continue;
      final days = daysBetween(day, dayOf(date));
      final place = _text(event['place']).isEmpty ? '' : ' in ${event['place']}';
      final opening = days == 0 ? 'Um' : days == 1 ? 'Morgen um' : 'In $days Tagen um';
      final end = _minuteOf(event['end']);
      _add('event:${event['id']}:$date', day, _awake(at.hour * 60 + at.minute), _text(event['title']), '$opening ${_hm(event['start'])}$place', 'events',
          until: end != null && end > start ? _at(dayOf(date), end) : begins.add(const Duration(hours: 1)));
    }
  }

  void tasks(DateTime day, List<Map<String, Object?>> items) {
    if (!prefs['tasks'].on) return;
    final today = isoOf(day);
    final summary = <String>[];
    for (final task in items) {
      if (_truthy(task['done']) || _truthy(task['someday'])) continue;
      final date = task['date'] is String ? task['date'] as String : '';
      final due = _minuteOf(task['dueTime']);
      if (date == today && due != null) {
        _add('task:${task['id']}:$today', day, _awake(due), _text(task['title']), 'Fällig um ${task['dueTime']}', 'tasks');
      } else if (date.isEmpty || date.compareTo(today) <= 0) {
        summary.add(_text(task['title']));
      }
    }
    if (summary.isEmpty) return;
    _add('tasks:$today', day, prefs.morning, summary.length == 1 ? 'Heute fällig' : '${summary.length} Aufgaben heute fällig', summary.take(3).join(', '), 'tasks');
  }
}

List<UiReminder> uiPlanReminders(Map<String, Object?> data, Map<String, Object?> store, DateTime now, {int days = 8, int limit = 120}) {
  final prefs = UiReminderPrefs.read(store['app-settings']);
  if (!prefs.enabled) return const [];
  final school = _School(data, store);
  final deadlines = [
    for (final item in _list(data['deadlines']).map(_map))
      if (!(item['subject'] is String && school.retired.contains(item['subject']))) item,
  ];
  final events = _list(data['events']).map(_map).toList();
  final tasks = [..._list(data['tasks']), ..._list(data['taskPool'])].map(_map).toList();
  final planner = _Planner(prefs, school);
  final until = now.add(Duration(days: days));
  for (var offset = 0; offset <= days; offset++) {
    final day = DateTime(now.year, now.month, now.day + offset);
    planner
      ..lessons(day)
      ..deadlines(day, deadlines)
      ..events(day, events)
      ..tasks(day, tasks);
  }
  final ahead = planner.reminders.where((item) => item.at.isAfter(now) && !item.at.isAfter(until)).toList()
    ..sort((a, b) {
      final byTime = a.at.compareTo(b.at);
      return byTime != 0 ? byTime : a.key.compareTo(b.key);
    });
  return ahead.length > limit ? ahead.sublist(0, limit) : ahead;
}
