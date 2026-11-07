// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/providers/app_provider.dart';
import 'package:app/web_ui/ui_data.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  final cases = [
    for (final item in (jsonDecode(File('../tests/ab_weeks.json').readAsStringSync()) as Map)['cases'] as List)
      (item as Map).cast<String, String>(),
  ];
  final friday = DateTime(2026, 11, 6, 10, 40);

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-week-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  // An install as the update finds it. lesson is the week of its one lesson, null for no plan at all.
  Future<(Database, SharedPreferences)> fresh(Map<String, Object> values, {bool swapped = false, String? lesson, bool edits = false}) async {
    AppProvider.forgetWeekRule();
    SharedPreferences.setMockInitialValues(values);
    final prefs = await SharedPreferences.getInstance();
    final db = await UiDb.open();
    await db.delete('ui_store');
    await db.delete('lessons');
    if (swapped) await UiDb.save(db, 'app-ab-swap', true);
    if (edits) await UiDb.save(db, 'app-timetable-edits', {'B:2:1': {'subject': '1', 'room': 'R101'}});
    if (lesson != null) {
      final stamp = DateTime(2026, 9, 1).toIso8601String();
      await db.insert('lessons', {
        'id': 'l1', 'subject': 'Mathe', 'day_of_week': 1, 'start_time': '08:00', 'end_time': '09:30', 'lesson_number': 1,
        'week_type': lesson, 'created_at': stamp, 'updated_at': stamp,
      });
    }
    return (db, prefs);
  }

  // The letter a page showed before the update: the parity of the week number, turned by the swap of the old
  // screens and by the swap of the settings page.
  String before(DateTime now, {bool inverted = false, bool swapped = false}) {
    final monday = DateTime.utc(now.year, now.month, now.day).subtract(Duration(days: now.weekday - 1));
    final first = DateTime.utc(monday.year, 1, 1);
    final number = (monday.difference(first).inDays + first.weekday - 1) ~/ 7 + 1;
    return (number.isEven != inverted) != swapped ? 'A' : 'B';
  }

  final days = [friday, DateTime(2026, 11, 9, 7, 30), DateTime(2026, 11, 14, 12), DateTime(2027, 3, 1, 9), DateTime(2027, 9, 6, 9)];

  test('weeks are counted the way the desktop counts them', () {
    expect(cases, hasLength(greaterThan(30)));
    for (final item in cases) {
      final reference = DateTime.parse(item['reference']!);
      final day = DateTime.parse(item['day']!);
      expect(AppProvider.weekTypeFrom(day, reference), item['week'], reason: '${item['day']} from ${item['reference']}');
      expect(AppProvider.weekTypeFrom(DateTime(day.year, day.month, day.day, 23, 59), reference), item['week']);
    }
  });

  test('a fresh install counts from the same Monday as the desktop and is not asked', () async {
    final (db, prefs) = await fresh({});
    final school = await UiData(db, prefs, friday).school();
    expect(school.abReference, '2026-01-12');
    expect(school.abWeeks, isTrue);
    for (final item in cases.where((item) => item['reference'] == '2026-01-12')) {
      expect(school.weekOf(DateTime.parse(item['day']!)), item['week'], reason: item['day']);
    }
    expect(AppProvider.calculateIsAWeek(friday), isTrue);
    expect(prefs.getString(AppProvider.abReferenceKey), '2026-01-12');
    expect(prefs.getBool(AppProvider.abAskKey), isNull);
  });

  test('with A/B weeks off every week is an A week and nothing is asked', () async {
    final (db, prefs) = await fresh({'ab_weeks_enabled': false, 'ab_week_inverted': true}, lesson: 'A', swapped: true);
    final school = await UiData(db, prefs, friday).school();
    expect(school.abWeeks, isFalse);
    expect({for (final item in cases) school.weekOf(DateTime.parse(item['day']!))}, {'A'});
    expect(prefs.getString(AppProvider.abReferenceKey), '2026-01-12');
    expect(prefs.getBool(AppProvider.abAskKey), isNull);
  });

  // What an install from before has: prefs, a store, lessons. Asked are only those whose A and B weeks differ.
  final kept = <String, (Map<String, Object>, bool, String?, bool, bool)>{
    'week-specific lessons': ({}, false, 'A', false, true),
    'edits from the settings page': ({}, false, null, true, true),
    'both swaps and a plan with A and B weeks': ({'ab_week_inverted': true}, true, 'B', true, true),
    'the same lessons in both weeks': ({}, false, 'both', false, false),
    'no plan, only its settings': ({'timetable_setup_completed': true}, false, null, false, false),
    'only the swap of the old screens': ({'ab_week_inverted': true}, false, null, false, false),
    'only the swap of the settings page': ({}, true, null, false, false),
    'both swaps': ({'ab_week_inverted': true}, true, 'both', false, false),
  };
  for (final entry in kept.entries) {
    final (values, swapped, lesson, edits, asked) = entry.value;
    test('an install with ${entry.key} keeps the letter it showed${asked ? ' and is asked once' : ' without a question'}', () async {
      for (final now in days) {
        final (db, prefs) = await fresh(values, swapped: swapped, lesson: lesson, edits: edits);
        final school = await UiData(db, prefs, now).school();
        final inverted = values['ab_week_inverted'] == true;
        expect(school.weekOf(now), before(now, inverted: inverted, swapped: swapped), reason: '$now');
        expect(school.weekOf(now.add(const Duration(days: 7))), before(now.add(const Duration(days: 7)), inverted: inverted, swapped: swapped));
        expect(prefs.getBool(AppProvider.abAskKey), asked ? isTrue : isNull);
      }
    });
  }

  test('the move is written in one step, so running it again changes nothing', () async {
    final (db, prefs) = await fresh({'ab_week_inverted': true}, swapped: true, lesson: 'A');
    final monday = DateTime(2026, 11, 9, 8);
    await UiData(db, prefs, monday).school();
    final reference = prefs.getString(AppProvider.abReferenceKey);
    final shown = (await UiData(db, prefs, monday).school()).weekOf(monday);

    await prefs.remove(AppProvider.abAskKey);
    await prefs.setBool('ab_week_inverted', false);
    AppProvider.forgetWeekRule();
    expect((await UiData(db, prefs, monday).school()).weekOf(monday), shown);
    expect(prefs.getString(AppProvider.abReferenceKey), reference);
    expect(prefs.getBool(AppProvider.abAskKey), isNull);

    await prefs.remove(AppProvider.abReferenceKey);
    await prefs.setBool('ab_week_inverted', true);
    AppProvider.forgetWeekRule();
    expect((await UiData(db, prefs, monday).school()).weekOf(monday), shown);
    expect(prefs.getString(AppProvider.abReferenceKey), reference);
  });
}
