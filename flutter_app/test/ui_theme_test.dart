// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/web_ui/ui_pages.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  Future<String> themeOf(Map<String, Object?> store, [Map<String, Object> prefs = const {}]) async {
    SharedPreferences.setMockInitialValues(prefs);
    return UiPages.themeOf(store, await SharedPreferences.getInstance());
  }

  test('without a stored choice the pages follow the system until a scheme is picked', () async {
    expect(await themeOf({}), 'auto');
    expect(await themeOf({'app-theme-choice': 'light'}), 'light');
    expect(await themeOf({'app-theme-choice': 'dark'}), 'dark');
    expect(await themeOf({'app-theme-choice': 'auto'}, {'theme_switch_mode': 'manual', 'theme_mode': 'dark'}), 'auto');
  });

  test('a scheme picked in the older app screens carries over', () async {
    expect(await themeOf({}, {'theme_switch_mode': 'manual', 'theme_mode': 'light'}), 'light');
    expect(await themeOf({}, {'theme_switch_mode': 'system', 'theme_mode': 'dark'}), 'auto');
  });

  test('a new install starts light, one that already has data keeps following the system', () async {
    Future<bool> first(Map<String, Object?> store, {Map<String, Object> prefs = const {}, bool device = false, int tasks = 0}) async {
      SharedPreferences.setMockInitialValues(prefs);
      return UiPages.firstStart(store, await SharedPreferences.getInstance(), device: device, tasks: tasks);
    }

    expect(await first({}), isTrue);
    expect(await first({}, device: true), isFalse, reason: 'the pages ran here before');
    expect(await first({}, tasks: 2), isFalse);
    expect(await first({'app-motion': 'calm'}), isFalse);
    expect(await first({}, prefs: {'tour_state': 'done'}), isFalse);
    expect(await first({}, prefs: {'theme_switch_mode': 'system'}), isFalse, reason: 'a scheme from the older app screens');
  });
}
