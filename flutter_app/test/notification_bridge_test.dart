// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/services/notification_service.dart';
import 'package:app/web_ui/mobile_shell.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _System {
  bool enabled = false;
  bool answer = false;
  Object? failure;
  var asked = 0;

  NotificationPermission permission() => NotificationPermission(
        enabled: () async => enabled,
        request: () async {
          asked++;
          final error = failure;
          if (error != null) throw error;
          enabled = answer;
          return answer;
        },
      );
}

void main() {
  late _System system;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    system = _System();
  });

  test('an app that may notify reads granted and is never asked', () async {
    system.enabled = true;
    final permission = system.permission();
    expect(await permission.read(), 'granted');
    expect(await permission.ask(), 'granted');
    expect(system.asked, 0);
  });

  test('the first question shows the system prompt and gives its real answer', () async {
    system.answer = true;
    final permission = system.permission();
    expect(await permission.read(), 'default');
    expect(await permission.ask(), 'granted');
    expect(system.asked, 1);
    expect(await permission.read(), 'granted');
  });

  test('a refusal reads denied from then on, without a second prompt', () async {
    final permission = system.permission();
    expect(await permission.ask(), 'denied');
    expect(await permission.ask(), 'denied');
    expect(await system.permission().read(), 'denied', reason: 'it survives a restart');
    expect(system.asked, 1);
  });

  test('allowing it later in the system settings reads granted again', () async {
    final permission = system.permission();
    await permission.ask();
    system.enabled = true;
    expect(await permission.read(), 'granted');
    system.enabled = false;
    expect(await permission.read(), 'denied');
  });

  test('a prompt that cannot open keeps the answer open and remembers nothing', () async {
    system.failure = StateError('a request is already running');
    final permission = system.permission();
    expect(await permission.ask(), 'default');
    expect((await SharedPreferences.getInstance()).getBool(NotificationPermission.deniedKey), isNull);
  });

  test('the page script hands reminders and the permission question to the app', () async {
    final node = await Process.run('node', ['--version']).then((result) => result.exitCode == 0).catchError((Object _) => false);
    if (!node) {
      markTestSkipped('node is not installed');
      return;
    }
    final folder = await Directory.systemTemp.createTemp('start-script-');
    addTearDown(() => folder.delete(recursive: true));
    final script = File('${folder.path}/start.js')..writeAsStringSync(mobileStartScript(ios: false, insets: '', permission: 'default'));
    final run = await Process.run('node', ['test/js/start_script_check.mjs', script.path], stdoutEncoding: utf8, stderrEncoding: utf8);
    expect(run.exitCode, 0, reason: '${run.stdout}${run.stderr}');
    expect('${run.stdout}', 'ok');
  });

  test('the permission the page starts with is the one the app knows', () {
    for (final state in ['granted', 'denied', 'default']) {
      expect(mobileStartScript(ios: false, insets: '', permission: state), contains('var permission = "$state";'));
    }
  });
}
