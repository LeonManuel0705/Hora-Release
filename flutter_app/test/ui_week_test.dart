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

  Future<(Database, SharedPreferences)> fresh(Map<String, Object> values, {bool swapped = false}) async {
    AppProvider.forgetWeekRule();
    SharedPreferences.setMockInitialValues(values);
    final prefs = await SharedPreferences.getInstance();
    final db = await UiDb.open();
    if (swapped) {
      await UiDb.save(db, 'app-ab-swap', true);
    } else {
      await UiDb.remove(db, 'app-ab-swap');
    }
    return (db, prefs);
  }

  test('weeks are counted the way the desktop counts them', () {
    expect(cases, hasLength(greaterThan(30)));
    for (final item in cases) {
      final reference = DateTime.parse(item['reference']!);
      final day = DateTime.parse(item['day']!);
      expect(AppProvider.weekTypeFrom(day, reference), item['week'], reason: '${item['day']} from ${item['reference']}');
      expect(AppProvider.weekTypeFrom(DateTime(day.year, day.month, day.day, 23, 59), reference), item['week']);
    }
  });

  test('the school data counts from the same Monday as the desktop and alternates over the years', () async {
    final (db, prefs) = await fresh({});
    final school = await UiData(db, prefs, friday).school();
    expect(school.abReference, '2026-01-12');
    expect(school.abWeeks, isTrue);
    for (final item in cases.where((item) => item['reference'] == '2026-01-12')) {
      expect(school.weekOf(DateTime.parse(item['day']!)), item['week'], reason: item['day']);
    }
    expect(AppProvider.calculateIsAWeek(friday), isTrue);
  });

  test('with A/B weeks off every week is an A week', () async {
    final (db, prefs) = await fresh({'ab_weeks_enabled': false});
    final school = await UiData(db, prefs, friday).school();
    expect(school.abWeeks, isFalse);
    expect({for (final item in cases) school.weekOf(DateTime.parse(item['day']!))}, {'A'});
  });

  test('a phone that never swapped follows the desktop from now on', () async {
    final (db, prefs) = await fresh({});
    final school = await UiData(db, prefs, friday).school();
    expect(school.weekOf(friday), 'A');
    expect(prefs.getBool('ab_week_inverted') ?? false, isFalse);
    expect(prefs.getString('ab_week_rule'), 'reference');
  });

  test('a phone that swapped A and B in its own screens keeps the letter of this week', () async {
    final (db, prefs) = await fresh({'ab_week_inverted': true});
    final school = await UiData(db, prefs, friday).school();
    expect(school.weekOf(friday), 'A');
    expect(school.abReference, '2026-01-12');
    expect(prefs.getBool('ab_week_inverted'), isFalse);
  });

  test('a phone that swapped A and B on the settings page keeps the letter the page shows', () async {
    final (db, prefs) = await fresh({}, swapped: true);
    final school = await UiData(db, prefs, friday).school();
    expect(prefs.getBool('ab_week_inverted'), isTrue);
    expect(school.abReference, '2026-01-19');
    expect(school.abSwapped, isTrue);
    expect(school.weekOf(friday), 'A');
    expect(school.weekOf(friday.add(const Duration(days: 7))), 'B');
  });

  test('the change happens once, a later swap stays as it is', () async {
    final (db, prefs) = await fresh({'ab_week_inverted': true, 'ab_week_rule': 'reference'});
    final school = await UiData(db, prefs, friday).school();
    expect(prefs.getBool('ab_week_inverted'), isTrue);
    expect(school.abReference, '2026-01-19');
    expect(school.weekOf(friday), 'B');
  });
}
