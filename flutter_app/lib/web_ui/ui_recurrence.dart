// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'ui_data.dart' show daysBetween, dayOf, isoOf;

// The same expansion as app/static/app/js/recurrence.js, so planned reminders meet every
// occurrence the page shows, under the same ids.

const _frequencies = {'daily', 'weekly', 'monthly', 'yearly'};
final _isoPattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

class UiRecurrence {
  const UiRecurrence(this.freq, this.interval, this.until, this.count, this.exceptions);

  final String freq;
  final int interval;
  final String? until;
  final int? count;
  final List<String> exceptions;
}

bool _validIso(Object? value) => value is String && _isoPattern.hasMatch(value) && isoOf(dayOf(value)) == value;

num? _number(Object? value) => value is num ? value : value is String ? num.tryParse(value.trim()) : value is bool ? (value ? 1 : 0) : null;

String _shifted(String iso, int days) {
  final date = dayOf(iso);
  return isoOf(DateTime(date.year, date.month, date.day + days));
}

UiRecurrence? uiRecurrence(Object? value) {
  if (value is! Map || !_frequencies.contains(value['freq'])) return null;
  final step = _number(value['interval']);
  final interval = (step == null || step.isNaN || step == 0 ? 1 : step.round()).clamp(1, 12);
  final times = _number(value['count']);
  final count = times != null && times.isFinite && times >= 1 ? times.round().clamp(1, 1000) : null;
  final until = count == null && _validIso(value['until']) ? value['until'] as String : null;
  final skipped = value['exceptions'] is List ? value['exceptions'] as List : const [];
  final exceptions = {for (final day in skipped) if (_validIso(day)) day as String}.toList()..sort();
  return UiRecurrence(value['freq'] as String, interval, until, count, exceptions);
}

// Null for a day that does not exist, the 31st in April or the 29th of February in a common year.
String? _nth(String start, UiRecurrence rule, int index) {
  final first = dayOf(start);
  final step = index * rule.interval;
  if (rule.freq == 'daily' || rule.freq == 'weekly') {
    return isoOf(DateTime(first.year, first.month, first.day + step * (rule.freq == 'weekly' ? 7 : 1)));
  }
  final date = DateTime(first.year, first.month + (rule.freq == 'monthly' ? step : step * 12), first.day);
  return date.day == first.day ? isoOf(date) : null;
}

int _span(Map<String, Object?> item) {
  final date = '${item['date']}', end = item['endDate'];
  return end is String && end.compareTo(date) > 0 ? daysBetween(dayOf(date), dayOf(end)) : 0;
}

List<String> uiOccurrenceDates(Map<String, Object?> item, String from, String to) {
  final date = '${item['date']}';
  final rule = uiRecurrence(item['recurrence']);
  final span = _span(item);
  if (rule == null) return date.compareTo(to) <= 0 && _shifted(date, span).compareTo(from) >= 0 ? [date] : [];
  final skip = {...rule.exceptions, if (item['googleDays'] is List) ...(item['googleDays'] as List).whereType<String>()};
  final dates = <String>[];
  var index = 0;
  if (rule.count == null && (rule.freq == 'daily' || rule.freq == 'weekly')) {
    final step = rule.interval * (rule.freq == 'weekly' ? 7 : 1);
    index = ((daysBetween(dayOf(date), dayOf(from)) - span) / step).floor().clamp(0, 1 << 30);
  }
  var produced = 0;
  for (var guard = 0; guard < 20000; guard++, index++) {
    if (rule.count != null && produced >= rule.count!) break;
    final next = _nth(date, rule, index);
    if (next == null) continue;
    produced++;
    if (next.compareTo(to) > 0 || (rule.until != null && next.compareTo(rule.until!) > 0)) break;
    if (_shifted(next, span).compareTo(from) >= 0 && !skip.contains(next)) dates.add(next);
  }
  return dates;
}

List<Map<String, Object?>> uiExpandEvents(Iterable<Map<String, Object?>> items, String from, String to) {
  final result = <Map<String, Object?>>[];
  for (final item in items) {
    if (uiRecurrence(item['recurrence']) == null) {
      result.add(item);
      continue;
    }
    final span = _span(item);
    for (final date in uiOccurrenceDates(item, from, to)) {
      result.add({
        ...item,
        'id': '${item['id']}~$date',
        'date': date,
        'endDate': span > 0 ? _shifted(date, span) : item['endDate'],
        'series': item['id'],
        'occurrence': date,
      });
    }
  }
  return result;
}
