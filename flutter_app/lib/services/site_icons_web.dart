// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:typed_data';

// A page in the browser may not read other sites, so there the bookmarks keep their letter.
Future<Uint8List?> loadSiteIcon(String url) async => null;

Future<void> forgetSiteIcon(String url, Iterable<String> stillUsed) async {}
