// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/web_ui/home_screen_hint.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const iphoneNew = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);
const iphoneOld = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);
const ipad = HomeScreenDevice(
  agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  touchPoints: 5,
  platform: 'MacIntel',
  standalone: false,
);
const chromeOnIphone = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);
const pixel = HomeScreenDevice(
  agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  touchPoints: 5,
  platform: 'Linux armv8l',
  standalone: false,
);
const mac = HomeScreenDevice(
  agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  touchPoints: 0,
  platform: 'MacIntel',
  standalone: false,
);
const homeScreenApp = HomeScreenDevice(agent: 'iPhone', touchPoints: 5, platform: 'iPhone', standalone: true);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> open(WidgetTester tester, HomeScreenDevice device, {bool withData = false, bool still = false}) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: still), child: child!),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showHomeScreenHint(context, device, withData: withData),
              child: const Text('Start'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Start'));
  }

  test('only an iPhone or iPad in a browser tab gets the hint, and only once', () async {
    expect(await homeScreenHintDue(iphoneNew), isTrue);
    expect(await homeScreenHintDue(ipad), isTrue);
    expect(await homeScreenHintDue(chromeOnIphone), isTrue);
    expect(await homeScreenHintDue(pixel), isFalse);
    expect(await homeScreenHintDue(mac), isFalse);
    expect(await homeScreenHintDue(homeScreenApp), isFalse);
    await (await SharedPreferences.getInstance()).setBool(homeScreenHintKey, true);
    expect(await homeScreenHintDue(iphoneNew), isFalse);
  });

  test('the first step points where the share button really is', () {
    expect(iphoneNew.shareStep, 'Tippe neben der Adresse auf „…“ und dann auf Teilen.');
    expect(iphoneOld.shareStep, 'Tippe unten auf Teilen.');
    expect(ipad.shareStep, 'Tippe oben auf Teilen.');
    expect(chromeOnIphone.shareStep, 'Tippe im Browser auf Teilen.');
  });

  testWidgets('another browser on the iPhone is not called Safari', (tester) async {
    await open(tester, chromeOnIphone);
    await tester.pumpAndSettle();
    expect(find.text('Zwei Schritte im Browser'), findsOneWidget);
    expect(find.textContaining('Safari'), findsNothing);
    await tester.ensureVisible(find.text('Im Browser weiter'));
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
  });

  testWidgets('the hint shows both steps, says that tab entries stay behind and closes for good', (tester) async {
    await open(tester, iphoneOld);
    await tester.pumpAndSettle();
    expect(find.text('Auf den Home-Bildschirm'), findsOneWidget);
    expect(find.text('Tippe unten auf Teilen.'), findsOneWidget);
    expect(find.text('Wähle „Zum Home-Bildschirm“.'), findsOneWidget);
    expect(find.textContaining('fängt leer an'), findsOneWidget);
    expect(find.textContaining('Erinnerungen gibt es auf dem iPhone nur dort'), findsOneWidget);
    await tester.ensureVisible(find.text('Im Browser weiter'));
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
    expect(find.text('Im Browser weiter'), findsNothing);
    expect((await SharedPreferences.getInstance()).getBool(homeScreenHintKey), isTrue);
  });

  testWidgets('someone with entries in the tab learns how to take them along', (tester) async {
    await open(tester, ipad, withData: true);
    await tester.pumpAndSettle();
    expect(find.textContaining('Einstellungen › Daten'), findsOneWidget);
    expect(find.textContaining('dem iPad'), findsOneWidget);
    await tester.ensureVisible(find.text('Im Browser weiter'));
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
  });

  testWidgets('with reduced motion the steps are there at once', (tester) async {
    await open(tester, iphoneNew, still: true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    final fade = tester.widget<FadeTransition>(
      find.ancestor(of: find.text('Wähle „Zum Home-Bildschirm“.'), matching: find.byType(FadeTransition)).first,
    );
    expect(fade.opacity.value, 1);
    await tester.ensureVisible(find.text('Im Browser weiter'));
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
  });
}
