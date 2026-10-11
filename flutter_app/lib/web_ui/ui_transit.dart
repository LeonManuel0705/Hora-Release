// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:http/http.dart' as http;

import '../brand.dart';

class _TransitFailure implements Exception {
  const _TransitFailure(this.message, this.status);

  final String message;
  final int status;
}

class UiTransit {
  UiTransit._();

  static final UiTransit instance = UiTransit._();
  static const _base = 'api.transitous.org';
  static const _maxCache = 400;
  static const _categories = {
    'HIGHSPEED_RAIL': 'fern',
    'LONG_DISTANCE': 'fern',
    'NIGHT_RAIL': 'fern',
    'COACH': 'fernbus',
    'REGIONAL_FAST_RAIL': 'regio',
    'REGIONAL_RAIL': 'regio',
    'RAIL': 'regio',
    'SUBURBAN': 'sbahn',
    'METRO': 'sbahn',
    'SUBWAY': 'ubahn',
    'TRAM': 'tram',
    'BUS': 'bus',
    'FERRY': 'faehre',
    'WALK': 'fuss',
    'BIKE': 'rad',
  };
  static const _longDistance = {'fern', 'fernbus'};
  static final _fareStop = RegExp(r'^9\d{8}$');
  static final _fareStopInId = RegExp(r'_de:1[12]\d{3}:(9\d{8})(?::|$)');
  static final _shortTrip = RegExp(r'^(.+) Kurzstrecke: Kurzstrecke$');
  static final _citySingle = RegExp(r'^(.+) Tarifgebiet ([A-C](?:-[A-C])*): Einzelfahrausweis$');

  final Map<String, (DateTime, Object?)> _cache = {};

  @visibleForTesting
  Future<http.Response> Function(Uri url, {Map<String, String>? headers}) send = http.get;

  String? _arg(Map<String, String> args, String key, [int limit = 120]) {
    final value = args[key];
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.length > limit ? trimmed.substring(0, limit) : trimmed;
  }

  static Map<String, String> _query(Map<String, Object?> params) => {
        for (final entry in params.entries)
          if (entry.value != null && '${entry.value}'.isNotEmpty) entry.key: '${entry.value}',
      };

  Future<Object?> _fetch(String path, Map<String, Object?> params, int ttl) => _get(Uri.https(_base, '/api/v1/$path', _query(params)), ttl);

  Future<Object?> _get(Uri uri, int ttl) async {
    final key = uri.toString();
    final hit = _cache[key];
    if (hit != null && DateTime.now().difference(hit.$1).inSeconds < ttl) return hit.$2;
    final response = await send(uri, headers: {
      if (!kIsWeb) 'User-Agent': '${Brand.name}/0.4 (Schul-App)',
      'Accept': 'application/json',
    }).timeout(const Duration(seconds: 12));
    if (response.statusCode != 200) throw _TransitFailure('Fahrplan antwortet mit ${response.statusCode}', 502);
    final data = jsonDecode(utf8.decode(response.bodyBytes));
    _cache[key] = (DateTime.now(), data);
    if (_cache.length > _maxCache) {
      final oldest = _cache.entries.toList()..sort((a, b) => a.value.$1.compareTo(b.value.$1));
      for (final entry in oldest.take(100)) {
        _cache.remove(entry.key);
      }
    }
    return data;
  }

  static String _category(Object? mode) => _categories['${mode ?? ''}'] ?? 'sonst';

  static Map<String, Object?> _map(Object? value) => value is Map ? value.cast<String, Object?>() : const {};

  static List<Object?> _list(Object? value) => value is List ? value : const [];

  static String _lineName(Map<String, Object?> item) {
    var name = '${item['routeShortName'] ?? item['displayName'] ?? ''}'.trim();
    if (name.contains('(') && name.endsWith(')')) name = name.substring(0, name.lastIndexOf('(')).trim();
    return name;
  }

  static String _areaOf(Map<String, Object?> item) {
    final areas = _list(item['areas']).map(_map).toList();
    final preferred = areas.where((area) => area['default'] == true).firstOrNull ??
        areas.where((area) => area['matched'] == true).firstOrNull;
    return '${preferred?['name'] ?? ''}';
  }

  Future<(Map<String, Object?>, int)> _search(Map<String, String> args) async {
    final query = _arg(args, 'q', 80) ?? '';
    if (query.length < 2) return (<String, Object?>{'places': <Object?>[]}, 200);
    final near = _arg(args, 'nahe', 60);
    final bias = _arg(args, 'bias', 4) ?? (near != null && near.isNotEmpty ? '5' : null);
    final data = await _fetch('geocode', {'text': query, 'language': 'de', 'place': near, 'placeBias': bias}, 3600);
    final places = <Map<String, Object?>>[];
    final seen = <String>{};
    for (final raw in _list(data)) {
      final item = _map(raw);
      final kind = {'STOP': 'stop', 'ADDRESS': 'address'}[item['type']] ?? 'place';
      if (item['country'] != null && item['country'] != 'DE' && kind != 'stop') continue;
      var area = _areaOf(item);
      if (kind != 'stop') {
        area = ['${item['zip'] ?? ''}'.trim(), area].where((part) => part.isNotEmpty).join(' ');
        final key = '$kind|${'${item['name'] ?? ''}'.toLowerCase()}|${area.toLowerCase()}';
        if (!seen.add(key)) continue;
      }
      places.add({
        'id': kind == 'stop' ? item['id'] : '${item['lat']},${item['lon']}',
        'name': item['name'] ?? '',
        'area': area,
        'kind': kind,
        'modes': ({for (final mode in _list(item['modes'])) _category(mode)}.toList()..sort()),
        'lat': item['lat'],
        'lon': item['lon'],
      });
    }
    return (<String, Object?>{'places': places.take(8).toList()}, 200);
  }

  Future<(Map<String, Object?>, int)> _departures(Map<String, String> args) async {
    final stop = _arg(args, 'stop');
    if (stop == null || stop.isEmpty) return (<String, Object?>{'error': 'Haltestelle fehlt'}, 400);
    final count = (int.tryParse(args['n'] ?? '') ?? 14).clamp(1, 30);
    final data = _map(await _fetch('stoptimes', {'stopId': stop, 'n': count, 'time': _arg(args, 'zeit', 40)}, 30));
    final seen = <String, Map<String, Object?>>{};
    for (final raw in _list(data['stopTimes'])) {
      final item = _map(raw);
      final place = _map(item['place']);
      final planned = place['scheduledDeparture'] ?? place['departure'];
      final key = '${_category(item['mode'])}|${_lineName(item)}|$planned';
      final entry = <String, Object?>{
        'line': _lineName(item),
        'category': _category(item['mode']),
        'direction': item['headsign'] ?? _map(item['tripTo'])['name'] ?? '',
        'planned': planned,
        'time': place['departure'] ?? planned,
        'track': place['track'] ?? place['scheduledTrack'],
        'cancelled': item['cancelled'] == true || item['tripCancelled'] == true,
        'realtime': item['realTime'] == true,
      };
      final current = seen[key];
      if (current == null ||
          (entry['realtime'] == true && current['realtime'] != true) ||
          (entry['track'] != null && current['track'] == null)) {
        seen[key] = entry;
      }
    }
    final items = seen.values.toList()..sort((a, b) => '${a['time'] ?? ''}'.compareTo('${b['time'] ?? ''}'));
    return (<String, Object?>{'stop': _map(data['place'])['name'] ?? '', 'departures': items}, 200);
  }

  static num? _number(Object? value) => value is num ? value : null;

  static Map<String, Object?> _leg(Map<String, Object?> leg) {
    final origin = _map(leg['from']);
    final target = _map(leg['to']);
    final duration = leg['duration'];
    final distance = leg['distance'];
    return {
      'category': _category(leg['mode']),
      'line': _lineName(leg),
      'headsign': leg['headsign'] ?? '',
      'agency': leg['agencyName'] ?? '',
      'from': {'name': origin['name'] ?? '', 'time': leg['startTime'], 'planned': leg['scheduledStartTime'], 'track': origin['track'] ?? origin['scheduledTrack'], 'lat': _number(origin['lat']), 'lon': _number(origin['lon'])},
      'to': {'name': target['name'] ?? '', 'time': leg['endTime'], 'planned': leg['scheduledEndTime'], 'track': target['track'] ?? target['scheduledTrack'], 'lat': _number(target['lat']), 'lon': _number(target['lon'])},
      'minutes': duration is num ? (duration / 60).round() : 0,
      'distance': distance is num ? distance.round() : 0,
      'stops': _list(leg['intermediateStops']).length,
      'realtime': leg['realTime'] == true,
      'cancelled': leg['cancelled'] == true,
    };
  }

  static String? _fareStopOf(Object? stopId) => _fareStopInId.firstMatch('${stopId ?? ''}')?.group(1);

  static Map<String, Object?>? _fareQuery(List<Map<String, Object?>> rides) {
    final first = rides.first, last = rides.last;
    final origin = _fareStopOf(_map(first['from'])['stopId']);
    final target = _fareStopOf(_map(last['to'])['stopId']);
    if (origin == null || target == null || origin == target) return null;
    return {'from': origin, 'to': target, 'time': first['scheduledStartTime'] ?? first['startTime']};
  }

  Future<(Map<String, Object?>, int)> _journeys(Map<String, String> args) async {
    final origin = _arg(args, 'von'), target = _arg(args, 'nach');
    if (origin == null || origin.isEmpty || target == null || target.isEmpty) {
      return (<String, Object?>{'error': 'Start oder Ziel fehlt'}, 400);
    }
    final data = _map(await _fetch('plan', {
      'fromPlace': origin,
      'toPlace': target,
      'time': _arg(args, 'zeit', 40),
      'arriveBy': args['ankunft'] == '1' ? 'true' : 'false',
      'numItineraries': 5,
    }, 45));
    final result = <Map<String, Object?>>[];
    for (final raw in _list(data['itineraries'])) {
      final item = _map(raw);
      final legs = _list(item['legs']).map((leg) => _leg(_map(leg))).toList();
      if (legs.isEmpty) continue;
      final rides = legs.where((leg) => leg['category'] != 'fuss' && leg['category'] != 'rad').toList();
      final ticket = rides.isEmpty
          ? 'fuss'
          : rides.any((leg) => _longDistance.contains(leg['category']))
              ? 'fern'
              : 'deutschland';
      final ridden = _list(item['legs']).map(_map).where((leg) => !const {'fuss', 'rad'}.contains(_category(leg['mode']))).toList();
      final duration = item['duration'];
      final transfers = item['transfers'];
      result.add({
        'start': item['startTime'],
        'end': item['endTime'],
        'minutes': duration is num ? (duration / 60).round() : 0,
        'transfers': transfers is int && transfers >= 0 ? transfers : (rides.length - 1).clamp(0, 99),
        'legs': legs,
        'ticket': ticket,
        'fare': ticket == 'deutschland' ? _fareQuery(ridden) : null,
        'realtime': rides.any((leg) => leg['realtime'] == true),
        'cancelled': rides.any((leg) => leg['cancelled'] == true),
      });
    }
    return (<String, Object?>{'journeys': result}, 200);
  }

  static double? _price(Map<String, Object?> group, String name) {
    for (final raw in _list(group['tickets'])) {
      final variant = _map(raw);
      final amount = _map(variant['price'])['amount'];
      if (variant['name'] == name && amount is num && amount > 0) return amount.round() / 100;
    }
    return null;
  }

  static Map<String, Object?>? _fareTicket(Map<String, Object?> group, String label) {
    final price = _price(group, 'Regeltarif');
    return price == null ? null : {'label': label, 'price': price, 'reduced': _price(group, 'Ermäßigungstarif')};
  }

  static Map<String, Object?>? _fareView(Map<String, Object?> journey) {
    final rides = _list(journey['legs']).map(_map).where((leg) => _map(leg['line']).isNotEmpty).toList();
    if (rides.isEmpty) return null;
    Map<String, Object?>? single, short;
    String? net, zones;
    for (final raw in _list(journey['tickets'])) {
      final group = _map(raw);
      final name = '${group['name'] ?? ''}';
      final shortTrip = _shortTrip.firstMatch(name), city = _citySingle.firstMatch(name);
      if (shortTrip != null) {
        short ??= _fareTicket(group, shortTrip[1]!);
      } else if (city != null && single == null) {
        final area = city[2]!.replaceAll('-', '');
        single = _fareTicket(group, '${city[1]} $area');
        if (single != null) {
          net = city[1];
          zones = area;
        }
      } else if (name.endsWith(': Einzelfahrausweis') && single == null) {
        single = _fareTicket(group, name.substring(0, name.lastIndexOf(':')));
      }
    }
    if (single == null) return null;
    return {
      'start': rides.first['plannedDeparture'] ?? rides.first['departure'],
      'end': rides.last['plannedArrival'] ?? rides.last['arrival'],
      'lines': [for (final leg in rides) '${_map(leg['line'])['name'] ?? ''}'],
      'single': single,
      'short': short,
      'net': net,
      'zones': zones,
    };
  }

  Future<(Map<String, Object?>, int)> _fares(Map<String, String> args) async {
    final origin = _arg(args, 'von', 12) ?? '', target = _arg(args, 'nach', 12) ?? '';
    if (!_fareStop.hasMatch(origin) || !_fareStop.hasMatch(target)) {
      return (<String, Object?>{'error': 'Start oder Ziel fehlt'}, 400);
    }
    final data = _map(await _get(
      Uri.https('v6.vbb.transport.rest', '/journeys', _query({
        'from': origin,
        'to': target,
        'departure': _arg(args, 'zeit', 40),
        'results': 6,
        'tickets': 'true',
        'stopovers': 'false',
        'remarks': 'false',
        'language': 'de',
      })),
      300,
    ));
    final found = _list(data['journeys']).map((item) => _fareView(_map(item))).nonNulls.toList();
    return (<String, Object?>{'fares': found}, 200);
  }

  Future<(Map<String, Object?>, int)> _nearby(Map<String, String> args) async {
    final lat = double.tryParse(args['lat'] ?? ''), lon = double.tryParse(args['lon'] ?? '');
    if (lat == null || lon == null || lat.abs() > 90 || lon.abs() > 180) {
      return (<String, Object?>{'error': 'Standort fehlt'}, 400);
    }
    const span = 0.006;
    final data = await _fetch('map/stops', {'min': '${lat - span},${lon - span}', 'max': '${lat + span},${lon + span}'}, 300);
    final stops = <Map<String, Object?>>[
      for (final raw in _list(data))
        if (_map(raw)['stopId'] != null)
          {'id': _map(raw)['stopId'], 'name': _map(raw)['name'] ?? '', 'lat': _map(raw)['lat'], 'lon': _map(raw)['lon']},
    ];
    double distance(Map<String, Object?> stop) {
      final a = stop['lat'], b = stop['lon'];
      if (a is! num || b is! num) return double.infinity;
      return (a - lat) * (a - lat) + (b - lon) * (b - lon);
    }

    stops.sort((a, b) => distance(a).compareTo(distance(b)));
    final unique = <String, Map<String, Object?>>{};
    for (final stop in stops) {
      unique.putIfAbsent('${stop['name']}', () => stop);
    }
    return (<String, Object?>{'stops': unique.values.take(6).toList()}, 200);
  }

  Future<(Map<String, Object?>, int)> handle(String action, Map<String, String> args) async {
    final handler = switch (action) {
      'suche' => _search,
      'abfahrten' => _departures,
      'verbindungen' => _journeys,
      'naehe' => _nearby,
      'tarif' => _fares,
      _ => null,
    };
    if (handler == null) return (<String, Object?>{'error': 'unbekannt'}, 404);
    try {
      return await handler(args);
    } on _TransitFailure catch (failure) {
      return (<String, Object?>{'error': failure.message}, failure.status);
    } on TimeoutException {
      return (<String, Object?>{'error': 'Fahrplan gerade nicht erreichbar'}, 504);
    } on SocketException {
      return (<String, Object?>{'error': 'Fahrplan gerade nicht erreichbar'}, 504);
    } on http.ClientException {
      return (<String, Object?>{'error': 'Fahrplan gerade nicht erreichbar'}, 504);
    } catch (_) {
      return (<String, Object?>{'error': 'Unerwartete Antwort vom Fahrplan'}, 502);
    }
  }
}
