// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:app/providers/app_provider.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_data.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

Map<String, Object?> times(int count) => {
      'v': 2,
      'blocks': [for (var n = 1; n <= count; n++) {'n': n, 'start': '${(6 + n).toString().padLeft(2, '0')}:00', 'end': '${(6 + n).toString().padLeft(2, '0')}:45'}],
    };

const subjects = {
  'items': {
    'x-ma': {'custom': true, 'name': 'Mathe', 'short': 'Ma', 'hue': 'lake', 'type': 'LK', 'teacher': '', 'room': ''},
    'x-de': {'custom': true, 'name': 'Deutsch', 'short': 'De', 'hue': 'rose', 'type': 'GK', 'teacher': '', 'room': ''},
  },
};

Map<String, Object?> lesson(String subject) => {'subject': subject, 'room': 'R1'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  final api = UiApi(null);

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-deadline-lessons-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  setUp(() async {
    AppProvider.forgetWeekRule();
    SharedPreferences.setMockInitialValues({});
    final db = await UiDb.open();
    for (final table in ['ui_store', 'lessons', 'subjects', 'tests', 'exams', 'talks', 'homework', 'iserv_exercises']) {
      await db.delete(table);
    }
  });

  Future<UiReply> call(String method, List<String> segments, Object? body) =>
      api.handle(UiRequest(method: method, segments: segments, query: const {}, json: true, body: body));

  Future<void> put(String key, Object? value) async => expect((await call('PUT', ['ui', 'store', key], value)).status, 200);

  // A plan as the new setup writes it: own subjects, block times, the answer on A and B weeks and the lessons as edits.
  Future<void> newPlan(Map<String, Object?> cells, {bool weeks = true, int blocks = 6}) async {
    await put('app-subjects', subjects);
    await put('app-block-times', times(blocks));
    await put('app-ab-weeks', weeks);
    await put('app-timetable-edits', cells);
  }

  Future<Map<String, Object?>> add(String? subject, DateTime day, [String kind = 'Test']) async {
    final reply = await call('POST', ['ui', 'deadlines'], {'kind': kind, 'title': 'Analysis', 'subject': subject, 'date': isoOf(day)});
    expect(reply.status, 200);
    return ((reply.body as Map)['deadline'] as Map).cast<String, Object?>();
  }

  Future<UiData> data() async => UiData(await UiDb.open(), await SharedPreferences.getInstance(), DateTime.now());

  Future<Map<Object?, Object?>> shown() async {
    final store = await UiDb.store(await UiDb.open());
    final built = await (await data()).build('calendar', store);
    return {for (final item in (built['deadlines'] as List).cast<Map>()) item['id']: item['block']};
  }

  // The first Monday after this week that falls in the A or B week as the page counts them.
  Future<DateTime> mondayOf(String week) async {
    final school = await (await data()).school();
    final today = DateTime.now();
    var monday = DateTime(today.year, today.month, today.day - (today.weekday - 1) + 7);
    while (school.weekOf(monday) != week) {
      monday = DateTime(monday.year, monday.month, monday.day + 7);
    }
    return monday;
  }

  DateTime after(DateTime day, int days) => DateTime(day.year, day.month, day.day + days);

  test('a test finds its lesson in a plan made in the new setup, in the A and in the B week', () async {
    await newPlan({'A:1:3': lesson('x-ma'), 'A:1:1': lesson('x-de'), 'B:1:1': lesson('x-ma'), 'B:1:2': lesson('x-de')});
    final inA = await add('x-ma', await mondayOf('A'));
    final inB = await add('x-ma', await mondayOf('B'));
    expect([inA['block'], inB['block']], [3, 1]);
    final listed = await shown();
    expect([listed[inA['id']], listed[inB['id']]], [3, 1]);
  });

  test('a double lesson gives its first block', () async {
    await newPlan({for (final week in ['A', 'B']) for (final n in [4, 5]) '$week:2:$n': lesson('x-ma')});
    final klausur = await add('x-ma', after(await mondayOf('A'), 1), 'Klausur');
    expect(klausur['block'], 4);
    expect((await shown())[klausur['id']], 4);
  });

  test('no lesson of the subject that day, or no plan at all, leaves the test without a lesson', () async {
    final nothing = await add('x-ma', await mondayOf('A'));
    expect(nothing.containsKey('block'), isFalse);
    await newPlan({'A:1:2': lesson('x-de'), 'A:3:2': lesson('x-ma')});
    final monday = await mondayOf('A');
    final other = await add('x-ma', monday);
    final weekend = await add('x-ma', after(monday, 5));
    final loose = await add(null, after(monday, 2));
    expect([other['block'], weekend['block'], loose['block']], [null, null, null]);
    final listed = await shown();
    expect([for (final item in [nothing, other, weekend, loose]) listed[item['id']]], [null, null, null, null]);
  });

  test('without A and B weeks every week has the lessons of the A week', () async {
    await newPlan({'A:1:2': lesson('x-ma')}, weeks: false);
    final inA = await add('x-ma', await mondayOf('A'));
    final inB = await add('x-ma', after(await mondayOf('A'), 7));
    expect([inA['block'], inB['block']], [2, 2]);
  });

  test('the swapped weeks move the lesson with them', () async {
    await newPlan({'A:1:3': lesson('x-ma'), 'B:1:1': lesson('x-ma')});
    await put('app-ab-swap', true);
    final inA = await add('x-ma', await mondayOf('A'));
    final inB = await add('x-ma', await mondayOf('B'));
    expect([inA['block'], inB['block']], [3, 1]);
  });

  test('the stored plan still counts where the settings changed nothing, and an edit moves the lesson', () async {
    final db = await UiDb.open();
    final stamp = DateTime(2026, 9, 1).toIso8601String();
    for (final (id, day, number) in [('l1', 1, 2), ('l2', 2, 1)]) {
      await db.insert('lessons', {
        'id': id, 'subject': 'Physik', 'day_of_week': day, 'start_time': '08:00', 'end_time': '08:45', 'lesson_number': number,
        'week_type': 'both', 'created_at': stamp, 'updated_at': stamp,
      });
    }
    await put('app-block-times', times(6));
    final physics = (await (await data()).school()).names['physik']!;
    await put('app-timetable-edits', {'A:2:1': null, 'B:2:1': null, 'A:2:3': lesson(physics), 'B:2:3': lesson(physics)});
    final monday = await mondayOf('A');
    final stored = await add(physics, monday);
    final moved = await add(physics, after(monday, 1));
    expect([stored['block'], moved['block']], [2, 3]);
    final changed = await call('PATCH', ['ui', 'deadlines', '${stored['id']}'], {'date': isoOf(after(monday, 1))});
    expect(((changed.body as Map)['deadline'] as Map)['block'], 3);
  });

  test('a lesson outside the block times or of a subject put aside does not count, and twelve blocks are kept', () async {
    await newPlan({'A:1:6': lesson('x-ma'), 'A:1:2': lesson('x-de'), 'A:2:11': lesson('x-ma')}, blocks: 12);
    final monday = await mondayOf('A');
    final late = await add('x-ma', monday);
    final german = await add('x-de', monday);
    final eleventh = await add('x-ma', after(monday, 1));
    expect([late['block'], german['block'], eleventh['block']], [6, 2, 11]);
    await put('app-block-times', times(5));
    await put('app-subjects', {...subjects, 'removed': ['x-de']});
    final listed = await shown();
    expect([listed[late['id']], listed[eleventh['id']]], [null, null]);
    expect(listed.containsKey(german['id']) ? listed[german['id']] : null, isNull);
  });

  test('homework from IServ finds the lesson too', () async {
    final db = await UiDb.open();
    await db.insert('subjects', {'name': 'Deutsch', 'created_at': DateTime(2026, 9, 1).toIso8601String()});
    final german = (await (await data()).school()).names['deutsch']!;
    await put('app-timetable-edits', {'A:4:3': lesson(german)});
    final thursday = after(await mondayOf('A'), 3);
    await db.insert('iserv_exercises', {'id': '7', 'title': 'Gedicht', 'course': 'Deutsch', 'due_date': '${isoOf(thursday)}T08:00:00', 'cached_at': DateTime.now().toIso8601String()});
    final setup = await (await data()).school();
    final view = (await data()).iservView((await db.query('iserv_exercises')).single, setup, const {});
    expect([view!['subject'], view['block']], [german, 3]);
  });
}
