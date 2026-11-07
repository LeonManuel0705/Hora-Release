// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const _viewKeys = {'app-task-filter', 'app-cal-view', 'app-motion', 'app-theme-choice', 'app-single-keys'};

bool savesUserData(String method, String path, int status) {
  if (method == 'GET' || status >= 400 || !path.startsWith('/api/ui/')) return false;
  final segments = Uri.parse(path).pathSegments;
  return !(segments.length == 4 && segments[2] == 'store' && _viewKeys.contains(segments[3]));
}
