// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/services.dart';

import 'downloads.dart';

class SavedFile {
  const SavedFile({required this.name, this.folder, this.shared = false});

  final String name;
  final String? folder;
  final bool shared;
}

class AndroidDevice {
  AndroidDevice._();

  static const _channel = MethodChannel('app/device');

  static const _types = {
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ics': 'text/calendar',
  };

  static Future<T?> _call<T>(String method, [Map<String, Object?>? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(method, arguments);
    } on PlatformException catch (error) {
      if (kDebugMode) print('AndroidDevice.$method: ${error.message}');
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  static Future<bool> requestLocation() async => await _call<bool>('requestLocation') ?? false;

  /// Null where the channel is missing, as in a WorkManager isolate, so nothing counts as present.
  static Future<Set<int>?> missingAlarms(List<int> ids) async =>
      (await _call<List<Object?>>('missingAlarms', {'ids': ids}))?.whereType<int>().toSet();

  /// The name the page offered and the extension decide the type, and only kinds the app
  /// itself writes are saved.
  static (String, String)? fileFor(String offered) {
    final name = Downloads.safeName(offered);
    final dot = name.lastIndexOf('.');
    final type = dot < 0 ? null : _types[name.substring(dot).toLowerCase()];
    return type == null ? null : (name, type);
  }

  static Future<SavedFile?> saveDownload(String offered, Uint8List bytes) async {
    final file = fileFor(offered);
    if (file == null || bytes.length > Downloads.maxBytes) return null;
    final saved = await _call<Map<Object?, Object?>>('saveDownload', {'name': file.$1, 'type': file.$2, 'bytes': bytes});
    final name = saved?['name'];
    if (name is! String) return null;
    return SavedFile(name: name, folder: saved?['folder'] as String?, shared: saved?['shared'] == true);
  }

  static Future<bool> canInstall() async => await _call<bool>('canInstall') ?? false;

  static Future<bool> allowInstall() async => await _call<bool>('allowInstall') ?? false;

  static Future<bool> install(String path) async => await _call<bool>('install', {'path': path}) ?? false;
}
