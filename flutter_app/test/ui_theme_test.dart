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

  test('a new install follows the system until a scheme is picked', () async {
    expect(await themeOf({}), 'auto');
    expect(await themeOf({'app-theme-choice': 'light'}), 'light');
    expect(await themeOf({'app-theme-choice': 'dark'}), 'dark');
    expect(await themeOf({'app-theme-choice': 'auto'}, {'theme_switch_mode': 'manual', 'theme_mode': 'dark'}), 'auto');
  });

  test('a scheme picked in the older app screens carries over', () async {
    expect(await themeOf({}, {'theme_switch_mode': 'manual', 'theme_mode': 'light'}), 'light');
    expect(await themeOf({}, {'theme_switch_mode': 'system', 'theme_mode': 'dark'}), 'auto');
  });
}
