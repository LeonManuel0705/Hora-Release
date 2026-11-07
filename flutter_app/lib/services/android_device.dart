// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/services.dart';

class AndroidDevice {
  AndroidDevice._();

  static const _channel = MethodChannel('app/device');

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
}
