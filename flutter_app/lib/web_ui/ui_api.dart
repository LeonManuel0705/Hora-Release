// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:typed_data';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../services/site_icon_rules.dart' show imageKind;
import '../services/site_icons.dart';
import 'ui_data.dart';
import 'ui_db.dart';
import 'ui_transit.dart';
import 'ui_weather.dart';

class UiPlanPage {
  const UiPlanPage(this.bytes, this.contentType, this.digest);

  final Uint8List bytes;
  final String contentType;
  final String digest;
}

class UiPlan {
  const UiPlan({required this.pages, this.cachedAt, this.cause});

  final List<UiPlanPage> pages;
  final DateTime? cachedAt;
  final String? cause;
}

/// A host that can fetch the homework from IServ right now, which the background sync does every quarter of an hour.
/// It answers null when IServ gave its list, an empty one too, otherwise why not: setup, login, offline or format.
abstract class UiIservSync {
  Future<String?> syncIserv();
}

abstract class UiHost {
  Future<Map<String, Object?>> connectIserv(String url, String user, String password);
  Future<void> disconnectIserv();
  Map<String, Object?> iservStatus();
  Future<UiPlan?> plan({bool fresh = false});
  Future<int> changeState(String name);
  Future<void> themeChoice(String? choice);
  void dataChanged(String area);
}

class UiRequest {
  UiRequest({required this.method, required this.segments, required this.query, required this.json, required this.body});

  final String method;
  final List<String> segments;
  final Map<String, String> query;
  final bool json;
  final Object? body;

  Map<String, Object?>? get payload => json && body is Map ? (body as Map).cast<String, Object?>() : null;
}

class UiReply {
  const UiReply(this.status, this.body, {this.bytes, this.contentType, this.filename});

  factory UiReply.ok([Map<String, Object?> extra = const {}]) => UiReply(200, {'success': true, ...extra});

  factory UiReply.error(String message, [int status = 400]) => UiReply(status, {'success': false, 'error': message});

  factory UiReply.file(Uint8List bytes, String contentType, String filename) =>
      UiReply(200, null, bytes: bytes, contentType: contentType, filename: filename);

  final int status;
  final Object? body;
  final Uint8List? bytes;
  final String? contentType;
  final String? filename;
}

class _Invalid implements Exception {
  const _Invalid(this.message);

  final String message;
}

class UiApi {
  UiApi(this.host);

  final UiHost? host;
  final _uuid = const Uuid();

  static const _eventCategories = {'school': 'school', 'training': 'training', 'private': 'personal'};

  Future<UiReply> handle(UiRequest request) async {
    final db = await UiDb.open();
    final prefs = await SharedPreferences.getInstance();
    final data = UiData(db, prefs, DateTime.now());
    final path = request.segments;
    final method = request.method;
    try {
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'store') return await _store(db, request, path[2]);
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'transit' && method == 'GET') {
        final (body, status) = await UiTransit.instance.handle(path[2], request.query);
        return UiReply(status, body);
      }
      if (path.length == 2 && path[0] == 'ui' && path[1] == 'export' && method == 'GET') {
        return UiReply.ok({'data': await data.exportRecords()});
      }
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'tasks') return await _tasks(db, data, request);
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'deadlines') return await _deadlines(db, data, request);
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'grades') return await _grades(db, data, request);
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'events' && path[2] == 'synced' && method == 'GET') {
        return await _synced(db, request);
      }
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'events') return await _events(db, request);
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'notes') return await _notes(db, request);
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'places') return await _place(db, request, path[2]);
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'mail') return _mail(request);
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'weather' && path[2] == 'place' && method == 'PUT') {
        return await _weatherPlace(request);
      }
      if (path.length >= 2 && path[0] == 'hub' && path[1] == 'bookmarks') return await _bookmarks(db, request);
      if (path.length == 2 && path[0] == 'hub' && path[1] == 'tour') return await _tour(prefs, request);
      if (path.length == 2 && path[0] == 'hub' && path[1] == 'bundesland' && method == 'POST') return await _state(request);
      if (path.length >= 2 && path[0] == 'ui' && path[1] == 'vplan') return await _plan(request);
      if (path.length == 2 && path[0] == 'iserv') return await _iserv(request, path[1]);
      if (path.length == 3 && path[0] == 'ui' && path[1] == 'iserv' && method == 'POST') return await _iservRefresh(data, path[2]);
      if (path.isNotEmpty && (path[0] == 'calendar' || path[0] == 'email')) {
        return UiReply.error('Google lässt sich in der App noch nicht verbinden', 404);
      }
      return UiReply.error('Nicht gefunden', 404);
    } on _Invalid catch (invalid) {
      return UiReply.error(invalid.message);
    }
  }

  Map<String, Object?> _needPayload(UiRequest request) {
    final payload = request.payload;
    if (payload == null) throw const _Invalid('JSON erwartet');
    return payload;
  }

  void _changed(String area) => host?.dataChanged(area);

  Future<UiReply> _store(Database db, UiRequest request, String key) async {
    if (!UiDb.storeKeys.contains(key)) return UiReply.error('Unbekannter Schlüssel', 404);
    if (request.method == 'DELETE') {
      await UiDb.remove(db, key);
      await _mirror(key, null);
      return UiReply.ok();
    }
    if (request.method != 'PUT') return UiReply.error('Nicht erlaubt', 405);
    if (!request.json) return UiReply.error('JSON erwartet', 415);
    try {
      await UiDb.save(db, key, request.body);
    } on UiStoreTooLarge {
      return UiReply.error('Zu groß', 413);
    }
    await _mirror(key, request.body);
    return UiReply.ok();
  }

  static const _reminderKeys = {'app-settings', 'app-timetable-edits', 'app-block-times', 'app-ab-swap', 'app-subjects'};

  Future<void> _mirror(String key, Object? value) async {
    final prefs = await SharedPreferences.getInstance();
    if (_reminderKeys.contains(key)) _changed('reminders');
    if (key == 'app-ab-weeks') {
      await prefs.setBool('ab_weeks_enabled', value != false);
      _changed('school');
    } else if (key == 'app-theme-choice') {
      await host?.themeChoice(value == 'light' || value == 'dark' ? value as String : null);
    } else if (key == 'app-settings' && value is Map) {
      final school = value['school'] is Map ? value['school'] as Map : const {};
      final grade = school['grade'];
      if (grade is int && grade >= 5 && grade <= 13) {
        await prefs.setInt('school_class_level', grade);
        await prefs.setString('grade_system', grade >= 11 ? 'points' : 'marks');
      }
      if (school.containsKey('birthday')) {
        final birthday = isoDay(school['birthday']);
        if (birthday == null) {
          await prefs.remove('user_birthday');
        } else {
          await prefs.setString('user_birthday', birthday);
        }
      }
    }
  }

  int? _subjectId(Object? key) => key == null ? null : int.tryParse('$key');

  String _iso(String day, [String? time]) {
    final date = dayOf(day);
    final parts = (time ?? '00:00').split(':');
    return DateTime(date.year, date.month, date.day, int.parse(parts[0]), int.parse(parts[1])).toIso8601String();
  }

  Future<Map<String, Object?>?> _row(Database db, String table, String id) async {
    final rows = await db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Map<String, Object?> _taskColumns(Map<String, Object?> payload, Map<String, Object?> subjects, Map<String, Object?>? row) {
    final columns = <String, Object?>{};
    if (payload.containsKey('title') || row == null) {
      final title = text(payload['title'], 300);
      if (title.isEmpty) throw const _Invalid('Titel fehlt');
      columns['title'] = title;
    }
    if (payload.containsKey('subject')) {
      final subject = payload['subject'];
      columns['subject'] = subjects.containsKey(subject) ? subject : null;
      columns['category'] = columns['subject'] == null ? 'general' : 'school';
    }
    if (payload.containsKey('date') || payload.containsKey('dueTime')) {
      final current = stamp(row?['due_date']);
      var day = current == null ? null : isoOf(current);
      var time = current == null || (current.hour == 0 && current.minute == 0) ? null : hm(current);
      if (payload.containsKey('date')) day = isoDay(payload['date']);
      if (payload.containsKey('dueTime')) time = clock(payload['dueTime']);
      columns['due_date'] = day == null ? null : _iso(day, time);
    }
    if (payload.containsKey('someday')) columns['someday'] = payload['someday'] == true ? 1 : 0;
    if (payload.containsKey('minutes')) {
      final minutes = payload['minutes'];
      columns['estimated_minutes'] = minutes is int && minutes > 0 && minutes <= 1440 ? minutes : null;
    }
    if (payload.containsKey('priority')) columns['priority'] = payload['priority'] == true ? 'high' : 'medium';
    if (payload.containsKey('repeat')) columns['repeat_type'] = uiRepeats.contains(payload['repeat']) ? payload['repeat'] : null;
    if (payload.containsKey('notes')) columns['description'] = text(payload['notes'], 5000);
    if (payload.containsKey('deadline')) {
      final deadline = text(payload['deadline'], 60);
      columns['deadline_ref'] = deadline.isEmpty ? null : deadline;
    }
    if (payload.containsKey('source')) columns['source'] = payload['source'] == 'iserv' ? 'iserv' : 'own';
    if (payload.containsKey('done')) {
      final done = payload['done'] == true;
      columns['completed'] = done ? 1 : 0;
      columns['completed_at'] = done ? DateTime.now().toIso8601String() : null;
    }
    return columns;
  }

  Future<UiReply> _tasks(Database db, UiData data, UiRequest request) async {
    final path = request.segments;
    final subjects = (await data.school()).known;
    final now = DateTime.now().toIso8601String();
    if (path.length == 2 && request.method == 'POST') {
      final columns = _taskColumns(_needPayload(request), subjects, null);
      columns.putIfAbsent('priority', () => 'medium');
      columns.putIfAbsent('category', () => 'general');
      columns.putIfAbsent('completed', () => 0);
      final id = _uuid.v4();
      await db.insert('tasks', {...columns, 'id': id, 'created_at': now, 'updated_at': now});
      _changed('tasks');
      return UiReply.ok({'task': UiData.taskView((await _row(db, 'tasks', id))!, subjects)});
    }
    if (path.length != 3) return UiReply.error('Nicht gefunden', 404);
    final id = path[2];
    final row = await _row(db, 'tasks', id);
    if (row == null) return UiReply.error('Aufgabe nicht gefunden', 404);
    if (request.method == 'DELETE') {
      await db.delete('tasks', where: 'id = ?', whereArgs: [id]);
      _changed('tasks');
      return UiReply.ok();
    }
    if (request.method != 'PATCH') return UiReply.error('Nicht erlaubt', 405);
    final columns = _taskColumns(_needPayload(request), subjects, row);
    if (columns.isNotEmpty) {
      await db.update('tasks', {...columns, 'updated_at': now}, where: 'id = ?', whereArgs: [id]);
      _changed('tasks');
    }
    return UiReply.ok({'task': UiData.taskView((await _row(db, 'tasks', id))!, subjects)});
  }

  (String, String)? _deadlineRef(String ref) {
    final split = ref.indexOf('-');
    if (split <= 0) return null;
    final prefix = ref.substring(0, split), id = ref.substring(split + 1);
    if (!uiDeadlineKinds.containsKey(prefix) || id.isEmpty) return null;
    return (prefix, id);
  }

  void _applyDeadline(String prefix, Map<String, Object?> payload, Map<String, Object?> item, School school, bool creating) {
    if (payload.containsKey('title') || creating) {
      final title = text(payload['title'], 300);
      if (title.isEmpty) throw const _Invalid('Titel fehlt');
      item['title'] = title;
    }
    if (payload.containsKey('subject')) {
      item['subject_id'] = school.known.containsKey(payload['subject']) ? _subjectId(payload['subject']) ?? payload['subject'] : null;
    }
    if (payload.containsKey('date') || creating) {
      final when = isoDay(payload['date']);
      if (when == null) throw const _Invalid('Datum fehlt');
      item[prefix == 'hw' ? 'due_date' : 'date'] = _iso(when);
    }
    if (payload.containsKey('detail')) item['notes'] = text(payload['detail'], 2000);
    if (prefix != 'hw' && payload.containsKey('time')) item['time'] = clock(payload['time']) ?? '';
    if (prefix == 'hw' && payload.containsKey('status')) item['completed'] = payload['status'] == 'abgegeben' ? 1 : 0;
  }

  Future<UiReply> _deadlines(Database db, UiData data, UiRequest request) async {
    final path = request.segments;
    final school = await data.school();
    final now = DateTime.now().toIso8601String();
    if (path.length == 2 && request.method == 'POST') {
      final payload = _needPayload(request);
      final prefix = uiDeadlinePrefixes[payload['kind']];
      if (prefix == null) return UiReply.error('Unbekannte Art');
      final item = <String, Object?>{'id': _uuid.v4(), 'subject_id': null, 'notes': '', 'created_at': now};
      if (prefix == 'hw') {
        item.addAll({'completed': 0, 'updated_at': now});
      } else {
        item['time'] = '';
      }
      _applyDeadline(prefix, payload, item, school, true);
      await db.insert(uiDeadlineTables[prefix]!, item);
      _changed('school');
      return UiReply.ok({'deadline': data.deadlineView(prefix, item, school)});
    }
    if (path.length != 3) return UiReply.error('Nicht gefunden', 404);
    final parsed = _deadlineRef(path[2]);
    if (parsed == null) return UiReply.error('Unbekannter Eintrag', 404);
    final (prefix, id) = parsed;
    if (prefix == 'hw' && id.startsWith(iservPrefix)) return _iservHomework(db, data, school, request, id);
    final table = uiDeadlineTables[prefix]!;
    final row = await _row(db, table, id);
    if (row == null) return UiReply.error('Eintrag nicht gefunden', 404);
    if (request.method == 'DELETE') {
      await db.delete(table, where: 'id = ?', whereArgs: [id]);
      _changed('school');
      return UiReply.ok();
    }
    if (request.method != 'PATCH') return UiReply.error('Nicht erlaubt', 405);
    final item = Map<String, Object?>.of(row);
    _applyDeadline(prefix, _needPayload(request), item, school, false);
    if (prefix == 'hw') item['updated_at'] = now;
    item.remove('id');
    await db.update(table, item, where: 'id = ?', whereArgs: [id]);
    _changed('school');
    return UiReply.ok({'deadline': data.deadlineView(prefix, (await _row(db, table, id))!, school)});
  }

  Future<UiReply> _iservHomework(Database db, UiData data, School school, UiRequest request, String id) async {
    final rows = await db.query('iserv_exercises', where: 'id = ?', whereArgs: [id.substring(iservPrefix.length)], limit: 1);
    if (rows.isEmpty) return UiReply.error('Eintrag nicht gefunden', 404);
    if (request.method == 'DELETE') {
      await UiDb.changeIdSet(db, UiDb.iservHiddenKey, id, true);
      _changed('school');
      return UiReply.ok();
    }
    if (request.method != 'PATCH') return UiReply.error('Nicht erlaubt', 405);
    final payload = _needPayload(request);
    if (payload['hidden'] == false) {
      await UiDb.changeIdSet(db, UiDb.iservHiddenKey, id, false);
      _changed('school');
    }
    if (payload.containsKey('status')) {
      await UiDb.changeIdSet(db, UiDb.iservDoneKey, id, payload['status'] == 'abgegeben');
      _changed('school');
    }
    final done = await UiDb.idSet(db, UiDb.iservDoneKey);
    return UiReply.ok({'deadline': data.iservView(rows.first, school, done)});
  }

  Future<UiReply> _grades(Database db, UiData data, UiRequest request) async {
    final path = request.segments;
    if (path.length == 2 && request.method == 'POST') {
      final payload = _needPayload(request);
      final school = await data.school();
      final subject = payload['subject'];
      final points = payload['points'];
      if (!school.known.containsKey(subject)) return UiReply.error('Fach fehlt');
      if (points is! int || points < 0 || points > 15) return UiReply.error('Punkte fehlen');
      final kind = uiGradeWords.containsKey(payload['type']) ? payload['type'] as String : 'sonstiges';
      final marks = data.classLevel <= 10;
      final semester = text(payload['semester'], 12).isEmpty ? data.currentSemester : text(payload['semester'], 12);
      final day = isoDay(payload['date']) ?? data.todayIso;
      final id = _uuid.v4();
      final now = DateTime.now().toIso8601String();
      await db.insert('grades', {
        'id': id,
        'subject_id': _subjectId(subject) ?? subject,
        'semester': semester,
        'type': uiGradeWords[kind],
        'points': marks ? 0 : points,
        'value': marks ? uiMarks[points] : null,
        'grade_system': marks ? 'marks' : 'points',
        'notes': text(payload['title'], 300),
        'date': _iso(day),
        'created_at': now,
      });
      _changed('school');
      return UiReply.ok({
        'grade': {'id': 'g-$id', 'subject': subject, 'points': points, 'type': kind, 'semester': semester, 'date': day, 'title': text(payload['title'], 300)},
      });
    }
    if (path.length == 3 && request.method == 'DELETE') {
      final ref = path[2];
      if (!ref.startsWith('g-')) return UiReply.error('Unbekannte Note', 404);
      final removed = await db.delete('grades', where: 'id = ?', whereArgs: [ref.substring(2)]);
      if (removed == 0) return UiReply.error('Note nicht gefunden', 404);
      _changed('school');
      return UiReply.ok();
    }
    return UiReply.error('Nicht gefunden', 404);
  }

  Map<String, Object?> _eventColumns(Map<String, Object?> payload, Map<String, Object?> current) {
    final merged = Map<String, Object?>.of(current);
    if (payload.containsKey('title') || !current.containsKey('title')) {
      final title = text(payload['title'], 300);
      if (title.isEmpty) throw const _Invalid('Titel fehlt');
      merged['title'] = title;
    }
    if (payload.containsKey('date') || !current.containsKey('date')) {
      final when = isoDay(payload['date']);
      if (when == null) throw const _Invalid('Datum fehlt');
      merged['date'] = when;
    }
    if (payload.containsKey('endDate')) merged['endDate'] = isoDay(payload['endDate']);
    if (payload.containsKey('start')) merged['start'] = clock(payload['start']);
    if (payload.containsKey('end')) merged['end'] = clock(payload['end']);
    if (payload.containsKey('place')) merged['place'] = text(payload['place'], 300);
    if (payload.containsKey('notes')) merged['notes'] = text(payload['notes'], 5000);
    if (payload.containsKey('kind')) merged['kind'] = payload['kind'];
    final date = merged['date'] as String;
    var last = merged['endDate'] as String?;
    if (last == null || last.compareTo(date) < 0) last = date;
    final start = merged['start'] as String?;
    final end = merged['end'] as String?;
    final allDay = start == null;
    final startStamp = DateTime.parse(_iso(date, start));
    var endStamp = allDay
        ? DateTime.parse(_iso(last, '23:59'))
        : end != null
            ? DateTime.parse(_iso(last, end))
            : startStamp.add(const Duration(hours: 1));
    if (!endStamp.isAfter(startStamp)) endStamp = startStamp.add(const Duration(hours: 1));
    return {
      'title': merged['title'],
      'description': merged['notes'] ?? '',
      'location': merged['place'] ?? '',
      'start_time': startStamp.toIso8601String(),
      'end_time': endStamp.toIso8601String(),
      'all_day': allDay ? 1 : 0,
      'category': _eventCategories[merged['kind']] ?? 'personal',
    };
  }

  Future<UiReply> _events(Database db, UiRequest request) async {
    final path = request.segments;
    final now = DateTime.now().toIso8601String();
    if (path.length == 2 && request.method == 'POST') {
      final columns = _eventColumns(_needPayload(request), const {});
      final id = _uuid.v4();
      await db.insert('events', {...columns, 'id': id, 'created_at': now, 'updated_at': now});
      _changed('events');
      return UiReply.ok({'event': UiData.eventView((await _row(db, 'events', id))!)});
    }
    if (path.length != 3) return UiReply.error('Nicht gefunden', 404);
    final ref = path[2];
    if (!ref.startsWith('loc-')) return UiReply.error('Nur eigene Termine lassen sich hier ändern', 404);
    final id = ref.substring(4);
    final row = await _row(db, 'events', id);
    if (row == null || row['category'] == 'holiday' || row['category'] == 'vacation') {
      return UiReply.error('Termin nicht gefunden', 404);
    }
    if (request.method == 'DELETE') {
      await db.delete('events', where: 'id = ?', whereArgs: [id]);
      _changed('events');
      return UiReply.ok();
    }
    if (request.method != 'PATCH') return UiReply.error('Nicht erlaubt', 405);
    final current = UiData.eventView(row) ?? const <String, Object?>{};
    final columns = _eventColumns(_needPayload(request), current);
    await db.update('events', {...columns, 'updated_at': now}, where: 'id = ?', whereArgs: [id]);
    _changed('events');
    return UiReply.ok({'event': UiData.eventView((await _row(db, 'events', id))!)});
  }

  static const _kindWords = [
    ('training', ['training', 'sport', 'gym', 'fitness', 'schwimm', 'verein']),
    ('school', ['schule', 'school', 'iserv', 'kurs', 'uni', 'klasse']),
  ];

  String _syncedKind(List<Object?> texts) {
    final joined = texts.map((item) => '${item ?? ''}').join(' ').toLowerCase();
    for (final (kind, words) in _kindWords) {
      if (words.any(joined.contains)) return kind;
    }
    return 'private';
  }

  Future<UiReply> _synced(Database db, UiRequest request) async {
    final today = DateTime.now();
    final start = isoDay(request.query['start']) ?? isoOf(today.subtract(const Duration(days: 42)));
    final end = isoDay(request.query['end']) ?? isoOf(today.add(const Duration(days: 120)));
    if (end.compareTo(start) < 0 || daysBetween(dayOf(start), dayOf(end)) > 400) return UiReply.error('Zeitraum ungültig');
    final calendars = {
      for (final row in await db.query('google_calendars')) '${row['id']}': row,
    };
    final events = <Map<String, Object?>>[];
    void add(Map<String, Object?> view) {
      final last = (view['endDate'] as String?) ?? view['date'] as String;
      if (last.compareTo(start) >= 0 && (view['date'] as String).compareTo(end) <= 0) events.add(view);
    }

    for (final row in await db.query('google_events', where: "sync_status IS NULL OR sync_status != 'deleted'")) {
      final calendar = calendars['${row['calendar_id']}'];
      if (calendar != null && calendar['is_visible'] == 0) continue;
      final allDay = row['all_day'] == 1;
      final begin = allDay ? null : stamp(row['start_time']);
      final finish = allDay ? null : stamp(row['end_time']);
      final day = allDay ? isoDay(row['start_date']) : begin == null ? null : isoOf(begin);
      if (day == null) continue;
      var last = allDay ? isoDay(row['end_date']) : finish == null ? null : isoOf(finish);
      if (allDay && last != null && last.compareTo(day) > 0) last = isoOf(dayOf(last).subtract(const Duration(days: 1)));
      final view = <String, Object?>{
        'id': 'g-${row['calendar_id']}-${row['id']}',
        'date': day,
        'start': begin == null ? null : hm(begin),
        'end': finish == null ? null : hm(finish),
        'title': text(row['title']).isEmpty ? 'Termin' : text(row['title']),
        'place': text(row['location']),
        'kind': _syncedKind([calendar?['name'], row['title']]),
        'notes': text(row['description'], 2000),
        'source': 'dem Google-Kalender',
        'synced': true,
      };
      if (last != null && last.compareTo(day) > 0) view['endDate'] = last;
      add(view);
    }
    for (final row in await db.query('iserv_events')) {
      final begin = stamp(row['start_time']);
      if (begin == null) continue;
      final allDay = row['all_day'] == 1;
      final finish = stamp(row['end_time']);
      final day = isoOf(begin);
      final last = finish == null ? day : isoOf(finish);
      final view = <String, Object?>{
        'id': 'i-${row['id']}',
        'date': day,
        'start': allDay ? null : hm(begin),
        'end': allDay || finish == null || !finish.isAfter(begin) ? null : hm(finish),
        'title': text(row['title']).isEmpty ? 'Termin' : text(row['title']),
        'place': text(row['location']),
        'kind': 'school',
        'notes': text(row['description'], 2000),
        'source': 'IServ',
        'synced': true,
      };
      if (last.compareTo(day) > 0) view['endDate'] = last;
      add(view);
    }
    return UiReply.ok({'events': events});
  }

  // A new note takes 300 and 5000 characters on the page. One from the older screens may be longer and must survive an edit.
  static const _noteTitle = 1000, _noteText = 100000;

  static int _words(String content) => content.isEmpty ? 0 : content.split(RegExp(r'\s+')).length;

  Future<UiReply> _notes(Database db, UiRequest request) async {
    final path = request.segments;
    final now = DateTime.now().toIso8601String();
    if (path.length == 2 && request.method == 'POST') {
      final payload = _needPayload(request);
      final title = text(payload['title'], _noteTitle);
      if (title.isEmpty) return UiReply.error('Titel fehlt');
      final content = text(payload['details'], _noteText);
      final id = _uuid.v4();
      await db.insert('quick_notes', {
        'id': id,
        'type': payload['type'] == 'idea' ? 'idea' : 'note',
        'title': title,
        'content': content,
        'word_count': _words(content),
        'created_at': DateTime.tryParse(text(payload['created'], 40))?.toIso8601String() ?? now,
        'updated_at': now,
      });
      _changed('notes');
      return UiReply.ok({'note': UiData.noteView((await _row(db, 'quick_notes', id))!)});
    }
    if (path.length != 3) return UiReply.error('Nicht gefunden', 404);
    final row = await _row(db, 'quick_notes', path[2]);
    if (row == null) return UiReply.error('Notiz nicht gefunden', 404);
    if (request.method == 'DELETE') {
      await db.delete('quick_notes', where: 'id = ?', whereArgs: [path[2]]);
      _changed('notes');
      return UiReply.ok();
    }
    if (request.method != 'PATCH') return UiReply.error('Nicht erlaubt', 405);
    final payload = _needPayload(request);
    if (payload.containsKey('title') && text(payload['title'], _noteTitle).isEmpty) return UiReply.error('Titel fehlt');
    final columns = <String, Object?>{'updated_at': now};
    final shown = UiData.noteView(row);
    if (text(row['title']).isEmpty && shown != null) {
      // Such a note shows its first line as the title and the page sends only what changed. Stored apart first, one part cannot swallow the other.
      columns['title'] = shown['title'];
      columns['content'] = shown['details'];
    }
    if (payload.containsKey('title')) columns['title'] = text(payload['title'], _noteTitle);
    if (payload.containsKey('details')) columns['content'] = text(payload['details'], _noteText);
    if (payload['type'] == 'note' || payload['type'] == 'idea') columns['type'] = payload['type'];
    if (columns['content'] is String) columns['word_count'] = _words(columns['content'] as String);
    await db.update('quick_notes', columns, where: 'id = ?', whereArgs: [path[2]]);
    _changed('notes');
    return UiReply.ok({'note': UiData.noteView((await _row(db, 'quick_notes', path[2]))!)});
  }

  static const _bookmarkCategories = {'Work', 'Personal', 'Dev', 'Other'};
  static const _iconTypes = {'png': 'image/png', 'ico': 'image/x-icon', 'jpg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'};

  Map<String, Object?> _bookmarkFields(UiRequest request) {
    final payload = _needPayload(request);
    final title = text(payload['title'], 200);
    final url = text(payload['url'], 2000);
    final address = Uri.tryParse(url);
    if (title.isEmpty || url.isEmpty) throw const _Invalid('Titel und Adresse fehlen');
    if (address == null || !const {'http', 'https'}.contains(address.scheme) || address.host.isEmpty) {
      throw const _Invalid('Das ist keine Webadresse');
    }
    final category = '${payload['category'] ?? ''}';
    return {'title': title, 'url': url, 'category': _bookmarkCategories.contains(category) ? category : 'Other'};
  }

  Future<Map<String, Object?>?> _bookmark(Database db, String id) async {
    final rows = await db.query('bookmarks', where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<Iterable<String>> _bookmarkUrls(Database db) async => [for (final row in await db.query('bookmarks', columns: ['url'])) text(row['url'])];

  Future<UiReply> _bookmarks(Database db, UiRequest request) async {
    final path = request.segments;
    final method = request.method;
    if (path.length == 2 && method == 'GET') {
      return UiReply(200, {'bookmarks': [for (final row in await db.query('bookmarks', orderBy: 'created_at DESC')) UiData.bookmarkView(row)]});
    }
    if (path.length == 2 && method == 'POST') {
      final fields = _bookmarkFields(request);
      final now = DateTime.now().toIso8601String();
      final earlier = request.payload?['restore'];
      final kept = earlier is Map ? earlier : const <Object?, Object?>{};
      final earlierId = '${kept['id'] ?? ''}';
      final earlierAt = text(kept['created_at'], 40);
      final restoring = RegExp(r'^[A-Za-z0-9-]{1,64}$').hasMatch(earlierId) && DateTime.tryParse(earlierAt) != null && await _bookmark(db, earlierId) == null;
      final id = restoring ? earlierId : _uuid.v4();
      final favicon = restoring && kept['favicon'] is String ? kept['favicon'] : null;
      await db.insert('bookmarks', {'id': id, ...fields, 'favicon': favicon, 'created_at': restoring ? earlierAt : now, 'updated_at': now});
      return UiReply.ok({'bookmark': UiData.bookmarkView((await _bookmark(db, id))!)});
    }
    if (path.length == 4 && path[3] == 'icon' && method == 'GET') {
      final row = await _bookmark(db, path[2]);
      final bytes = row == null ? null : await siteIcon(text(row['url']));
      final type = bytes == null ? null : _iconTypes[imageKind(bytes)];
      if (row == null) return const UiReply(404, null);
      if (bytes == null || type == null) return const UiReply(204, null);
      return UiReply.file(bytes, type, 'icon');
    }
    if (path.length != 3) return UiReply.error('Nicht gefunden', 404);
    final row = await _bookmark(db, path[2]);
    if (method == 'DELETE') {
      if (row == null) return UiReply.ok();
      await db.delete('bookmarks', where: 'id = ?', whereArgs: [path[2]]);
      await forgetSiteIcon(text(row['url']), await _bookmarkUrls(db));
      return UiReply.ok({'bookmark': row});
    }
    if (method != 'PUT') return UiReply.error('Nicht gefunden', 404);
    if (row == null) return UiReply.error('Lesezeichen nicht gefunden', 404);
    final fields = _bookmarkFields(request);
    await db.update('bookmarks', {...fields, 'updated_at': DateTime.now().toIso8601String()}, where: 'id = ?', whereArgs: [path[2]]);
    if (text(row['url']) != fields['url']) await forgetSiteIcon(text(row['url']), await _bookmarkUrls(db));
    return UiReply.ok({'bookmark': UiData.bookmarkView((await _bookmark(db, path[2]))!)});
  }

  Future<UiReply> _place(Database db, UiRequest request, String key) async {
    if (key != 'home' && key != 'school') return UiReply.error('Unbekannter Ort', 404);
    if (request.method == 'DELETE') {
      final rows = await db.query('vbb_known_locations', where: 'key = ?', whereArgs: [key], limit: 1);
      await db.delete('vbb_known_locations', where: 'key = ?', whereArgs: [key]);
      final known = rows.isEmpty ? null : rows.first;
      final usable = known != null && text(known['name']).isNotEmpty && known['latitude'] != null && known['longitude'] != null;
      return UiReply.ok({
        'removed': usable
            ? {
                'name': text(known['name'], 200),
                'area': '',
                'lat': known['latitude'],
                'lon': known['longitude'],
                'stop': known['type'] == 'stop' ? text(known['vbb_id'], 120) : '',
              }
            : null,
      });
    }
    if (request.method != 'PUT') return UiReply.error('Nicht erlaubt', 405);
    final payload = _needPayload(request);
    final lat = double.tryParse('${payload['lat']}'), lon = double.tryParse('${payload['lon']}');
    if (lat == null || lon == null) return UiReply.error('Koordinaten fehlen');
    if (lat.abs() > 90 || lon.abs() > 180) return UiReply.error('Koordinaten ungültig');
    var name = text(payload['name'], 120);
    if (name.isEmpty) return UiReply.error('Name fehlt');
    final stop = text(payload['stop'], 120);
    final area = text(payload['area'], 120);
    if (stop.isEmpty && area.isNotEmpty && !name.contains(area)) name = text('$name, $area', 200);
    final row = {'key': key, 'name': name, 'vbb_id': stop, 'latitude': lat, 'longitude': lon, 'type': stop.isEmpty ? 'location' : 'stop'};
    await db.insert('vbb_known_locations', row, conflictAlgorithm: ConflictAlgorithm.replace);
    return UiReply.ok({'place': UiData.placeView(key == 'home' ? 'Zuhause' : 'Schule', row)});
  }

  Future<UiReply> _weatherPlace(UiRequest request) async {
    final name = text(_needPayload(request)['name'], 80);
    if (name.isEmpty) return UiReply.error('Trag einen Ort ein, zum Beispiel Potsdam.');
    final place = await UiWeather.instance.setPlace(name);
    if (place == null) return UiReply.error('Diesen Ort finde ich nicht. Versuch es mit dem Namen der Stadt.', 404);
    return UiReply.ok({'place': place.name});
  }

  UiReply _mail(UiRequest request) {
    if (request.segments.length == 2 && request.method == 'GET') {
      return UiReply.ok({'accounts': <Object?>[], 'messages': <Object?>[], 'failed': <Object?>[]});
    }
    return UiReply.error('E-Mail gibt es in der App noch nicht', 404);
  }

  Future<UiReply> _tour(SharedPreferences prefs, UiRequest request) async {
    if (request.method == 'GET') return UiReply.ok({'state': prefs.getString('tour_state')});
    final state = _needPayload(request)['state'];
    if (state != 'done' && state != 'skipped') return UiReply.error('Invalid state');
    await prefs.setString('tour_state', state as String);
    return UiReply.ok();
  }

  Future<UiReply> _state(UiRequest request) async {
    final name = stateName('${_needPayload(request)['bundesland'] ?? ''}');
    if (name == null) return UiReply.error('Unbekanntes Bundesland');
    if (host == null) return UiReply.error('Gerade nicht möglich', 503);
    try {
      final count = await host!.changeState(name);
      _changed('events');
      return UiReply.ok({'imported_count': count});
    } catch (_) {
      return UiReply.error('Ferien ließen sich nicht laden', 502);
    }
  }

  static const _planProblems = {
    'setup': 'IServ ist nicht verbunden.',
    'login': 'Die Anmeldung bei IServ ist abgelaufen. Verbinde IServ in den Einstellungen neu.',
    'empty': 'IServ zeigt gerade keinen Vertretungsplan.',
    'offline': 'IServ ist gerade nicht erreichbar.',
    'format': 'IServ liefert den Vertretungsplan als PDF. Das zeigt die App noch nicht an.',
  };

  static const _planSuffixes = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'};

  Future<UiReply> _plan(UiRequest request) async {
    final bridge = host;
    final path = request.segments;
    if (bridge == null || request.method != 'GET') return UiReply.error('Nicht gefunden', 404);
    if (path.length == 2) {
      final fresh = request.query['frisch'] == '1';
      final plan = await bridge.plan(fresh: fresh);
      if (plan == null) return UiReply.error('Nicht gefunden', 404);
      final problem = fresh && _planProblems.containsKey(plan.cause) ? plan.cause : null;
      final stamp = plan.cachedAt?.toIso8601String();
      return UiReply.ok({
        'files': [
          for (final (index, page) in plan.pages.indexed)
            {'page': index + 1, 'type': 'image', 'url': '/api/ui/vplan/datei/${index + 1}?v=${page.digest}'},
        ],
        'cachedAt': stamp == null || plan.pages.isEmpty ? null : stamp.substring(0, 16),
        'problem': problem,
        'message': _planProblems[problem] ?? '',
      });
    }
    final number = path.length == 4 && path[2] == 'datei' ? int.tryParse(path[3]) : null;
    final plan = number == null ? null : await bridge.plan();
    if (plan == null || number == null || number < 1 || number > plan.pages.length) return UiReply.error('Seite nicht gefunden', 404);
    final page = plan.pages[number - 1];
    return UiReply.file(page.bytes, page.contentType, 'vertretungsplan-$number.${_planSuffixes[page.contentType] ?? 'bin'}');
  }

  static const _homeworkProblems = {
    'setup': 'IServ ist nicht verbunden.',
    'login': 'Die Anmeldung bei IServ ist abgelaufen. Verbinde IServ in den Einstellungen neu.',
    'offline': 'IServ ist gerade nicht erreichbar.',
    'format': 'Die Hausaufgaben aus IServ lassen sich hier nicht lesen.',
  };

  /// The answer has the shape the desktop gives. The phone fetches no mail, so there is no part for it.
  Future<UiReply> _iservRefresh(UiData data, String action) async {
    if (action != 'homework' && action != 'sync') return UiReply.error('Nicht gefunden', 404);
    final bridge = host;
    final syncing = host is UiIservSync ? host as UiIservSync : null;
    final iserv = await data.iservAccount();
    if (bridge == null || syncing == null || iserv['connected'] != true || data.browser) {
      return UiReply.error(_planProblems['setup']!, 409);
    }
    final parts = <String, Object?>{};
    if (action == 'sync') {
      final plan = await bridge.plan(fresh: true);
      final problem = plan == null ? 'offline' : _planProblems.containsKey(plan.cause) ? plan.cause : null;
      // An empty plan and one only as PDF are answers from IServ as well.
      final reached = problem == null || problem == 'empty' || problem == 'format';
      parts['plan'] = {'ok': reached, 'problem': problem, 'message': _planProblems[problem] ?? '', 'count': problem == null ? plan!.pages.length : 0};
    }
    final cause = await syncing.syncIserv();
    final problem = cause == null ? null : _homeworkProblems.containsKey(cause) ? cause : 'offline';
    final homework = await data.iservHomework();
    final open = homework.where((item) => item['status'] != 'abgegeben').length;
    parts['homework'] = {'ok': problem == null, 'problem': problem, 'message': _homeworkProblems[problem] ?? '', 'count': open};
    _changed('school');
    return UiReply.ok({
      if (action == 'homework') ...(parts['homework'] as Map<String, Object?>),
      if (action == 'sync') 'parts': parts,
      'deadlines': homework,
      'status': await data.syncStatus(iserv),
    });
  }

  Future<UiReply> _iserv(UiRequest request, String action) async {
    final bridge = host;
    if (bridge == null) return UiReply.error('Gerade nicht möglich', 503);
    if (action == 'status' && request.method == 'GET') return UiReply.ok(bridge.iservStatus());
    if (action == 'disconnect' && request.method == 'POST') {
      await bridge.disconnectIserv();
      _changed('school');
      return UiReply.ok();
    }
    if (action == 'connect' && request.method == 'POST') {
      final payload = _needPayload(request);
      final url = text(payload['iserv_url'], 200), user = text(payload['username'], 120);
      final password = '${payload['password'] ?? ''}';
      if (url.isEmpty || user.isEmpty || password.isEmpty) return UiReply.error('Angaben fehlen');
      final result = await bridge.connectIserv(url, user, password);
      if (result['success'] != true) return UiReply.error('${result['error'] ?? 'Anmeldung fehlgeschlagen'}', 401);
      _changed('school');
      return UiReply.ok({'user': {'name': user}});
    }
    return UiReply.error('Nicht gefunden', 404);
  }
}
