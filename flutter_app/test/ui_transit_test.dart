// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';

import 'package:app/web_ui/ui_transit.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

Map<String, Object?> _ride(String mode, String line, String origin, String target) => {
      'mode': mode,
      'routeShortName': line,
      'duration': 2400,
      'scheduledStartTime': '2026-10-12T06:04:00Z',
      'startTime': '2026-10-12T06:05:00Z',
      'endTime': '2026-10-12T06:45:00Z',
      'from': {'name': 'Start', 'lat': 52.3917, 'lon': 13.0667, 'stopId': origin},
      'to': {'name': 'Ziel', 'lat': 52.5215, 'lon': 13.4112, 'stopId': target},
    };

Map<String, Object?> _group(String name, Map<String, int> prices) => {
      'name': name,
      'tickets': [
        for (final entry in prices.entries) {'name': entry.key, 'price': {'amount': entry.value, 'currency': 'EUR'}},
      ],
    };

Map<String, Object?> _trip(String line, List<Map<String, Object?>> tickets) => {
      'legs': [
        {'walking': true},
        {'line': {'name': line}, 'plannedDeparture': '2026-10-12T08:00:00+02:00', 'departure': '2026-10-12T08:01:00+02:00', 'plannedArrival': '2026-10-12T08:20:00+02:00'},
      ],
      'tickets': tickets,
    };

void main() {
  final asked = <Uri>[];

  void answer(Object? body) {
    asked.clear();
    UiTransit.instance.send = (url, {headers}) async {
      asked.add(url);
      return http.Response.bytes(utf8.encode(jsonEncode(body)), 200);
    };
  }

  tearDown(() => UiTransit.instance.send = http.get);

  test('a connection says where each walk leads and between which stops its fare runs', () async {
    answer({
      'itineraries': [
        {
          'legs': [
            _ride('METRO', 'S7', 'de-VBB_de:12054:900230999:3:54', 'de-VBB_de:11000:900100003:2:52'),
            {
              'mode': 'WALK',
              'duration': 240,
              'distance': 262.4,
              'startTime': '2026-10-12T06:45:00Z',
              'endTime': '2026-10-12T06:49:00Z',
              'from': {'name': 'Ziel', 'lat': 52.5215, 'lon': 13.4112},
              'to': {'name': 'END', 'lat': 52.5201, 'lon': '13.41'},
            },
          ],
        },
        {
          'legs': [_ride('REGIONAL_RAIL', 'RE1', 'de-DELFI_de:12054:900230999', 'de-DELFI_de:15003:2468')],
        },
        {
          'legs': [_ride('HIGHSPEED_RAIL', 'ICE 1', 'de-VBB_de:11000:900003201:1:1', 'de-VBB_de:12054:900230999:3:54')],
        },
        {
          'legs': [_ride('BUS', '695', 'de-VBB_de:12054:900230999:3:54', 'de-VBB_de:12054:900230999:9:9')],
        },
      ],
    });
    final (body, status) = await UiTransit.instance.handle('verbindungen', {'von': 'a-walks', 'nach': 'b'});
    expect(status, 200);
    final found = (body['journeys'] as List).cast<Map<String, Object?>>();
    expect(found.map((journey) => journey['fare']), [
      {'from': '900230999', 'to': '900100003', 'time': '2026-10-12T06:04:00Z'},
      null,
      null,
      null,
    ]);
    final walk = (found.first['legs'] as List)[1] as Map<String, Object?>;
    expect(walk['from'], {'name': 'Ziel', 'time': '2026-10-12T06:45:00Z', 'planned': null, 'track': null, 'lat': 52.5215, 'lon': 13.4112});
    expect((walk['to'] as Map)['lat'], 52.5201);
    expect((walk['to'] as Map)['lon'], isNull);
  });

  test('the fare of a connection is its cheapest tickets with the zones they need', () async {
    answer({
      'journeys': [
        _trip('U2', [
          _group('Berlin Kurzstrecke: Kurzstrecke', {'Regeltarif': 280, 'Ermäßigungstarif': 210, 'Fahrrad': 190}),
          _group('Berlin Kurzstrecke: 4-Fahrten-Kurzstr.', {'Regeltarif': 780}),
          _group('Berlin Tarifgebiet A-B: Einzelfahrausweis', {'Regeltarif': 400, 'Ermäßigungstarif': 250}),
          _group('Berlin Tarifgebiet A-B: 24-Stunden-Karte', {'Regeltarif': 1120}),
          _group('Zeitkarte Berlin Tarifgebiet A-B: Monatskarte', {'VBB-Umweltkarte': 11300}),
        ]),
        _trip('RE1', [
          _group('Regionaltarif über 25 bis 35 km: Einzelfahrausweis', {'Regeltarif': 810, 'Ermäßigungstarif': 600}),
          _group('Zeitkarte 1 Lkr + 1 krfr Stadt: Monatskarte', {'Schüler': 10130}),
        ]),
        _trip('601', [
          _group('Potsdam Tarifgebiet A-B-C: Einzelfahrausweis', {'Regeltarif': 370}),
        ]),
        _trip('X1', [
          _group('Potsdam Tarifgebiet A-B: 24-Stunden-Karte', {'Regeltarif': 630}),
        ]),
        {
          'legs': [
            {'walking': true},
          ],
          'tickets': [
            _group('Berlin Tarifgebiet A-B: Einzelfahrausweis', {'Regeltarif': 400}),
          ],
        },
      ],
    });
    final (body, status) = await UiTransit.instance.handle('tarif', {'von': '900100003', 'nach': '900100016', 'zeit': '2026-10-12T06:00:00Z'});
    expect(status, 200);
    expect(asked.single.host, 'v6.vbb.transport.rest');
    expect(asked.single.path, '/journeys');
    expect(asked.single.queryParameters, containsPair('from', '900100003'));
    expect(asked.single.queryParameters, containsPair('to', '900100016'));
    expect(asked.single.queryParameters, containsPair('departure', '2026-10-12T06:00:00Z'));
    expect(asked.single.queryParameters, containsPair('tickets', 'true'));
    expect(body['fares'], [
      {
        'start': '2026-10-12T08:00:00+02:00',
        'end': '2026-10-12T08:20:00+02:00',
        'lines': ['U2'],
        'single': {'label': 'Berlin AB', 'price': 4.0, 'reduced': 2.5},
        'short': {'label': 'Berlin', 'price': 2.8, 'reduced': 2.1},
        'net': 'Berlin',
        'zones': 'AB',
      },
      {
        'start': '2026-10-12T08:00:00+02:00',
        'end': '2026-10-12T08:20:00+02:00',
        'lines': ['RE1'],
        'single': {'label': 'Regionaltarif über 25 bis 35 km', 'price': 8.1, 'reduced': 6.0},
        'short': null,
        'net': null,
        'zones': null,
      },
      {
        'start': '2026-10-12T08:00:00+02:00',
        'end': '2026-10-12T08:20:00+02:00',
        'lines': ['601'],
        'single': {'label': 'Potsdam ABC', 'price': 3.7, 'reduced': null},
        'short': null,
        'net': 'Potsdam',
        'zones': 'ABC',
      },
    ]);
  });

  test('a fare is only asked between two stop numbers', () async {
    answer({'journeys': []});
    for (final stops in [
      {'von': '900100003'},
      {'von': '900100003', 'nach': 'de-VBB_de:11000:900100016'},
      {'von': '9001000031', 'nach': '900100016'},
      {'von': '../journeys', 'nach': '900100016'},
    ]) {
      final (body, status) = await UiTransit.instance.handle('tarif', stops);
      expect(status, 400);
      expect(body, {'error': 'Start oder Ziel fehlt'});
    }
    expect(asked, isEmpty);
  });
}
