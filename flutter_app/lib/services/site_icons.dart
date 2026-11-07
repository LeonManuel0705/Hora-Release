// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/foundation.dart';

import 'site_icons_web.dart' if (dart.library.io) 'site_icons_native.dart' as platform;

typedef SiteIconLoader = Future<Uint8List?> Function(String url);

@visibleForTesting
SiteIconLoader siteIconLoader = platform.loadSiteIcon;

/// The icon the bookmarked site declares for itself, or nothing where it has none or cannot be asked.
Future<Uint8List?> siteIcon(String url) async {
  try {
    return await siteIconLoader(url);
  } on Object {
    return null;
  }
}

/// Whether an icon is kept, the site had none lately, or nothing is known, without asking the site.
Future<bool?> knownSiteIcon(String url) async {
  try {
    return await platform.siteIconKnown(url);
  } on Object {
    return null;
  }
}

Future<void> forgetSiteIcon(String url, Iterable<String> stillUsed) async {
  try {
    await platform.forgetSiteIcon(url, stillUsed);
  } on Object {
    // nothing was kept
  }
}
