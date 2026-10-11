// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:convert';
import 'dart:typed_data';

// The addresses come from bookmarks and from pages nobody here has read, so every one is treated as hostile:
// only http and https, never this device or a link-local address, a private network only for the bookmarked host itself.

const iconMinSide = 8;
const _maxTag = 2000;

class IconTarget {
  const IconTarget(this.scheme, this.host, this.port, this.path);

  final String scheme;
  final String host;
  final int port;
  final String path;

  String get origin => '$scheme://${host.contains(':') ? '[$host]' : host}:$port';
  String get address => '$origin$path';
}

enum IconReach { public, local, never }

final _control = RegExp(r'[\x00-\x1f\x7f\\]');
final _hostName = RegExp(r'^(?:[a-z0-9_.-]+|[0-9a-f:.]+)$');

IconTarget? iconTarget(String? url) {
  if (url == null) return null;
  final text = url.trim().replaceAll(' ', '%20');
  if (_control.hasMatch(text)) return null;
  final uri = Uri.tryParse(text);
  if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) return null;
  if (uri.userInfo.isNotEmpty || uri.host.isEmpty) return null;
  final host = uri.host.toLowerCase();
  if (!_hostName.hasMatch(host)) return null;
  final port = uri.port == 0 ? (uri.isScheme('https') ? 443 : 80) : uri.port;
  final path = '${uri.path.isEmpty ? '/' : uri.path}${uri.hasQuery ? '?${uri.query}' : ''}';
  return IconTarget(uri.scheme, host, port, path);
}

IconReach iconReach(List<int> raw) {
  if (raw.length == 16) {
    final inner = _innerV4(raw);
    if (inner != null) return iconReach(inner);
    if (raw.take(15).every((byte) => byte == 0)) return IconReach.never;
    if (raw[0] == 0xff || (raw[0] == 0xfe && raw[1] & 0xc0 == 0x80)) return IconReach.never;
    if (raw[0] & 0xfe == 0xfc) return IconReach.local;
    if (raw[0] & 0xe0 != 0x20) return IconReach.never;
    if (raw[0] == 0x20 && raw[1] == 0x01 && (raw[2] < 0x02 || (raw[2] == 0x0d && raw[3] == 0xb8))) return IconReach.never;
    return IconReach.public;
  }
  if (raw.length != 4) return IconReach.never;
  final a = raw[0], b = raw[1], c = raw[2];
  if (a == 0 || a == 127 || a >= 224 || (a == 169 && b == 254)) return IconReach.never;
  if (a == 10 || (a == 172 && b & 0xf0 == 16) || (a == 192 && b == 168) || (a == 100 && b & 0xc0 == 64)) return IconReach.local;
  if (a == 192 && b == 0 && (c == 0 || c == 2)) return IconReach.never;
  if ((a == 198 && b & 0xfe == 18) || (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113)) return IconReach.never;
  return IconReach.public;
}

List<int>? _innerV4(List<int> raw) {
  if (raw.take(10).every((byte) => byte == 0) && raw[10] == 0xff && raw[11] == 0xff) return raw.sublist(12);
  if (raw[0] == 0x20 && raw[1] == 0x02) return raw.sublist(2, 6);
  if (raw[0] == 0 && raw[1] == 0x64 && raw[2] == 0xff && raw[3] == 0x9b && raw.sublist(4, 12).every((byte) => byte == 0)) return raw.sublist(12);
  return null;
}

final _attribute = RegExp(r'''([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))''');
final _size = RegExp(r'(\d{1,5})x\d{1,5}', caseSensitive: false);
final _entity = RegExp(r'&(?:#(x?)([0-9a-fA-F]{1,6})|(amp|quot|apos|lt|gt));');
const _entities = {'amp': '&', 'quot': '"', 'apos': "'", 'lt': '<', 'gt': '>'};

String _plain(String value) => value.replaceAllMapped(_entity, (match) {
      final named = match[3];
      if (named != null) return _entities[named]!;
      final code = int.tryParse(match[2]!, radix: match[1]!.isEmpty ? 10 : 16);
      return code == null || code == 0 || code > 0x10ffff ? match[0]! : String.fromCharCode(code);
    });

(String, String) _without(String text, String lowered, String start, String end) {
  final kept = StringBuffer(), keptLowered = StringBuffer();
  var at = 0;
  while (true) {
    final begin = lowered.indexOf(start, at);
    if (begin < 0) {
      kept.write(text.substring(at));
      keptLowered.write(lowered.substring(at));
      break;
    }
    kept.write(text.substring(at, begin));
    keptLowered.write(lowered.substring(at, begin));
    final close = lowered.indexOf(end, begin + start.length);
    if (close < 0) break;
    at = close + end.length;
  }
  return (kept.toString(), keptLowered.toString());
}

// Read without a parser, in one pass: a hostile page must not be able to keep one busy.
List<(String, Map<String, String>)> _tags(Uint8List body) {
  var text = latin1.decode(body);
  var lowered = text.toLowerCase();
  for (final (start, end) in const [('<!--', '-->'), ('<script', '</script'), ('<style', '</style')]) {
    (text, lowered) = _without(text, lowered, start, end);
  }
  final ends = [lowered.indexOf('</head'), lowered.indexOf('<body')].where((at) => at >= 0);
  final stop = ends.isEmpty ? lowered.length : ends.reduce((a, b) => a < b ? a : b);
  final found = <(String, Map<String, String>)>[];
  var at = 0;
  while (true) {
    at = lowered.indexOf('<', at);
    if (at < 0 || at >= stop) return found;
    final name = lowered.length >= at + 5 ? lowered.substring(at + 1, at + 5) : '';
    final next = lowered.length > at + 5 ? lowered[at + 5] : '';
    if ((name == 'link' || name == 'base') && ' \t\n\r\f/'.contains(next) && next.isNotEmpty) {
      final close = lowered.substring(at, at + _maxTag > lowered.length ? lowered.length : at + _maxTag).indexOf('>');
      if (close > 0) {
        final inside = utf8.decode(latin1.encode(text.substring(at + 5, at + close)), allowMalformed: true);
        final attributes = <String, String>{};
        for (final match in _attribute.allMatches(inside)) {
          attributes.putIfAbsent(match[1]!.toLowerCase(), () => _plain(match[2] ?? match[3] ?? match[4] ?? ''));
        }
        found.add((name, attributes));
        at += close;
      }
    }
    at++;
  }
}

bool _forDark(String media) => media.contains('prefers-color-scheme') && media.contains('dark') != media.contains('not');

/// The icons a page names that the app can draw, the best one first. Vector icons are left out, the app has nothing to draw them with.
List<String> declaredIcons(Uint8List body, String pageUrl) {
  final tags = _tags(body);
  var base = Uri.parse(pageUrl);
  for (final (name, attributes) in tags) {
    final href = attributes['href']?.trim() ?? '';
    if (name == 'base' && href.isNotEmpty) {
      try {
        base = base.resolve(href);
      } on FormatException {
        // keeps the address of the page
      }
      break;
    }
  }
  final found = <(int, int, int, String)>[];
  for (final (name, attributes) in tags) {
    final rel = (attributes['rel'] ?? '').toLowerCase().split(RegExp(r'\s+')).toSet();
    final touch = rel.contains('apple-touch-icon') || rel.contains('apple-touch-icon-precomposed');
    final href = attributes['href']?.trim() ?? '';
    if (name != 'link' || href.isEmpty || !(touch || rel.contains('icon')) || _forDark((attributes['media'] ?? '').toLowerCase())) continue;
    final String url;
    try {
      url = base.resolve(href).toString();
    } on FormatException {
      continue;
    }
    final target = iconTarget(url);
    if (target == null) continue;
    final kind = (attributes['type'] ?? '').trim().toLowerCase();
    final ending = target.path.split('?').first.toLowerCase().split('.').last;
    final ico = kind == 'image/x-icon' || kind == 'image/vnd.microsoft.icon' || ending == 'ico';
    if (!ico && (kind == 'image/svg+xml' || ending == 'svg')) continue;
    final size = _size.allMatches(attributes['sizes'] ?? '').map((match) => int.parse(match[1]!)).fold(0, (a, b) => a > b ? a : b);
    final (tier, order) = touch
        ? (1, -(size == 0 ? 180 : size))
        : ico
            ? (3, -size)
            : size >= 64
                ? (0, (size - 128).abs())
                : (2, -size);
    found.add((tier, order, found.length, url));
  }
  found.sort((a, b) => a.$1 != b.$1 ? a.$1 - b.$1 : a.$2 != b.$2 ? a.$2 - b.$2 : a.$3 - b.$3);
  return [for (final entry in found) entry.$4];
}

int _little(List<int> data, int at) => data[at] | data[at + 1] << 8;
int _big(List<int> data, int at) => data[at] << 24 | data[at + 1] << 16 | data[at + 2] << 8 | data[at + 3];
bool _starts(List<int> data, List<int> head, [int at = 0]) {
  if (data.length < at + head.length) return false;
  for (var index = 0; index < head.length; index++) {
    if (data[at + index] != head[index]) return false;
  }
  return true;
}

/// The kind of image the bytes really are, whatever the server called them. A tracking pixel is no icon.
String? imageKind(List<int> data) {
  if (_starts(data, const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && _starts(data, const [0x49, 0x48, 0x44, 0x52], 12) && data.length >= 24) {
    return _big(data, 16) >= iconMinSide && _big(data, 20) >= iconMinSide ? 'png' : null;
  }
  if ((_starts(data, ascii.encode('GIF87a')) || _starts(data, ascii.encode('GIF89a'))) && data.length >= 10) {
    return _little(data, 6) >= iconMinSide && _little(data, 8) >= iconMinSide ? 'gif' : null;
  }
  if (_starts(data, const [0, 0, 1, 0]) && data.length >= 6) {
    var widest = 0;
    final count = _little(data, 4) > 64 ? 64 : _little(data, 4);
    for (var index = 0; index < count && data.length >= 22 + 16 * index; index++) {
      final width = data[6 + 16 * index] == 0 ? 256 : data[6 + 16 * index];
      if (width > widest) widest = width;
    }
    return widest >= iconMinSide ? 'ico' : null;
  }
  if (_starts(data, const [0xff, 0xd8, 0xff])) return 'jpg';
  if (_starts(data, ascii.encode('RIFF')) && _starts(data, ascii.encode('WEBP'), 8)) return 'webp';
  return null;
}
