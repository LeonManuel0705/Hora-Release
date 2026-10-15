// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class SavedDownload {
  const SavedDownload(this.path);

  final String path;

  String get name => p.basename(path);
  String get folder => p.basename(p.dirname(path));

  Map<String, String> toJson() => {'path': path, 'name': name, 'folder': folder};
}

class Downloads {
  Downloads._();

  static const maxBytes = 64 * 1024 * 1024;
  static const fallbackName = 'Download';
  static const maxNameLength = 120;
  static const allowedExtensions = {'.json', '.txt', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.ics'};
  static final _unsafe = RegExp('[\\x00-\\x1f\\x7f<>:"/\\\\|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]');
  static final _edges = RegExp(r'^[.\s]+|[.\s]+$');
  static final _saved = <String>{};

  static String safeName(String raw) {
    final name = raw.split(RegExp(r'[/\\]')).last.replaceAll(_unsafe, '').replaceAll(_edges, '');
    if (name.isEmpty) return fallbackName;
    final runes = name.runes.toList();
    if (runes.length <= maxNameLength) return name;
    final extension = p.extension(name);
    final keep = extension.length > 1 && extension.length <= 16 ? extension : '';
    final stem = String.fromCharCodes(runes.take(maxNameLength - keep.runes.length)).replaceAll(_edges, '');
    return stem.isEmpty ? fallbackName : '$stem$keep';
  }

  static Future<Directory> folder() async {
    final found = await getDownloadsDirectory();
    if (found != null) return found;
    final home = Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? Directory.current.path;
    return Directory(p.join(home, 'Downloads'));
  }

  static Future<SavedDownload?> saveEncoded(Object? name, Object? data, {Directory? into}) async {
    if (data is! String || data.length > (maxBytes + 2) ~/ 3 * 4) return null;
    final List<int> bytes;
    try {
      bytes = base64.decode(data);
    } on FormatException {
      return null;
    }
    return save(name is String ? name : '', bytes, into: into);
  }

  static Future<SavedDownload?> save(String name, List<int> bytes, {Directory? into}) async {
    final wanted = safeName(name);
    final stem = p.basenameWithoutExtension(wanted);
    final extension = p.extension(wanted);
    if (bytes.length > maxBytes || !allowedExtensions.contains(extension.toLowerCase())) return null;
    final target = into ?? await folder();
    try {
      await target.create(recursive: true);
    } on PathAccessException {
      rethrow;
    } on FileSystemException {
      return null;
    }
    for (var copy = 1; copy < 1000; copy += 1) {
      final file = File(p.join(target.path, copy == 1 ? wanted : '$stem $copy$extension'));
      if (await _taken(file.path)) continue;
      try {
        await file.create(exclusive: true);
      } on PathAccessException {
        rethrow;
      } on FileSystemException {
        if (await _taken(file.path)) continue;
        return null;
      }
      try {
        await file.writeAsBytes(bytes, flush: true);
      } on FileSystemException {
        await file.delete().catchError((Object _) => file);
        return null;
      }
      _saved.add(file.path);
      return SavedDownload(file.path);
    }
    return null;
  }

  static Future<bool> _taken(String path) async =>
      await FileSystemEntity.type(path, followLinks: false) != FileSystemEntityType.notFound;

  static bool saved(String path) => _saved.contains(path);

  static Future<bool> show(String path) async {
    if (!Platform.isMacOS || !_saved.contains(path) || !File(path).existsSync()) return false;
    final result = await Process.run('/usr/bin/open', ['-R', path]);
    return result.exitCode == 0;
  }
}
