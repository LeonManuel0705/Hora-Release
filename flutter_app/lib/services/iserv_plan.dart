// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:html/parser.dart' as html_parser;

import 'iserv_session.dart';

const _planMagic = <(List<int>, String)>[
  ([0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'),
  ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'),
  ([0xff, 0xd8, 0xff], 'image/jpeg'),
  ([0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'image/gif'),
  ([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'),
];

bool _startsWith(List<int> bytes, List<int> magic, [int at = 0]) {
  if (bytes.length < at + magic.length) return false;
  for (var index = 0; index < magic.length; index++) {
    if (bytes[at + index] != magic[index]) return false;
  }
  return true;
}

String? planContentType(List<int> bytes) {
  for (final (magic, type) in _planMagic) {
    if (_startsWith(bytes, magic)) return type;
  }
  if (_startsWith(bytes, const [0x52, 0x49, 0x46, 0x46]) && _startsWith(bytes, const [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

String planDigest(List<int> bytes) => sha256.convert(bytes).toString().substring(0, 16);

class IServPlanFile {
  const IServPlanFile(this.bytes, this.contentType);

  final Uint8List bytes;
  final String contentType;

  static IServPlanFile? of(Uint8List bytes) {
    final type = planContentType(bytes);
    return type == null ? null : IServPlanFile(bytes, type);
  }
}

enum IServPlanState { found, expired, empty, failed }

class IServPlan {
  const IServPlan(this.state, [this.files = const []]);

  final IServPlanState state;
  final List<IServPlanFile> files;
}

const _maxPlanLinks = 12;
const _maxPlanPages = 6;
const _minPlanBytes = 1000;
final _planAddress = RegExp(r'''/iserv/infodisplay/(?:file|pdf)/[^\s"'><\\]+''', caseSensitive: false);

List<String> planLinks(String text, Uri page, int displayId) {
  final links = <String>{};

  void add(String value) {
    if (value.isEmpty || value.startsWith('data:')) return;
    try {
      final url = page.resolve(value);
      if (url.path.startsWith('/iserv/infodisplay/') && !url.path.startsWith('/iserv/infodisplay/show/')) links.add(url.toString());
    } on FormatException {
      return;
    }
  }

  for (final match in _planAddress.allMatches(text)) {
    add(match.group(0)!.replaceAll('&amp;', '&'));
  }
  for (final node in html_parser.parse(text).querySelectorAll('img, iframe, object, embed')) {
    for (final name in const ['src', 'data', 'data-src']) {
      add(node.attributes[name] ?? '');
    }
  }
  for (var index = 1; index <= 6; index++) {
    add('/iserv/infodisplay/file/$displayId/$index');
  }
  return links.take(_maxPlanLinks).toList();
}

Future<IServPlanFile?> _planFile(IServSession session, String link) async {
  try {
    final page = await session.get(link, timeout: const Duration(seconds: 8));
    if (page == null || page.status != 200 || page.bytes.length < _minPlanBytes) return null;
    return IServPlanFile.of(page.bytes);
  } catch (_) {
    return null;
  }
}

Future<IServPlan> fetchIServPlan(IServSession session, {int displayId = 3}) async {
  final show = await session.get('/iserv/infodisplay/show/$displayId');
  if (show == null) return const IServPlan(IServPlanState.failed);
  if (show.status == 401 || show.outsideApp) return const IServPlan(IServPlanState.expired);
  if (show.status == 403) return const IServPlan(IServPlanState.empty);
  if (show.status != 200) return const IServPlan(IServPlanState.failed);
  final direct = IServPlanFile.of(show.bytes);
  if (direct != null) return IServPlan(IServPlanState.found, [direct]);
  if (!show.isHtml) return const IServPlan(IServPlanState.failed);
  final found = await Future.wait(planLinks(show.text, show.url, displayId).map((link) => _planFile(session, link)));
  final files = <IServPlanFile>[];
  final seen = <String>{};
  for (final file in found) {
    if (file == null || files.length >= _maxPlanPages || !seen.add(planDigest(file.bytes))) continue;
    files.add(file);
  }
  return files.isEmpty ? const IServPlan(IServPlanState.empty) : IServPlan(IServPlanState.found, files);
}
