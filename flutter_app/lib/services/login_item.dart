// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:flutter/services.dart';

class LoginItem {
  LoginItem._();

  static const _channel = MethodChannel('app/login-item');
  static const _unsupported = <String, Object?>{'supported': false};

  static Map<String, Object?> _plain(Map<Object?, Object?>? state) => {
        'supported': state?['supported'] == true,
        'enabled': state?['enabled'] == true,
        'pending': state?['pending'] == true,
      };

  static Future<Map<String, Object?>> change(bool? enabled) async {
    if (!Platform.isMacOS) return _unsupported;
    try {
      final state = await _channel.invokeMethod<Map<Object?, Object?>>(enabled == null ? 'status' : 'set', enabled);
      return _plain(state);
    } on PlatformException catch (error) {
      var state = _unsupported;
      try {
        state = _plain(await _channel.invokeMethod<Map<Object?, Object?>>('status'));
      } on PlatformException catch (_) {}
      return {...state, 'error': error.message ?? error.code};
    } on MissingPluginException {
      return _unsupported;
    }
  }

  static Future<bool> openSettings() async {
    if (!Platform.isMacOS) return false;
    try {
      return await _channel.invokeMethod<bool>('openSettings') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
