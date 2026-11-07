// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:shared_preferences/shared_preferences.dart';

import '../web_ui/ui_data.dart';
import '../web_ui/ui_db.dart';
import '../web_ui/ui_reminders.dart';
import 'android_device.dart';
import 'notification_service.dart';

abstract class ReminderAlarms {
  Future<bool> allowed();
  Future<bool> exact();
  Future<void> schedule(int id, UiReminder reminder, {required bool exact});
  Future<void> cancel(int id);

  /// The ones among [ids] the system no longer holds, after a force stop or a reboot.
  Future<Set<int>> missing(List<int> ids);

  /// Every reminder the notification plugin keeps planned, also those another isolate set.
  Future<Set<int>> pending();
}

typedef ReminderSource = Future<List<UiReminder>> Function(DateTime now);

class _DeviceAlarms implements ReminderAlarms {
  final _service = NotificationService();

  @override
  Future<bool> allowed() => _service.remindersAllowed();

  @override
  Future<bool> exact() => _service.exactAlarmsAllowed();

  @override
  Future<void> schedule(int id, UiReminder reminder, {required bool exact}) => _service.scheduleReminder(
        id: id,
        at: reminder.at,
        title: reminder.title,
        body: reminder.body,
        silent: reminder.silent,
        until: reminder.until,
        exact: exact,
      );

  @override
  Future<void> cancel(int id) => _service.cancel(id);

  @override
  Future<Set<int>> missing(List<int> ids) async => await AndroidDevice.missingAlarms(ids) ?? ids.toSet();

  @override
  Future<Set<int>> pending() => _service.pendingIds();
}

class _Planned {
  const _Planned(this.id, this.at, this.fingerprint);

  final int id;
  final DateTime at;
  final String fingerprint;

  List<Object> toJson() => [id, at.millisecondsSinceEpoch, fingerprint];

  static _Planned? fromJson(Object? value) {
    if (value is! List || value.length != 3 || value[0] is! int || value[1] is! int || value[2] is! String) return null;
    return _Planned(value[0] as int, DateTime.fromMillisecondsSinceEpoch(value[1] as int), value[2] as String);
  }
}

class ReminderScheduler {
  ReminderScheduler({required this.alarms, ReminderSource? source, DateTime Function()? clock, this.patience = const Duration(seconds: 3)})
      : _source = source ?? planFromDevice,
        _clock = clock ?? DateTime.now;

  static final instance = ReminderScheduler(alarms: _DeviceAlarms());

  static const registryKey = 'reminder_plan';
  static const wholeKey = 'reminder_plan_whole';
  static const keep = Duration(days: 3);
  static const wholeEvery = Duration(hours: 20);
  static const lead = Duration(seconds: 30);
  static const firstId = 0x40000000;

  final ReminderAlarms alarms;
  final Duration patience;
  final ReminderSource _source;
  final DateTime Function() _clock;
  Future<bool>? _running;
  bool _again = false;
  bool _againWhole = false;
  bool _dirty = false;
  Completer<void>? _caughtUp;

  static Future<List<UiReminder>> planFromDevice(DateTime now) async {
    final db = await UiDb.open();
    final prefs = await SharedPreferences.getInstance();
    final store = await UiDb.store(db);
    final data = await UiData(db, prefs, now).build('home', store);
    return uiPlanReminders(data, store, now);
  }

  static int idFor(String key) {
    var hash = 0x811c9dc5;
    for (final unit in utf8.encode(key)) {
      hash = ((hash ^ unit) * 0x01000193) & 0xffffffff;
    }
    return firstId | (hash & 0x3fffffff);
  }

  static Map<String, int> idsFor(Iterable<String> keys) {
    final ids = <String, int>{};
    final taken = <int>{};
    for (final key in [...keys]..sort()) {
      var id = idFor(key);
      while (!taken.add(id)) {
        id = id == 0x7fffffff ? firstId : id + 1;
      }
      ids[key] = id;
    }
    return ids;
  }

  /// Called the moment data changes, before the debounced plan runs, so the page's copy of a
  /// reminder is judged by the plan that follows the change, not by the one before it.
  void markChanged() {
    _dirty = true;
    _caughtUp ??= Completer<void>();
  }

  /// Completes with false when a step failed, so a background run asks WorkManager to retry.
  Future<bool> reschedule({bool whole = false}) {
    final running = _running;
    if (running != null) {
      _again = true;
      _againWhole |= whole;
      return running;
    }
    return _running = _run(whole).whenComplete(() => _running = null);
  }

  Future<bool> _run(bool whole) async {
    var next = whole;
    var done = true;
    do {
      _again = false;
      _dirty = false;
      try {
        done = await _sync(next);
      } catch (error) {
        if (kDebugMode) print('ReminderScheduler: $error');
        done = false;
      }
      next = _againWhole;
      _againWhole = false;
    } while (_again);
    if (!_dirty) {
      _caughtUp?.complete();
      _caughtUp = null;
    }
    return done;
  }

  static (int, Map<String, _Planned>) _decode(String? raw) {
    if (raw == null) return (0, {});
    try {
      final decoded = jsonDecode(raw);
      final items = decoded is Map ? decoded['items'] : null;
      if (items is! Map) return (0, {});
      final result = <String, _Planned>{};
      items.forEach((key, value) {
        final planned = _Planned.fromJson(value);
        if (key is String && planned != null) result[key] = planned;
      });
      return (decoded['rev'] is int ? decoded['rev'] as int : 0, result);
    } on FormatException {
      return (0, {});
    }
  }

  Future<(int, Map<String, _Planned>)> _registry(SharedPreferences prefs) async {
    await prefs.reload();
    return _decode(prefs.getString(registryKey));
  }

  Future<bool> _quietly(Future<void> Function() action) async {
    try {
      await action();
      return true;
    } catch (error) {
      if (kDebugMode) print('ReminderScheduler: $error');
      return false;
    }
  }

  Future<bool> _sync(bool whole) async {
    final prefs = await SharedPreferences.getInstance();
    for (var attempt = 0; attempt < 3; attempt++) {
      final (rev, known) = await _registry(prefs);
      final result = await _apply(prefs, known, whole);
      if (result == null) return true;
      final (done, next, everything, now) = result;
      final (latest, _) = await _registry(prefs);
      if (latest != rev) continue;
      await prefs.setString(registryKey, jsonEncode({
        'rev': rev + 1,
        'items': {for (final entry in next.entries) entry.key: entry.value.toJson()},
      }));
      if (everything) await prefs.setInt(wholeKey, now.millisecondsSinceEpoch);
      return done;
    }
    return false;
  }

  Future<(bool, Map<String, _Planned>, bool, DateTime)?> _apply(SharedPreferences prefs, Map<String, _Planned> known, bool whole) async {
    final now = _clock();
    final last = prefs.getInt(wholeKey);
    final everything = whole || last == null || now.difference(DateTime.fromMillisecondsSinceEpoch(last)) > wholeEvery;
    final allowed = await alarms.allowed();
    if (!allowed && known.isEmpty) return null;
    final soonest = now.add(lead);
    final plan = [
      if (allowed)
        for (final reminder in await _source(now))
          if (reminder.at.isAfter(soonest)) reminder,
    ];
    final wanted = {for (final reminder in plan) reminder.key: reminder};
    final ids = idsFor(wanted.keys);
    final exact = plan.isNotEmpty && await alarms.exact();
    bool unchanged(String key, _Planned? before) =>
        before != null && before.at.isAfter(now) && before.id == ids[key] && before.fingerprint == wanted[key]!.fingerprint;
    final kept = [for (final key in wanted.keys) if (unchanged(key, known[key])) known[key]!.id];
    final lost = everything && kept.isNotEmpty ? await alarms.missing(kept) : const <int>{};
    var done = true;
    final next = <String, _Planned>{};
    for (final MapEntry(:key, value: entry) in known.entries) {
      if (!entry.at.isAfter(soonest)) {
        if (now.difference(entry.at) < keep) next[key] = entry;
      } else if (!wanted.containsKey(key) || ids[key] != entry.id) {
        done &= await _quietly(() => alarms.cancel(entry.id));
      }
    }
    for (final reminder in plan) {
      final id = ids[reminder.key]!;
      final before = known[reminder.key];
      if (unchanged(reminder.key, before) && !lost.contains(id)) {
        next[reminder.key] = before!;
      } else if (await _quietly(() => alarms.schedule(id, reminder, exact: exact))) {
        next[reminder.key] = _Planned(id, reminder.at, reminder.fingerprint);
      } else {
        done = false;
      }
    }
    if (everything) {
      final planned = {for (final entry in next.values) entry.id};
      for (final id in await alarms.pending()) {
        if (id >= firstId && !planned.contains(id)) done &= await _quietly(() => alarms.cancel(id));
      }
    }
    return (done, next, everything, now);
  }

  Future<bool> covers(String key) async {
    final caughtUp = _caughtUp;
    if (caughtUp != null) await caughtUp.future.timeout(patience, onTimeout: () {});
    final running = _running;
    if (running != null) await running;
    final (_, known) = await _registry(await SharedPreferences.getInstance());
    final entry = known[key];
    return entry != null && _clock().difference(entry.at) < keep;
  }
}
