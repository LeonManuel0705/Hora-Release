// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/web_ui/lasting_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('saving an entry, a lesson or a setting counts as data worth keeping', () {
    for (final (method, path) in const [
      ('POST', '/api/ui/tasks'),
      ('POST', '/api/ui/grades'),
      ('PATCH', '/api/ui/deadlines/abc'),
      ('DELETE', '/api/ui/events/abc'),
      ('PUT', '/api/ui/store/app-timetable-edits'),
      ('PUT', '/api/ui/store/app-subjects'),
      ('PUT', '/api/ui/store/app-settings'),
      ('PUT', '/api/ui/places/home'),
    ]) {
      expect(savesUserData(method, path, 200), isTrue, reason: '$method $path');
    }
  });

  test('reading, failing, the tour and view choices do not ask for lasting storage', () {
    expect(savesUserData('GET', '/api/ui/export', 200), isFalse);
    expect(savesUserData('POST', '/api/ui/tasks', 400), isFalse);
    expect(savesUserData('POST', '/api/hub/tour', 200), isFalse);
    for (final key in const ['app-task-filter', 'app-cal-view', 'app-motion', 'app-theme-choice', 'app-single-keys']) {
      expect(savesUserData('PUT', '/api/ui/store/$key', 200), isFalse, reason: key);
    }
  });
}
