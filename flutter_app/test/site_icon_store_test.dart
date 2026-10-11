// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: AGPL-3.0-only

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:app/services/site_icon_store.dart';

import 'site_icon_images.dart';

const public = '93.184.216.34';

class Answer {
  const Answer(this.body, {this.status = 200, this.headers = const {}, this.unannounced = false, this.announce});

  final List<int> body;
  final int status;
  final Map<String, String> headers;
  final bool unannounced;
  final int? announce;
}

Answer page(List<String> links, {String after = ''}) =>
    Answer(utf8.encode('<!doctype html><html><head><meta charset="utf-8">${links.join()}</head><body><p>Hi</p></body></html>$after'));

Answer moved(String location, [int status = 302]) => Answer(const [], status: status, headers: {'location': location});

/// A web server on this machine that answers what a test tells it to and notes what it was asked.
class Site {
  Site(this.server) {
    server.listen((request) async {
      final host = (request.headers.value('host') ?? '').toLowerCase();
      final path = request.uri.toString();
      seen.add('$host $path');
      heard.add({for (final name in ['user-agent', 'cookie', 'referer', 'authorization']) name: request.headers.value(name)});
      final route = routes['$host $path'] ?? routes[path] ?? Answer(utf8.encode('<!doctype html><html><head><title>Not found</title></head></html>'), status: 404);
      final response = request.response;
      try {
        final answer = route is Answer ? route : await (route as Future<Answer> Function())();
        response.statusCode = answer.status;
        answer.headers.forEach(response.headers.set);
        if (!answer.unannounced) response.contentLength = answer.announce ?? answer.body.length;
        response.add(answer.body);
        await response.close();
      } on Object {
        // the reader hung up or the announced length did not fit, both on purpose
      }
    });
  }

  final HttpServer server;
  final routes = <String, Object>{};
  final seen = <String>[];
  final heard = <Map<String, String?>>[];

  List<String> paths([String? host]) => [
        for (final entry in seen)
          if (host == null || entry.startsWith('$host ')) entry.split(' ').last,
      ];
}

void main() {
  late Site site;
  late Directory folder;
  late Map<String, Object> names;
  late List<String> asked;
  late List<String> opened;

  Future<List<InternetAddress>> resolve(String host) async {
    asked.add(host);
    var answer = names[host];
    if (answer is List<String> Function()) answer = answer();
    if (answer == null) {
      final literal = InternetAddress.tryParse(host);
      if (literal == null) throw const SocketException('unknown name');
      return [literal];
    }
    return [for (final address in answer as List<String>) InternetAddress(address)];
  }

  Future<Socket> open(InternetAddress address, int port, Duration timeout) {
    opened.add(address.address);
    return Socket.connect(InternetAddress.loopbackIPv4, site.server.port, timeout: timeout);
  }

  SiteIconStore store({Duration budget = const Duration(seconds: 12), Duration timeout = const Duration(seconds: 5), Duration unreachableFor = const Duration(minutes: 5)}) =>
      SiteIconStore(folder: () async => folder, agent: 'Probe (+https://probe.test)', resolve: resolve, open: open, budget: budget, timeout: timeout, unreachableFor: unreachableFor);

  List<String> kept() => folder.existsSync() ? [for (final entry in folder.listSync()) entry.uri.pathSegments.last.split('.').last] : [];

  setUp(() async {
    site = Site(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));
    folder = Directory('${(await Directory.systemTemp.createTemp('site-icons-')).path}/icons');
    names = {'site.test': [public]};
    asked = [];
    opened = [];
  });

  tearDown(() async {
    await site.server.close(force: true);
    if (folder.parent.existsSync()) folder.parent.deleteSync(recursive: true);
  });

  test('the icon a page names is fetched and kept', () async {
    site.routes['/start'] = page(['<link rel="icon" href="/img/logo.png" sizes="96x96">']);
    site.routes['/img/logo.png'] = Answer(iconImage('png'), headers: {'content-type': 'text/plain'});
    expect(await store().iconFor('http://site.test/start'), iconImage('png'));
    expect(site.seen, ['site.test /start', 'site.test /img/logo.png']);
    expect(opened, [public, public]);
    expect(kept(), ['png']);
  });

  test('the request says who asks and carries nothing else', () async {
    await store().iconFor('http://site.test/');
    expect(site.heard.first, {'user-agent': 'Probe (+https://probe.test)', 'cookie': null, 'referer': null, 'authorization': null});
  });

  test('without a named icon the usual place is tried, also where the page turns readers away', () async {
    site.routes['/article'] = Answer(utf8.encode('<html><head><title>Just a moment</title></head></html>'), status: 403);
    site.routes['/favicon.ico'] = Answer(iconImage('icoBmp'));
    expect(await store().iconFor('http://site.test/article'), iconImage('icoBmp'));
    expect(kept(), ['ico']);
  });

  test('a broken first choice leads to the next and a vector is passed over', () async {
    site.routes['/'] = page(['<link rel="icon" href="/logo.svg" type="image/svg+xml">', '<link rel="icon" href="/gone.png" sizes="128x128">', '<link rel="apple-touch-icon" href="/touch.png">']);
    site.routes['/touch.png'] = Answer(iconImage('png'));
    expect(await store().iconFor('http://site.test/'), iconImage('png'));
    expect(site.paths(), ['/', '/gone.png', '/touch.png']);
  });

  test('a page cannot make us ask for dozens of icons', () async {
    site.routes['/'] = page([for (var index = 0; index < 40; index++) '<link rel="icon" href="/missing-$index.png">']);
    expect(await store().iconFor('http://site.test/'), isNull);
    expect(site.seen.length, 1 + SiteIconStore.maxDeclared + 1);
    expect(kept(), ['none']);
  });

  test('a packed answer is unpacked', () async {
    site.routes['/favicon.ico'] = Answer(gzip.encode(iconImage('webp')), headers: {'content-encoding': 'gzip'});
    expect(await store().iconFor('http://site.test/'), iconImage('webp'));
  });

  test('an answer that is too big, cut short or no image is not kept', () async {
    final big = Uint8List(SiteIconStore.maxIcon + 100)..setAll(0, iconImage('png'));
    final pixel = [...iconImage('gif')]..setRange(6, 10, const [1, 0, 1, 0]);
    final answers = <String, Answer>{
      'announced too big': Answer(big),
      'too big without a word': Answer(big, unannounced: true),
      'unpacks to too much': Answer(gzip.encode(Uint8List(20 * SiteIconStore.maxIcon)..setAll(0, iconImage('png'))), headers: {'content-encoding': 'gzip'}),
      'cut short': Answer(iconImage('png'), announce: iconImage('png').length + 100),
      'a page instead of an image': Answer(utf8.encode('<!doctype html><html></html>'), headers: {'content-type': 'image/x-icon'}),
      'a vector': Answer(utf8.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), headers: {'content-type': 'image/svg+xml'}),
      'a tracking pixel': Answer(pixel),
      'not found': Answer(iconImage('png'), status: 404),
    };
    for (final entry in answers.entries) {
      names['${entry.key.hashCode}.test'] = [public];
      site.routes['${entry.key.hashCode}.test /favicon.ico'] = entry.value;
      expect(await store().iconFor('http://${entry.key.hashCode}.test/'), isNull, reason: entry.key);
    }
    expect(kept().toSet(), {'none'});
  });

  test('only the head of a long page is read', () async {
    final long = page(['<link rel="icon" href="/logo.png">'], after: '<p>${'x' * (8 * SiteIconStore.maxPage)}</p>');
    site.routes['/'] = long;
    site.routes['/logo.png'] = Answer(iconImage('png'));
    expect(await store().iconFor('http://site.test/'), iconImage('png'));
  });

  test('redirects are followed a few steps and one in circles ends', () async {
    names['www.site.test'] = [public];
    site.routes['site.test /'] = moved('http://www.site.test/home', 301);
    site.routes['www.site.test /home'] = page(['<link rel="icon" href="logo.png">']);
    site.routes['www.site.test /logo.png'] = moved('/static/logo.png');
    site.routes['www.site.test /static/logo.png'] = Answer(iconImage('png'));
    expect(await store().iconFor('http://site.test/'), iconImage('png'));

    names['loop.test'] = [public];
    site.routes['loop.test /'] = moved('/');
    site.routes['loop.test /favicon.ico'] = moved('/favicon.ico');
    expect(await store().iconFor('http://loop.test/'), isNull);
    expect(site.paths('loop.test').length, 2 * (SiteIconStore.maxRedirects + 1));
  });

  test('a site on the internet cannot send us into the own network', () async {
    names.addAll({'router.lan': ['192.168.178.1'], 'localhost': ['127.0.0.1'], 'mixed.test': [public, '10.0.0.5']});
    const inside = [
      'http://192.168.178.1/logo.png', 'http://10.0.0.5:8080/logo.png', 'http://router.lan/logo.png', 'http://127.0.0.1/logo.png',
      'http://localhost/logo.png', 'http://[::1]/logo.png', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/logo.png',
      'http://[::ffff:10.0.0.5]/logo.png', 'http://[64:ff9b::7f00:1]/logo.png', 'http://mixed.test/logo.png',
    ];
    site.routes['/logo.png'] = Answer(iconImage('png'));
    site.routes['/latest/meta-data/'] = Answer(iconImage('png'));
    for (final (index, target) in inside.indexed) {
      names['named$index.test'] = [public];
      names['moved$index.test'] = [public];
      site.routes['named$index.test /'] = page(['<link rel="icon" href="$target">']);
      site.routes['named$index.test /favicon.ico'] = moved(target);
      site.routes['moved$index.test /'] = moved(target);
      site.routes['moved$index.test /favicon.ico'] = moved(target);
      expect(await store().iconFor('http://named$index.test/'), isNull, reason: target);
      expect(await store().iconFor('http://moved$index.test/'), isNull, reason: target);
    }
    expect(opened.toSet(), {public});
    expect(site.paths().where((path) => path == '/logo.png' || path == '/latest/meta-data/'), isEmpty);
  });

  test('a name that later points into the own network is not followed', () async {
    final answers = [[public], [public], ['192.168.178.1'], ['192.168.178.1']].iterator;
    names['turning.test'] = () => (answers..moveNext()).current;
    site.routes['/'] = page(['<link rel="icon" href="/reboot?now=1">']);
    site.routes['/reboot?now=1'] = Answer(iconImage('png'));
    expect(await store().iconFor('http://turning.test/'), isNull);
    expect(site.paths(), ['/']);
    expect(opened, [public]);
  });

  test('a bookmark in the own network gets its icon from there and only from there', () async {
    names.addAll({'nas.lan': ['192.168.178.40'], 'printer.lan': ['192.168.178.41']});
    site.routes['nas.lan /'] = page(['<link rel="icon" href="http://printer.lan/steal.png" sizes="128x128">', '<link rel="icon" href="/own.png" sizes="16x16">']);
    site.routes['nas.lan /own.png'] = Answer(iconImage('png'));
    site.routes['printer.lan /steal.png'] = Answer(iconImage('gif'));
    expect(await store().iconFor('http://nas.lan/'), iconImage('png'));
    expect(opened, ['192.168.178.40', '192.168.178.40']);
    expect(site.paths('printer.lan'), isEmpty);
  });

  test('this device and link-local addresses are never asked', () async {
    names['localhost'] = ['127.0.0.1'];
    for (final url in ['http://127.0.0.1:5050/api/hub/bookmarks', 'http://localhost:3000/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/', 'http://[fe80::1]/', 'http://224.0.0.1/', 'javascript:alert(1)', 'kein link']) {
      expect(await store().iconFor(url), isNull, reason: url);
    }
    expect(opened, isEmpty);
    expect(site.seen, isEmpty);
  });

  test('a site that cannot be reached is tried again later but not at once', () async {
    final icons = store(unreachableFor: const Duration(milliseconds: 300));
    expect(await icons.iconFor('http://nowhere.test/'), isNull);
    expect(kept(), isEmpty);
    final lookups = asked.length;
    expect(await icons.iconFor('http://nowhere.test/'), isNull);
    expect(asked.length, lookups);
    names['nowhere.test'] = [public];
    site.routes['nowhere.test /favicon.ico'] = Answer(iconImage('png'));
    await Future<void>.delayed(const Duration(milliseconds: 350));
    expect(await icons.iconFor('http://nowhere.test/'), iconImage('png'));
  });

  test('a site that keeps us waiting is given up in time', () async {
    Future<Answer> dawdle() async {
      await Future<void>.delayed(const Duration(seconds: 2));
      return Answer(iconImage('png'));
    }

    site.routes['/'] = page([for (var index = 0; index < 3; index++) '<link rel="icon" href="/slow-$index.png">']);
    for (var index = 0; index < 3; index++) {
      site.routes['/slow-$index.png'] = dawdle;
    }
    site.routes['/favicon.ico'] = dawdle;
    final watch = Stopwatch()..start();
    expect(await store(budget: const Duration(milliseconds: 800), timeout: const Duration(milliseconds: 400)).iconFor('http://site.test/'), isNull);
    expect(watch.elapsed, lessThan(const Duration(milliseconds: 1800)));
    expect(site.seen.length, lessThanOrEqualTo(4));
  });

  test('an icon is fetched once and then comes from the folder', () async {
    site.routes['/favicon.ico'] = Answer(iconImage('png'));
    final icons = store();
    expect(await icons.iconFor('http://site.test/'), iconImage('png'));
    final requests = site.seen.length;
    expect(await icons.iconFor('http://site.test/#later'), iconImage('png'));
    expect(await store().iconFor('http://site.test/'), iconImage('png'));
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(site.seen.length, requests);
    expect(kept(), ['png']);
  });

  test('a site without an icon is remembered until someone asks again', () async {
    final icons = store();
    expect(await icons.iconFor('http://site.test/'), isNull);
    expect(site.seen.length, 2);
    expect(await icons.iconFor('http://site.test/'), isNull);
    expect(site.seen.length, 2);
    site.routes['/favicon.ico'] = Answer(iconImage('gif'));
    await icons.retry('http://site.test/');
    expect(await icons.iconFor('http://site.test/'), iconImage('gif'));
    expect(kept(), ['gif']);
  });

  test('an old icon is handed out at once and renewed beside it', () async {
    site.routes['/favicon.ico'] = Answer(iconImage('png'));
    final icons = store();
    await icons.iconFor('http://site.test/');
    final old = File('${folder.path}/${SiteIconStore.keyOf('http://site.test/')}.png');
    old.setLastModifiedSync(DateTime.now().subtract(const Duration(days: 31)));
    final renewed = Completer<void>();
    site.routes['/favicon.ico'] = () async {
      await Future<void>.delayed(const Duration(milliseconds: 300));
      scheduleMicrotask(renewed.complete);
      return Answer(iconImage('gif'));
    };
    final watch = Stopwatch()..start();
    expect(await store().iconFor('http://site.test/'), iconImage('png'));
    expect(watch.elapsed, lessThan(const Duration(milliseconds: 250)));
    await renewed.future;
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(await store().iconFor('http://site.test/'), iconImage('gif'));
    expect(kept(), ['gif']);
  });

  test('an old icon is kept when the site has none any more', () async {
    site.routes['/favicon.ico'] = Answer(iconImage('png'));
    await store().iconFor('http://site.test/');
    final old = File('${folder.path}/${SiteIconStore.keyOf('http://site.test/')}.png');
    old.setLastModifiedSync(DateTime.now().subtract(const Duration(days: 31)));
    site.routes.remove('/favicon.ico');
    final icons = store();
    expect(await icons.iconFor('http://site.test/'), iconImage('png'));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    final requests = site.seen.length;
    expect(await store().iconFor('http://site.test/'), iconImage('png'));
    expect(site.seen.length, requests);
    expect(kept(), ['png']);
  });

  test('requests at the same moment share one fetch', () async {
    site.routes['/favicon.ico'] = () async {
      await Future<void>.delayed(const Duration(milliseconds: 300));
      return Answer(iconImage('png'));
    };
    final icons = store();
    final found = await Future.wait([for (var index = 0; index < 6; index++) icons.iconFor('http://site.test/')]);
    expect(found, everyElement(iconImage('png')));
    expect(site.paths().where((path) => path == '/favicon.ico').length, 1);
  });

  test('forgetting spares a page another bookmark still shows', () async {
    site.routes['/favicon.ico'] = Answer(iconImage('png'));
    final icons = store();
    await icons.iconFor('http://site.test/a');
    await icons.forget('http://site.test/a', stillUsed: ['https://elsewhere.test/', 'http://site.test/a#part']);
    expect(kept(), ['png']);
    await icons.forget('http://site.test/a', stillUsed: ['https://elsewhere.test/']);
    expect(kept(), isEmpty);
    await icons.forget('not an address');
  });
}
