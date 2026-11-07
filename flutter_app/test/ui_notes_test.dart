// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:app/web_ui/ui_api.dart';
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
  final api = UiApi(null);

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-notes-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<UiReply> call(String method, List<String> segments, [Map<String, Object?>? body]) => api.handle(UiRequest(
        method: method,
        segments: segments,
        query: const {},
        json: body != null,
        body: body,
      ));

  Map<String, Object?> body(UiReply reply) => (reply.body as Map).cast<String, Object?>();

  Future<List<Map<String, Object?>>> listed() async {
    final data = await UiData(await UiDb.open(), await SharedPreferences.getInstance(), DateTime.now()).build('tasks', {});
    return ((data['page'] as Map)['notes'] as List).cast<Map<String, Object?>>();
  }

  test('a note from the quick sheet is listed on the task page with what the page needs', () async {
    final reply = await call('POST', ['ui', 'notes'], {'type': 'idea', 'title': 'Referat über Kafka', 'details': 'Die Verwandlung\nzweite Zeile'});
    expect(reply.status, 200);
    final note = body(reply)['note'] as Map;
    expect(note['title'], 'Referat über Kafka');
    expect(note['type'], 'idea');
    expect(note['details'], 'Die Verwandlung\nzweite Zeile');
    expect('${note['created']}', hasLength(19));
    expect((await listed()).map((item) => item['id']), contains(note['id']));
  });

  test('a note can be edited and deleted, and undo brings it back with its old date', () async {
    final note = body(await call('POST', ['ui', 'notes'], {'type': 'note', 'title': 'Bio Mappe', 'details': ''}))['note'] as Map;
    final id = note['id'] as String;
    final edited = await call('PATCH', ['ui', 'notes', id], {'title': 'Bio Mappe abgeben', 'type': 'idea'});
    expect(edited.status, 200);
    expect((body(edited)['note'] as Map)['title'], 'Bio Mappe abgeben');
    expect((await listed()).firstWhere((item) => item['id'] == id)['type'], 'idea');
    expect((await call('PATCH', ['ui', 'notes', id], {'title': '  '})).status, 400);

    expect((await call('DELETE', ['ui', 'notes', id])).status, 200);
    expect((await listed()).where((item) => item['id'] == id), isEmpty);
    expect((await call('DELETE', ['ui', 'notes', id])).status, 404);

    final back = body(await call('POST', ['ui', 'notes'], {'type': 'idea', 'title': 'Bio Mappe abgeben', 'details': '', 'created': '2026-10-01T09:30:00'}))['note'] as Map;
    expect(back['created'], '2026-10-01T09:30:00');
    final order = (await listed()).map((item) => item['id']).toList();
    expect(order, contains(back['id']));
    expect(order.first, isNot(back['id']));
  });

  test('a note of the older screens keeps its first line as title when only the text changes', () async {
    final db = await UiDb.open();
    final stamp = DateTime.now().toIso8601String();
    await db.insert('quick_notes', {'id': 'old-1', 'type': 'note', 'title': null, 'content': 'Erste Zeile\nRest der Notiz', 'word_count': 5, 'created_at': stamp, 'updated_at': stamp});
    final shown = (await listed()).firstWhere((item) => item['id'] == 'old-1');
    expect(shown['title'], 'Erste Zeile');
    expect(shown['details'], 'Rest der Notiz');
    final reply = await call('PATCH', ['ui', 'notes', 'old-1'], {'details': 'Neuer Rest'});
    expect(body(reply)['note'], containsPair('title', 'Erste Zeile'));
    expect(body(reply)['note'], containsPair('details', 'Neuer Rest'));
  });
}
