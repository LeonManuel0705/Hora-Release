// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'site_icon_rules.dart';

typedef IconResolve = Future<List<InternetAddress>> Function(String host);
typedef IconOpen = Future<Socket> Function(InternetAddress address, int port, Duration timeout);

class _Reply {
  const _Reply(this.url, this.status, this.body);

  final String url;
  final int status;
  final Uint8List body;
}

class _Kept {
  const _Kept(this.file, this.kind, this.age);

  final File file;
  final String? kind;
  final Duration age;
}

enum _Found { icon, missing, unreachable }

/// Fetches the icon a website declares for itself and keeps it in a folder.
/// Every connection goes to exactly the address that was checked, and nothing is kept that is not an image.
class SiteIconStore {
  SiteIconStore({
    required this.folder,
    required this.agent,
    IconResolve? resolve,
    IconOpen? open,
    DateTime Function()? now,
    this.fresh = const Duration(days: 30),
    this.retryAfter = const Duration(hours: 6),
    this.unreachableFor = const Duration(minutes: 5),
    this.budget = const Duration(seconds: 12),
    this.timeout = const Duration(seconds: 5),
  })  : _resolve = resolve ?? InternetAddress.lookup,
        _open = open ?? ((address, port, timeout) => Socket.connect(address, port, timeout: timeout)),
        _now = now ?? DateTime.now;

  static const kinds = ['png', 'ico', 'jpg', 'gif', 'webp'];
  static const maxPage = 256 * 1024;
  static const maxIcon = 1024 * 1024;
  static const maxRedirects = 5;
  static const maxDeclared = 3;
  static const maxAddresses = 3;
  static const maxRemembered = 64;

  final Future<Directory> Function() folder;
  final String agent;
  final Duration fresh;
  final Duration retryAfter;
  final Duration unreachableFor;
  final Duration budget;
  final Duration timeout;
  final IconResolve _resolve;
  final IconOpen _open;
  final DateTime Function() _now;

  final _running = <String, Future<void>>{};
  final _unreachable = <String, DateTime>{};
  final _remembered = <String, Uint8List>{};
  final _waiting = <Completer<void>>[];
  var _busy = 0;

  static String? keyOf(String url) {
    final target = iconTarget(url);
    return target == null ? null : sha256.convert(utf8.encode('${target.scheme}://${target.host}:${target.port}${target.path}')).toString().substring(0, 32);
  }

  /// The kept icon of the page, fetched first where there is none yet. An old one is handed out at once and renewed beside it.
  Future<Uint8List?> iconFor(String url) async {
    final key = keyOf(url);
    if (key == null) return null;
    final kept = await _kept(key);
    if (kept != null) {
      if (kept.kind != null && kept.age < fresh) return _bytes(key, kept);
      if (kept.kind == null && kept.age < retryAfter) return null;
    }
    final running = _refresh(url, key, kept?.kind != null);
    if (kept?.kind != null) return _bytes(key, kept!);
    await running;
    final now = await _kept(key);
    return now?.kind == null ? null : _bytes(key, now!);
  }

  /// Lets the next request ask a site again that had no icon.
  Future<void> retry(String url) async {
    final key = keyOf(url);
    if (key == null) return;
    _unreachable.remove(key);
    await _remove(File('${(await folder()).path}/$key.none'));
  }

  /// Drops what is kept for the page unless one of the other addresses is the same page.
  Future<void> forget(String url, {Iterable<String> stillUsed = const []}) async {
    final key = keyOf(url);
    if (key == null || stillUsed.map(keyOf).contains(key)) return;
    _unreachable.remove(key);
    _remembered.remove(key);
    final path = (await folder()).path;
    for (final suffix in [...kinds, 'none']) {
      await _remove(File('$path/$key.$suffix'));
    }
  }

  Future<Uint8List?> _bytes(String key, _Kept kept) async {
    final known = _remembered[key];
    if (known != null) return known;
    try {
      final bytes = await kept.file.readAsBytes();
      if (_remembered.length >= maxRemembered) _remembered.remove(_remembered.keys.first);
      return _remembered[key] = bytes;
    } on FileSystemException {
      return null;
    }
  }

  Future<_Kept?> _kept(String key) async {
    final path = (await folder()).path;
    _Kept? newest;
    DateTime? changed;
    for (final suffix in [...kinds, 'none']) {
      final file = File('$path/$key.$suffix');
      try {
        final modified = await file.lastModified();
        if (changed == null || modified.isAfter(changed)) {
          changed = modified;
          newest = _Kept(file, suffix == 'none' ? null : suffix, _now().difference(modified));
        }
      } on FileSystemException {
        continue;
      }
    }
    return newest;
  }

  Future<void> _keep(String key, String? kind, Uint8List body) async {
    final directory = await folder();
    final suffix = kind ?? 'none';
    try {
      await directory.create(recursive: true);
      final scratch = File('${directory.path}/$key.$pid.tmp');
      await scratch.writeAsBytes(body, flush: true);
      await scratch.rename('${directory.path}/$key.$suffix');
    } on FileSystemException {
      return;
    }
    _remembered.remove(key);
    for (final other in [...kinds, 'none']) {
      if (other != suffix) await _remove(File('${directory.path}/$key.$other'));
    }
  }

  Future<void> _remove(File file) async {
    try {
      await file.delete();
    } on FileSystemException {
      // was not there
    }
  }

  Future<void> _refresh(String url, String key, bool hadIcon) {
    final until = _unreachable[key];
    if (until != null && until.isAfter(_now())) return Future.value();
    return _running[key] ??= _work(url, key, hadIcon).whenComplete(() {
      _running.remove(key);
    });
  }

  Future<void> _work(String url, String key, bool hadIcon) async {
    while (_busy >= 4) {
      final turn = Completer<void>();
      _waiting.add(turn);
      await turn.future;
    }
    _busy++;
    var found = _Found.unreachable;
    String? kind;
    Uint8List? body;
    try {
      (found, kind, body) = await _discover(url);
    } on Object {
      found = _Found.unreachable;
    } finally {
      _busy--;
      if (_waiting.isNotEmpty) _waiting.removeAt(0).complete();
    }
    try {
      if (found == _Found.unreachable) {
        _unreachable.removeWhere((_, until) => !until.isAfter(_now()));
        _unreachable[key] = _now().add(unreachableFor);
      } else if (found == _Found.icon) {
        await _keep(key, kind, body!);
      } else if (hadIcon) {
        // The icon shown so far stays; touching it puts the next attempt a month away.
        final kept = await _kept(key);
        if (kept?.kind != null) await kept!.file.setLastModified(_now());
      } else {
        await _keep(key, null, Uint8List(0));
      }
    } on FileSystemException {
      // the folder cannot be written right now, the next request tries again
    }
  }

  Future<(_Found, String?, Uint8List?)> _discover(String url) async {
    final start = iconTarget(url);
    if (start == null) return (_Found.missing, null, null);
    final Set<IconReach> home;
    try {
      home = {for (final address in await _resolve(start.host)) iconReach(address.rawAddress)};
    } on Object {
      return (_Found.unreachable, null, null);
    }
    if (home.isEmpty || home.contains(IconReach.never)) return (_Found.missing, null, null);
    final ownNetwork = home.length == 1 && home.single == IconReach.local;
    bool allow(String host, List<int> raw) {
      final reach = iconReach(raw);
      return reach == IconReach.public || (reach == IconReach.local && ownNetwork && host == start.host);
    }

    final deadline = _now().add(budget);
    final page = await _fetch(url, allow, deadline, maxPage, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', whole: false);
    var answered = page != null;
    final candidates = <String>{
      if (page != null) ...declaredIcons(page.body, page.url).take(maxDeclared),
      if (page != null) '${iconTarget(page.url)!.origin}/favicon.ico',
      '${start.origin}/favicon.ico',
    };
    for (final candidate in candidates) {
      final reply = await _fetch(candidate, allow, deadline, maxIcon, 'image/*,*/*;q=0.5');
      if (reply == null) continue;
      answered = true;
      final kind = reply.status == 200 ? imageKind(reply.body) : null;
      if (kind != null) return (_Found.icon, kind, reply.body);
    }
    return (answered ? _Found.missing : _Found.unreachable, null, null);
  }

  Duration _left(DateTime deadline) {
    final left = deadline.difference(_now());
    return left < timeout ? left : timeout;
  }

  Future<_Reply?> _fetch(String url, bool Function(String host, List<int> raw) allow, DateTime deadline, int limit, String accept, {bool whole = true}) async {
    var current = url;
    for (var hop = 0; hop <= maxRedirects; hop++) {
      final target = iconTarget(current);
      if (target == null || _left(deadline) <= Duration.zero) return null;
      final List<InternetAddress> addresses;
      try {
        addresses = await _resolve(target.host).timeout(_left(deadline));
      } on Object {
        return null;
      }
      if (addresses.isEmpty || !addresses.every((address) => allow(target.host, address.rawAddress))) return null;
      final client = HttpClient()
        ..findProxy = ((_) => 'DIRECT')
        ..userAgent = agent
        ..connectionFactory = (uri, proxyHost, proxyPort) => _connect(uri, addresses, deadline);
      try {
        final request = await client.getUrl(Uri.parse(target.address)).timeout(_left(deadline));
        request.followRedirects = false;
        request.persistentConnection = false;
        request.headers.set(HttpHeaders.acceptHeader, accept);
        request.headers.set(HttpHeaders.acceptLanguageHeader, 'de,en;q=0.8');
        final response = await request.close().timeout(_left(deadline));
        if (const [301, 302, 303, 307, 308].contains(response.statusCode)) {
          final location = (response.headers.value(HttpHeaders.locationHeader) ?? '').trim();
          if (location.isEmpty) return null;
          current = Uri.parse(target.address).resolve(location).toString();
          continue;
        }
        final body = await _body(response, deadline, limit, whole);
        return body == null ? null : _Reply(target.address, response.statusCode, body);
      } on Object {
        return null;
      } finally {
        client.close(force: true);
      }
    }
    return null;
  }

  Future<ConnectionTask<Socket>> _connect(Uri uri, List<InternetAddress> addresses, DateTime deadline) async {
    Object failure = const SocketException('No time left');
    for (final address in addresses.take(maxAddresses)) {
      final left = _left(deadline);
      if (left <= Duration.zero) break;
      try {
        Socket socket = await _open(address, uri.port, left);
        if (uri.isScheme('https')) {
          try {
            socket = await SecureSocket.secure(socket, host: uri.host).timeout(left);
          } on Object {
            socket.destroy();
            rethrow;
          }
        }
        final connected = socket;
        return ConnectionTask.fromSocket(Future.value(connected), connected.destroy);
      } on Object catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  Future<Uint8List?> _body(HttpClientResponse response, DateTime deadline, int limit, bool whole) async {
    if (whole && response.contentLength > limit) return null;
    final parts = BytesBuilder(copy: false);
    await for (final chunk in response.timeout(timeout)) {
      if (!_now().isBefore(deadline)) return null;
      parts.add(chunk);
      if (parts.length > limit) {
        if (whole) return null;
        break;
      }
      if (!whole && latin1.decode(chunk).toLowerCase().contains('</head')) break;
    }
    final body = parts.takeBytes();
    return whole || body.length <= limit ? body : Uint8List.sublistView(body, 0, limit);
  }
}
