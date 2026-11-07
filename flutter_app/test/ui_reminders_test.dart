// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/brand.dart';
import 'package:app/web_ui/ui_reminders.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _lesson(int block, String subject, [String room = '']) => {'block': block, 'subject': subject, 'room': room, 'teacher': ''};

Map<String, Object?> _week(Map<int, List<Map<String, Object?>>> days) => {for (var day = 1; day <= 5; day++) '$day': days[day] ?? const []};

Map<String, Object?> _data({
  Map<String, Object?>? timetable,
  List<Object?> deadlines = const [],
  List<Object?> events = const [],
  List<Object?> tasks = const [],
  List<Object?> taskPool = const [],
  List<Object?> holidays = const [],
  String abReference = '2026-11-02',
}) =>
    {
      'blocks': [
        {'n': 1, 'start': '08:00', 'end': '09:30'},
        {'n': 2, 'start': '09:50', 'end': '11:20'},
        {'n': 3, 'start': '11:30', 'end': '13:00'},
      ],
      'subjects': {
        '1': {'name': 'Mathe', 'label': 'Mathe', 'short': 'Mat', 'hue': 'lake'},
        '2': {'name': 'Deutsch LK', 'label': 'Deutsch LK', 'short': 'Deu', 'hue': 'rose'},
        '3': {'name': 'Physik', 'label': 'Physik', 'short': 'Phy', 'hue': 'jade'},
      },
      'courses': {'1': {'type': 'GK'}, '2': {'type': 'LK'}, '3': {'type': 'GK'}},
      'timetable': timetable ??
          {
            'A': _week({1: [_lesson(1, '1', 'R101'), _lesson(2, '2', 'R204')], 3: [_lesson(3, '3')]}),
            'B': _week({1: [_lesson(2, '3', 'R110')], 4: [_lesson(1, '1', 'R101')]}),
          },
      'abReference': abReference,
      'changes': const [],
      'tasks': tasks,
      'taskPool': taskPool,
      'deadlines': deadlines,
      'events': events,
      'holidays': holidays,
    };

Map<String, Object?> _store({Map<String, Object?> notify = const {}, Map<String, Object?> extra = const {}}) => {
      'app-settings': {
        'notify': {'enabled': true, ...notify},
      },
      ...extra,
    };

List<UiReminder> _plan(Map<String, Object?> data, Map<String, Object?> store, DateTime now, {int days = 8, int limit = 120}) =>
    uiPlanReminders(data, store, now, days: days, limit: limit);

Map<String, UiReminder> _byKey(List<UiReminder> plan) => {for (final item in plan) item.key: item};

String _clock(DateTime at) => '${at.year}-${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')} '
    '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';

void main() {
  final sunday = DateTime(2026, 11, 8, 12);

  test('nothing is planned while reminders are off', () {
    expect(_plan(_data(), {'app-settings': {'notify': {'enabled': false}}}, sunday), isEmpty);
    expect(_plan(_data(), const {}, sunday), isEmpty);
  });

  test('a lesson is announced its lead minutes before, in the words of the page', () {
    final plan = _byKey(_plan(_data(), _store(), sunday, days: 1));
    final first = plan['lesson:2026-11-09:2']!;
    expect(_clock(first.at), '2026-11-09 09:40');
    expect(first.title, Brand.name);
    expect(first.body, 'Physik um 9:50 in R110.');
    expect(first.until, DateTime(2026, 11, 9, 11, 20));
    expect(first.kind, 'lessons');
    final later = _byKey(_plan(_data(), _store(notify: {
      'categories': {'lessons': {'on': true, 'lead': 15}},
    }), sunday, days: 1));
    expect(_clock(later['lesson:2026-11-09:2']!.at), '2026-11-09 09:35');
  });

  test('a lead of null or nonsense falls back to the default, as the page does', () {
    for (final lead in [null, 0, 'abc', '']) {
      final plan = _byKey(_plan(_data(), _store(notify: {
        'categories': {'lessons': {'on': true, 'lead': lead}},
      }), sunday, days: 1));
      expect(_clock(plan['lesson:2026-11-09:2']!.at), '2026-11-09 09:40', reason: '$lead');
    }
    final text = _byKey(_plan(_data(), _store(notify: {
      'categories': {'lessons': {'on': true, 'lead': '5'}},
    }), sunday, days: 1));
    expect(_clock(text['lesson:2026-11-09:2']!.at), '2026-11-09 09:45');
  });

  test('A and B weeks follow the reference Monday, and a plan without them is always A', () {
    final weeks = _plan(_data(), _store(), sunday, days: 14).where((item) => item.kind == 'lessons').map((item) => item.key).toList();
    expect(weeks, [
      'lesson:2026-11-09:2',
      'lesson:2026-11-12:1',
      'lesson:2026-11-16:1',
      'lesson:2026-11-16:2',
      'lesson:2026-11-18:3',
    ]);
    final single = _plan(_data(), _store(extra: {'app-ab-weeks': false}), sunday, days: 7).where((item) => item.kind == 'lessons').map((item) => item.key);
    expect(single, ['lesson:2026-11-09:1', 'lesson:2026-11-09:2', 'lesson:2026-11-11:3']);
    final swapped = _plan(_data(), _store(extra: {'app-ab-swap': true}), sunday, days: 7).where((item) => item.kind == 'lessons').map((item) => item.key);
    expect(swapped, ['lesson:2026-11-09:1', 'lesson:2026-11-09:2', 'lesson:2026-11-11:3']);
  });

  test('weeks before the reference and across the new year keep alternating', () {
    final data = _data(abReference: '2026-12-28');
    final before = _plan(data, _store(), DateTime(2026, 12, 20, 12), days: 2).where((item) => item.kind == 'lessons');
    expect(before.map((item) => item.key), ['lesson:2026-12-21:2'], reason: 'one week before the reference is B');
    final after = _plan(data, _store(), DateTime(2027, 1, 3, 12), days: 2).where((item) => item.kind == 'lessons');
    expect(after.map((item) => item.key), ['lesson:2027-01-04:2'], reason: 'the week after is B again');
  });

  test('no lessons on a holiday, nor on a weekend', () {
    final data = _data(holidays: [
      {'id': 'h-1', 'title': 'Feiertag', 'date': '2026-11-09', 'endDate': null, 'type': 'feiertag'},
      {'id': 'h-2', 'title': 'Herbstferien', 'date': '2026-11-11', 'endDate': '2026-11-13', 'type': 'ferien'},
    ]);
    final keys = _plan(data, _store(), sunday, days: 6).where((item) => item.kind == 'lessons').map((item) => item.key);
    expect(keys, isEmpty);
  });

  test('quiet hours drop a lesson reminder unless its five minutes reach past them', () {
    final data = _data(timetable: {
      'A': _week({1: [_lesson(1, '1')]}),
      'B': _week({1: [_lesson(1, '1')]}),
    });
    data['blocks'] = [
      {'n': 1, 'start': '07:05', 'end': '08:30'},
    ];
    expect(_plan(data, _store(), sunday, days: 1).where((item) => item.kind == 'lessons'), isEmpty);
    data['blocks'] = [
      {'n': 1, 'start': '07:08', 'end': '08:30'},
    ];
    final late = _plan(data, _store(), sunday, days: 1).where((item) => item.kind == 'lessons').single;
    expect(_clock(late.at), '2026-11-09 07:00');
    final open = _plan(data, _store(notify: {'quiet': {'from': '23:00', 'to': '06:00'}}), sunday, days: 1).single;
    expect(_clock(open.at), '2026-11-09 06:58');
  });

  test('a test is announced the day before and on the day, at the first minute after the quiet hours, homework the same', () {
    final data = _data(deadlines: [
      {'id': 'test-1', 'kind': 'Test', 'title': 'Analysis', 'subject': '1', 'date': '2026-11-11', 'time': '08:00', 'detail': '- Ableitungen\n- Kurvendiskussion;', 'status': 'offen'},
      {'id': 'hw-1', 'kind': 'Hausaufgabe', 'title': 'Gedichtanalyse', 'subject': '2', 'date': '2026-11-10', 'detail': '', 'status': 'offen'},
      {'id': 'hw-2', 'kind': 'Hausaufgabe', 'title': 'Schon erledigt', 'subject': '2', 'date': '2026-11-10', 'detail': '', 'status': 'abgegeben'},
    ]);
    final plan = _plan(data, _store(), sunday, days: 4).where((item) => item.key.startsWith('deadline:')).toList();
    expect([for (final item in plan) '${_clock(item.at)} ${item.key}'], [
      '2026-11-09 07:00 deadline:hw-1:2026-11-09',
      '2026-11-10 07:00 deadline:hw-1:2026-11-10',
      '2026-11-10 07:00 deadline:test-1:2026-11-10',
      '2026-11-11 07:00 deadline:test-1:2026-11-11',
    ]);
    expect(plan[0].title, 'Hausaufgabe: Gedichtanalyse');
    expect(plan[0].body, 'Fällig morgen, Deutsch LK');
    expect(plan[1].body, 'Fällig heute, Deutsch LK');
    expect(plan[2].title, 'Test: Analysis');
    expect(plan[2].body, 'Morgen um 8:00, Mathe\nLernstoff: Ableitungen, Kurvendiskussion');
    expect(plan[3].body, 'Heute um 8:00, Mathe\nLernstoff: Ableitungen, Kurvendiskussion');
  });

  test('a longer lead reminds every day up to the date, and the time follows the quiet hours like the page', () {
    final data = _data(deadlines: [
      {'id': 'exam-1', 'kind': 'Klausur', 'title': 'Klausur', 'subject': null, 'date': '2026-11-12', 'detail': '', 'status': 'offen'},
    ]);
    final store = _store(notify: {
      'categories': {'tests': {'on': true, 'lead': 3}},
    });
    final plan = _plan(data, store, sunday, days: 5).where((item) => item.kind == 'tests').toList();
    expect([for (final item in plan) '${_clock(item.at)} ${item.body}'], [
      '2026-11-09 07:00 In 3 Tagen',
      '2026-11-10 07:00 In 2 Tagen',
      '2026-11-11 07:00 Morgen',
      '2026-11-12 07:00 Heute',
    ]);
    List<String> times(Map<String, Object?> quiet) => [
          for (final item in _plan(data, _store(notify: {'quiet': quiet}), sunday, days: 5).where((item) => item.kind == 'tests')) _clock(item.at),
        ];
    expect(times({'from': '17:00', 'to': '07:30'}), ['2026-11-11 07:30', '2026-11-12 07:30']);
    expect(times({'from': '23:00', 'to': '06:00'}), ['2026-11-11 06:00', '2026-11-12 06:00']);
    expect(times({'from': '13:00', 'to': '14:00'}), ['2026-11-11 00:00', '2026-11-12 00:00']);
    expect(times({'from': '08:00', 'to': '08:00'}), ['2026-11-11 00:00', '2026-11-12 00:00'], reason: 'equal times mean no quiet hours');
  });

  test('an event uses its own minutes when it has them, the category lead otherwise', () {
    final data = _data(events: [
      {'id': 'loc-a', 'date': '2026-11-09', 'start': '15:00', 'end': '16:30', 'title': 'Zahnarzt', 'place': 'Praxis Weber', 'kind': 'private'},
      {'id': 'loc-b', 'date': '2026-11-09', 'start': '17:00', 'end': null, 'title': 'Training', 'place': '', 'kind': 'training', 'reminderMinutes': 60},
      {'id': 'loc-c', 'date': '2026-11-09', 'start': '18:00', 'title': 'Ohne Erinnerung', 'reminderMinutes': -1},
      {'id': 'loc-d', 'date': '2026-11-10', 'start': '19:00', 'title': 'Konzert', 'place': 'Aula', 'reminderMinutes': 1440},
      {'id': 'loc-e', 'date': '2026-11-09', 'start': '20:00', 'title': 'Zum Beginn', 'reminderMinutes': 0},
      {'id': 'loc-f', 'date': '2026-11-09', 'start': null, 'title': 'Ganztägig'},
      {'id': 'loc-g', 'date': '2026-11-09', 'start': '16:00', 'title': 'Standard', 'reminderMinutes': null},
    ]);
    final plan = _plan(data, _store(), sunday, days: 3).where((item) => item.kind == 'events').toList();
    expect([for (final item in plan) '${_clock(item.at)} ${item.key} ${item.body}'], [
      '2026-11-09 14:45 event:loc-a:2026-11-09 Um 15:00 in Praxis Weber',
      '2026-11-09 15:45 event:loc-g:2026-11-09 Um 16:00',
      '2026-11-09 16:00 event:loc-b:2026-11-09 Um 17:00',
      '2026-11-09 19:00 event:loc-d:2026-11-10 Morgen um 19:00 in Aula',
      '2026-11-09 20:00 event:loc-e:2026-11-09 Um 20:00',
    ]);
    expect(plan.first.until, DateTime(2026, 11, 9, 16, 30));
    expect(plan[2].until, DateTime(2026, 11, 9, 18));
    final off = _plan(data, _store(notify: {
      'categories': {'events': {'on': false}},
    }), sunday, days: 3);
    expect(off.where((item) => item.kind == 'events'), isEmpty);
  });

  test('tasks with a time remind at that time, the others of the day and those without a date in one morning reminder', () {
    final data = _data(tasks: [
      {'id': 't1', 'title': 'Vokabeln', 'date': '2026-11-09', 'done': false},
      {'id': 't2', 'title': 'Referat üben', 'date': '2026-11-09', 'dueTime': '16:30', 'done': false},
      {'id': 't3', 'title': 'Längst fällig', 'date': '2026-11-06', 'done': false},
      {'id': 't4', 'title': 'Ohne Datum', 'date': null, 'done': false},
      {'id': 't5', 'title': 'Erledigt', 'date': '2026-11-09', 'done': true},
    ], taskPool: [
      {'id': 't6', 'title': 'Irgendwann', 'date': null, 'someday': true, 'done': false},
      {'id': 't7', 'title': 'Mittwoch', 'date': '2026-11-11', 'done': false},
    ]);
    final plan = _byKey(_plan(data, _store(), sunday, days: 3).where((item) => item.kind == 'tasks').toList());
    expect(plan.keys, containsAll(['tasks:2026-11-09', 'task:t2:2026-11-09', 'tasks:2026-11-10', 'tasks:2026-11-11']));
    expect(_clock(plan['tasks:2026-11-09']!.at), '2026-11-09 07:00');
    expect(plan['tasks:2026-11-09']!.title, '2 Aufgaben heute fällig');
    expect(plan['tasks:2026-11-09']!.body, 'Vokabeln, Ohne Datum', reason: 'an overdue task is left out, as reminders.js does');
    expect(_clock(plan['task:t2:2026-11-09']!.at), '2026-11-09 16:30');
    expect(plan['task:t2:2026-11-09']!.body, 'Fällig um 16:30');
    expect(plan['tasks:2026-11-10']!.title, 'Heute fällig');
    expect(plan['tasks:2026-11-11']!.title, '2 Aufgaben heute fällig');
    expect(plan['tasks:2026-11-11']!.body, 'Ohne Datum, Mittwoch');
    expect(plan.keys.where((key) => key.startsWith('task:')), ['task:t2:2026-11-09']);
    final single = _plan(_data(tasks: [
      {'id': 't1', 'title': 'Vokabeln', 'date': '2026-11-09', 'done': false},
    ]), _store(), sunday, days: 1);
    expect(single.where((item) => item.kind == 'tasks').single.title, 'Heute fällig');
  });

  test('subjects take their new name, a removed one drops its lessons and dates, and an own subject works', () {
    final data = _data(deadlines: [
      {'id': 'test-1', 'kind': 'Test', 'title': 'Optik', 'subject': '3', 'date': '2026-11-10', 'detail': '', 'status': 'offen'},
      {'id': 'test-2', 'kind': 'Test', 'title': 'Eigenes', 'subject': 'own-1', 'date': '2026-11-10', 'detail': '', 'status': 'offen'},
    ]);
    final store = _store(extra: {
      'app-subjects': {
        'items': {
          '1': {'name': 'Mathematik', 'type': 'LK'},
          'own-1': {'custom': true, 'name': 'Informatik', 'hue': 'iris'},
        },
        'removed': ['3'],
      },
      'app-timetable-edits': {
        'B:4:2': {'subject': 'own-1', 'room': 'R 300'},
      },
    });
    final plan = _byKey(_plan(data, store, sunday, days: 5));
    expect(plan.containsKey('lesson:2026-11-09:2'), isFalse, reason: 'Physik was removed');
    expect(plan.containsKey('deadline:test-1:2026-11-09'), isFalse);
    expect(plan['lesson:2026-11-12:1']!.body, 'Mathematik LK um 8:00 in R101.');
    expect(plan['lesson:2026-11-12:2']!.body, 'Informatik um 9:50 in R 300.');
    expect(plan['deadline:test-2:2026-11-09']!.body, 'Morgen, Informatik');
  });

  test('block times and cell edits from the store move and clear lessons', () {
    final store = _store(extra: {
      'app-block-times': {
        'v': 2,
        'blocks': [
          {'n': 1, 'start': '07:45', 'end': '09:15'},
          {'n': 2, 'start': '09:35', 'end': '11:05'},
        ],
      },
      'app-timetable-edits': {'B:4:1': null},
    });
    final plan = _plan(_data(), store, sunday, days: 5).where((item) => item.kind == 'lessons').toList();
    expect([for (final item in plan) '${_clock(item.at)} ${item.body}'], ['2026-11-09 09:25 Physik um 9:35 in R110.']);
    final broken = _plan(_data(), _store(extra: {
      'app-block-times': {
        'v': 2,
        'blocks': [
          {'n': 1, 'start': '10:00', 'end': '09:00'},
        ],
      },
    }), sunday, days: 1);
    expect(_clock(broken.single.at), '2026-11-09 09:40', reason: 'invalid times keep the defaults');
    final older = _plan(_data(), _store(extra: {
      'app-block-times': [
        {'n': 2, 'start': '10:00', 'end': '11:30'},
      ],
    }), sunday, days: 1);
    expect(_clock(older.single.at), '2026-11-09 09:50');
  });

  test('only what lies ahead within the window is planned, soonest first and capped', () {
    final plan = _plan(_data(), _store(), DateTime(2026, 11, 9, 9, 45), days: 14);
    expect(plan.first.key, 'lesson:2026-11-12:1', reason: 'the reminder at 9:40 has passed');
    expect(plan.every((item) => item.at.isAfter(DateTime(2026, 11, 9, 9, 45))), isTrue);
    expect(plan.last.at.isAfter(DateTime(2026, 11, 23, 9, 45)), isFalse);
    final capped = _plan(_data(), _store(), sunday, days: 14, limit: 2);
    expect([for (final item in capped) item.key], ['lesson:2026-11-09:2', 'lesson:2026-11-12:1']);
  });

  test('a switched off kind plans nothing of that kind, and without sound every reminder is silent', () {
    final data = _data(
      deadlines: [
        {'id': 'hw-1', 'kind': 'Hausaufgabe', 'title': 'Aufsatz', 'subject': '2', 'date': '2026-11-10', 'detail': '', 'status': 'offen'},
      ],
      tasks: [
        {'id': 't1', 'title': 'Vokabeln', 'date': '2026-11-09', 'done': false},
      ],
    );
    final off = _plan(data, _store(notify: {
      'categories': {
        'lessons': {'on': false, 'lead': 10},
        'homework': {'on': false},
        'tasks': {'on': null},
      },
    }), sunday, days: 3);
    expect(off, isEmpty);
    final silent = _plan(data, _store(notify: {'sound': false}), sunday, days: 3);
    expect(silent, isNotEmpty);
    expect(silent.every((item) => item.silent), isTrue);
    expect(_plan(data, _store(), sunday, days: 3).any((item) => item.silent), isFalse);
  });

  test('a long note is cut at 160 characters like the page cuts it', () {
    final long = List.filled(30, 'Absatz').join(' ');
    final data = _data(deadlines: [
      {'id': 'talk-1', 'kind': 'Vortrag', 'title': 'Referat', 'subject': null, 'date': '2026-11-09', 'detail': 'Folien fertig.\n$long', 'status': 'offen'},
    ]);
    final body = _plan(data, _store(), DateTime(2026, 11, 8, 20), days: 1).where((item) => item.kind == 'tests').single.body;
    expect(body.startsWith('Heute\nNotiz: Folien fertig. Absatz'), isTrue);
    expect(body.endsWith('…'), isTrue);
    expect(body.length, 'Heute\nNotiz: '.length + 160);
  });

  test('lessons keep their wall clock time across the change to winter time', () {
    final plan = _plan(_data(abReference: '2026-10-19'), _store(), DateTime(2026, 10, 24, 12), days: 3);
    final monday = plan.where((item) => item.key.startsWith('lesson:2026-10-26')).toList();
    expect(monday, isNotEmpty);
    for (final item in monday) {
      expect(item.at.day, 26);
      expect([item.at.hour, item.at.minute], anyOf(equals([7, 50]), equals([9, 40])));
    }
  });

  test('the plan matches what the page itself would show, minute for minute', () async {
    final node = await Process.run('node', ['--version']).then((result) => result.exitCode == 0).catchError((Object _) => false);
    if (!node) {
      markTestSkipped('node is not installed');
      return;
    }
    for (final quiet in [null, {'from': '08:00', 'to': '08:00'}, {'from': '23:00', 'to': '06:00'}]) {
      await _compareWithPage(quiet);
    }
  });
}

Future<void> _compareWithPage(Map<String, String>? quiet) async {
  final data = _data(
    deadlines: [
      {'id': 'test-1', 'kind': 'Test', 'title': 'Analysis', 'subject': '1', 'date': '2026-11-11', 'time': '08:00', 'detail': '- Ableitungen\n- Kurven', 'status': 'offen'},
      {'id': 'hw-1', 'kind': 'Hausaufgabe', 'title': 'Gedicht', 'subject': '2', 'date': '2026-11-10', 'detail': '', 'status': 'offen'},
      {'id': 'hw-2', 'kind': 'Hausaufgabe', 'title': 'Abgegeben', 'subject': '2', 'date': '2026-11-10', 'detail': '', 'status': 'abgegeben'},
    ],
    events: [
      {'id': 'loc-a', 'date': '2026-11-09', 'start': '15:00', 'end': '16:30', 'title': 'Zahnarzt', 'place': 'Praxis', 'kind': 'private'},
      {'id': 'loc-b', 'date': '2026-11-12', 'start': '07:10', 'title': 'Früh', 'place': '', 'kind': 'private'},
    ],
    tasks: [
      {'id': 't1', 'title': 'Vokabeln', 'date': '2026-11-18', 'done': false},
      {'id': 't2', 'title': 'Üben', 'date': '2026-11-18', 'dueTime': '16:30', 'done': false},
      {'id': 't3', 'title': 'Ohne Datum', 'date': null, 'done': false},
      {'id': 't4', 'title': 'Längst fällig', 'date': '2026-11-06', 'done': false},
      {'id': 't5', 'title': 'Mitte', 'date': '2026-11-12', 'done': false},
      {'id': 't6', 'title': 'Erledigt', 'date': '2026-11-12', 'done': true},
    ],
    holidays: [
      {'id': 'h-1', 'title': 'Feiertag', 'date': '2026-11-13', 'endDate': null, 'type': 'feiertag'},
    ],
  );
  final store = _store(notify: {if (quiet != null) 'quiet': quiet}, extra: {
    'app-subjects': {
      'items': {'1': {'name': 'Mathematik'}},
      'removed': <String>[],
    },
    'app-timetable-edits': {'A:2:1': {'subject': '3', 'room': 'R9'}},
  });
  final folder = await Directory.systemTemp.createTemp('reminders-');
  addTearDown(() => folder.delete(recursive: true));
  final fixture = File('${folder.path}/fixture.json')
    ..writeAsStringSync(jsonEncode({'brand': Brand.name, 'from': '2026-11-09', 'days': 10, 'data': data, 'store': store}));
  final run = await Process.run('node', ['test/js/reminders_dump.mjs', fixture.path], stdoutEncoding: utf8, stderrEncoding: utf8);
  expect(run.exitCode, 0, reason: '${run.stderr}');
  final page = {for (final item in (jsonDecode('${run.stdout}') as List).cast<Map<String, Object?>>()) item['key'] as String: item};
  final phone = _byKey(_plan(data, store, DateTime(2026, 11, 8, 23, 59), days: 10));
  expect(page.keys.map((key) => key.split(':').first).toSet(), {'lesson', 'deadline', 'event', 'task', 'tasks'});
  expect(phone.keys.toSet(), page.keys.toSet());
  for (final MapEntry(:key, value: shown) in page.entries) {
    final planned = phone[key]!;
    expect(planned.title, shown['title'], reason: '$key $quiet');
    expect(planned.body, shown['body'], reason: '$key $quiet');
    final day = DateTime.parse(shown['day'] as String);
    expect(planned.at, DateTime(day.year, day.month, day.day, 0, shown['minute'] as int), reason: '$key $quiet');
  }
}
