// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';

import 'package:app/web_ui/ui_data.dart';
import 'package:app/web_ui/ui_db.dart';
import 'package:app/web_ui/ui_transit.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_path_provider.dart';

String at(int hour, int minute) => DateTime(2026, 11, 6, hour, minute).toUtc().toIso8601String();

Map<String, Object?> walk(int minutes) => {'mode': 'WALK', 'duration': minutes * 60, 'from': {'name': 'Schule'}, 'to': {'name': 'Halt'}};

Map<String, Object?> ride(String mode, String line, String stop, String planned, [String? actual]) =>
    {'mode': mode, 'routeShortName': line, 'from': {'name': stop}, 'to': {'name': 'Bahnhof'}, 'scheduledStartTime': planned, 'startTime': actual ?? planned, 'duration': 600};

final plan = {
  'itineraries': [
    {'legs': [walk(4), ride('BUS', '612', 'Schulzentrum', at(15, 12), at(15, 15))]},
    {'legs': [walk(4), ride('BUS', '612', 'Schulzentrum', at(15, 32))]},
    {'legs': [walk(9), ride('TRAM', '91', 'Am Markt', at(15, 20))]},
    {'legs': [walk(4), {...ride('BUS', '612', 'Schulzentrum', at(15, 52)), 'cancelled': true}]},
    {'legs': [walk(4), ride('BUS', '612', 'Schulzentrum', at(16, 12))]},
  ],
};

School school({List<Map<String, Object?>>? friday}) {
  final empty = {for (var day = 1; day <= 5; day++) '$day': <Map<String, Object?>>[]};
  final week = {...empty, '5': friday ?? [{'block': 1, 'subject': 'ma'}, {'block': 2, 'subject': 'de'}]};
  return School(
    subjects: {},
    known: {},
    courses: {},
    blocks: [{'n': 1, 'start': '08:00', 'end': '09:30'}, {'n': 2, 'start': '09:50', 'end': '11:20'}, {'n': 3, 'start': '11:30', 'end': '13:00'}],
    timetable: {'A': week, 'B': week},
    abReference: '2026-01-12',
    abWeeks: false,
    names: {},
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory folder;
  final asked = <Uri>[];

  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    folder = await Directory.systemTemp.createTemp('ui-way-home-');
    await databaseFactoryFfi.setDatabasesPath(folder.path);
    PathProviderPlatform.instance = FakePathProvider(folder.path);
    SharedPreferences.setMockInitialValues({});
    UiTransit.instance.send = (url, {headers}) async {
      asked.add(url);
      return http.Response(jsonEncode(plan), 200);
    };
  });

  tearDownAll(() async {
    try {
      await folder.delete(recursive: true);
    } catch (_) {}
  });

  Future<UiData> data(DateTime now) async => UiData(await UiDb.open(), await SharedPreferences.getInstance(), now);

  test('the way home lists the first ride of the same line and stop, as on the desktop', () {
    final journeys = [
      {'legs': [{'category': 'fuss', 'minutes': 4}, {'category': 'bus', 'line': '612', 'from': {'name': 'Schulzentrum', 'planned': at(15, 12), 'time': at(15, 15)}, 'minutes': 10}]},
      {'legs': [{'category': 'tram', 'line': '91', 'from': {'name': 'Am Markt', 'planned': at(15, 20), 'time': at(15, 20)}, 'minutes': 10}]},
      {'legs': [{'category': 'fuss', 'minutes': 4}, {'category': 'bus', 'line': '612', 'from': {'name': 'Schulzentrum', 'planned': at(15, 32), 'time': at(15, 32)}, 'minutes': 10}]},
    ];
    expect(UiWayHome.view(journeys, 'Lindenallee'), {
      'line': '612', 'mode': 'bus', 'from': 'Schulzentrum', 'to': 'Lindenallee', 'walkMinutes': 4,
      'departures': ['15:12', '15:32'], 'delays': {'15:12': 3},
    });
    expect(UiWayHome.view([{'legs': [{'category': 'fuss', 'minutes': 20}]}], 'Zuhause'), isNull);
  });

  test('the end of school follows the edits and block times from the settings', () async {
    final friday = await data(DateTime(2026, 11, 6, 14));
    expect(friday.schoolEnd(school(), {}, []), DateTime(2026, 11, 6, 11, 20));
    expect(friday.schoolEnd(school(), {'app-timetable-edits': {'A:5:2': null}}, []), DateTime(2026, 11, 6, 9, 30));
    expect(friday.schoolEnd(school(), {'app-timetable-edits': {'A:5:3': {'subject': 'ma', 'room': 'R1'}}}, []), DateTime(2026, 11, 6, 13, 0));
    final times = {'v': 2, 'blocks': [{'n': 1, 'start': '08:00', 'end': '08:45'}, {'n': 2, 'start': '08:50', 'end': '09:35'}]};
    expect(friday.schoolEnd(school(), {'app-block-times': times}, []), DateTime(2026, 11, 6, 9, 35));
    expect(friday.schoolEnd(school(), {}, [{'date': '2026-11-02', 'endDate': '2026-11-06'}]), isNull);
    expect((await data(DateTime(2026, 11, 7, 14))).schoolEnd(school(), {}, []), isNull);
  });

  test('the page gets the copy while the fetch runs beside it, and only around the end of school', () async {
    final db = await UiDb.open();
    await db.delete('vbb_known_locations');
    await db.insert('vbb_known_locations', {'key': 'home', 'name': 'Lindenallee', 'vbb_id': 'de-home', 'latitude': 52.52, 'longitude': 13.4, 'type': 'stop'});
    await db.insert('vbb_known_locations', {'key': 'school', 'name': 'Schulzentrum', 'vbb_id': 'de-school', 'latitude': 52.51, 'longitude': 13.41, 'type': 'stop'});
    UiWayHome.instance.forget();
    asked.clear();

    final morning = await data(DateTime(2026, 11, 6, 9, 0));
    expect((await morning.wayHome(school(), {}, []))['departures'], isEmpty);
    expect(asked, isEmpty);

    final noon = await data(DateTime(2026, 11, 6, 10, 30));
    expect((await noon.wayHome(school(), {}, []))['departures'], isEmpty);
    await UiWayHome.instance.running;
    expect(asked, hasLength(1));
    expect(asked.single.queryParameters['fromPlace'], 'de-school');
    expect(asked.single.queryParameters['toPlace'], 'de-home');
    expect(DateTime.parse(asked.single.queryParameters['time']!).toLocal(), DateTime(2026, 11, 6, 11, 20));

    final shown = await noon.wayHome(school(), {}, []);
    expect(shown['departures'], ['15:12', '15:32', '16:12']);
    expect(shown['delays'], {'15:12': 3});
    expect(shown['walkMinutes'], 4);
    expect(asked, hasLength(1));
  });
}
