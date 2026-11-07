// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/site_icons.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:app/web_ui/ui_pages.dart';
import 'package:app/web_ui/ui_shell.dart';
import 'package:app/web_ui/web_start_script.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';
import 'site_icon_images.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  final opened = <String>[];
  final usual = siteIconLoader;

  setUpAll(() async {
    HttpOverrides.global = null;
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-bookmarks-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg'});
  });

  tearDown(() => siteIconLoader = usual);

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  UiBridge bridge() => UiBridge(
        api: UiApi(null),
        pages: UiPages(browser: true),
        openNative: (name) async {
          opened.add(name);
          return true;
        },
        startScript: webStartScript,
        assets: (key) async => Uint8List.fromList(utf8.encode('export const key = "$key";')),
      );

  Future<UiBridgeReply> api(UiBridge hub, String method, String path, [Object? body]) => hub.handle(UiBridgeRequest(
        method: method,
        path: path,
        body: body == null ? null : jsonEncode(body),
        contentType: body == null ? null : 'application/json',
      ));

  Map<String, Object?> json(UiBridgeReply reply) => (jsonDecode(reply.body as String) as Map).cast<String, Object?>();

  Future<List<Map>> shown(UiBridge hub) async {
    final reply = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/bookmarks', navigate: true, from: '/hub'));
    expect(reply.status, 200);
    final html = reply.body as String;
    expect(html, contains('data-page-module="bookmarks"'));
    final data = RegExp(r'<script type="application/json" id="appData">(.*?)</script>', dotAll: true).firstMatch(html)!.group(1)!;
    final page = (jsonDecode(data) as Map)['page'] as Map;
    return (page['bookmarks'] as List).cast<Map>();
  }

  test('the bookmarks page is the shared page now, while training and review keep their own screens', () async {
    opened.clear();
    expect(uiNativePages.containsKey('bookmarks'), isFalse);
    expect(uiNativePages.keys, containsAll(['training', 'review']));
    await shown(bridge());
    expect(opened, isEmpty);
  });

  test('a bookmark is added, changed and removed through the page api and lands in the same table', () async {
    final hub = bridge();
    final made = await api(hub, 'POST', '/api/hub/bookmarks', {'title': 'Schulportal', 'url': 'https://portal.example.org/', 'category': 'Work'});
    expect(made.status, 200);
    final link = json(made)['bookmark'] as Map;
    expect([link['title'], link['url'], link['category']], ['Schulportal', 'https://portal.example.org/', 'Work']);
    final onPage = (await shown(hub)).singleWhere((item) => item['id'] == link['id']);
    expect(onPage.containsKey('icon'), isTrue);

    final db = await UiDb.open();
    expect((await db.query('bookmarks', where: 'id = ?', whereArgs: [link['id']])).single['title'], 'Schulportal');

    final changed = await api(hub, 'PUT', '/api/hub/bookmarks/${link['id']}', {'title': 'Portal', 'url': 'https://portal.example.org/neu', 'category': 'Unbekannt'});
    expect(changed.status, 200);
    expect((json(changed)['bookmark'] as Map)['category'], 'Other');
    final listed = json(await api(hub, 'GET', '/api/hub/bookmarks'))['bookmarks'] as List;
    expect(listed.cast<Map>().singleWhere((item) => item['id'] == link['id'])['title'], 'Portal');

    final deleted = await api(hub, 'DELETE', '/api/hub/bookmarks/${link['id']}');
    final gone = json(deleted)['bookmark'] as Map;
    expect((await shown(hub)).where((item) => item['id'] == link['id']), isEmpty);
    final back = json(await api(hub, 'POST', '/api/hub/bookmarks', {
      'title': 'Portal',
      'url': 'https://portal.example.org/neu',
      'restore': {'id': gone['id'], 'created_at': gone['created_at'], 'favicon': gone['favicon']},
    }))['bookmark'] as Map;
    expect([back['id'], (await db.query('bookmarks', where: 'id = ?', whereArgs: [link['id']])).single['created_at']], [link['id'], gone['created_at']]);
    expect((await api(hub, 'DELETE', '/api/hub/bookmarks/${link['id']}')).status, 200);
    expect((await shown(hub)).where((item) => item['id'] == link['id']), isEmpty);
    expect((await api(hub, 'PUT', '/api/hub/bookmarks/${link['id']}', {'title': 'x', 'url': 'https://x.example/'})).status, 404);
  });

  test('only web addresses with a title are kept', () async {
    final hub = bridge();
    for (final body in [
      {'title': 'Böse', 'url': 'javascript:alert(1)'},
      {'title': 'Datei', 'url': 'file:///etc/passwd'},
      {'title': '', 'url': 'https://example.org/'},
      {'title': 'Ohne', 'url': ''},
    ]) {
      expect((await api(hub, 'POST', '/api/hub/bookmarks', body)).status, 400, reason: '$body');
    }
  });

  test('the logo comes from the site icon store and is missing honestly where there is none', () async {
    final hub = bridge();
    final link = json(await api(hub, 'POST', '/api/hub/bookmarks', {'title': 'Lexikon', 'url': 'https://lexikon.example.org/'}))['bookmark'] as Map;
    siteIconLoader = (url) async => url == 'https://lexikon.example.org/' ? iconImage('png') : null;
    final icon = await api(hub, 'GET', '/api/hub/bookmarks/${link['id']}/icon');
    expect(icon.status, 200);
    expect(icon.headers['Content-Type'], 'image/png');
    expect(icon.body, iconImage('png'));
    siteIconLoader = (url) async => null;
    final none = await api(hub, 'GET', '/api/hub/bookmarks/${link['id']}/icon');
    expect([none.status, none.body], [204, null]);
    expect((await api(hub, 'GET', '/api/hub/bookmarks/unbekannt/icon')).status, 404);
  });
}
