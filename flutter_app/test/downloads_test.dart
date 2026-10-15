// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:app/services/downloads.dart';

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('downloads_test_');
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  group('safeName', () {
    test('keeps an ordinary name as it is', () {
      expect(Downloads.safeName('app-sicherung-2026-10-15.json'), 'app-sicherung-2026-10-15.json');
      expect(Downloads.safeName('Vertretungsplan Montag.pdf'), 'Vertretungsplan Montag.pdf');
    });

    test('drops every folder a name tries to reach', () {
      expect(Downloads.safeName('../../Library/LaunchAgents/evil.plist'), 'evil.plist');
      expect(Downloads.safeName(r'..\..\evil.json'), 'evil.json');
      expect(Downloads.safeName('/etc/passwd'), 'passwd');
    });

    test('removes characters a file name cannot hold or that hide its ending', () {
      expect(Downloads.safeName('a:b*c?"<d>|e.json'), 'abcde.json');
      expect(Downloads.safeName('line\nbreak\t.json'), 'linebreak.json');
      expect(Downloads.safeName('rechnung\u202efdp.exe'), 'rechnungfdp.exe');
    });

    test('never names a hidden file or an empty one', () {
      expect(Downloads.safeName('.zshrc'), 'zshrc');
      expect(Downloads.safeName('  ..  '), Downloads.fallbackName);
      expect(Downloads.safeName(''), Downloads.fallbackName);
      expect(Downloads.safeName('folder/'), Downloads.fallbackName);
      expect(Downloads.safeName('name. '), 'name');
    });

    test('shortens a long name but keeps its ending', () {
      final name = Downloads.safeName('${'x' * 300}.json');
      expect(name.length, Downloads.maxNameLength);
      expect(name, endsWith('x.json'));
      expect(Downloads.safeName('${'ä' * 200}.pdf').runes.length, Downloads.maxNameLength);
      expect(Downloads.safeName('${'😀' * 130}.json'), endsWith('😀.json'));
    });
  });

  group('save', () {
    test('writes the bytes under the given name', () async {
      final saved = await Downloads.save('sicherung.json', utf8.encode('{"a":1}'), into: root);
      expect(saved, isNotNull);
      expect(saved!.path, p.join(root.path, 'sicherung.json'));
      expect(saved.name, 'sicherung.json');
      expect(saved.folder, p.basename(root.path));
      expect(File(saved.path).readAsStringSync(), '{"a":1}');
      expect(saved.toJson(), {'path': saved.path, 'name': 'sicherung.json', 'folder': p.basename(root.path)});
    });

    test('never overwrites a file that is already there', () async {
      File(p.join(root.path, 'sicherung.json')).writeAsStringSync('old');
      final second = await Downloads.save('sicherung.json', utf8.encode('new'), into: root);
      final third = await Downloads.save('sicherung.json', utf8.encode('newer'), into: root);
      expect(File(p.join(root.path, 'sicherung.json')).readAsStringSync(), 'old');
      expect(second!.name, 'sicherung 2.json');
      expect(third!.name, 'sicherung 3.json');
      expect(File(third.path).readAsStringSync(), 'newer');
    });

    test('passes by a link that carries the name instead of writing through it', () async {
      final elsewhere = File(p.join(root.path, 'elsewhere.txt'))..writeAsStringSync('keep');
      Link(p.join(root.path, 'sicherung.json')).createSync(elsewhere.path);
      Link(p.join(root.path, 'sicherung 2.json')).createSync(p.join(root.path, 'missing.txt'));
      final saved = await Downloads.save('sicherung.json', utf8.encode('new'), into: root);
      expect(saved!.name, 'sicherung 3.json');
      expect(elsewhere.readAsStringSync(), 'keep');
      expect(File(p.join(root.path, 'missing.txt')).existsSync(), isFalse);
    });

    test('creates the folder when it is missing', () async {
      final folder = Directory(p.join(root.path, 'Downloads'));
      final saved = await Downloads.save('a.txt', utf8.encode('x'), into: folder);
      expect(saved!.path, p.join(folder.path, 'a.txt'));
    });

    test('refuses a file larger than the limit', () async {
      expect(await Downloads.save('big.json', Uint8List(Downloads.maxBytes + 1), into: root), isNull);
      expect(root.listSync(), isEmpty);
    });

    test('writes only document types that cannot run anything', () async {
      for (final name in ['evil.terminal', 'run.command', 'tool.app', 'link.fileloc', 'script.sh', 'page.html', 'noext']) {
        expect(await Downloads.save(name, utf8.encode('x'), into: root), isNull, reason: name);
      }
      expect(root.listSync(), isEmpty);
      expect((await Downloads.save('PLAN.PDF', utf8.encode('x'), into: root))!.name, 'PLAN.PDF');
      expect((await Downloads.save('termine.ics', utf8.encode('x'), into: root))!.name, 'termine.ics');
    });

    test('says so when the folder may not be written', () async {
      final locked = Directory(p.join(root.path, 'locked'))..createSync();
      Process.runSync('chmod', ['500', locked.path]);
      addTearDown(() => Process.runSync('chmod', ['700', locked.path]));
      await expectLater(Downloads.save('sicherung.json', utf8.encode('x'), into: locked), throwsA(isA<PathAccessException>()));
      await expectLater(Downloads.saveEncoded('sicherung.json', base64.encode([1]), into: locked), throwsA(isA<PathAccessException>()));
    }, skip: Platform.isWindows ? 'folder permissions work differently on Windows' : false);

    test('reports a folder macOS locks as refused, too', () async {
      final locked = Directory(p.join(root.path, 'frozen'))..createSync();
      Process.runSync('chflags', ['uchg', locked.path]);
      addTearDown(() => Process.runSync('chflags', ['nouchg', locked.path]));
      await expectLater(Downloads.save('sicherung.json', utf8.encode('x'), into: locked), throwsA(isA<PathAccessException>()));
    }, skip: Platform.isMacOS ? false : 'chflags exists only on macOS');

    test('remembers what it saved and nothing else', () async {
      final saved = await Downloads.save('note.txt', utf8.encode('x'), into: root);
      expect(Downloads.saved(saved!.path), isTrue);
      expect(Downloads.saved(p.join(root.path, 'other.txt')), isFalse);
    });

    test('shows only a file it saved itself', () async {
      final other = File(p.join(root.path, 'other.txt'))..writeAsStringSync('x');
      expect(await Downloads.show(other.path), isFalse);
      expect(await Downloads.show('/Applications'), isFalse);
    });
  });

  group('saveEncoded', () {
    test('decodes what the page sends', () async {
      final saved = await Downloads.saveEncoded('plan.pdf', base64.encode([37, 80, 68, 70, 0, 255]), into: root);
      expect(File(saved!.path).readAsBytesSync(), [37, 80, 68, 70, 0, 255]);
    });

    test('turns down broken or missing content', () async {
      expect(await Downloads.saveEncoded('a.json', 'not base64 !', into: root), isNull);
      expect(await Downloads.saveEncoded('a.json', null, into: root), isNull);
      expect(await Downloads.saveEncoded('a.json', 42, into: root), isNull);
      expect(root.listSync(), isEmpty);
    });

    test('turns down a file without a name', () async {
      expect(await Downloads.saveEncoded(null, base64.encode([1]), into: root), isNull);
      expect(root.listSync(), isEmpty);
    });
  });
}
