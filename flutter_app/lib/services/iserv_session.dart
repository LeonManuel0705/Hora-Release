// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:html/parser.dart' as html_parser;

class IServPage {
  const IServPage(this.url, this.status, this.contentType, this.bytes, {this.location});

  final Uri url;
  final int status;
  final String contentType;
  final Uint8List bytes;
  final String? location;

  static final _loginPath = RegExp(r'/iserv/(?:auth|app)/login');
  static final loginField = RegExp(r'''name=["']_(?:username|password)["']''');
  static final _codeName = RegExp(r'otp|totp|2fa|two.?factor|mfa|auth.?code|verification|^_?code$', caseSensitive: false);

  String get text => utf8.decode(bytes, allowMalformed: true);

  String get _head => utf8.decode(bytes.length > 20000 ? Uint8List.sublistView(bytes, 0, 20000) : bytes, allowMalformed: true);

  bool get isHtml => contentType.toLowerCase().contains('text/html');

  bool get onAuth => url.path.startsWith('/iserv/auth/');

  /// A sign-in page of IServ's that wants a one-time code instead of the password.
  bool get asksForCode {
    if (!isHtml || !onAuth) return false;
    for (final input in html_parser.parse(_head).querySelectorAll('input')) {
      final type = (input.attributes['type'] ?? 'text').toLowerCase();
      if (type == 'hidden' || type == 'password' || type == 'submit') continue;
      final name = '${input.attributes['name'] ?? ''} ${input.attributes['id'] ?? ''}'.trim();
      if ((input.attributes['autocomplete'] ?? '').toLowerCase() == 'one-time-code') return true;
      if (name.split(' ').any(_codeName.hasMatch)) return true;
    }
    return false;
  }

  bool get isLogin {
    if (_loginPath.hasMatch(url.path)) return true;
    if (!isHtml) return false;
    return loginField.hasMatch(_head);
  }

  bool get outsideApp => isLogin || onAuth;
}

enum IServSignIn { entered, refused, stuck, twoFactor, external }

class IServSession {
  IServSession(this.dio, this.origin);

  final Dio dio;
  final Uri origin;

  static const maxHops = 8;
  static const maxBytes = 12 * 1024 * 1024;
  static final _refresh = RegExp(r'^\s*\d+(?:\.\d*)?\s*[;,]\s*(?:url\s*=\s*)?(.+?)\s*$', caseSensitive: false, dotAll: true);

  bool within(Uri url) =>
      url.scheme == origin.scheme &&
      url.host.toLowerCase() == origin.host.toLowerCase() &&
      url.port == origin.port &&
      url.userInfo.isEmpty;

  static String? handoffTarget(IServPage page) {
    if (page.status != 200 || !page.onAuth || !page.isHtml) return null;
    final text = page.text;
    if (!text.toLowerCase().contains('refresh')) return null;
    for (final meta in html_parser.parse(text).querySelectorAll('meta')) {
      if ((meta.attributes['http-equiv'] ?? '').trim().toLowerCase() != 'refresh') continue;
      var target = _refresh.firstMatch(meta.attributes['content'] ?? '')?.group(1)?.trim() ?? '';
      if (target.length > 1 && (target.startsWith('"') || target.startsWith("'"))) target = target.substring(1);
      if (target.endsWith('"') || target.endsWith("'")) target = target.substring(0, target.length - 1);
      if (target.isNotEmpty) return target;
    }
    return null;
  }

  Uri? _next(Uri from, String target) {
    if (target.contains(r'\')) return null;
    try {
      final url = from.resolve(target);
      return within(url) ? url : null;
    } on FormatException {
      return null;
    }
  }

  Future<IServPage?> _fetch(Uri url, Duration? timeout) async {
    final response = await dio.getUri<ResponseBody>(
      url,
      options: Options(
        responseType: ResponseType.stream,
        followRedirects: false,
        validateStatus: (_) => true,
        receiveTimeout: timeout,
      ),
    );
    final builder = BytesBuilder(copy: false);
    final body = response.data;
    if (body != null) {
      await for (final chunk in body.stream) {
        if (builder.length + chunk.length > maxBytes) return null;
        builder.add(chunk);
      }
    }
    return IServPage(
      url,
      response.statusCode ?? 0,
      response.headers.value(Headers.contentTypeHeader) ?? '',
      builder.takeBytes(),
      location: response.headers.value('location'),
    );
  }

  Uri? _left;

  Future<IServPage?> get(String location, {Duration? timeout}) async {
    _left = null;
    var url = _next(origin, location);
    for (var hop = 0; url != null && hop <= maxHops; hop++) {
      final page = await _fetch(url, timeout);
      if (page == null) return null;
      final redirect = page.status >= 300 && page.status < 400;
      final target = redirect ? page.location : handoffTarget(page);
      if (target == null || target.isEmpty) return page;
      final from = url;
      url = _next(from, target);
      if (url == null && redirect) _left = _away(from, target);
    }
    return null;
  }

  /// Null when IServ answered with its sign-in instead of data, so the session is over.
  Future<Response<Object?>?> api(String path, {Map<String, dynamic>? query}) async {
    final response = await dio.get<Object?>(
      path,
      queryParameters: query,
      options: Options(
        headers: const {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
        responseType: ResponseType.json,
        followRedirects: false,
        validateStatus: (_) => true,
      ),
    );
    return expired(response) ? null : response;
  }

  static bool expired(Response<Object?> response) {
    final status = response.statusCode ?? 0;
    if (status == 401) return true;
    if (status >= 300 && status < 400) {
      final location = response.headers.value('location') ?? '';
      return location.contains('/iserv/auth/') || location.contains('/login');
    }
    final data = response.data;
    return (response.headers.value(Headers.contentTypeHeader) ?? '').contains('text/html') && data is String && IServPage.loginField.hasMatch(data);
  }

  Uri? _away(Uri from, String target) {
    if (target.contains(r'\')) return null;
    try {
      final url = from.resolve(target);
      return url.host.isNotEmpty && url.host.toLowerCase() != origin.host.toLowerCase() ? url : null;
    } on FormatException {
      return null;
    }
  }

  Future<IServSignIn> signIn(String username, String password) async {
    final form = await get('/iserv/auth/login');
    if (form == null) return _left != null ? IServSignIn.external : IServSignIn.stuck;
    if (form.isLogin && form.isHtml) {
      final forms = html_parser.parse(form.text).querySelectorAll('form');
      final login = forms.where((node) => node.querySelector('input[name="_username"]') != null).firstOrNull ?? forms.firstOrNull;
      final fields = <String, String>{};
      if (login != null) {
        for (final input in login.querySelectorAll('input')) {
          final name = input.attributes['name'] ?? '';
          if (name.isEmpty || (input.attributes['type'] ?? '').toLowerCase() != 'hidden') continue;
          fields[name] = input.attributes['value'] ?? '';
        }
      }
      fields['_username'] = username;
      fields['_password'] = password;
      final action = (login?.attributes['action'] ?? '').trim();
      final target = action.isEmpty ? form.url : _next(form.url, action);
      if (target == null) return IServSignIn.stuck;
      await dio.postUri<List<int>>(
        target,
        data: fields,
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          responseType: ResponseType.bytes,
          followRedirects: false,
          validateStatus: (_) => true,
        ),
      );
    }
    final home = await get('/iserv/');
    if (home == null) return IServSignIn.stuck;
    if (home.asksForCode) return IServSignIn.twoFactor;
    if (home.isLogin) return IServSignIn.refused;
    return home.onAuth ? IServSignIn.stuck : IServSignIn.entered;
  }
}

/// Calls an IServ API and signs in again once when the session turned out to be over.
/// [renew] gets the session that expired, so parallel calls sign in only once.
Future<Response<Object?>?> iservApi(
  IServSession? Function() current,
  Future<bool> Function(IServSession expired) renew,
  String path, {
  Map<String, dynamic>? query,
}) async {
  for (var attempt = 0; attempt < 2; attempt++) {
    final session = current();
    if (session == null) return null;
    final response = await session.api(path, query: query);
    if (response != null) return response;
    if (attempt == 0 && !await renew(session)) return null;
  }
  return null;
}
