// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../providers/app_provider.dart';
import '../theme.dart';
import 'ui_db.dart';

const _months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/// The week the question is about: this one, or the coming one on a weekend.
DateTime askedMonday(DateTime now) => DateTime(now.year, now.month, now.day + (now.weekday > 5 ? 8 - now.weekday : 1 - now.weekday));

String weekSpan(DateTime monday) {
  final friday = DateTime(monday.year, monday.month, monday.day + 4);
  final start = friday.month == monday.month ? '${monday.day}.' : '${monday.day}. ${_months[monday.month - 1]}';
  return '$start bis ${friday.day}. ${_months[friday.month - 1]}';
}

String weekQuestion(DateTime now) => 'Ist ${now.weekday > 5 ? 'nächste' : 'diese'} Woche (${weekSpan(askedMonday(now))}) eine A-Woche?';

Future<bool> _swapped(Database db) async => (await UiDb.store(db))['app-ab-swap'] == true;

/// A device that syncs its plan with an account takes the A/B setting with the plan from the device that changed it last.
/// Its own answer here would move only its own count, so it is not asked while it syncs, and is asked once it stops.
Future<bool> _syncing(Database db) async {
  final state = (await UiDb.store(db))[UiDb.syncKey];
  return state is Map && state['account'] is String;
}

/// The letter the pages show for that week: the count of this install, turned around where A and B are swapped.
Future<String> shownWeek(Database db, SharedPreferences prefs, DateTime now) async {
  final letter = AppProvider.weekTypeFrom(askedMonday(now), AppProvider.abReferenceOf(prefs));
  return await _swapped(db) ? (letter == 'A' ? 'B' : 'A') : letter;
}

/// Stores the Monday to count from, so that the week asked about shows [letter].
Future<void> answerWeek(Database db, SharedPreferences prefs, String letter, DateTime now) async {
  final base = await _swapped(db) ? (letter == 'A' ? 'B' : 'A') : letter;
  final monday = askedMonday(now);
  final reference = AppProvider.weekTypeFrom(monday, AppProvider.abReference) == base
      ? AppProvider.abReference
      : AppProvider.abReference.add(const Duration(days: 7));
  await AppProvider.saveAbReference(prefs, reference);
}

/// Asks the installs that kept their letter when the phone took over the desktop's count which week it is.
/// It asks once: dismissing keeps the letter. Answers true when the letter changed, so the page has to load again.
/// It never throws: the shells wait for it before they show the page, and a failure here must not keep the page away.
Future<bool> askWeekOnce(BuildContext context, {DateTime? now}) async {
  try {
    return await settleWeekQuestion(
      now: now,
      ask: (question) async => context.mounted
          ? showDialog<String>(
              context: context,
              barrierColor: Colors.black.withValues(alpha: 0.55),
              builder: (context) => WeekQuestionDialog(question: question),
            )
          : null,
    );
  } catch (error) {
    debugPrint('Die Frage nach der Woche ging nicht: $error');
    return false;
  }
}

@visibleForTesting
Future<bool> settleWeekQuestion({DateTime? now, required Future<String?> Function(String question) ask}) async {
  final db = await UiDb.open();
  final prefs = await SharedPreferences.getInstance();
  final today = now ?? DateTime.now();
  await AppProvider.settleWeekRule(db, prefs, today);
  if (prefs.getBool(AppProvider.abAskKey) != true) return false;
  if (await _syncing(db)) return false;
  await prefs.remove(AppProvider.abAskKey);
  if (!(prefs.getBool('ab_weeks_enabled') ?? true)) return false;
  final before = await shownWeek(db, prefs, today);
  final answer = await ask(weekQuestion(today));
  if (answer != 'A' && answer != 'B') return false;
  await answerWeek(db, prefs, answer!, today);
  return answer != before;
}

class WeekQuestionDialog extends StatelessWidget {
  const WeekQuestionDialog({super.key, required this.question});

  final String question;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? AppPalette.inkDark : AppPalette.ink;
    Widget choice(String letter) => Expanded(
          child: SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: () => Navigator.of(context).pop(letter),
              style: FilledButton.styleFrom(
                backgroundColor: dark ? AppPalette.pressDark : AppPalette.sunken,
                foregroundColor: ink,
                shape: const StadiumBorder(),
                textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              child: Text('$letter-Woche'),
            ),
          ),
        );
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 380),
        padding: const EdgeInsets.fromLTRB(24, 26, 24, 22),
        decoration: BoxDecoration(
          color: dark ? AppPalette.overlayDark : AppPalette.overlay,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: dark ? AppPalette.lineDark : AppPalette.line),
          boxShadow: [
            BoxShadow(
              color: dark ? Colors.black.withValues(alpha: .5) : const Color(0xFF14201A).withValues(alpha: .18),
              blurRadius: 36,
              spreadRadius: -10,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('A- oder B-Woche', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: ink)),
            const SizedBox(height: 8),
            Text(question, style: TextStyle(fontSize: 15, height: 1.45, color: dark ? AppPalette.inkSoftDark : AppPalette.inkSoft)),
            const SizedBox(height: 22),
            Row(children: [choice('A'), const SizedBox(width: 10), choice('B')]),
          ],
        ),
      ),
    );
  }
}
