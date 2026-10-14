// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:app/services/iserv_plan.dart';
import 'package:app/services/iserv_session.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List _file(List<int> magic, [int size = 4000]) => Uint8List.fromList([...magic, ...List<int>.filled(size, 48)]);

final _png = _file(const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
final _jpeg = _file(const [0xff, 0xd8, 0xff, 0xe0]);

class _School {
  _School(this.server) {
    server.listen(_answer);
  }

  final HttpServer server;
  final requested = <String>[];
  String password = 'geheim';
  String? handoff;
  String wanted = '/iserv/';
  String show = '<img src="/iserv/assets/infodisplay/img/infodisplay.svg">'
      '<img src="/iserv/infodisplay/pdf/17/1/0?1&amp;x=2"><img src="/iserv/infodisplay/pdf/17/2/0"><img src="/iserv/infodisplay/pdf/17/3/0">';

  Uri get origin => Uri.parse('http://127.0.0.1:${server.port}');

  static Future<_School> start() async => _School(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  String get _form => '<form method="post"><input type="hidden" name="_token" value="t1">'
      '<input name="_username"><input type="password" name="_password"></form>';

  bool _has(HttpRequest request, String name) => request.cookies.any((cookie) => cookie.name == name && cookie.value == 'yes');

  void _html(HttpRequest request, String body, [int status = 200]) {
    request.response
      ..statusCode = status
      ..headers.set('Content-Type', 'text/html; charset=UTF-8')
      ..write(body);
  }

  void _redirect(HttpRequest request, String target) {
    request.response
      ..statusCode = HttpStatus.found
      ..headers.set('Location', target);
  }

  Future<void> _answer(HttpRequest request) async {
    final path = request.uri.path;
    requested.add('${request.method} $path');
    if (path == '/iserv/auth/login' && request.method == 'POST') {
      final fields = Uri.splitQueryString(await utf8.decoder.bind(request).join());
      if (fields['_username'] == 'lea' && fields['_password'] == password && fields['_token'] == 't1') {
        request.response.cookies.add(Cookie('IServAuthSession', 'yes')..path = '/iserv/auth');
        _redirect(request, '/iserv/auth/home');
      } else {
        _html(request, '<p>Anmeldung fehlgeschlagen</p>$_form');
      }
    } else if (path == '/iserv/auth/login') {
      _html(request, _form);
    } else if (path.startsWith('/iserv/auth/')) {
      if (!_has(request, 'IServAuthSession')) {
        _redirect(request, '/iserv/auth/login');
      } else {
        final target = handoff ?? '0;url=$origin/iserv/app/authentication/redirect?state=abc&code=xyz';
        _html(request, '<html><head><meta http-equiv="refresh" content="${const HtmlEscape(HtmlEscapeMode.attribute).convert(target)}"></head>'
            '<body>Sie werden weitergeleitet.</body></html>');
      }
    } else if (path == '/iserv/app/authentication/redirect') {
      request.response.cookies.add(Cookie('IServSession', 'yes')..path = '/');
      _redirect(request, wanted);
    } else if (!_has(request, 'IServSession')) {
      wanted = request.uri.toString();
      _redirect(request, '/iserv/auth/auth?state=abc');
    } else if (path == '/iserv/') {
      _html(request, '<h1>Start</h1>');
    } else if (path == '/iserv/infodisplay/show/3') {
      _html(request, show);
    } else if (path == '/iserv/infodisplay/pdf/17/1/0' || path == '/iserv/infodisplay/pdf/17/2/0') {
      final first = path.contains('/1/0');
      request.response
        ..headers.set('Content-Type', 'image/png')
        ..add(first ? _png : _jpeg);
    } else if (path == '/iserv/infodisplay/pdf/17/3/0') {
      request.response
        ..headers.set('Content-Type', 'image/png')
        ..add(_png);
    } else {
      _html(request, '<h1>Nicht gefunden</h1>', HttpStatus.notFound);
    }
    await request.response.close();
  }
}

IServSession _session(Uri origin) {
  final dio = Dio(BaseOptions(baseUrl: origin.toString(), followRedirects: false, validateStatus: (status) => status != null && status < 500));
  dio.interceptors.add(CookieManager(CookieJar()));
  return IServSession(dio, origin);
}

IServPage _page(String path, String body, {int status = 200, String type = 'text/html; charset=UTF-8'}) =>
    IServPage(Uri.parse('https://iserv.schule.de$path'), status, type, Uint8List.fromList(utf8.encode(body)));

void main() {
  late _School school;

  setUp(() async {
    HttpOverrides.global = null;
    school = await _School.start();
  });

  tearDown(() => school.server.close(force: true));

  test('signing in passes the page that forwards by meta refresh', () async {
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.entered);
    expect(school.requested, [
      'GET /iserv/auth/login',
      'POST /iserv/auth/login',
      'GET /iserv/',
      'GET /iserv/auth/auth',
      'GET /iserv/app/authentication/redirect',
      'GET /iserv/',
    ]);
  });

  test('a password the school refuses is not taken for a sign-in', () async {
    expect(await _session(school.origin).signIn('lea', 'falsch'), IServSignIn.refused);
  });

  test('a sign-in page that leads nowhere is not taken for a sign-in', () async {
    school.handoff = '30';
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.stuck);
  });

  test('a refresh that leaves the school is never requested', () async {
    final other = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var visits = 0;
    other.listen((request) {
      visits++;
      request.response.close();
    });
    addTearDown(() => other.close(force: true));
    for (final target in [
      'http://127.0.0.1:${other.port}/iserv/app/authentication/redirect?code=xyz',
      'http://localhost:${school.server.port}/iserv/app/authentication/redirect?code=xyz',
      'http://lea@127.0.0.1:${school.server.port}/iserv/app/authentication/redirect',
      'http://127.0.0.1:${other.port}\\@127.0.0.1:${school.server.port}/iserv/',
    ]) {
      school
        ..handoff = '0;url=$target'
        ..requested.clear();
      expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.stuck, reason: target);
      expect(school.requested, isNot(contains('GET /iserv/app/authentication/redirect')), reason: target);
    }
    expect(visits, 0);
  });

  test('the refresh target is read in the ways browsers accept', () {
    const target = 'https://iserv.schule.de/iserv/app/authentication/redirect?state=abc&code=xyz';
    for (final content in ['0;url=$target', '0; URL=$target', "0;url='$target'", '0;$target']) {
      final page = _page('/iserv/auth/auth', '<meta http-equiv="Refresh" content="${content.replaceAll('&', '&amp;')}">');
      expect(IServSession.handoffTarget(page), target, reason: content);
    }
  });

  test('only the sign-in forwards, a page inside iserv that reloads itself does not', () {
    const reload = '<meta http-equiv="refresh" content="60;url=/iserv/infodisplay/show/3">';
    expect(IServSession.handoffTarget(_page('/iserv/infodisplay/show/3', reload)), isNull);
    expect(IServSession.handoffTarget(_page('/iserv/auth/auth', reload, status: 500)), isNull);
    expect(IServSession.handoffTarget(_page('/iserv/auth/auth', reload, type: 'application/json')), isNull);
    expect(IServSession.handoffTarget(_page('/iserv/auth/auth', '<meta http-equiv="refresh" content="30">')), isNull);
  });

  test('the plan pages are fetched once signed in, in the order of the page', () async {
    final session = _session(school.origin);
    await session.signIn('lea', 'geheim');
    final plan = await fetchIServPlan(session);
    expect(plan.state, IServPlanState.found);
    expect([for (final file in plan.files) file.contentType], ['image/png', 'image/jpeg']);
    expect(plan.files.first.bytes, _png);
  });

  test('a plan request that ends at the login counts as an expired session', () async {
    expect((await fetchIServPlan(_session(school.origin))).state, IServPlanState.expired);
  });

  test('a display without pages is empty, not broken', () async {
    final session = _session(school.origin);
    await session.signIn('lea', 'geheim');
    school.show = '<p>Zurzeit keine Inhalte</p>';
    expect((await fetchIServPlan(session)).state, IServPlanState.empty);
  });

  test('plan addresses are resolved against the display and kept inside it', () {
    final page = Uri.parse('https://iserv.schule.de/iserv/infodisplay/show/3');
    final links = planLinks(
      '<img src="/iserv/infodisplay/pdf/17/1/0?a=1&amp;b=2"><img src="pdf/17/2/0"><img src="data:image/png;base64,AAAA">'
      '<iframe src="/iserv/infodisplay/show/4"></iframe><img src="/iserv/assets/infodisplay/img/infodisplay.svg">'
      '<script>var next = "/iserv/infodisplay/file/9/1";</script>',
      page,
      3,
    );
    expect(links, [
      'https://iserv.schule.de/iserv/infodisplay/pdf/17/1/0?a=1&b=2',
      'https://iserv.schule.de/iserv/infodisplay/file/9/1',
      for (var index = 1; index <= 6; index++) 'https://iserv.schule.de/iserv/infodisplay/file/3/$index',
    ]);
    final many = planLinks([for (var index = 0; index < 40; index++) '<img src="/iserv/infodisplay/pdf/1/$index/0">'].join(), page, 3);
    expect(many.length, 12);
  });

  test('a plan file is told by its first bytes, whatever the server calls it', () {
    expect(planContentType(_png), 'image/png');
    expect(planContentType(_jpeg), 'image/jpeg');
    expect(planContentType(utf8.encode('%PDF-1.7 ...')), 'application/pdf');
    expect(planContentType(utf8.encode('GIF89a....')), 'image/gif');
    expect(planContentType([...utf8.encode('RIFF'), 0, 0, 0, 0, ...utf8.encode('WEBPVP8 ')]), 'image/webp');
    expect(planContentType(utf8.encode('<svg onload="alert(1)">')), isNull);
    expect(planContentType(utf8.encode('<!doctype html>')), isNull);
  });
}
