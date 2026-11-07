// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

import '../brand.dart';
import 'site_icon_store.dart';

Future<Directory>? _folder;

final _store = SiteIconStore(
  folder: () => _folder ??= getApplicationSupportDirectory().then((support) => Directory('${support.path}/bookmark_icons')),
  agent: 'Mozilla/5.0 (compatible; ${Brand.name}; +${Brand.repository})',
);

Future<Uint8List?> loadSiteIcon(String url) => _store.iconFor(url);

Future<bool?> siteIconKnown(String url) => _store.known(url);

Future<void> forgetSiteIcon(String url, Iterable<String> stillUsed) => _store.forget(url, stillUsed: stillUsed);
