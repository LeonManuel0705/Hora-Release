// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:app/web_ui/ui_recurrence.dart';
import 'package:flutter_test/flutter_test.dart';

// The cases of tests/js/recurrence_check.mjs, which checks recurrence.js.
Map<String, Object?> _event(Map<String, Object?>? recurrence, [Map<String, Object?> extra = const {}]) =>
    {'id': 'loc-1', 'title': 'Klavier', 'date': '2026-11-04', 'start': '15:00', 'end': '15:45', 'recurrence': recurrence, ...extra};

List<String> _dates(Map<String, Object?>? recurrence, String from, String to, [Map<String, Object?> extra = const {}]) =>
    uiOccurrenceDates(_event(recurrence, extra), from, to);

void main() {
  test('a rule is kept only in the shape it is stored in', () {
    expect(uiRecurrence(null), isNull);
    expect(uiRecurrence({'freq': 'hourly'}), isNull);
    final weekly = uiRecurrence({'freq': 'weekly', 'interval': '2', 'until': '2026-12-31', 'exceptions': ['2026-11-18', '2026-11-18', 'bad', '2026-02-30']})!;
    expect([weekly.interval, weekly.until, weekly.count, weekly.exceptions], [2, '2026-12-31', null, ['2026-11-18']]);
    final daily = uiRecurrence({'freq': 'daily', 'count': 3, 'until': '2026-12-31'})!;
    expect([daily.interval, daily.until, daily.count], [1, null, 3]);
  });

  test('an event that does not repeat is there on its days only', () {
    expect(_dates(null, '2026-11-01', '2026-11-30'), ['2026-11-04']);
    expect(_dates(null, '2026-11-05', '2026-11-30'), isEmpty);
    expect(_dates(null, '2026-11-05', '2026-11-30', {'endDate': '2026-11-06'}), ['2026-11-04']);
  });

  test('daily, weekly, every two weeks, monthly and yearly come round on their days', () {
    expect(_dates({'freq': 'daily'}, '2026-11-04', '2026-11-07'), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(_dates({'freq': 'weekly'}, '2026-11-01', '2026-11-30'), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
    expect(_dates({'freq': 'weekly', 'interval': 2}, '2026-11-01', '2026-12-31'), ['2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30']);
    expect(_dates({'freq': 'monthly'}, '2026-11-01', '2027-02-28'), ['2026-11-04', '2026-12-04', '2027-01-04', '2027-02-04']);
    expect(_dates({'freq': 'yearly'}, '2026-01-01', '2029-12-31'), ['2026-11-04', '2027-11-04', '2028-11-04', '2029-11-04']);
  });

  test('a series ends on its last day or after its number of times, and a skipped day still counts', () {
    expect(_dates({'freq': 'weekly', 'until': '2026-11-18'}, '2026-11-01', '2026-12-31'), ['2026-11-04', '2026-11-11', '2026-11-18']);
    expect(_dates({'freq': 'weekly', 'count': 3}, '2026-11-01', '2026-12-31'), ['2026-11-04', '2026-11-11', '2026-11-18']);
    expect(_dates({'freq': 'weekly', 'count': 3}, '2026-11-12', '2026-12-31'), ['2026-11-18']);
    expect(_dates({'freq': 'weekly', 'exceptions': ['2026-11-11']}, '2026-11-01', '2026-11-30'), ['2026-11-04', '2026-11-18', '2026-11-25']);
    expect(_dates({'freq': 'weekly', 'count': 3, 'exceptions': ['2026-11-11']}, '2026-11-01', '2026-12-31'), ['2026-11-04', '2026-11-18']);
  });

  test('the 31st and the 29th of February come round only where they exist, and count only there', () {
    expect(uiOccurrenceDates({'date': '2026-01-31', 'recurrence': {'freq': 'monthly'}}, '2026-01-01', '2026-06-30'), ['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(uiOccurrenceDates({'date': '2028-02-29', 'recurrence': {'freq': 'yearly'}}, '2028-01-01', '2036-12-31'), ['2028-02-29', '2032-02-29', '2036-02-29']);
    expect(uiOccurrenceDates({'date': '2027-01-31', 'recurrence': {'freq': 'monthly', 'count': 6}}, '2027-01-01', '2028-12-31'),
        ['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31', '2027-08-31', '2027-10-31']);
  });

  test('days Google shows itself are left out but still count', () {
    final item = _event({'freq': 'weekly', 'count': 4}, {'googleDays': ['2026-11-11']});
    expect(uiOccurrenceDates(item, '2026-11-01', '2026-12-31'), ['2026-11-04', '2026-11-18', '2026-11-25']);
    expect(uiRecurrence(item['recurrence'])!.exceptions, isEmpty);
  });

  test('a long series is counted from far away, and an occurrence over midnight touches its second day', () {
    expect(uiOccurrenceDates({'date': '2020-01-06', 'recurrence': {'freq': 'weekly'}}, '2026-11-09', '2026-11-15'), ['2026-11-09']);
    expect(uiOccurrenceDates({'date': '2020-01-01', 'recurrence': {'freq': 'daily'}}, '2026-11-09', '2026-11-10'), ['2026-11-09', '2026-11-10']);
    final night = {'id': 'loc-2', 'date': '2026-11-06', 'endDate': '2026-11-07', 'start': '20:00', 'end': '10:00', 'recurrence': {'freq': 'weekly'}};
    expect(uiOccurrenceDates(night, '2026-11-14', '2026-11-14'), ['2026-11-13']);
    final one = uiExpandEvents([night], '2026-11-14', '2026-11-14').single;
    expect([one['id'], one['date'], one['endDate'], one['series'], one['occurrence']], ['loc-2~2026-11-13', '2026-11-13', '2026-11-14', 'loc-2', '2026-11-13']);
  });

  test('every occurrence has an id of its own that leads back to the series', () {
    final list = uiExpandEvents([_event({'freq': 'weekly'}), {'id': 'loc-9', 'date': '2026-11-05'}], '2026-11-01', '2026-11-14');
    expect([for (final item in list) item['id']], ['loc-1~2026-11-04', 'loc-1~2026-11-11', 'loc-9']);
  });
}
