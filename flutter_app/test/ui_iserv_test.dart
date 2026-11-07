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

class _Host implements UiHost, UiIservSync {
  _Host(this.db);

  final Database db;
  int syncs = 0;
  bool bringsHomework = true;

  @override
  Future<void> syncIserv() async {
    syncs++;
    if (!bringsHomework) return;
    final due = DateTime.now().add(const Duration(days: 2));
    await db.insert('iserv_exercises', {
      'id': '41',
      'title': 'Analysis Blatt 3',
      'course': 'Mathematik',
      'due_date': due.toIso8601String(),
      'status': 'open',
      'cached_at': DateTime.now().add(Duration(microseconds: syncs)).toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<UiPlan?> plan({bool fresh = false}) async => UiPlan(pages: const <UiPlanPage>[], cachedAt: DateTime.now(), cause: 'empty');

  @override
  Future<Map<String, Object?>> connectIserv(String url, String user, String password) async => {'success': true};

  @override
  Future<void> disconnectIserv() async {}

  @override
  Map<String, Object?> iservStatus() => {'connected': true};

  @override
  Future<int> changeState(String name) async => 0;

  @override
  Future<void> themeChoice(String? choice) async {}

  @override
  void dataChanged(String area) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-iserv-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<Database> clean({bool account = false}) async {
    final db = await UiDb.open();
    for (final table in const ['iserv_credentials', 'iserv_exercises', 'iserv_events', 'iserv_notifications', 'vertretungsplan_cache']) {
      await db.delete(table);
    }
    if (account) {
      await db.insert('iserv_credentials', {'id': 1, 'username': 'ben.k', 'iserv_url': 'https://iserv.schule.de', 'credential_key': 'k', 'created_at': DateTime.now().toIso8601String()});
    }
    return db;
  }

  Future<Map<String, Object?>> status(Database db, {bool browser = false}) async {
    final data = UiData(db, await SharedPreferences.getInstance(), DateTime(2026, 11, 6, 10, 40), browser: browser);
    return (await data.build('home', {}))['status'] as Map<String, Object?>;
  }

  UiRequest post(String action) => UiRequest(method: 'POST', segments: ['ui', 'iserv', action], query: const {}, json: true, body: const <String, Object?>{});

  test('without IServ the phone claims no sync, and the web app says it has no IServ at all', () async {
    final db = await clean();
    final phone = await status(db);
    expect(phone['iserv'], isFalse);
    expect(phone['iservAvailable'], isTrue);
    expect(phone['synced'], {'iserv': null, 'google': null});
    expect(phone['rendered'], '2026-11-06T10:40');
    final web = await status(db, browser: true);
    expect(web['iservAvailable'], isFalse);
    expect(web['synced'], {'iserv': null, 'google': null});
  });

  test('the stand is the newest copy IServ gave, and the plan and the homework are named', () async {
    final db = await clean(account: true);
    expect((await status(db))['synced'], {'iserv': null, 'google': null});
    await db.insert('vertretungsplan_cache', {'data_base64': '', 'page': 1, 'fetched_at': '2026-11-06T07:36:12.000'});
    await db.insert('iserv_events', {'id': 'e1', 'title': 'Elternabend', 'cached_at': '2026-11-06T09:15:00.000'});
    final shown = await status(db);
    expect(shown['iserv'], isTrue);
    expect(shown['synced'], {'iserv': '2026-11-06T09:15', 'google': null});
    expect(shown['iservParts'], {'plan': '2026-11-06T07:36', 'mail': null, 'homework': null});
  });

  test('fetching the homework now asks the phone host and lists what came', () async {
    final db = await clean(account: true);
    final host = _Host(db);
    final api = UiApi(host);
    final reply = await api.handle(post('homework'));
    expect(reply.status, 200);
    final body = reply.body as Map;
    expect(host.syncs, 1);
    expect(body['ok'], isTrue);
    expect(body['count'], 1);
    expect([for (final item in body['deadlines'] as List) (item as Map)['id']], ['hw-iserv.41']);
    expect(((body['status'] as Map)['iservParts'] as Map)['homework'], isNotNull);

    host.bringsHomework = false;
    final again = (await api.handle(post('homework'))).body as Map;
    expect(again['ok'], isFalse);
    expect(again['message'], 'Von IServ kamen keine neuen Hausaufgaben.');
    expect(again['count'], 1);

    final sync = (await api.handle(post('sync'))).body as Map;
    expect((sync['parts'] as Map).keys, unorderedEquals(['plan', 'homework']));
    expect(((sync['parts'] as Map)['plan'] as Map)['problem'], 'empty');
  });

  test('without an account or a host that can sync nothing is fetched', () async {
    final db = await clean();
    final host = _Host(db);
    expect((await UiApi(host).handle(post('homework'))).status, 409);
    expect(host.syncs, 0);
    await clean(account: true);
    expect((await UiApi(null).handle(post('homework'))).status, 409);
  });
}
