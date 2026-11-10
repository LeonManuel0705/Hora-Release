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
const instagram = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.0 (iPhone15,3; iOS 18_5; de_DE)',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);
const googleApp = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.0 Mobile/15E148 Safari/604.1',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);
const duckDuckGo = HomeScreenDevice(
  agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1 Ddg/18.5',
  touchPoints: 5,
  platform: 'iPhone',
  standalone: false,
);

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
    expect(duckDuckGo.shareStep, 'Tippe im Browser auf Teilen.', reason: 'DuckDuckGo is not Safari');
    expect(duckDuckGo.subtitle, 'Zwei Schritte im Browser');
    expect(iphoneNew.shareGlyphs, [Icons.more_horiz_rounded, Icons.ios_share], reason: 'Safari 26 hides Teilen behind „…“');
    expect(iphoneOld.shareGlyphs, [Icons.ios_share]);
    expect(ipad.shareGlyphs, [Icons.ios_share]);
    expect(iphoneNew.shareSpot, Alignment.bottomRight);
    expect(iphoneOld.shareSpot, Alignment.bottomCenter);
    expect(ipad.shareSpot, Alignment.topRight);
    expect(chromeOnIphone.shareSpot, isNull, reason: 'every other browser puts it somewhere else');
    expect(instagram.shareSpot, isNull);
  });

  test('inside Instagram, TikTok or the Google app the first step is to open Safari', () {
    for (final app in [instagram, googleApp]) {
      expect(app.insideApp, isTrue);
      expect(app.shareStep, contains('in Safari'));
      expect(app.addStep, contains('Zum Home-Bildschirm'));
      expect(app.subtitle, 'Zwei Schritte in Safari');
    }
    expect(iphoneOld.insideApp, isFalse);
    expect(chromeOnIphone.insideApp, isFalse);
  });

  test('the tab is named plainly: no reminders there, and the entries may go after about a week', () {
    expect(iphoneNew.tabLimits, 'Im Safari-Tab gibt es keine Erinnerungen, und Safari kann deine Einträge nach etwa einer Woche ohne Besuch löschen.');
    expect(chromeOnIphone.tabLimits, startsWith('Im Browser-Tab gibt es keine Erinnerungen'));
    expect(chromeOnIphone.tabLimits, isNot(contains('Safari')));
    for (final device in [iphoneNew, chromeOnIphone, instagram]) {
      expect(device.tabLimits, isNot(matches(RegExp('[—–]'))));
    }
  });

  testWidgets('the hint leads to the home screen first and keeps the tab as the second choice', (tester) async {
    await open(tester, iphoneOld);
    await tester.pumpAndSettle();
    expect(find.text('Auf den Home-Bildschirm'), findsOneWidget);
    expect(find.text(iphoneOld.tabLimits), findsOneWidget);
    expect(find.textContaining('solange die App geöffnet ist'), findsOneWidget);
    expect(find.textContaining('fängt leer an'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Zum Home-Bildschirm hinzufügen'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Im Browser weiter'), findsOneWidget);
    await tester.tap(find.text('Zum Home-Bildschirm hinzufügen'));
    await tester.pumpAndSettle();
    expect(find.text('Tippe unten auf Teilen.'), findsOneWidget);
    expect(find.text('Wähle „Zum Home-Bildschirm“.'), findsOneWidget);
    expect(find.textContaining('über das neue Symbol auf dem Home-Bildschirm'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
    expect(tester.getCenter(find.byIcon(Icons.arrow_downward_rounded)).dx, closeTo(215, 1), reason: 'the share button of older Safari sits in the middle');
    expect((await SharedPreferences.getInstance()).getBool(homeScreenHintKey), isNull, reason: 'the hint stays until the tab is chosen');
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
    expect(find.text('Im Browser weiter'), findsNothing);
    expect((await SharedPreferences.getInstance()).getBool(homeScreenHintKey), isTrue);
  });

  testWidgets('Safari 26 on the iPhone is pointed to „…“ at the bottom right', (tester) async {
    await open(tester, iphoneNew);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Zum Home-Bildschirm hinzufügen'));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.more_horiz_rounded), findsOneWidget);
    expect(find.byIcon(Icons.ios_share), findsOneWidget);
    final arrow = tester.getCenter(find.byIcon(Icons.arrow_downward_rounded));
    expect(arrow.dx, greaterThan(360));
    expect(arrow.dy, greaterThan(tester.getBottomLeft(find.text('Im Browser weiter')).dy));
  });

  testWidgets('the iPad is pointed up to the share button at the top right', (tester) async {
    await open(tester, ipad);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Zum Home-Bildschirm hinzufügen'));
    await tester.pumpAndSettle();
    final arrow = tester.getCenter(find.byIcon(Icons.arrow_upward_rounded));
    expect(arrow.dx, greaterThan(360));
    expect(arrow.dy, lessThan(tester.getTopLeft(find.text('Tippe oben auf Teilen.')).dy));
  });

  testWidgets('another browser on the iPhone is not called Safari and gets no arrow', (tester) async {
    await open(tester, chromeOnIphone);
    await tester.pumpAndSettle();
    expect(find.text('Zwei Schritte im Browser'), findsOneWidget);
    expect(find.textContaining('Safari'), findsNothing);
    await tester.tap(find.text('Zum Home-Bildschirm hinzufügen'));
    await tester.pumpAndSettle();
    expect(find.text('Tippe im Browser auf Teilen.'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsNothing);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsNothing);
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
  });

  testWidgets('someone with entries in the tab learns how to take them along', (tester) async {
    await open(tester, ipad, withData: true);
    await tester.pumpAndSettle();
    expect(find.textContaining('Einstellungen › Daten'), findsOneWidget);
    await tester.ensureVisible(find.text('Im Browser weiter'));
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
    expect((await SharedPreferences.getInstance()).getBool(homeScreenHintKey), isTrue);
  });

  testWidgets('with reduced motion everything is there at once and the arrow stands still', (tester) async {
    await open(tester, iphoneNew, still: true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    double opacityOf(Finder text) => tester.widget<FadeTransition>(find.ancestor(of: text, matching: find.byType(FadeTransition)).first).opacity.value;
    expect(opacityOf(find.text(iphoneNew.tabLimits)), 1);
    await tester.tap(find.text('Zum Home-Bildschirm hinzufügen'));
    await tester.pump();
    expect(opacityOf(find.text('Wähle „Zum Home-Bildschirm“.')), 1);
    await tester.pump(const Duration(milliseconds: 400));
    final nudge = tester.widget<Transform>(find.ancestor(of: find.byIcon(Icons.arrow_downward_rounded), matching: find.byType(Transform)).first);
    expect(nudge.transform.getTranslation().y, 0, reason: 'the arrow does not bounce');
    await tester.tap(find.text('Im Browser weiter'));
    await tester.pumpAndSettle();
  });
}
