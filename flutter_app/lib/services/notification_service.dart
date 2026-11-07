// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode;
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:url_launcher/url_launcher.dart';

import '../brand.dart';


final _trustedNotificationDomains = [
  Uri.parse(Brand.website).host,
  'github.com',
];


@pragma('vm:entry-point')
void _onNotificationTapped(NotificationResponse response) {
  final payload = response.payload;
  if (payload == null || !payload.startsWith('https://')) return;
  final uri = Uri.tryParse(payload);
  if (uri == null) return;
  final host = uri.host.toLowerCase();
  final isTrusted = _trustedNotificationDomains.any(
    (d) => host == d || host.endsWith('.$d'),
  );
  if (isTrusted) {
    launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// Android only tells whether the app may notify, never whether it already asked. A refusal
/// is remembered so the page reads "denied" afterwards, the way a browser answers, and is
/// not asked again on every new test.
class NotificationPermission {
  NotificationPermission({required this.enabled, required this.request, Future<SharedPreferences> Function()? prefs})
      : _prefs = prefs ?? SharedPreferences.getInstance;

  static const deniedKey = 'notifications_denied';

  final Future<bool> Function() enabled;
  final Future<bool> Function() request;
  final Future<SharedPreferences> Function() _prefs;

  Future<String> read() async {
    if (await enabled()) return 'granted';
    return (await _prefs()).getBool(deniedKey) == true ? 'denied' : 'default';
  }

  Future<String> ask() async {
    final before = await read();
    if (before != 'default') return before;
    final bool granted;
    try {
      granted = await request();
    } catch (_) {
      return before;
    }
    final prefs = await _prefs();
    if (granted) {
      await prefs.remove(deniedKey);
    } else {
      await prefs.setBool(deniedKey, true);
    }
    return granted ? 'granted' : 'denied';
  }
}

enum NotificationKind {
  reminders('reminders', 'Erinnerungen', 'Vor Stunden, Tests, Abgaben und Terminen'),
  updates('updates', 'Updates', 'Benachrichtigungen über neue ${Brand.name}-Versionen'),
  iserv('iserv', 'IServ', 'Neue Nachrichten aus IServ');

  const NotificationKind(this.id, this.title, this.description);

  final String id;
  final String title;
  final String description;
}

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  static const _macChannel = MethodChannel('app/notifications');

  final FlutterLocalNotificationsPlugin _flnPlugin = FlutterLocalNotificationsPlugin();

  bool _initialized = false;
  bool _permissionGranted = false;
  bool _denied = false;
  Future<void>? _initializing;

  bool get _isMacOS => !kIsWeb && Platform.isMacOS;
  bool get _isAndroid => !kIsWeb && Platform.isAndroid;
  // flutter_local_notifications has no Windows implementation, so Windows is
  // deliberately excluded — otherwise init/show silently throw and are swallowed,
  // making it look supported when it is not. (Desktop update prompts are shown
  // via the in-app update dialog instead.)
  bool get _useFLN =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS || Platform.isLinux);
  bool get isInitialized => _initialized;
  bool get permissionGranted => _permissionGranted;

  /// The answer `Notification.permission` gives in the app's page: granted, denied or default.
  String get permission => _permissionGranted ? 'granted' : _denied ? 'denied' : 'default';

  AndroidFlutterLocalNotificationsPlugin? get _android =>
      _flnPlugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();

  late final _androidPermission = NotificationPermission(
    enabled: () async => await _android?.areNotificationsEnabled() ?? false,
    request: () async => await _android?.requestNotificationsPermission() ?? false,
  );

  void _take(String state) {
    _permissionGranted = state == 'granted';
    _denied = state == 'denied';
  }

  Future<void> initialize() => _initializing ??= _initialize();

  Future<void> _initialize() async {
    if (_isMacOS) {
      _initialized = true;
      await refreshPermission();
      if (kDebugMode) print('NotificationService: macOS native channel initialized, permissionGranted=$_permissionGranted');
    } else if (_useFLN) {
      try {
        const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
        const iosSettings = DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        );
        const linuxSettings = LinuxInitializationSettings(defaultActionName: 'Open');
        const initSettings = InitializationSettings(
          android: androidSettings,
          iOS: iosSettings,
          linux: linuxSettings,
        );

        final result = await _flnPlugin.initialize(
          initSettings,
          onDidReceiveNotificationResponse: _onNotificationTapped,
        );
        _initialized = result ?? false;
        await refreshPermission();
        if (kDebugMode) print('NotificationService: FLN initialized=$_initialized, permissionGranted=$_permissionGranted');
      } catch (e) {
        _initialized = true;
        if (kDebugMode) print('NotificationService: FLN initialize() error: $e');
      }
    }
  }

  /// Reads whether the system lets the app notify, without ever asking the user.
  Future<String> refreshPermission() async {
    try {
      if (_isMacOS) {
        final status = (await _macChannel.invokeMapMethod<String, int>('getAuthorizationStatus'))?['status'];
        _permissionGranted = status == 2 || status == 3 || status == 4;
        _denied = status == 1;
      } else if (_isAndroid) {
        _take(await _androidPermission.read());
      } else if (!kIsWeb && Platform.isIOS) {
        final options = await _flnPlugin
            .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
            ?.checkPermissions();
        _permissionGranted = options?.isEnabled ?? false;
      } else if (_useFLN) {
        _permissionGranted = _initialized;
      }
    } catch (e) {
      if (kDebugMode) print('NotificationService: refreshPermission() error: $e');
    }
    return permission;
  }


  Future<bool> showNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
    NotificationKind kind = NotificationKind.updates,
    bool silent = false,
  }) async {
    if (!_initialized) {
      if (kDebugMode) print('NotificationService: showNotification skipped — not initialized');
      return false;
    }

    if (_isMacOS) {
      return _showMacNotification(id: id, title: title, body: body, payload: payload);
    } else if (_useFLN) {
      return _showFLNNotification(id: id, title: title, body: body, payload: payload, kind: kind, silent: silent);
    }

    return false;
  }

  Future<bool> _showMacNotification({required int id, required String title, required String body, String? payload}) async {
    try {
      await _macChannel.invokeMethod('showNotification', {
        'id': id,
        'title': title,
        'body': body,
        if (payload != null) 'payload': payload,
      });
      if (kDebugMode) print('NotificationService: macOS notification sent — id=$id');
      return true;
    } on PlatformException catch (e) {
      if (kDebugMode) print('NotificationService: macOS PlatformException: ${e.code} — ${e.message}');
      return false;
    } catch (e) {
      if (kDebugMode) print('NotificationService: macOS error: $e');
      return false;
    }
  }

  static AndroidNotificationDetails androidDetails(NotificationKind kind, String body, {bool silent = false, Duration? timeout}) =>
      AndroidNotificationDetails(
        kind.id,
        kind.title,
        channelDescription: kind.description,
        importance: Importance.high,
        priority: Priority.high,
        category: kind == NotificationKind.reminders ? AndroidNotificationCategory.reminder : null,
        silent: silent,
        styleInformation: body.contains('\n') || body.length > 40 ? BigTextStyleInformation(body) : null,
        timeoutAfter: timeout == null || timeout <= Duration.zero ? null : timeout.inMilliseconds,
      );

  Future<bool> _showFLNNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
    required NotificationKind kind,
    required bool silent,
  }) async {
    try {
      final details = NotificationDetails(
        android: androidDetails(kind, body, silent: silent),
        iOS: const DarwinNotificationDetails(),
        linux: const LinuxNotificationDetails(),
      );

      await _flnPlugin.show(id, title, body, details, payload: payload);
      if (kDebugMode) print('NotificationService: FLN notification sent — id=$id');
      return true;
    } catch (e) {
      if (kDebugMode) print('NotificationService: FLN error: $e');
      return false;
    }
  }


  /// Shows the system's own question, so only call it when the user just asked for reminders.
  Future<bool> requestPermissions() async {
    if (!_initialized) await initialize();
    try {
      if (_isMacOS) {
        final granted = await _macChannel.invokeMethod<bool>('requestPermissions');
        _permissionGranted = granted ?? false;
        _denied = !_permissionGranted;
      } else if (_isAndroid) {
        _take(await _androidPermission.ask());
      } else if (!kIsWeb && Platform.isIOS) {
        final iosPlugin = _flnPlugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
        _permissionGranted = await iosPlugin?.requestPermissions(
          alert: true,
          badge: true,
          sound: true,
        ) ?? false;
        _denied = !_permissionGranted;
      }
    } catch (e) {
      if (kDebugMode) print('NotificationService: requestPermissions() error: $e');
    }
    return _permissionGranted;
  }

  Future<bool> remindersAllowed() async {
    if (!_isAndroid) return false;
    if (!_initialized) await initialize();
    return await _android?.areNotificationsEnabled() ?? false;
  }

  Future<bool> exactAlarmsAllowed() async {
    if (!_isAndroid) return false;
    return await _android?.canScheduleExactNotifications() ?? false;
  }

  Future<void> scheduleReminder({
    required int id,
    required DateTime at,
    required String title,
    required String body,
    required bool silent,
    required bool exact,
    DateTime? until,
  }) async {
    final android = _android;
    if (!_isAndroid || android == null) return;
    if (!_initialized) await initialize();
    final details = androidDetails(NotificationKind.reminders, body, silent: silent, timeout: until?.difference(at));
    Future<void> plan(AndroidScheduleMode mode) => android.zonedSchedule(id, title, body, tz.TZDateTime.from(at, tz.UTC), details, scheduleMode: mode);
    if (!exact) return plan(AndroidScheduleMode.inexactAllowWhileIdle);
    try {
      await plan(AndroidScheduleMode.exactAllowWhileIdle);
    } on PlatformException catch (e) {
      if (e.code != 'exact_alarms_not_permitted') rethrow;
      await plan(AndroidScheduleMode.inexactAllowWhileIdle);
    }
  }

  Future<void> cancel(int id) async {
    if (!_useFLN) return;
    if (!_initialized) await initialize();
    await _flnPlugin.cancel(id);
  }

  Future<Set<int>> pendingIds() async {
    if (!_isAndroid) return {};
    if (!_initialized) await initialize();
    return {for (final request in await _flnPlugin.pendingNotificationRequests()) request.id};
  }


  Future<Map<String, int>> getAuthorizationStatus() async {
    if (!_isMacOS) return {};
    try {
      final result = await _macChannel.invokeMapMethod<String, int>('getAuthorizationStatus');
      return result ?? {};
    } catch (e) {
      if (kDebugMode) print('NotificationService: getAuthorizationStatus() error: $e');
      return {};
    }
  }
}
