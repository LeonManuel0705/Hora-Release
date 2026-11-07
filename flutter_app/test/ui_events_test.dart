// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/database_service.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_data.dart';
import 'package:app/web_ui/ui_pages.dart';
import 'package:app/web_ui/web_start_script.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  late UiBridge hub;

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-events-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg', 'school_class_level': 12});
    hub = UiBridge(
      api: UiApi(null),
      pages: UiPages(browser: true),
      openNative: (name) async => false,
      startScript: webStartScript,
      assets: (key) async => Uint8List(0),
    );
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<(int, Map<String, Object?>)> send(String method, String path, [Map<String, Object?>? body]) async {
    final reply = await hub.handle(UiBridgeRequest(
      method: method,
      path: path,
      body: body == null ? null : jsonEncode(body),
      contentType: body == null ? null : 'application/json',
    ));
    return (reply.status, (jsonDecode(reply.body as String) as Map).cast<String, Object?>());
  }

  test('an event table from before repeats gains its columns and keeps its events', () async {
    final db = await DatabaseService().database;
    final stamp = DateTime.now().toIso8601String();
    await db.insert('events', {
      'id': 'old', 'title': 'Kino', 'start_time': '2026-11-13T20:00:00.000', 'end_time': '2026-11-13T22:30:00.000',
      'all_day': 0, 'category': 'personal', 'created_at': stamp, 'updated_at': stamp,
    });
    final (status, reply) = await send('PATCH', '/api/ui/events/loc-old', {'title': 'Kino mit Lea'});
    expect(status, 200);
    expect(reply['event'], {
      'id': 'loc-old', 'date': '2026-11-13', 'start': '20:00', 'end': '22:30', 'title': 'Kino mit Lea', 'place': '',
      'kind': 'private', 'notes': '', 'synced': false,
    });
    final columns = {for (final row in await db.rawQuery('PRAGMA table_info(events)')) row['name']};
    expect(columns, containsAll(['recurrence', 'reminder_minutes']));
  });

  test('an event keeps its repeat rule and its reminder through a change', () async {
    final (status, created) = await send('POST', '/api/ui/events', {
      'title': 'Klavier', 'date': '2026-11-04', 'start': '15:00', 'end': '15:45', 'kind': 'private',
      'recurrence': {'freq': 'weekly', 'interval': 2, 'until': '2026-12-31', 'exceptions': ['2026-11-18', '2026-11-18', 'kaputt']},
      'reminderMinutes': 30,
    });
    expect(status, 200);
    final event = (created['event'] as Map).cast<String, Object?>();
    expect(event['recurrence'], {'freq': 'weekly', 'interval': 2, 'until': '2026-12-31', 'count': null, 'exceptions': ['2026-11-18']});
    expect(event['reminderMinutes'], 30);

    final (_, changed) = await send('PATCH', '/api/ui/events/${event['id']}', {'title': 'Klavierstunde'});
    expect((changed['event'] as Map)['recurrence'], event['recurrence']);
    expect((changed['event'] as Map)['reminderMinutes'], 30);

    final (_, cleared) = await send('PATCH', '/api/ui/events/${event['id']}', {'recurrence': null, 'reminderMinutes': -1});
    expect((cleared['event'] as Map).containsKey('recurrence'), isFalse);
    expect((cleared['event'] as Map)['reminderMinutes'], -1);

    final (_, back) = await send('PATCH', '/api/ui/events/${event['id']}', {'reminderMinutes': null});
    expect((back['event'] as Map).containsKey('reminderMinutes'), isFalse);
  });

  test('a rule or a reminder the app does not know is refused', () async {
    for (final body in [
      {'recurrence': {'freq': 'hourly'}},
      {'recurrence': 'weekly'},
      {'reminderMinutes': -5},
      {'reminderMinutes': 50000},
      {'reminderMinutes': 'bald'},
    ]) {
      final (status, reply) = await send('POST', '/api/ui/events', {'title': 'Test', 'date': '2026-11-04', ...body});
      expect(status, 400, reason: '$body');
      expect(reply['success'], isFalse);
    }
  });

  test('the rule is read the same way as in the browser', () {
    expect(recurrenceRule({'freq': 'daily', 'count': 3, 'until': '2026-12-31'}), {'freq': 'daily', 'interval': 1, 'until': null, 'count': 3, 'exceptions': <String>[]});
    expect(recurrenceRule('{"freq":"yearly","interval":40}'), {'freq': 'yearly', 'interval': 12, 'until': null, 'count': null, 'exceptions': <String>[]});
    expect(recurrenceRule({'freq': 'weekly', 'exceptions': ['2026-02-30', '2026-11-11']})!['exceptions'], ['2026-11-11']);
    expect(recurrenceRule(null), isNull);
    expect(reminderMinutes(1440), 1440);
    expect(reminderMinutes(null), isNull);
    expect(() => reminderMinutes(7.5), throwsFormatException);
  });
}
