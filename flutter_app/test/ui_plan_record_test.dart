// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:app/web_ui/ui_pages.dart';
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
    folder = await Directory.systemTemp.createTemp('ui-plan-record-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg'});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  final bridge = UiBridge(api: UiApi(null), pages: UiPages(browser: true), openNative: (name) async => false);

  Future<Map<String, Object?>> pageJson(String id, [String path = '/hub/settings']) async {
    final reply = await bridge.handle(UiBridgeRequest(method: 'GET', path: path, navigate: true));
    final match = RegExp('<script type="application/json" id="$id">(.*?)</script>', dotAll: true).firstMatch(reply.body as String)!;
    return (jsonDecode(match.group(1)!) as Map).cast<String, Object?>();
  }

  UiRequest put(String key, Object? body) => UiRequest(method: 'PUT', segments: ['ui', 'store', key], query: const {}, json: true, body: body);

  test('the device id is made once and stays the same', () async {
    final db = await UiDb.open();
    final first = await UiDb.deviceId(db);
    expect(first, matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(await UiDb.deviceId(db), first);
    expect((await pageJson('appData'))['device'], first);
    expect((await pageJson('appData', '/hub'))['device'], first);
  });

  test('the device id is no stored value, so no backup carries it', () async {
    final db = await UiDb.open();
    final device = await UiDb.deviceId(db);
    expect((await UiDb.store(db)).containsKey(UiDb.deviceKey), isFalse);
    expect(jsonEncode(await pageJson('appStore')), isNot(contains(device)));
    final export = await UiApi(null).handle(UiRequest(method: 'GET', segments: ['ui', 'export'], query: const {}, json: false, body: null));
    expect(jsonEncode(export.body), isNot(contains(device)));
    expect((await UiApi(null).handle(put(UiDb.deviceKey, '0' * 32))).status, 404);
    expect(await UiDb.deviceId(db), device);
  });

  test('the plan record is stored like the plan and no page load writes one', () async {
    final db = await UiDb.open();
    await pageJson('appData', '/hub/school');
    expect((await UiDb.store(db)).containsKey('app-timetable-meta'), isFalse);
    const record = {'at': 1800000000000, 'origin': 'edit', 'device': '5e7c0f3a9b214d6e8a1f0c2b3d4e5f60', 'seen': 1800000000000};
    expect((await UiApi(null).handle(put('app-timetable-meta', record))).status, 200);
    expect((await UiDb.store(db))['app-timetable-meta'], record);
    expect((await pageJson('appStore'))['app-timetable-meta'], record);
  });

  test('the sync state is kept on the device like the record, and the export leaves it out', () async {
    final db = await UiDb.open();
    const state = {'account': 'acc-1', 'cursor': 3, 'latest': 3, 'entries': [], 'unreadable': []};
    expect((await UiApi(null).handle(put(UiDb.syncKey, state))).status, 200);
    expect((await UiDb.store(db))[UiDb.syncKey], state);
    expect((await pageJson('appStore'))[UiDb.syncKey], state);
    final export = await UiApi(null).handle(UiRequest(method: 'GET', segments: ['ui', 'export'], query: const {}, json: false, body: null));
    expect(jsonEncode(export.body), isNot(contains('acc-1')));
  });

  test('the account is kept on the device like the sync state, and the export leaves it out', () async {
    final db = await UiDb.open();
    final token = 't' * 43;
    final account = {'service': 'http://127.0.0.1:8794', 'token': token, 'account': {'id': 'acc-7', 'email': 'lina@example.org'}, 'known': true};
    expect((await UiApi(null).handle(put(UiDb.accountKey, account))).status, 200);
    expect((await UiDb.store(db))[UiDb.accountKey], account);
    expect((await pageJson('appStore'))[UiDb.accountKey], account);
    final export = await UiApi(null).handle(UiRequest(method: 'GET', segments: ['ui', 'export'], query: const {}, json: false, body: null));
    expect(jsonEncode(export.body), allOf(isNot(contains('acc-7')), isNot(contains(token))));
    final removed = await UiApi(null).handle(UiRequest(method: 'DELETE', segments: ['ui', 'store', UiDb.accountKey], query: const {}, json: false, body: null));
    expect(removed.status, 200);
    expect((await UiDb.store(db)).containsKey(UiDb.accountKey), isFalse);
  });

  test('the first name and the avatar are kept on the device like the account, and the export leaves them out', () async {
    final db = await UiDb.open();
    final profile = {'name': 'Lina Marie', 'avatar': 'musik', 'asked': true};
    expect((await UiApi(null).handle(put(UiDb.profileKey, profile))).status, 200);
    expect((await UiDb.store(db))[UiDb.profileKey], profile);
    expect((await pageJson('appStore'))[UiDb.profileKey], profile);
    final export = await UiApi(null).handle(UiRequest(method: 'GET', segments: ['ui', 'export'], query: const {}, json: false, body: null));
    expect(jsonEncode(export.body), isNot(contains('Lina Marie')));
    final removed = await UiApi(null).handle(UiRequest(method: 'DELETE', segments: ['ui', 'store', UiDb.profileKey], query: const {}, json: false, body: null));
    expect(removed.status, 200);
    expect((await UiDb.store(db)).containsKey(UiDb.profileKey), isFalse);
  });

  test('the account service comes only from the build and opens the page policy for it alone', () async {
    String connect(String policy) => RegExp('connect-src ([^;]+)').firstMatch(policy)!.group(1)!;
    expect(UiPages.accountService, isNull);
    expect(connect(UiPages.policy('n', framed: true)), "'self'");
    expect((await pageJson('appData')).containsKey('accountService'), isFalse);
    addTearDown(() => UiPages.accountService = null);
    UiPages.accountService = accountServiceOrigin('http://127.0.0.1:8794/');
    final reply = await bridge.handle(UiBridgeRequest(method: 'GET', path: '/hub', navigate: true));
    expect(connect(reply.headers['Content-Security-Policy']!), "'self' http://127.0.0.1:8794");
    expect(connect(UiPages.policy('n')), "'self' http://127.0.0.1:8794");
    expect((await pageJson('appData', '/hub'))['accountService'], 'http://127.0.0.1:8794');
    expect((await UiDb.store(await UiDb.open())).containsKey(UiDb.accountKey), isFalse, reason: 'a page load stores nothing');
    for (final value in ['', 'konto.example.org', 'ftp://konto.example.org', 'https://konto.example.org/api', 'https://a:b@konto.example.org', 'https://konto.example.org?q=1']) {
      expect(accountServiceOrigin(value), isNull, reason: value);
    }
    expect(accountServiceOrigin(' https://konto.example.org '), 'https://konto.example.org');
  });
}
