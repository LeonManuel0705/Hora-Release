// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:io';

import 'package:app/services/reminder_scheduler.dart';
import 'package:app/web_ui/ui_api.dart';
import 'package:app/web_ui/ui_reminders.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

class _Alarms implements ReminderAlarms {
  bool permitted = true;
  bool precise = true;
  final scheduled = <int, (UiReminder, bool)>{};
  final log = <String>[];
  String? failing;

  @override
  Future<bool> allowed() async => permitted;

  @override
  Future<bool> exact() async => precise;

  @override
  Future<void> schedule(int id, UiReminder reminder, {required bool exact}) async {
    if (reminder.key == failing) throw StateError('alarm refused');
    scheduled[id] = (reminder, exact);
    log.add('schedule ${reminder.key}');
  }

  @override
  Future<void> cancel(int id) async {
    final gone = scheduled.remove(id);
    log.add('cancel ${gone?.$1.key ?? id}');
  }
}

UiReminder _reminder(String key, DateTime at, [String body = 'Mathe um 8:00 in R101.']) =>
    UiReminder(key: key, at: at, title: 'Titel', body: body, kind: 'lessons');

class _Host implements UiHost {
  final areas = <String>[];

  @override
  Future<UiPlan?> plan({bool fresh = false}) async => null;

  @override
  Future<Map<String, Object?>> connectIserv(String url, String user, String password) async => {'success': false};

  @override
  Future<void> disconnectIserv() async {}

  @override
  Map<String, Object?> iservStatus() => {'connected': false, 'has_credentials': false};

  @override
  Future<int> changeState(String name) async => 0;

  @override
  Future<void> themeChoice(String? choice) async {}

  @override
  void dataChanged(String area) => areas.add(area);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _Alarms alarms;
  late List<UiReminder> plan;
  late DateTime now;
  late ReminderScheduler scheduler;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    alarms = _Alarms();
    now = DateTime(2026, 11, 9, 7);
    plan = [
      _reminder('lesson:2026-11-09:1', DateTime(2026, 11, 9, 7, 50)),
      _reminder('lesson:2026-11-09:2', DateTime(2026, 11, 9, 9, 40)),
      _reminder('deadline:test-1:2026-11-09', DateTime(2026, 11, 9, 18)),
    ];
    scheduler = ReminderScheduler(alarms: alarms, source: (_) async => List.of(plan), clock: () => now);
  });

  test('the first plan sets every alarm, a later one only touches what changed', () async {
    await scheduler.reschedule();
    expect(alarms.scheduled.length, 3);
    expect(alarms.scheduled.values.every((entry) => entry.$2), isTrue, reason: 'exact alarms are allowed');
    alarms.log.clear();

    await scheduler.reschedule();
    expect(alarms.log, isEmpty);

    plan[1] = _reminder('lesson:2026-11-09:2', DateTime(2026, 11, 9, 9, 40), 'Physik um 9:50 in R110.');
    plan.removeAt(2);
    plan.add(_reminder('event:loc-a:2026-11-09', DateTime(2026, 11, 9, 14, 45)));
    await scheduler.reschedule();
    expect(alarms.log, unorderedEquals(['cancel deadline:test-1:2026-11-09', 'schedule lesson:2026-11-09:2', 'schedule event:loc-a:2026-11-09']));
    expect(alarms.scheduled[ReminderScheduler.idFor('lesson:2026-11-09:2')]!.$1.body, 'Physik um 9:50 in R110.');
    expect(alarms.scheduled.length, 3);
  });

  test('the page copy of a planned reminder is recognised until three days after it was due', () async {
    await scheduler.reschedule();
    expect(await scheduler.covers('lesson:2026-11-09:1'), isTrue);
    expect(await scheduler.covers('lesson:2026-11-10:1'), isFalse);

    now = DateTime(2026, 11, 9, 8);
    plan.removeAt(0);
    alarms.log.clear();
    await scheduler.reschedule();
    expect(alarms.log, isEmpty, reason: 'a delivered reminder is never cancelled, that would take it off the screen');
    expect(await scheduler.covers('lesson:2026-11-09:1'), isTrue);

    now = DateTime(2026, 11, 12, 8);
    plan.clear();
    await scheduler.reschedule();
    expect(await scheduler.covers('lesson:2026-11-09:1'), isFalse);
  });

  test('without permission nothing is planned and the coming alarms are cancelled', () async {
    await scheduler.reschedule();
    now = DateTime(2026, 11, 9, 8);
    alarms.permitted = false;
    alarms.log.clear();
    await scheduler.reschedule();
    expect(alarms.log, unorderedEquals(['cancel lesson:2026-11-09:2', 'cancel deadline:test-1:2026-11-09']));
    expect(await scheduler.covers('lesson:2026-11-09:2'), isFalse);
    expect(await scheduler.covers('lesson:2026-11-09:1'), isTrue);
  });

  test('a whole run sets every alarm again, as after a reboot', () async {
    await scheduler.reschedule();
    alarms.log.clear();
    await scheduler.reschedule(whole: true);
    expect(alarms.log, hasLength(3));
    expect(alarms.log.every((line) => line.startsWith('schedule')), isTrue);
    alarms.log.clear();
    now = now.add(const Duration(hours: 21));
    plan = [_reminder('lesson:2026-11-10:1', DateTime(2026, 11, 10, 7, 50))];
    await scheduler.reschedule();
    expect(alarms.log, ['schedule lesson:2026-11-10:1']);
  });

  test('an alarm about to go off is left alone by a plan made seconds before', () async {
    await scheduler.reschedule();
    now = DateTime(2026, 11, 9, 7, 49, 45);
    alarms.log.clear();
    await scheduler.reschedule();
    expect(alarms.log, isEmpty);
    expect(await scheduler.covers('lesson:2026-11-09:1'), isTrue);
  });

  test('the page copy of a reminder is judged by the plan that follows a change', () async {
    await scheduler.reschedule();
    now = DateTime(2026, 11, 9, 9, 36);
    scheduler.markChanged();
    var answered = false;
    final answer = scheduler.covers('lesson:2026-11-09:2').whenComplete(() => answered = true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(answered, isFalse, reason: 'it waits while a change has no plan yet');
    plan[1] = _reminder('lesson:2026-11-09:2', DateTime(2026, 11, 9, 9, 35));
    await scheduler.reschedule();
    expect(await answer, isFalse, reason: 'the reminder moved into the past, so the page shows it');
    expect(alarms.log, contains('cancel lesson:2026-11-09:2'));
  });

  test('a change without a following plan holds the page copy only briefly', () async {
    final brief = ReminderScheduler(alarms: alarms, source: (_) async => List.of(plan), clock: () => now, patience: const Duration(milliseconds: 50));
    await brief.reschedule();
    brief.markChanged();
    expect(await brief.covers('lesson:2026-11-09:1'), isTrue);
  });

  test('an alarm is exact only where the system allows it', () async {
    alarms.precise = false;
    await scheduler.reschedule();
    expect(alarms.scheduled.values.any((entry) => entry.$2), isFalse);
  });

  test('a refused alarm is tried again by the next plan, and one due right now is left to the page', () async {
    alarms.failing = 'lesson:2026-11-09:2';
    plan.add(_reminder('task:t1:2026-11-09', now.add(const Duration(seconds: 10))));
    await scheduler.reschedule();
    expect(alarms.scheduled.length, 2);
    expect(await scheduler.covers('lesson:2026-11-09:2'), isFalse);
    expect(await scheduler.covers('task:t1:2026-11-09'), isFalse);
    alarms.failing = null;
    alarms.log.clear();
    await scheduler.reschedule();
    expect(alarms.log, ['schedule lesson:2026-11-09:2']);
  });

  test('plans asked for while one runs are folded into a single further run', () async {
    var runs = 0;
    final gate = Completer<void>();
    final slow = ReminderScheduler(
      alarms: alarms,
      clock: () => now,
      source: (_) async {
        runs++;
        if (runs == 1) await gate.future;
        return List.of(plan);
      },
    );
    final first = slow.reschedule();
    final second = slow.reschedule();
    final third = slow.reschedule(whole: true);
    gate.complete();
    await Future.wait([first, second, third]);
    expect(runs, 2);
  });

  test('ids stay the same for a key and never collide inside one plan', () {
    final keys = [for (var day = 1; day <= 30; day++) for (var block = 1; block <= 10; block++) 'lesson:2026-11-$day:$block'];
    final ids = ReminderScheduler.idsFor(keys);
    expect(ids.values.toSet().length, keys.length);
    expect(ids.values.every((id) => id >= ReminderScheduler.firstId && id <= 0x7fffffff), isTrue);
    expect(ReminderScheduler.idFor('lesson:2026-11-9:1'), ReminderScheduler.idFor('lesson:2026-11-9:1'));
    expect(ids['lesson:2026-11-9:1'], ReminderScheduler.idFor('lesson:2026-11-9:1'));
  });

  group('with the data of the phone app', () {
    late Directory folder;

    setUpAll(() async {
      HttpOverrides.global = null;
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
      folder = await Directory.systemTemp.createTemp('reminder-plan-');
      await databaseFactoryFfi.setDatabasesPath(folder.path);
      PathProviderPlatform.instance = FakePathProvider(folder.path);
    });

    tearDownAll(() async {
      try {
        await folder.delete(recursive: true);
      } catch (_) {}
    });

    Future<UiReply> send(UiApi api, String method, String path, Object? body) => api.handle(UiRequest(
          method: method,
          segments: Uri.parse(path).pathSegments.skip(1).toList(),
          query: const {},
          json: true,
          body: body,
        ));

    test('what the pages save is what the phone plans, and saving asks for a new plan', () async {
      SharedPreferences.setMockInitialValues({'user_bundesland': 'Brandenburg'});
      final host = _Host();
      final api = UiApi(host);
      final today = DateTime.now();
      final tomorrow = DateTime(today.year, today.month, today.day + 1);
      final iso = '${tomorrow.year}-${tomorrow.month.toString().padLeft(2, '0')}-${tomorrow.day.toString().padLeft(2, '0')}';
      expect((await send(api, 'PUT', '/api/ui/store/app-settings', {
        'notify': {'enabled': true, 'quiet': {'from': '22:00', 'to': '07:00'}},
      })).status, 200);
      expect(host.areas, contains('reminders'));
      expect((await send(api, 'POST', '/api/ui/deadlines', {'kind': 'Test', 'title': 'Vokabeltest', 'date': iso})).status, 200);
      expect((await send(api, 'POST', '/api/ui/tasks', {'title': 'Lernen', 'date': iso})).status, 200);
      expect((await send(api, 'POST', '/api/ui/events', {'title': 'Chor', 'date': iso, 'start': '16:00', 'end': '17:00'})).status, 200);

      final planned = await ReminderScheduler.planFromDevice(DateTime(today.year, today.month, today.day, 0, 1));
      final titles = {for (final item in planned) item.key.split(':').first: item.title};
      expect(titles['deadline'], 'Test: Vokabeltest');
      expect(titles['tasks'], 'Heute fällig');
      expect(titles['event'], 'Chor');
      final chor = planned.firstWhere((item) => item.key.startsWith('event:'));
      expect([chor.at.hour, chor.at.minute], [15, 45]);
    });
  });
}
