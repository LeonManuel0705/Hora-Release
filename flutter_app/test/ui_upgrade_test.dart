// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/database_service.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_data.dart' show semesterFor;
import 'package:app/web_ui/ui_pages.dart';
import 'package:app/web_ui/web_start_script.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

// The tables the web interface had added to the app database up to release 0.5.2, before presentations.
Future<void> asReleasedBeforePresentations(Database db) async {
  await db.execute('CREATE TABLE ui_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  for (final table in const ['tests', 'exams']) {
    await db.execute('''
      CREATE TABLE $table (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, subject_id INTEGER, date TEXT, notes TEXT, grade TEXT, created_at TEXT NOT NULL, time TEXT
      )
    ''');
  }
  await db.execute('''
    CREATE TABLE grades (
      id TEXT PRIMARY KEY, subject_id INTEGER NOT NULL, semester TEXT NOT NULL, type TEXT NOT NULL, points INTEGER NOT NULL,
      notes TEXT, date TEXT, created_at TEXT NOT NULL, grade_system TEXT DEFAULT 'points', value REAL
    )
  ''');
  await db.execute('ALTER TABLE subjects ADD COLUMN course_type TEXT');
  for (final column in const ['subject TEXT', 'someday INTEGER DEFAULT 0', 'deadline_ref TEXT', 'source TEXT', 'completed_at TEXT']) {
    await db.execute('ALTER TABLE tasks ADD COLUMN $column');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-upgrade-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg', 'school_class_level': 12});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  String day(int ahead) {
    final when = DateTime.now().add(Duration(days: ahead));
    return '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')}';
  }

  test('a database from before presentations gains their table and keeps what it holds', () async {
    final db = await DatabaseService().database;
    await asReleasedBeforePresentations(db);
    final stamp = DateTime.now().toIso8601String();
    final subject = await db.insert('subjects', {'name': 'Geografie', 'created_at': stamp});
    await db.insert('tests', {'id': 't-old', 'title': 'Stadtgeografie', 'subject_id': subject, 'date': '${day(3)}T00:00:00.000', 'notes': 'Seite 24', 'created_at': stamp, 'time': ''});
    await db.insert('exams', {'id': 'e-old', 'title': 'Klimazonen', 'subject_id': subject, 'date': '${day(9)}T00:00:00.000', 'notes': '', 'created_at': stamp, 'time': '08:00'});
    await db.insert('homework', {'id': 'h-old', 'title': 'Atlas S. 24', 'subject_id': subject, 'notes': '', 'due_date': '${day(2)}T00:00:00.000', 'completed': 0, 'created_at': stamp, 'updated_at': stamp});
    await db.insert('grades', {'id': 'g-old', 'subject_id': subject, 'semester': semesterFor(DateTime.now(), 12), 'type': 'Referat', 'points': 12, 'date': stamp, 'created_at': stamp});
    await db.insert('ui_store', {'key': 'app-task-filter', 'value': '"woche"', 'updated_at': stamp});
    Future<List<String>> tables() async =>
        [for (final row in await db.query('sqlite_master', columns: ['name'], where: "type = 'table'")) row['name'] as String];
    expect(await tables(), isNot(contains('talks')));
    expect(await db.getVersion(), 12);

    final hub = UiBridge(
      api: UiApi(null),
      pages: UiPages(browser: true),
      openNative: (name) async => false,
      startScript: webStartScript,
      assets: (key) async => Uint8List(0),
    );
    Future<Map<String, Object?>> school() async {
      final reply = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/school', navigate: true));
      expect(reply.status, 200);
      final html = reply.body as String;
      final data = RegExp(r'<script type="application/json" id="appData">(.*?)</script>', dotAll: true).firstMatch(html)!;
      final store = RegExp(r'<script type="application/json" id="appStore">(.*?)</script>', dotAll: true).firstMatch(html)!;
      return {...(jsonDecode(data.group(1)!) as Map).cast<String, Object?>(), 'store': jsonDecode(store.group(1)!)};
    }

    final before = await school();
    expect(await tables(), contains('talks'));
    expect(await db.getVersion(), 12);
    expect({for (final item in (before['deadlines'] as List).cast<Map>()) item['title']: [item['kind'], item['subject'], item['date']]}, {
      'Atlas S. 24': ['Hausaufgabe', '$subject', day(2)],
      'Stadtgeografie': ['Test', '$subject', day(3)],
      'Klimazonen': ['Klausur', '$subject', day(9)],
    });
    expect([for (final item in ((before['page'] as Map)['grades'] as List).cast<Map>()) [item['id'], item['type'], item['points']]], [['g-g-old', 'vortrag', 12]]);
    expect((before['store'] as Map)['app-task-filter'], 'woche');

    final created = await hub.handle(UiBridgeRequest(
      method: 'POST',
      path: '/api/ui/deadlines',
      body: jsonEncode({'kind': 'Vortrag', 'title': 'Stadtklima', 'date': day(5), 'subject': '$subject', 'detail': '10 Minuten'}),
      contentType: 'application/json',
    ));
    expect(created.status, 200);
    final after = (await school())['deadlines'] as List;
    expect([for (final item in after.cast<Map>()) '${item['kind']}: ${item['title']}'], ['Hausaufgabe: Atlas S. 24', 'Test: Stadtgeografie', 'Vortrag: Stadtklima', 'Klausur: Klimazonen']);

    final onDisk = await databaseFactoryFfi.openDatabase(p.join(folder.path, 'app.db'), options: OpenDatabaseOptions(readOnly: true, singleInstance: false));
    try {
      expect([for (final row in await onDisk.query('talks')) [row['title'], '${row['subject_id']}', row['notes'], row['time']]], [
        ['Stadtklima', '$subject', '10 Minuten', ''],
      ]);
      expect([for (final table in ['tests', 'exams', 'homework', 'grades']) (await onDisk.query(table)).single['id']], ['t-old', 'e-old', 'h-old', 'g-old']);
    } finally {
      await onDisk.close();
    }
  });
}
