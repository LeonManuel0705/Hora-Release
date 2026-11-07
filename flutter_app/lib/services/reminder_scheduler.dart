// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:shared_preferences/shared_preferences.dart';

import '../web_ui/ui_data.dart';
import '../web_ui/ui_db.dart';
import '../web_ui/ui_reminders.dart';
import 'notification_service.dart';

abstract class ReminderAlarms {
  Future<bool> allowed();
  Future<bool> exact();
  Future<void> schedule(int id, UiReminder reminder, {required bool exact});
  Future<void> cancel(int id);
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
  ReminderScheduler({required this.alarms, ReminderSource? source, DateTime Function()? clock})
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
  final ReminderSource _source;
  final DateTime Function() _clock;
  Future<void>? _running;
  bool _again = false;
  bool _againWhole = false;

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

  Future<void> reschedule({bool whole = false}) {
    final running = _running;
    if (running != null) {
      _again = true;
      _againWhole |= whole;
      return running;
    }
    return _running = _run(whole).whenComplete(() => _running = null);
  }

  Future<void> _run(bool whole) async {
    var next = whole;
    do {
      _again = false;
      try {
        await _sync(next);
      } catch (error) {
        if (kDebugMode) print('ReminderScheduler: $error');
      }
      next = _againWhole;
      _againWhole = false;
    } while (_again);
  }

  Future<Map<String, _Planned>> _registry(SharedPreferences prefs) async {
    await prefs.reload();
    final raw = prefs.getString(registryKey);
    if (raw == null) return {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return {};
      final result = <String, _Planned>{};
      decoded.forEach((key, value) {
        final planned = _Planned.fromJson(value);
        if (key is String && planned != null) result[key] = planned;
      });
      return result;
    } on FormatException {
      return {};
    }
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

  Future<void> _sync(bool whole) async {
    final prefs = await SharedPreferences.getInstance();
    final known = await _registry(prefs);
    final now = _clock();
    final last = prefs.getInt(wholeKey);
    final everything = whole || last == null || now.difference(DateTime.fromMillisecondsSinceEpoch(last)) > wholeEvery;
    final allowed = await alarms.allowed();
    if (!allowed && known.isEmpty) return;
    final soonest = now.add(lead);
    final plan = [
      if (allowed)
        for (final reminder in await _source(now))
          if (reminder.at.isAfter(soonest)) reminder,
    ];
    final wanted = {for (final reminder in plan) reminder.key: reminder};
    final ids = idsFor(wanted.keys);
    final exact = plan.isNotEmpty && await alarms.exact();
    final next = <String, _Planned>{};
    for (final MapEntry(:key, value: entry) in known.entries) {
      if (!entry.at.isAfter(soonest)) {
        if (now.difference(entry.at) < keep) next[key] = entry;
      } else if (!wanted.containsKey(key) || ids[key] != entry.id) {
        await _quietly(() => alarms.cancel(entry.id));
      }
    }
    for (final reminder in plan) {
      final id = ids[reminder.key]!;
      final before = known[reminder.key];
      if (!everything && before != null && before.at.isAfter(now) && before.id == id && before.fingerprint == reminder.fingerprint) {
        next[reminder.key] = before;
      } else if (await _quietly(() => alarms.schedule(id, reminder, exact: exact))) {
        next[reminder.key] = _Planned(id, reminder.at, reminder.fingerprint);
      }
    }
    await prefs.setString(registryKey, jsonEncode({for (final entry in next.entries) entry.key: entry.value.toJson()}));
    if (everything) await prefs.setInt(wholeKey, now.millisecondsSinceEpoch);
  }

  Future<bool> covers(String key) async {
    final running = _running;
    if (running != null) await running;
    final entry = (await _registry(await SharedPreferences.getInstance()))[key];
    return entry != null && _clock().difference(entry.at) < keep;
  }
}
