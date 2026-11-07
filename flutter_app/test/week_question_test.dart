// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:app/providers/app_provider.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:app/web_ui/week_question.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  final monday = DateTime(2026, 11, 9, 7, 30);
  final saturday = DateTime(2026, 11, 14, 11);

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('week-question-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<(Database, SharedPreferences)> install(Map<String, Object> values, {bool swapped = false}) async {
    AppProvider.forgetWeekRule();
    SharedPreferences.setMockInitialValues(values);
    final prefs = await SharedPreferences.getInstance();
    final db = await UiDb.open();
    if (swapped) {
      await UiDb.save(db, 'app-ab-swap', true);
    } else {
      await UiDb.remove(db, 'app-ab-swap');
    }
    return (db, prefs);
  }

  test('the question names the dates of the week it is about, the coming one on a weekend', () {
    expect(askedMonday(DateTime(2026, 11, 13, 22)), DateTime(2026, 11, 9));
    expect(askedMonday(saturday), DateTime(2026, 11, 16));
    expect(askedMonday(DateTime(2026, 11, 15, 23, 59)), DateTime(2026, 11, 16));
    expect(askedMonday(DateTime(2026, 10, 24, 12)), DateTime(2026, 10, 26));
    expect(weekSpan(DateTime(2026, 11, 9)), '9. bis 13. November');
    expect(weekSpan(DateTime(2026, 11, 30)), '30. November bis 4. Dezember');
    expect(weekSpan(DateTime(2026, 12, 28)), '28. Dezember bis 1. Januar');
    expect(weekQuestion(monday), 'Ist diese Woche (9. bis 13. November) eine A-Woche?');
    expect(weekQuestion(saturday), 'Ist nächste Woche (16. bis 20. November) eine A-Woche?');
  });

  test('an answer makes the week show that letter, with or without the swap of the settings page', () async {
    for (final swapped in [false, true]) {
      for (final now in [monday, saturday]) {
        for (final letter in ['A', 'B']) {
          final (db, prefs) = await install({AppProvider.abReferenceKey: '2026-01-12'}, swapped: swapped);
          await answerWeek(db, prefs, letter, now);
          expect(await shownWeek(db, prefs, now), letter, reason: 'swapped $swapped, $now, $letter');
          final next = askedMonday(now).add(const Duration(days: 7, hours: 12));
          expect(await shownWeek(db, prefs, next), letter == 'A' ? 'B' : 'A');
        }
      }
    }
  });

  test('an install that kept its letter is asked once, and the answer stays', () async {
    final (db, prefs) = await install({'ab_week_inverted': true});
    final asked = <String>[];
    Future<String?> answer(String question) async {
      asked.add(question);
      return 'B';
    }

    final before = await shownWeekAfterMove(db, prefs, monday);
    expect(await settleWeekQuestion(now: monday, ask: answer), before != 'B');
    expect(asked, ['Ist diese Woche (9. bis 13. November) eine A-Woche?']);
    expect(await shownWeek(db, prefs, monday), 'B');
    expect(prefs.getBool(AppProvider.abAskKey), isNull);
    expect(await settleWeekQuestion(now: monday, ask: answer), isFalse);
    expect(asked, hasLength(1));
  });

  test('dismissing the question keeps the letter and does not ask again', () async {
    final (db, prefs) = await install({'ab_week_inverted': true}, swapped: true);
    final before = await shownWeekAfterMove(db, prefs, monday);
    var asked = 0;
    expect(await settleWeekQuestion(now: monday, ask: (question) async => (asked++, null).$2), isFalse);
    expect(await shownWeek(db, prefs, monday), before);
    expect(await settleWeekQuestion(now: monday, ask: (question) async => 'A'), isFalse);
    expect(asked, 1);
  });

  test('a fresh install and one with A/B weeks off are never asked', () async {
    var asked = 0;
    Future<String?> answer(String question) async => (asked++, 'A').$2;
    await install({});
    expect(await settleWeekQuestion(now: monday, ask: answer), isFalse);
    await install({'ab_weeks_enabled': false, 'ab_week_inverted': true});
    expect(await settleWeekQuestion(now: monday, ask: answer), isFalse);
    expect(asked, 0);
  });

  testWidgets('the dialog asks with A-Woche and B-Woche and gives back the choice', (tester) async {
    String? picked = 'none';
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () async => picked = await showDialog<String>(context: context, builder: (_) => WeekQuestionDialog(question: weekQuestion(monday))),
          child: const Text('fragen'),
        ),
      ),
    ));
    await tester.tap(find.text('fragen'));
    await tester.pumpAndSettle();
    expect(find.text('Ist diese Woche (9. bis 13. November) eine A-Woche?'), findsOneWidget);
    expect(tester.getSize(find.widgetWithText(FilledButton, 'A-Woche')).height, greaterThanOrEqualTo(44));
    await tester.tap(find.text('B-Woche'));
    await tester.pumpAndSettle();
    expect(picked, 'B');

    await tester.tap(find.text('fragen'));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(4, 4));
    await tester.pumpAndSettle();
    expect(picked, isNull);
  });
}

// The letter the page shows right after the move, before any answer.
Future<String> shownWeekAfterMove(Database db, SharedPreferences prefs, DateTime now) async {
  await AppProvider.settleWeekRule(db, prefs, now);
  return shownWeek(db, prefs, now);
}
