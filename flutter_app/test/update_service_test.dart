// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:io';

import 'package:app/brand.dart';
import 'package:app/services/update_service.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

const _release = '${Brand.repository}/releases/download/v0.6.0/${Brand.name}-0.6.0.apk';
const _digest = 'a3f1c0de9b8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a392817060f5e';

Map<String, dynamic> _version(Object? android) => {
      'version': '0.6.0',
      'versionName': '0.6.0 Closed Beta',
      'platformUrls': {'android': '${Brand.website}/download#android'},
      'downloads': {'android': android},
    };

void main() {
  test('an update entry gives the file, its size and its checksum', () {
    final package = UpdateService.packageFor(_version({'url': _release, 'size': 42500000, 'sha256': _digest.toUpperCase()}), 'android')!;
    expect(package.url, _release);
    expect(package.size, 42500000);
    expect(package.sha256, _digest);
    expect(UpdateService.packageFor(_version({'url': _release, 'size': 42500000}), 'android')!.sha256, isNull);
  });

  test('a version.json without the entry, or with a broken one, keeps the download page', () {
    expect(UpdateService.packageFor({'version': '0.6.0'}, 'android'), isNull);
    expect(UpdateService.packageFor(_version(null), 'android'), isNull);
    for (final entry in [
      {'url': 'https://example.com/${Brand.name}-0.6.0.apk', 'size': 1000},
      {'url': _release.replaceFirst('https:', 'http:'), 'size': 1000},
      {'url': 'https://github.com/someone/else/releases/download/v0.6.0/app-0.6.0.apk', 'size': 1000},
      {'url': _release.replaceFirst('.apk', '.zip'), 'size': 1000},
      {'url': _release.replaceAll('0.6.0', '0.5.2'), 'size': 1000},
      {'url': _release, 'size': 0},
      {'url': _release, 'size': '42 MB'},
      {'url': _release, 'size': 900 * 1024 * 1024},
      {'url': _release, 'size': 1000, 'sha256': 'abc'},
      {'url': _release, 'size': 1000, 'sha256': 42},
    ]) {
      expect(UpdateService.packageFor(_version(entry), 'android'), isNull, reason: '$entry');
    }
  });

  group('downloading', () {
    late HttpServer server;
    late Directory folder;
    late List<int> apk;
    var requests = 0;

    setUp(() async {
      HttpOverrides.global = null;
      requests = 0;
      apk = List<int>.generate(300000, (index) => index * 7 % 251);
      folder = await Directory.systemTemp.createTemp('update-');
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        requests++;
        if (request.uri.path == '/releases/download/v0.6.0/app.apk') {
          request.response
            ..statusCode = HttpStatus.found
            ..headers.set('Location', '/objects/app.apk');
        } else {
          request.response
            ..headers.set('Content-Type', 'application/vnd.android.package-archive')
            ..add(apk);
        }
        await request.response.close();
      });
    });

    tearDown(() async {
      await server.close(force: true);
      await folder.delete(recursive: true);
    });

    UpdateDownloader downloader() => UpdateDownloader(folder: () async => folder);

    UpdatePackage package({int? size, String? sha256}) => UpdatePackage(
          url: 'http://127.0.0.1:${server.port}/releases/download/v0.6.0/app.apk',
          size: size ?? apk.length,
          sha256: sha256,
        );

    test('the file is loaded through redirects, checked and kept under the name of its version', () async {
      final seen = <int>[];
      final file = await downloader().fetch(package(sha256: sha256.convert(apk).toString()), '0.6.0', progress: (received, total) {
        expect(total, apk.length);
        seen.add(received);
      });
      expect(file.path, endsWith('${Brand.name}-0.6.0.apk'));
      expect(await file.readAsBytes(), apk);
      expect(seen.last, apk.length);
      expect(File('${file.path}.part').existsSync(), isFalse);
    });

    test('a file that is checked already is not loaded again', () async {
      await downloader().fetch(package(), '0.6.0');
      final before = requests;
      await downloader().fetch(package(), '0.6.0');
      expect(requests, before);
    });

    test('a wrong checksum or size throws the file away', () async {
      await expectLater(downloader().fetch(package(sha256: _digest), '0.6.0'), throwsA(isA<UpdateBroken>()));
      await expectLater(downloader().fetch(package(size: apk.length + 1), '0.6.0'), throwsA(isA<UpdateBroken>()));
      expect(folder.listSync(recursive: true).whereType<File>(), isEmpty);
    });

    test('old installers are cleared, the one for the offered version stays', () async {
      final updates = Directory('${folder.path}/updates')..createSync();
      File('${updates.path}/${Brand.name}-0.5.2.apk').writeAsStringSync('alt');
      File('${updates.path}/${Brand.name}-0.6.0.apk').writeAsStringSync('neu');
      await UpdateDownloader.tidy(keep: '0.6.0', folder: () async => folder);
      expect(updates.listSync().map((entry) => entry.uri.pathSegments.last), ['${Brand.name}-0.6.0.apk']);
      await UpdateDownloader.tidy(folder: () async => folder);
      expect(updates.listSync(), isEmpty);
    });
  });
}
