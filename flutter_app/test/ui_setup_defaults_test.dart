// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_data.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:app/web_ui/ui_weather.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-setup-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<Map<String, Object?>> build(Map<String, Object> values, {bool browser = false, String page = 'settings'}) async {
    SharedPreferences.setMockInitialValues(values);
    final prefs = await SharedPreferences.getInstance();
    final db = await UiDb.open();
    return UiData(db, prefs, DateTime(2026, 11, 7, 10), browser: browser).build(page, {});
  }

  test('the graduation year gives the class, counted from August', () {
    expect(UiData.levelForGraduation(2027, DateTime(2026, 11, 7)), 12);
    expect(UiData.levelForGraduation(2028, DateTime(2026, 11, 7)), 11);
    expect(UiData.levelForGraduation(2027, DateTime(2027, 7, 15)), 12);
    expect(UiData.levelForGraduation(2027, DateTime(2027, 8, 1)), 13);
    expect(UiData.levelForGraduation(2040, DateTime(2026, 11, 7)), 5);
    expect(UiData.levelForGraduation(2020, DateTime(2026, 11, 7)), 13);
  });

  test('the welcome answers fill the user block on the phone', () async {
    final data = await build({'user_bundesland': 'Brandenburg', 'graduation_year': 2027});
    expect(data['user'], {'state': 'BB', 'grade': 12, 'iserv': 'android'});
    final page = data['page'] as Map<String, Object?>;
    final school = page['school'] as Map<String, Object?>;
    expect(school['grade'], 12);
    expect(school['semester'], 'Q3');
  });

  test('the web app has no IServ to offer', () async {
    final data = await build({'user_bundesland': 'Berlin', 'graduation_year': 2029}, browser: true);
    expect(data['user'], {'state': 'BE', 'grade': 10, 'iserv': ''});
  });

  test('a class the student chose wins over the graduation year', () async {
    final data = await build({'graduation_year': 2027, 'school_class_level': 9});
    expect((data['user'] as Map)['grade'], 9);
  });

  test('without any answer the class stays unknown', () async {
    final data = await build({});
    expect((data['user'] as Map)['grade'], isNull);
    expect(((data['page'] as Map)['school'] as Map)['grade'], isNull);
  });

  test('the forecast passes the weather code on', () async {
    const today = '2026-11-07';
    SharedPreferences.setMockInitialValues({
      'weather_city': 'Potsdam',
      'ui_weather_cache': jsonEncode({
        'city': 'Potsdam',
        'fetched': DateTime(2026, 11, 7, 9).toIso8601String(),
        'current': {'time': '${today}T10:00', 'wind_speed_10m': 9.0, 'weather_code': 61},
        'hourly': {
          'time': [for (var hour = 0; hour < 24; hour++) '${today}T${hour.toString().padLeft(2, '0')}:00', '2026-11-08T07:00'],
          'temperature_2m': [for (var hour = 0; hour < 25; hour++) 8.0],
          'precipitation_probability': [for (var hour = 0; hour < 25; hour++) 60],
          'weather_code': [for (var hour = 0; hour < 25; hour++) 63],
        },
        'daily': {'time': [today], 'temperature_2m_max': [9.0], 'temperature_2m_min': [4.0]},
      }),
    });
    final prefs = await SharedPreferences.getInstance();
    final view = UiWeather.instance.view(prefs, DateTime(2026, 11, 7, 10));
    expect(view['code'], 61);
    final hours = view['hours'] as List;
    expect(hours, hasLength(24));
    expect((hours.first as Map)['code'], 63);
    expect((view['tomorrowMorning'] as Map)['code'], 63);
  });

  test('the store answers about A/B weeks and the class reach the phone settings', () async {
    SharedPreferences.setMockInitialValues({});
    final api = UiApi(null);
    UiRequest put(String key, Object? body) => UiRequest(method: 'PUT', segments: ['ui', 'store', key], query: const {}, json: true, body: body);
    expect((await api.handle(put('app-ab-weeks', false))).status, 200);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('ab_weeks_enabled'), isFalse);
    expect((await api.handle(put('app-ab-weeks', true))).status, 200);
    expect(prefs.getBool('ab_weeks_enabled'), isTrue);
    expect((await api.handle(put('app-settings', {'school': {'grade': 12}}))).status, 200);
    expect(prefs.getInt('school_class_level'), 12);
    expect(prefs.getString('grade_system'), 'points');
    for (final key in ['app-subjects', 'app-teachers', 'app-rooms', 'app-timetable-edits', 'app-block-times', 'app-ab-swap']) {
      expect((await api.handle(put(key, {'v': 1}))).status, 200, reason: key);
    }
  });

  test('the Bundesland route exists and says when it cannot run', () async {
    SharedPreferences.setMockInitialValues({});
    final reply = await UiApi(null).handle(UiRequest(method: 'POST', segments: ['hub', 'bundesland'], query: const {}, json: true, body: {'bundesland': 'BB'}));
    expect(reply.status, 503);
    final unknown = await UiApi(null).handle(UiRequest(method: 'POST', segments: ['hub', 'bundesland'], query: const {}, json: true, body: {'bundesland': 'XX'}));
    expect(unknown.status, 400);
  });
}
