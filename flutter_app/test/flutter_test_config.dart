// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';

import 'package:app/web_ui/ui_pages.dart';

/// Every test starts with accounts off, so none reaches the live account service. A test that needs an account
/// service sets [UiPages.accountService] itself.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  UiPages.accountService = null;
  await testMain();
}
