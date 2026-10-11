// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

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
  static final _loginField = RegExp(r'''name=["']_(?:username|password)["']''');

  String get text => utf8.decode(bytes, allowMalformed: true);

  bool get isHtml => contentType.toLowerCase().contains('text/html');

  bool get onAuth => url.path.startsWith('/iserv/auth/');

  bool get isLogin {
    if (_loginPath.hasMatch(url.path)) return true;
    if (!isHtml) return false;
    final start = bytes.length > 20000 ? Uint8List.sublistView(bytes, 0, 20000) : bytes;
    return _loginField.hasMatch(utf8.decode(start, allowMalformed: true));
  }

  bool get outsideApp => isLogin || onAuth;
}

enum IServSignIn { entered, refused, stuck }

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

  Future<IServPage?> get(String location, {Duration? timeout}) async {
    var url = _next(origin, location);
    for (var hop = 0; url != null && hop <= maxHops; hop++) {
      final page = await _fetch(url, timeout);
      if (page == null) return null;
      final target = page.status >= 300 && page.status < 400 ? page.location : handoffTarget(page);
      if (target == null || target.isEmpty) return page;
      url = _next(url, target);
    }
    return null;
  }

  Future<IServSignIn> signIn(String username, String password) async {
    final form = await get('/iserv/auth/login');
    if (form == null) return IServSignIn.stuck;
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
    if (home.isLogin) return IServSignIn.refused;
    return home.onAuth ? IServSignIn.stuck : IServSignIn.entered;
  }
}
