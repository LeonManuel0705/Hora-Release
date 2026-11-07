// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final shell = File('web/index.html').readAsStringSync();
  final page = File('../app/static/app/js/plan-share.js').readAsStringSync();

  test('the shell hands a plan link to the page under the key the page reads', () {
    final key = RegExp(r'const PENDING_KEY = "([^"]+)"').firstMatch(page)!.group(1)!;
    expect(shell, contains("sessionStorage.setItem('$key'"));
    expect(shell, contains("type: 'plan-link'"));
    expect(page, contains('event.data.type === "plan-link"'));
  });

  test('the link leaves the address before the app or its back handling sees it', () {
    final capture = shell.indexOf("window.addEventListener('popstate', function (event) {\n        if (catchPlan())");
    expect(capture, isNonNegative);
    expect(capture, lessThan(shell.indexOf('window.hubHistory')));
    expect(capture, lessThan(shell.indexOf('flutter_bootstrap.js')));
    expect(shell.indexOf('catchPlan();'), lessThan(capture));
  });
}
