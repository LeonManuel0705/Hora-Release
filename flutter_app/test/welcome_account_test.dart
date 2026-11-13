// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';

import 'package:app/main.dart' show showWelcomeSetup, WelcomeSetupResult;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the first steps offer a quiet sign in only with an account service', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    late BuildContext context;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (inner) {
      context = inner;
      return const SizedBox.shrink();
    })));
    unawaited(showWelcomeSetup(context, withDemo: false));
    await tester.pumpAndSettle();
    expect(find.text('Wo bist du zuhause?'), findsOneWidget);
    expect(find.text('Ich habe schon ein Konto'), findsNothing);
  });

  testWidgets('choosing to sign in first closes the first steps with that choice', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    WelcomeSetupResult? chosen;
    late BuildContext context;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (inner) {
      context = inner;
      return const SizedBox.shrink();
    })));
    final result = showWelcomeSetup(context, withDemo: false, withAccount: true).then((value) => chosen = value);
    await tester.pumpAndSettle();
    expect(find.text('Ich habe schon ein Konto'), findsOneWidget);
    await tester.tap(find.text('Ich habe schon ein Konto'));
    await tester.pumpAndSettle();
    await result;
    expect(chosen?.signIn, isTrue);
    expect(chosen?.bundesland, isEmpty);
  });

  testWidgets('the link is only on the first step', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    late BuildContext context;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (inner) {
      context = inner;
      return const SizedBox.shrink();
    })));
    unawaited(showWelcomeSetup(context, withDemo: false, withAccount: true));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Baden-Württemberg'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Weiter'));
    await tester.pumpAndSettle();
    expect(find.text('Wie lange noch?'), findsOneWidget);
    expect(find.text('Ich habe schon ein Konto'), findsNothing);
  });
}
