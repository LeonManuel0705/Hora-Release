// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/assistant/local_model/assistant_prompt.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_bridge.dart';
import 'package:app/web_ui/ui_db.dart';
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
  final opened = <String>[];
  final loaded = <String>[];

  setUpAll(() async {
    HttpOverrides.global = null;
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-bridge-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg'});
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  UiBridge bridge({bool known = true}) => UiBridge(
        api: UiApi(null),
        pages: UiPages(browser: true),
        openNative: (name) async {
          opened.add(name);
          return known;
        },
        startScript: webStartScript,
        assets: (key) async {
          loaded.add(key);
          if (key.endsWith('missing.js')) throw StateError('missing');
          return Uint8List.fromList(utf8.encode('export const key = "$key";'));
        },
      );

  Map<String, Object?> pageData(String html) {
    final match = RegExp(r'<script type="application/json" id="appData">(.*?)</script>', dotAll: true).firstMatch(html)!;
    return (jsonDecode(match.group(1)!) as Map).cast<String, Object?>();
  }

  Future<UiBridgeReply> api(UiBridge bridge, String method, String path, [Object? body]) => bridge.handle(UiBridgeRequest(
        method: method,
        path: path,
        body: body == null ? null : body is String ? body : jsonEncode(body),
        contentType: body == null ? null : 'application/json',
      ));

  test('a page is rendered with the web start script and a framable nonce policy', () async {
    final reply = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/tasks', navigate: true));
    expect(reply.status, 200);
    final policy = reply.headers['Content-Security-Policy']!;
    final nonce = RegExp("'nonce-([0-9a-f]{32})'").firstMatch(policy)!.group(1)!;
    expect(policy, contains("frame-ancestors 'self'"));
    expect(RegExp('script-src ([^;]+)').firstMatch(policy)!.group(1), "'self' 'nonce-$nonce'");
    final html = reply.body as String;
    expect(html, isNot(contains('__APP_')));
    expect(html, contains('root.dataset.shell = "web"'));
    final runnable = RegExp(r'<script\b[^>]*>').allMatches(html).map((match) => match[0]!).where((tag) => !tag.contains('type="application/json"'));
    for (final tag in runnable) {
      expect(tag, contains('nonce="$nonce"'));
    }
    expect(html.indexOf('root.dataset.shell'), lessThan(html.indexOf('<script type="module"')));
  });

  test('the settings page talks about the browser, not the device', () async {
    final reply = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/settings', navigate: true));
    final page = pageData(reply.body as String)['page'] as Map;
    expect(page['native'], isFalse);
  });

  test('no page offers Google, which this app cannot connect', () async {
    for (final path in ['/hub', '/hub/calendar', '/hub/settings']) {
      final data = pageData((await bridge().handle(UiBridgeRequest(method: 'GET', path: path, navigate: true))).body as String);
      expect((data['status'] as Map)['googleConfigured'], isFalse, reason: path);
    }
    final settings = pageData((await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/settings', navigate: true))).body as String);
    expect(((settings['page'] as Map)['accounts'] as Map)['google'], containsPair('unavailable', true));
  });

  test('native screens open in Flutter and keep the current page', () async {
    opened.clear();
    final assistant = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/assistant', navigate: true, from: '/hub/tasks'));
    expect(assistant.status, 204);
    expect(opened, ['assistant']);
    final classic = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/klassisch', navigate: true, from: '/hub'));
    expect(classic.status, 204);
    expect(opened, ['assistant']);
    final unknown = await bridge(known: false).handle(const UiBridgeRequest(method: 'GET', path: '/hub/unbekannt', navigate: true, from: '/hub'));
    expect(unknown.status, 404);
    final slash = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/', navigate: true));
    expect(slash.status, 303);
    expect(slash.headers['Location'], '/hub');
  });

  test('only the hub pages themselves can open a native screen', () async {
    opened.clear();
    for (final from in [null, '/pwa/', '/hubx', '/']) {
      final reply = await bridge().handle(UiBridgeRequest(method: 'GET', path: '/hub/assistant', navigate: true, from: from));
      expect(reply.status, 404, reason: '$from');
    }
    expect(opened, isEmpty);
    final page = await bridge().handle(const UiBridgeRequest(method: 'GET', path: '/hub/tasks', navigate: true));
    expect(page.headers['Referrer-Policy'], 'same-origin');
  });

  test('a task created through the bridge shows up on the next page load', () async {
    final hub = bridge();
    final created = await api(hub, 'POST', '/api/ui/tasks', {'title': 'Vektoren S. 38', 'date': null, 'minutes': 25});
    expect(created.status, 200);
    final task = (jsonDecode(created.body as String) as Map)['task'] as Map;
    expect(task['title'], 'Vektoren S. 38');
    final done = await api(hub, 'PATCH', '/api/ui/tasks/${Uri.encodeComponent('${task['id']}')}', {'done': true});
    expect(done.status, 200);
    final page = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/tasks', navigate: true));
    final tasks = (pageData(page.body as String)['tasks'] as List).cast<Map>();
    final saved = tasks.singleWhere((item) => item['id'] == task['id']);
    expect(saved['done'], isTrue);
  });

  test('a presentation is entered, changed and removed like a test', () async {
    final hub = bridge();
    const own = {'custom': true, 'name': 'Biologie', 'short': 'Bio', 'hue': 'jade', 'type': 'GK', 'teacher': '', 'room': ''};
    expect((await api(hub, 'PUT', '/api/ui/store/app-subjects', {'items': {'bio-own': own}, 'removed': []})).status, 200);
    Future<List<Map>> listed(String id) async {
      final page = pageData((await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/school', navigate: true))).body as String);
      return (page['deadlines'] as List).cast<Map>().where((item) => item['id'] == id).toList();
    }

    String day(int ahead) {
      final when = DateTime.now().add(Duration(days: ahead));
      return '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')}';
    }

    final created = await api(hub, 'POST', '/api/ui/deadlines', {'kind': 'Vortrag', 'title': 'Stadtklima', 'date': day(5), 'subject': 'bio-own', 'detail': '10 Minuten'});
    expect(created.status, 200);
    final talk = (jsonDecode(created.body as String) as Map)['deadline'] as Map;
    expect('${talk['id']}', startsWith('talk-'));
    expect([talk['kind'], talk['title'], talk['subject'], talk['date'], talk['detail'], talk['status']], ['Vortrag', 'Stadtklima', 'bio-own', day(5), '10 Minuten', 'offen']);
    expect(await listed('${talk['id']}'), [talk]);
    expect((await loadAssistantContext(DateTime.now())).deadlines, contains(startsWith('Vortrag: Stadtklima am ')));

    final changed = await api(hub, 'PATCH', '/api/ui/deadlines/${talk['id']}', {'title': 'Stadtgrün', 'date': day(8), 'detail': '', 'time': '9:50'});
    expect(changed.status, 200);
    final shown = (await listed('${talk['id']}')).single;
    expect([shown['kind'], shown['title'], shown['date'], shown['detail'], shown['time']], ['Vortrag', 'Stadtgrün', day(8), '', '09:50']);

    final db = await UiDb.open();
    expect(await db.query('talks', columns: ['title'], where: 'id = ?', whereArgs: ['${talk['id']}'.substring(5)]), [{'title': 'Stadtgrün'}]);
    for (final table in ['tests', 'exams', 'homework']) {
      expect(await db.query(table, where: 'title = ?', whereArgs: ['Stadtgrün']), isEmpty, reason: table);
    }

    expect((await api(hub, 'DELETE', '/api/ui/deadlines/${talk['id']}')).status, 200);
    expect((await api(hub, 'DELETE', '/api/ui/deadlines/${talk['id']}')).status, 404);
    expect(await listed('${talk['id']}'), isEmpty);
    for (final word in ['Referat', 'vortrag', 'talk', null]) {
      expect((await api(hub, 'POST', '/api/ui/deadlines', {'kind': word, 'title': 'Falsches Wort', 'date': day(5)})).status, 400, reason: '$word');
    }
  });

  test('a grade can be marked as a presentation, and one the older screens call Referat is shown as one', () async {
    final hub = bridge();
    const own = {'custom': true, 'name': 'Biologie', 'short': 'Bio', 'hue': 'jade', 'type': 'GK', 'teacher': '', 'room': ''};
    expect((await api(hub, 'PUT', '/api/ui/store/app-subjects', {'items': {'bio-own': own}, 'removed': []})).status, 200);
    Future<Map> school() async =>
        pageData((await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/school', navigate: true))).body as String)['page'] as Map;
    final semester = (await school())['semester'];
    final made = await api(hub, 'POST', '/api/ui/grades', {'subject': 'bio-own', 'points': 13, 'type': 'vortrag', 'semester': semester, 'title': 'Stadtklima'});
    expect(made.status, 200);
    final grade = (jsonDecode(made.body as String) as Map)['grade'] as Map;
    expect(grade['type'], 'vortrag');
    final db = await UiDb.open();
    final stamp = DateTime.now().toIso8601String();
    expect((await db.query('grades', where: 'id = ?', whereArgs: ['${grade['id']}'.substring(2)])).single['type'], 'Vortrag');
    await db.insert('grades', {'id': 'older-screen', 'subject_id': 'bio-own', 'semester': semester, 'type': 'Referat', 'points': 11, 'grade_system': 'points', 'date': stamp, 'created_at': stamp});
    await db.insert('grades', {'id': 'older-other', 'subject_id': 'bio-own', 'semester': semester, 'type': 'Hausarbeit', 'points': 9, 'grade_system': 'points', 'date': stamp, 'created_at': stamp});
    final types = {for (final item in ((await school())['grades'] as List).cast<Map>()) item['id']: item['type']};
    expect(types[grade['id']], 'vortrag');
    expect(types['g-older-screen'], 'vortrag');
    expect(types['g-older-other'], 'sonstiges');
  });

  test('stored settings are read back into the next page', () async {
    final hub = bridge();
    final saved = await api(hub, 'PUT', '/api/ui/store/app-task-filter', '"woche"');
    expect(saved.status, 200);
    final page = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/tasks', navigate: true));
    final store = RegExp(r'<script type="application/json" id="appStore">(.*?)</script>', dotAll: true).firstMatch(page.body as String)!;
    expect((jsonDecode(store.group(1)!) as Map)['app-task-filter'], 'woche');
  });

  test('a subject made in the settings keeps its grades, tests and tasks', () async {
    final hub = bridge();
    const own = {'custom': true, 'name': 'Geografie', 'short': 'Geo', 'hue': 'moss', 'type': 'GK', 'teacher': '', 'room': ''};
    final stored = await api(hub, 'PUT', '/api/ui/store/app-subjects', {
      'items': {'geo-own': own, 'geo-gone': own},
      'removed': ['geo-gone'],
    });
    expect(stored.status, 200);
    Future<Map<String, Object?>> school() async =>
        pageData((await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/school', navigate: true))).body as String);
    final semester = ((await school())['page'] as Map)['semester'];
    final grade = await api(hub, 'POST', '/api/ui/grades', {'subject': 'geo-own', 'points': 11, 'type': 'test', 'semester': semester, 'title': 'Klimazonen'});
    expect(grade.status, 200);
    final gradeId = ((jsonDecode(grade.body as String) as Map)['grade'] as Map)['id'];
    final when = DateTime.now().add(const Duration(days: 4));
    final day = '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')}';
    final test = await api(hub, 'POST', '/api/ui/deadlines', {'kind': 'Test', 'title': 'Stadtgeografie', 'date': day, 'subject': 'geo-own'});
    expect(((jsonDecode(test.body as String) as Map)['deadline'] as Map)['subject'], 'geo-own');
    final task = await api(hub, 'POST', '/api/ui/tasks', {'title': 'Karte beschriften', 'subject': 'geo-own'});
    expect(((jsonDecode(task.body as String) as Map)['task'] as Map)['subject'], 'geo-own');
    final page = await school();
    final grades = ((page['page'] as Map)['grades'] as List).cast<Map>();
    expect(grades.where((item) => item['id'] == gradeId && item['subject'] == 'geo-own'), hasLength(1));
    final deadlines = (page['deadlines'] as List).cast<Map>();
    expect(deadlines.where((item) => item['title'] == 'Stadtgeografie' && item['subject'] == 'geo-own'), hasLength(1));
    expect((await api(hub, 'POST', '/api/ui/grades', {'subject': 'geo-gone', 'points': 9})).status, 400);
    expect((await api(hub, 'POST', '/api/ui/grades', {'subject': 'nirgends', 'points': 9})).status, 400);
  });

  test('the test form takes no more text than is kept', () async {
    final source = File('assets/ui/static/app/js/pages/school.js').readAsStringSync();
    final limits = RegExp(r'const TEXT_LIMITS = \{ title: (\d+), detail: (\d+) \};').firstMatch(source)!;
    final title = int.parse(limits.group(1)!), detail = int.parse(limits.group(2)!);
    final hub = bridge();
    final when = DateTime.now().add(const Duration(days: 3));
    final day = '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')}';
    for (final kind in ['Test', 'Klausur', 'Vortrag', 'Hausaufgabe']) {
      final created = await api(hub, 'POST', '/api/ui/deadlines', {'kind': kind, 'title': 'T' * title, 'date': day, 'detail': 'D' * detail});
      final saved = (jsonDecode(created.body as String) as Map)['deadline'] as Map;
      expect([(saved['title'] as String).length, (saved['detail'] as String).length], [title, detail], reason: kind);
      final edited = await api(hub, 'PATCH', '/api/ui/deadlines/${Uri.encodeComponent('${saved['id']}')}', {'title': 'U' * title, 'detail': 'E' * detail});
      final changed = (jsonDecode(edited.body as String) as Map)['deadline'] as Map;
      expect([(changed['title'] as String).length, (changed['detail'] as String).length], [title, detail], reason: kind);
    }
  });

  test('the task form takes no more text than is kept and a task keeps what the form gives it', () async {
    final source = File('assets/ui/static/app/js/tasks.js').readAsStringSync();
    final limits = RegExp(r'const TASK_LIMITS = \{ title: (\d+), notes: (\d+) \};').firstMatch(source)!;
    final title = int.parse(limits.group(1)!), notes = int.parse(limits.group(2)!);
    final hub = bridge();
    final created = await api(hub, 'POST', '/api/ui/tasks', {'title': 'T' * title, 'notes': 'N' * notes, 'date': null, 'someday': true, 'priority': true, 'repeat': 'weekly', 'minutes': 20, 'source': 'own', 'done': false});
    expect(created.status, 200);
    final saved = (jsonDecode(created.body as String) as Map)['task'] as Map;
    expect([(saved['title'] as String).length, (saved['notes'] as String).length], [title, notes]);
    expect([saved['someday'], saved['date'], saved['priority'], saved['repeat']], [true, null, true, 'weekly']);
    final edited = await api(hub, 'PATCH', '/api/ui/tasks/${Uri.encodeComponent('${saved['id']}')}', {'title': 'U' * title, 'notes': 'M' * notes});
    final changed = (jsonDecode(edited.body as String) as Map)['task'] as Map;
    expect([(changed['title'] as String).length, (changed['notes'] as String).length], [title, notes]);
  });

  test('broken or oversized requests are refused like on the device server', () async {
    final hub = bridge();
    final invalid = await api(hub, 'POST', '/api/ui/tasks', '{"title": ');
    expect(invalid.status, 400);
    expect(jsonDecode(invalid.body as String), {'success': false, 'error': 'Ungültiges JSON'});
    final large = await api(hub, 'POST', '/api/ui/notes', 'x' * (UiBridge.maxBody + 1));
    expect(large.status, 413);
    final unknown = await api(hub, 'GET', '/api/nirgends');
    expect(unknown.status, 404);
    final other = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/sonstwo'));
    expect(other.status, 404);
  });

  test('a page that cannot be built says so instead of showing raw data', () async {
    final hub = UiBridge(api: UiApi(null), pages: _UnbuiltPages(), openNative: (_) async => false, startScript: webStartScript);
    final reply = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/calendar', navigate: true));
    expect(reply.status, 503);
    expect(reply.headers['Content-Type'], startsWith('text/html'));
    expect(reply.body, contains('Diese Seite ließ sich gerade nicht laden.'));
    expect(reply.body, isNot(contains('success')));
    final exported = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/api/ui/export'));
    expect(exported.headers['Content-Type'], startsWith('application/json'));
  });

  test('static files come from the bundle once and never from outside it', () async {
    loaded.clear();
    final hub = bridge();
    final first = await hub.handle(const UiBridgeRequest(method: 'GET', path: '/static/app/js/main.js', query: '?v=1'));
    expect(first.status, 200);
    expect(first.headers['Content-Type'], startsWith('text/javascript'));
    expect(utf8.decode(first.body as Uint8List), contains('assets/ui/static/app/js/main.js'));
    await hub.handle(const UiBridgeRequest(method: 'GET', path: '/static/app/js/main.js'));
    expect(loaded, ['assets/ui/static/app/js/main.js']);
    for (final path in ['/static/../pubspec.yaml', '/static/', '/static//etc/passwd']) {
      expect((await hub.handle(UiBridgeRequest(method: 'GET', path: path))).status, 404, reason: path);
    }
    expect((await hub.handle(const UiBridgeRequest(method: 'POST', path: '/static/app/js/main.js'))).status, 404);
    expect((await hub.handle(const UiBridgeRequest(method: 'GET', path: '/static/missing.js'))).status, 404);
  });

  test('a backup holds what the pages no longer show', () async {
    final hub = bridge();
    const own = {'custom': true, 'name': 'Physik', 'short': 'Phy', 'hue': 'iris', 'type': 'GK', 'teacher': '', 'room': ''};
    expect((await api(hub, 'PUT', '/api/ui/store/app-subjects', {'items': {'phy-own': own}, 'removed': []})).status, 200);
    Map made(UiBridgeReply reply, String name) => (jsonDecode(reply.body as String) as Map)[name] as Map;
    final grade = made(await api(hub, 'POST', '/api/ui/grades', {'subject': 'phy-own', 'points': 7, 'type': 'klausur', 'semester': 'Q1', 'date': '2025-03-04', 'title': 'Optik'}), 'grade');
    final written = made(await api(hub, 'POST', '/api/ui/deadlines', {'kind': 'Klausur', 'title': 'Mechanik', 'subject': 'phy-own', 'date': '2025-03-11', 'detail': 'Kapitel 4', 'time': '08:00'}), 'deadline');
    final homework = made(await api(hub, 'POST', '/api/ui/deadlines', {'kind': 'Hausaufgabe', 'title': 'Blatt 3', 'date': '2025-03-12', 'status': 'abgegeben'}), 'deadline');
    final task = made(await api(hub, 'POST', '/api/ui/tasks', {'title': 'Protokoll abgeben', 'subject': 'phy-own', 'date': '2025-03-13'}), 'task');
    final event = made(await api(hub, 'POST', '/api/ui/events', {'title': 'Exkursion', 'date': '2025-03-14', 'start': '09:00', 'place': 'Sternwarte', 'kind': 'school'}), 'event');
    expect((await api(hub, 'POST', '/api/ui/notes', {'title': 'Frage für Ben', 'details': 'Brennweite', 'type': 'idea'})).status, 200);
    expect((await api(hub, 'PUT', '/api/ui/places/home', {'name': 'Hauptstraße 1', 'area': '12345 Musterstadt', 'lat': 52.5, 'lon': 13.4, 'stop': ''})).status, 200);

    final school = pageData((await hub.handle(const UiBridgeRequest(method: 'GET', path: '/hub/school', navigate: true))).body as String);
    expect((school['deadlines'] as List).where((item) => (item as Map)['id'] == written['id']), isEmpty);
    expect(((school['page'] as Map)['grades'] as List).where((item) => (item as Map)['id'] == grade['id']), isEmpty);

    final reply = await api(hub, 'GET', '/api/ui/export');
    expect(reply.status, 200);
    final data = (jsonDecode(reply.body as String) as Map)['data'] as Map;
    Map one(String kind, Object? id) => (data[kind] as List).cast<Map>().singleWhere((item) => item['id'] == id);
    expect(one('grades', grade['id']), grade);
    expect(one('deadlines', written['id']), containsPair('time', '08:00'));
    expect(one('deadlines', written['id']), containsPair('subject', 'phy-own'));
    expect(one('deadlines', homework['id']), containsPair('status', 'abgegeben'));
    expect(one('tasks', task['id']), containsPair('date', '2025-03-13'));
    expect(one('events', event['id']), containsPair('place', 'Sternwarte'));
    final note = (data['notes'] as List).cast<Map>().singleWhere((item) => item['title'] == 'Frage für Ben');
    expect(note, containsPair('details', 'Brennweite'));
    expect(note, containsPair('type', 'idea'));
    expect(data['places'], {
      'home': {'name': 'Hauptstraße 1, 12345 Musterstadt', 'area': '', 'lat': 52.5, 'lon': 13.4, 'stop': ''},
    });
  });

  test('worker messages become bridge requests', () {
    final request = UiBridgeRequest.fromMessage({
      'type': 'hub-request',
      'navigate': true,
      'method': 'get',
      'path': '/hub/school',
      'query': '?datum=2026-09-28&t=10:15',
      'from': '/hub',
      'body': null,
      'contentType': null,
    });
    expect(request.method, 'GET');
    expect(request.navigate, isTrue);
    expect(request.fromHub, isTrue);
    expect(request.parameters, {'datum': '2026-09-28', 't': '10:15'});
  });

  test('the start script cannot end the script block it is placed in', () {
    expect(webStartScript.toLowerCase(), isNot(contains('</script')));
    final html = UiPages.withStartScript('<html><head>\n<meta charset="utf-8"><title>x</title></head></html>', 'abc', 'go();');
    expect(html, '<html><head>\n<meta charset="utf-8"><script nonce="abc">go();</script><title>x</title></head></html>');
  });
}

class _UnbuiltPages extends UiPages {
  _UnbuiltPages() : super(browser: true);

  @override
  Future<String> render(String page, {required String nonce, String? day, String? startScript}) =>
      Future.error(StateError('offline'));
}
