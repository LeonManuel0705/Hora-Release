// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/iserv_plan.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_pages.dart';
import 'package:app/web_ui/ui_server.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

Uint8List _png(String content) => Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...utf8.encode(content)]);

UiPlanPage _page(String content) {
  final bytes = _png(content);
  return UiPlanPage(bytes, 'image/png', planDigest(bytes));
}

class _Host implements UiHost {
  UiPlan? answer;
  final asked = <bool>[];

  @override
  Future<UiPlan?> plan({bool fresh = false}) async {
    asked.add(fresh);
    return answer;
  }

  @override
  Future<Map<String, Object?>> connectIserv(String url, String user, String password) async => {'success': false};

  @override
  Future<void> disconnectIserv() async {}

  @override
  Map<String, Object?> iservStatus() => {'connected': false, 'has_credentials': false};

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
  late _Host host;

  setUpAll(() async {
    HttpOverrides.global = null;
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-plan-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg'});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  setUp(() => host = _Host());

  Future<UiReply> ask(String path, [Map<String, String> query = const {}]) => UiApi(host).handle(UiRequest(
        method: 'GET',
        segments: Uri.parse(path).pathSegments.skip(1).toList(),
        query: query,
        json: false,
        body: null,
      ));

  Map<String, Object?> body(UiReply reply) => (reply.body as Map).cast<String, Object?>();

  test('the plan lists its pages, each under an address that follows its content', () async {
    host.answer = UiPlan(pages: [_page('montag'), _page('dienstag')], cachedAt: DateTime(2026, 10, 12, 7, 5, 30));
    final first = body(await ask('/api/ui/vplan'));
    expect(first['success'], true);
    expect(first['cachedAt'], '2026-10-12T07:05');
    expect(first['problem'], isNull);
    final files = (first['files'] as List).cast<Map<String, Object?>>();
    expect([for (final file in files) (file['page'], file['type'])], [(1, 'image'), (2, 'image')]);
    expect(files[0]['url'], '/api/ui/vplan/datei/1?v=${planDigest(_png('montag'))}');

    host.answer = UiPlan(pages: [_page('montag'), _page('mittwoch')], cachedAt: DateTime(2026, 10, 12, 9));
    final later = (body(await ask('/api/ui/vplan'))['files'] as List).cast<Map<String, Object?>>();
    expect(later[0]['url'], files[0]['url']);
    expect(later[1]['url'], isNot(files[1]['url']));
    expect(host.asked, [false, false]);
  });

  test('a page comes back as the image it is', () async {
    host.answer = UiPlan(pages: [_page('montag'), _page('dienstag')]);
    final reply = await ask('/api/ui/vplan/datei/2');
    expect(reply.status, 200);
    expect(reply.bytes, _png('dienstag'));
    expect(reply.contentType, 'image/png');
    expect(reply.filename, 'vertretungsplan-2.png');
    for (final missing in ['/api/ui/vplan/datei/0', '/api/ui/vplan/datei/3', '/api/ui/vplan/datei/x', '/api/ui/vplan/datei']) {
      expect((await ask(missing)).status, 404, reason: missing);
    }
  });

  test('only a fresh fetch names why the plan is missing', () async {
    host.answer = const UiPlan(pages: [], cause: 'login');
    final fresh = body(await ask('/api/ui/vplan', {'frisch': '1'}));
    expect(fresh['problem'], 'login');
    expect(fresh['message'], contains('abgelaufen'));
    expect(fresh['files'], isEmpty);
    expect(fresh['cachedAt'], isNull);
    final cached = body(await ask('/api/ui/vplan'));
    expect(cached['problem'], isNull);
    expect(cached['message'], '');
    expect(host.asked, [true, false]);
  });

  test('the last plan stays visible while iserv cannot be reached', () async {
    host.answer = UiPlan(pages: [_page('montag')], cachedAt: DateTime(2026, 10, 9, 7, 39), cause: 'offline');
    final reply = body(await ask('/api/ui/vplan', {'frisch': '1'}));
    expect(reply['problem'], 'offline');
    expect((reply['files'] as List).length, 1);
    expect(reply['cachedAt'], '2026-10-09T07:39');
  });

  test('where no plan can be fetched the address does not exist', () async {
    host.answer = null;
    expect((await ask('/api/ui/vplan')).status, 404);
    expect((await ask('/api/ui/vplan/datei/1')).status, 404);
    expect((await UiApi(null).handle(UiRequest(method: 'GET', segments: ['ui', 'vplan'], query: const {}, json: false, body: null))).status, 404);
  });

  test('the device server sends a page with its type and keeps it out of caches', () async {
    host.answer = UiPlan(pages: [_page('montag')], cachedAt: DateTime(2026, 10, 12, 7, 5));
    final server = UiServer.instance;
    await server.start(host: host);
    final client = HttpClient();
    addTearDown(() => client.close(force: true));

    final login = await client.getUrl(server.entry('/hub/school'));
    login.followRedirects = false;
    final auth = await login.close();
    await auth.drain<void>();

    Future<HttpClientResponse> get(String path, {bool signedIn = true}) async {
      final request = await client.getUrl(Uri.parse('${server.origin}$path'));
      if (signedIn) request.cookies.addAll(auth.cookies);
      return request.close();
    }

    final listing = await get('/api/ui/vplan');
    final files = ((jsonDecode(await listing.transform(utf8.decoder).join()) as Map)['files'] as List).cast<Map<String, Object?>>();
    final image = await get('${files.single['url']}');
    final bytes = await image.fold<List<int>>([], (all, chunk) => all..addAll(chunk));
    expect(image.statusCode, HttpStatus.ok);
    expect(bytes, _png('montag'));
    expect(image.headers.value('content-type'), 'image/png');
    expect(image.headers.value('cache-control'), 'private, no-store');
    expect(image.headers.value('x-content-type-options'), 'nosniff');
    expect(image.headers.value('content-disposition'), 'inline; filename="vertretungsplan-1.png"');

    final stranger = await get('/api/ui/vplan/datei/1', signedIn: false);
    await stranger.drain<void>();
    expect(stranger.statusCode, HttpStatus.forbidden);
  });

  test('the browser bridge passes a page on as bytes', () async {
    host.answer = UiPlan(pages: [_page('montag')]);
    final bridge = UiBridge(api: UiApi(host), pages: UiPages(browser: true), openNative: (name) async => false);
    final reply = await bridge.handle(const UiBridgeRequest(method: 'GET', path: '/api/ui/vplan/datei/1'));
    expect(reply.status, 200);
    expect(reply.body, _png('montag'));
    expect(reply.headers['Content-Type'], 'image/png');
  });
}
