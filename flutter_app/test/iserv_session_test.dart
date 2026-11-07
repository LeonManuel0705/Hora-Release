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
  String session = 'yes';
  String signedIn = 'yes';
  int hops = 0;
  bool loop = false;
  String? codePath;
  String codeForm = '<form method="post"><input type="hidden" name="_token" value="t2">'
      '<input name="_auth_code" autocomplete="one-time-code" inputmode="numeric"><button>Bestätigen</button></form>';
  String? sso;
  String show = '<img src="/iserv/assets/infodisplay/img/infodisplay.svg">'
      '<img src="/iserv/infodisplay/pdf/17/1/0?1&amp;x=2"><img src="/iserv/infodisplay/pdf/17/2/0"><img src="/iserv/infodisplay/pdf/17/3/0">';

  Uri get origin => Uri.parse('http://127.0.0.1:${server.port}');

  static Future<_School> start() async => _School(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  String get _form => '<form method="post"><input type="hidden" name="_token" value="t1">'
      '<input name="_username"><input type="password" name="_password"></form>';

  bool _has(HttpRequest request, String name, [String value = 'yes']) => request.cookies.any((cookie) => cookie.name == name && cookie.value == value);

  void forget() {
    session = 'app-${requested.length}';
    signedIn = 'auth-${requested.length}';
  }

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
    if (sso != null && path == '/iserv/auth/login') {
      _redirect(request, sso!);
    } else if (path == '/iserv/auth/login' && request.method == 'POST') {
      final fields = Uri.splitQueryString(await utf8.decoder.bind(request).join());
      if (fields['_username'] == 'lea' && fields['_password'] == password && fields['_token'] == 't1') {
        request.response.cookies.add(Cookie('IServAuthSession', codePath == null ? signedIn : 'partial')..path = '/iserv/auth');
        _redirect(request, '/iserv/auth/home');
      } else {
        _html(request, '<p>Anmeldung fehlgeschlagen!</p>$_form');
      }
    } else if (path == '/iserv/auth/login') {
      _html(request, _form);
    } else if (codePath != null && _has(request, 'IServAuthSession', 'partial') && path.startsWith('/iserv/auth/')) {
      if (path == codePath) {
        _html(request, codeForm);
      } else {
        _redirect(request, codePath!);
      }
    } else if (path.startsWith('/iserv/auth/')) {
      final hop = path.startsWith('/iserv/auth/hop/') ? int.parse(path.substring(16)) : 0;
      if (!_has(request, 'IServAuthSession', signedIn)) {
        _redirect(request, '/iserv/auth/login');
      } else if (loop && path == '/iserv/auth/auth') {
        _redirect(request, '$origin/iserv/auth/hop/1');
      } else if (loop) {
        _redirect(request, '/iserv/auth/auth?state=abc');
      } else if (hop < hops && (path == '/iserv/auth/auth' || hop > 0)) {
        _redirect(request, hop.isEven ? '/iserv/auth/hop/${hop + 1}' : '$origin/iserv/auth/hop/${hop + 1}');
      } else {
        final target = handoff ?? '0;url=$origin/iserv/app/authentication/redirect?state=abc&code=xyz';
        _html(request, '<html><head><meta http-equiv="refresh" content="${const HtmlEscape(HtmlEscapeMode.attribute).convert(target)}"></head>'
            '<body>Sie werden weitergeleitet.</body></html>');
      }
    } else if (path == '/iserv/app/authentication/redirect') {
      request.response.cookies.add(Cookie('IServSession', session)..path = '/');
      _redirect(request, wanted);
    } else if (!_has(request, 'IServSession', session)) {
      wanted = request.uri.toString();
      _redirect(request, '/iserv/auth/auth?state=abc');
    } else if (path == '/iserv/') {
      _html(request, '<h1>Start</h1>');
    } else if (path == '/iserv/exercise/api/exercises') {
      request.response
        ..headers.set('Content-Type', 'application/json')
        ..write(jsonEncode({'data': [{'id': 7, 'title': 'Gedichtanalyse', 'endDate': '2026-11-12T23:59:00+01:00'}]}));
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

  test('a wrong password with the right user name is refused, not taken for a sign-in', () async {
    expect(await _session(school.origin).signIn('lea', 'Geheim'), IServSignIn.refused);
    expect(await _session(school.origin).signIn('ben', 'geheim'), IServSignIn.refused);
    expect(school.requested.where((line) => line == 'GET /iserv/infodisplay/show/3'), isEmpty);
  });

  test('a chain of redirects inside the school is followed, relative and absolute alike', () async {
    school.hops = 3;
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.entered);
    expect(school.requested, containsAllInOrder(['GET /iserv/auth/hop/1', 'GET /iserv/auth/hop/2', 'GET /iserv/auth/hop/3', 'GET /iserv/']));
  });

  test('a chain longer than the cap and a loop both end as an unfinished sign-in', () async {
    school.hops = 12;
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.stuck);
    school
      ..hops = 0
      ..loop = true;
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.stuck);
  });

  test('a second step with a one-time code is named as such, wherever IServ asks for it', () async {
    for (final (path, form) in [
      ('/iserv/auth/login/2fa', school.codeForm),
      ('/iserv/auth/2fa', '<form method="post"><label for="code">Code</label><input id="code" name="code" type="text"></form>'),
      ('/iserv/auth/verify', '<form method="post"><input name="_totp" type="number"></form>'),
    ]) {
      school
        ..codePath = path
        ..codeForm = form;
      expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.twoFactor, reason: path);
      expect(await _session(school.origin).signIn('lea', 'falsch'), IServSignIn.refused, reason: path);
    }
  });

  test('a school that signs in through another service is named as such, and that service is never asked', () async {
    final other = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var visits = 0;
    other.listen((request) {
      visits++;
      request.response.close();
    });
    addTearDown(() => other.close(force: true));
    school.sso = 'http://localhost:${other.port}/saml/login?SAMLRequest=abc';
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.external);
    school.sso = 'https://idp.bildung.example/oidc/authorize?client_id=iserv';
    expect(await _session(school.origin).signIn('lea', 'geheim'), IServSignIn.external);
    expect(visits, 0);
    expect(school.requested.where((line) => line.startsWith('POST')), isEmpty, reason: 'the password never goes out');
  });

  test('an expired session is noticed in an API answer and signed in again once', () async {
    var session = _session(school.origin);
    expect(await session.signIn('lea', 'geheim'), IServSignIn.entered);
    final fresh = await session.api('/iserv/exercise/api/exercises');
    expect(((fresh!.data as Map)['data'] as List).single['title'], 'Gedichtanalyse');

    school.forget();
    expect(await session.api('/iserv/exercise/api/exercises'), isNull);

    var renewals = 0;
    Future<bool> renew(IServSession expired) async {
      renewals++;
      expect(identical(expired, session), isTrue);
      session = _session(school.origin);
      return await session.signIn('lea', 'geheim') == IServSignIn.entered;
    }

    final again = await iservApi(() => session, renew, '/iserv/exercise/api/exercises');
    expect(again?.statusCode, 200);
    expect(renewals, 1);
    expect(await iservApi(() => session, renew, '/iserv/exercise/api/exercises'), isNotNull);
    expect(renewals, 1, reason: 'a live session is not signed in again');
  });

  test('when signing in again fails, the API gives nothing instead of the sign-in page', () async {
    final session = _session(school.origin);
    await session.signIn('lea', 'geheim');
    school
      ..forget()
      ..password = 'neues-passwort';
    Future<bool> renew(IServSession expired) async => await _session(school.origin).signIn('lea', 'geheim') == IServSignIn.entered;
    expect(await iservApi(() => session, renew, '/iserv/exercise/api/exercises'), isNull);
    expect(await iservApi(() => null, renew, '/iserv/exercise/api/exercises'), isNull);
  });

  test('the plan after an expired session counts as expired, and a new sign-in finds it again', () async {
    final session = _session(school.origin);
    await session.signIn('lea', 'geheim');
    expect((await fetchIServPlan(session)).state, IServPlanState.found);
    school.forget();
    expect((await fetchIServPlan(session)).state, IServPlanState.expired);
    final renewed = _session(school.origin);
    await renewed.signIn('lea', 'geheim');
    expect((await fetchIServPlan(renewed)).state, IServPlanState.found);
  });

  test('an answer counts as expired when IServ sends its sign-in instead of data', () {
    Response<Object?> answer(int status, {String? location, String type = 'application/json', Object? data}) => Response(
          requestOptions: RequestOptions(path: '/iserv/exercise/api/exercises'),
          statusCode: status,
          data: data,
          headers: Headers.fromMap({
            Headers.contentTypeHeader: [type],
            if (location != null) 'location': [location],
          }),
        );
    expect(IServSession.expired(answer(302, location: '/iserv/auth/auth?state=abc')), isTrue);
    expect(IServSession.expired(answer(302, location: 'https://iserv.schule.de/iserv/auth/login')), isTrue);
    expect(IServSession.expired(answer(401)), isTrue);
    expect(IServSession.expired(answer(200, type: 'text/html; charset=UTF-8', data: '<form><input name="_username"></form>')), isTrue);
    expect(IServSession.expired(answer(200, data: {'data': []})), isFalse);
    expect(IServSession.expired(answer(404, data: {'error': 'Nicht gefunden'})), isFalse);
    expect(IServSession.expired(answer(302, location: '/iserv/exercise/show/7')), isFalse);
  });
}
