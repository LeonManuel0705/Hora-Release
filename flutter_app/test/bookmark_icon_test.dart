// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:app/services/site_icons.dart';
import 'package:app/widgets/bookmark_icon.dart';

import 'site_icon_images.dart';

void main() {
  final usual = siteIconLoader;
  tearDown(() => siteIconLoader = usual);

  Future<void> show(WidgetTester tester, String url, String title) =>
      tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: BookmarkIcon(url: url, title: title)))));

  testWidgets('the letter stands in until the logo is there', (tester) async {
    final arrives = Completer<Uint8List?>();
    siteIconLoader = (url) => arrives.future;
    await show(tester, 'https://site.test/', '  seite');
    expect(find.text('S'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
    arrives.complete(iconImage('png'));
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('S'), findsNothing);
  });

  testWidgets('without a logo the letter stays, also when asking fails', (tester) async {
    siteIconLoader = (url) async => null;
    await show(tester, 'https://site.test/', 'Übungen');
    await tester.pumpAndSettle();
    expect(find.text('Ü'), findsOneWidget);
    siteIconLoader = (url) async => throw const FormatException('no');
    await show(tester, 'https://other.test/', '');
    await tester.pumpAndSettle();
    expect(find.text('?'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('a new address asks again', (tester) async {
    final asked = <String>[];
    siteIconLoader = (url) async {
      asked.add(url);
      return url.contains('logo') ? iconImage('png') : null;
    };
    await show(tester, 'https://bare.test/', 'Seite');
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsNothing);
    await show(tester, 'https://logo.test/', 'Seite');
    await tester.pumpAndSettle();
    expect(find.byType(Image), findsOneWidget);
    await show(tester, 'https://logo.test/', 'Anderer Titel');
    await tester.pumpAndSettle();
    expect(asked, ['https://bare.test/', 'https://logo.test/']);
  });

  testWidgets('bytes that are no picture fall back to the letter', (tester) async {
    siteIconLoader = (url) async => Uint8List.fromList(List.filled(64, 7));
    await show(tester, 'https://site.test/', 'Seite');
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();
    expect(find.text('S'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });
}
