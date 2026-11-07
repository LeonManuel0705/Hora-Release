// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as path;

import 'package:app/services/backend_setup.dart';
import 'package:app/services/flask_server_service.dart';

final p = path.posix;

typedef Answer = ProcessResult? Function(String executable, List<String> arguments);

class FakeHost extends HostSystem {
  FakeHost({Set<String>? files, Set<String>? directories, Map<String, List<int>>? heads, Answer? answer})
      : files = files ?? {},
        directories = directories ?? {},
        heads = heads ?? {},
        answer = answer ?? ((_, __) => null);

  final Set<String> files;
  final Set<String> directories;
  final Map<String, List<int>> heads;
  final Answer answer;
  final runs = <List<String>>[];
  final started = <List<String>>[];
  FakeProcess? process;

  @override
  bool isFile(String path) => files.contains(path);

  @override
  bool isDirectory(String path) => directories.contains(path);

  @override
  List<String> list(String directory) =>
      [for (final entry in {...files, ...directories}) if (p.dirname(entry) == directory) entry];

  @override
  List<int> head(String path, int length) => heads[path] ?? const [];

  @override
  Future<ProcessResult?> run(String executable, List<String> arguments, {Duration timeout = const Duration(seconds: 20)}) async {
    runs.add([executable, ...arguments]);
    return answer(executable, arguments);
  }

  @override
  Future<Process> start(String executable, List<String> arguments,
      {String? workingDirectory, Map<String, String>? environment}) async {
    started.add([executable, ...arguments]);
    return process!;
  }
}

class FakeProcess implements Process {
  final _out = StreamController<List<int>>();
  final _err = StreamController<List<int>>();
  final _exit = Completer<int>();
  final killed = <ProcessSignal>[];

  void say(String line, {bool error = false}) => (error ? _err : _out).add(utf8.encode('$line\n'));

  void finish(int code) {
    if (_exit.isCompleted) return;
    _out.close();
    _err.close();
    _exit.complete(code);
  }

  @override
  Stream<List<int>> get stdout => _out.stream;

  @override
  Stream<List<int>> get stderr => _err.stream;

  @override
  IOSink get stdin => throw UnimplementedError();

  @override
  Future<int> get exitCode => _exit.future;

  @override
  int get pid => 4242;

  @override
  bool kill([ProcessSignal signal = ProcessSignal.sigterm]) {
    killed.add(signal);
    finish(-9);
    return true;
  }
}

ProcessResult result(String stdout, [int code = 0]) => ProcessResult(1, code, stdout, '');

Answer pythons(Map<String, String> versions, {String? developerTools, String? which}) => (executable, arguments) {
      if (executable == '/usr/bin/xcode-select') return developerTools == null ? result('', 2) : result('$developerTools\n');
      if (executable == '/usr/bin/which') return which == null ? result('', 1) : result('$which\n');
      final version = versions[executable];
      return version == null ? null : result('$version\n');
    };

List<int> machO(int cpuType) => [0xcf, 0xfa, 0xed, 0xfe, cpuType & 0xff, (cpuType >> 8) & 0xff, (cpuType >> 16) & 0xff, cpuType >> 24];

const arm64 = 0x0100000c;
const x86 = 0x01000007;

List<int> bigEndian(int value) => [value >> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

void main() {
  group('finding a Python on the Mac', () {
    const framework = MacPython.frameworks;

    test('a venv in the project wins without running anything', () async {
      final host = FakeHost(files: {'/p/venv/bin/python3', '/opt/homebrew/bin/python3'});
      expect((await MacPython.locate(host, root: '/p')).path, '/p/venv/bin/python3');
      expect(host.runs, isEmpty);
    });

    test('the newest python.org Python comes before Homebrew and the system', () async {
      final host = FakeHost(
        files: {'$framework/3.12/bin/python3', '$framework/3.14/bin/python3', '/opt/homebrew/bin/python3', MacPython.appleShim},
        directories: {'$framework/3.12', '$framework/3.14', '$framework/Current'},
        answer: pythons({'$framework/3.14/bin/python3': '3.14', '$framework/3.12/bin/python3': '3.12', '/opt/homebrew/bin/python3': '3.13'}),
      );
      expect((await MacPython.locate(host, root: '/p')).path, '$framework/3.14/bin/python3');
    });

    test('Homebrew and /usr/local are found without python.org', () async {
      final host = FakeHost(files: {'/usr/local/bin/python3'}, answer: pythons({'/usr/local/bin/python3': '3.11'}));
      expect((await MacPython.locate(host)).path, '/usr/local/bin/python3');
    });

    test('a Python older than 3.9 is skipped', () async {
      final host = FakeHost(
        files: {'/opt/homebrew/bin/python3', '/usr/local/bin/python3'},
        answer: pythons({'/opt/homebrew/bin/python3': '3.8', '/usr/local/bin/python3': '3.10'}),
      );
      expect((await MacPython.locate(host)).path, '/usr/local/bin/python3');
    });

    test('a Python on the PATH outside the usual places is used', () async {
      const shim = '/Users/a/.pyenv/shims/python3';
      final host = FakeHost(files: {MacPython.appleShim}, answer: pythons({shim: '3.12'}, which: shim));
      expect((await MacPython.locate(host)).path, shim);
    });

    test("Apple's python3 is never run without the developer tools", () async {
      final host = FakeHost(files: {MacPython.appleShim}, answer: pythons({MacPython.appleShim: '3.9'}, which: MacPython.appleShim));
      final found = await MacPython.locate(host, root: '/p');
      expect(found.status, PythonStatus.needsDeveloperTools);
      expect(found.path, isNull);
      expect(host.runs.where((run) => run.first == MacPython.appleShim), isEmpty);
    });

    test('a developer folder that is gone counts as missing tools', () async {
      final host = FakeHost(
        files: {MacPython.appleShim},
        answer: pythons({MacPython.appleShim: '3.9'}, developerTools: '/Applications/Xcode.app/Contents/Developer'),
      );
      expect((await MacPython.locate(host)).status, PythonStatus.needsDeveloperTools);
    });

    test("with the developer tools Apple's python3 counts", () async {
      const tools = '/Library/Developer/CommandLineTools';
      final host = FakeHost(
        files: {MacPython.appleShim},
        directories: {tools},
        answer: pythons({MacPython.appleShim: '3.9'}, developerTools: tools),
      );
      expect((await MacPython.locate(host, root: '/p')).path, MacPython.appleShim);
    });

    test('no Python at all is reported as missing', () async {
      expect((await MacPython.locate(FakeHost())).status, PythonStatus.missing);
    });
  });

  group('choosing the backend', () {
    const app = '/Applications/App.app/Contents/MacOS/App';
    const server = '/Applications/App.app/Contents/Resources/backend/server/server';
    const project = '/Users/a/Documents/App';
    Answer silicon(bool arm) => (executable, arguments) =>
        executable == '/usr/sbin/sysctl' ? (arm ? result('1\n') : result('', 1)) : null;
    Future<String?> choose(FakeHost host, String? located, {bool rootOverride = false}) =>
        FlaskServerService.frozenServerFor(host: host, executable: app, located: located, rootOverride: rootOverride);

    test('Mach-O headers name their architectures', () {
      expect(FrozenBackend.architectures(machO(arm64)), {'arm64'});
      expect(FrozenBackend.architectures(machO(x86)), {'x86_64'});
      final fat = [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2, ...bigEndian(x86), ...List.filled(16, 0), ...bigEndian(arm64), ...List.filled(16, 0)];
      expect(FrozenBackend.architectures(fat), {'x86_64', 'arm64'});
      expect(FrozenBackend.architectures(utf8.encode('#!/bin/sh\necho\n')), isEmpty);
      expect(FrozenBackend.architectures(const []), isEmpty);
    });

    test('a fresh Mac and an extracted backend get the frozen server', () async {
      final host = FakeHost(files: {server}, heads: {server: machO(arm64)}, answer: silicon(true));
      expect(await choose(host, null), server);
      expect(await choose(host, project), server);
    });

    test('a git checkout keeps its Python backend', () async {
      final host = FakeHost(files: {server}, directories: {path.join(project, '.git')}, heads: {server: machO(arm64)}, answer: silicon(true));
      expect(await choose(host, project), isNull);
    });

    test('a git worktree with a .git file keeps it too', () async {
      final host = FakeHost(files: {server, path.join(project, '.git')}, heads: {server: machO(arm64)}, answer: silicon(true));
      expect(await choose(host, project), isNull);
    });

    test('a folder named in HUB_ROOT keeps Python', () async {
      final host = FakeHost(files: {server}, heads: {server: machO(arm64)}, answer: silicon(true));
      expect(await choose(host, project, rootOverride: true), isNull);
    });

    test('an Intel Mac falls back to Python', () async {
      final host = FakeHost(files: {server}, heads: {server: machO(arm64)}, answer: silicon(false));
      expect(await choose(host, null), isNull);
    });

    test('an app without a frozen server falls back to Python', () async {
      expect(await choose(FakeHost(answer: silicon(true)), null), isNull);
    });
  });

  group('the quarantine flag on the frozen server', () {
    const server = '/A.app/Contents/Resources/backend/server/server';

    FakeHost hostWith({required bool quarantined, required bool writable}) {
      final flagged = <String>{if (quarantined) server};
      return FakeHost(files: {server}, answer: (executable, arguments) {
        if (executable == '/usr/bin/xattr' && arguments.first == '-p') return result('', flagged.contains(arguments.last) ? 0 : 1);
        if (executable == '/usr/bin/xattr' && arguments.first == '-dr') {
          if (!writable) return result('', 1);
          flagged.removeWhere((path) => path == arguments.last || p.isWithin(arguments.last, path));
          return result('');
        }
        return null;
      });
    }

    Iterable<List<String>> changes(FakeHost host) => host.runs.where((run) => !(run.first == '/usr/bin/xattr' && run[1] == '-p'));

    test('a server without the flag is left alone', () async {
      final host = hostWith(quarantined: false, writable: true);
      await FrozenBackend.clearQuarantine(host, server);
      expect(changes(host), isEmpty);
    });

    test('the flag is cleared inside the app and nowhere else', () async {
      final host = hostWith(quarantined: true, writable: true);
      await FrozenBackend.clearQuarantine(host, server);
      expect(changes(host), [
        ['/usr/bin/xattr', '-dr', 'com.apple.quarantine', p.dirname(server)],
      ]);
    });

    test('a read-only app is started as it is, without copies outside it', () async {
      final host = hostWith(quarantined: true, writable: false);
      await FrozenBackend.clearQuarantine(host, server);
      expect(changes(host), [
        ['/usr/bin/xattr', '-dr', 'com.apple.quarantine', p.dirname(server)],
      ]);
    });

    test('a support folder linked to Documents keeps everything in it', () async {
      final root = Directory.systemTemp.createTempSync('quarantine-');
      addTearDown(() => root.deleteSync(recursive: true));
      final documents = Directory(path.join(root.path, 'Documents', 'Schule'))..createSync(recursive: true);
      final note = File(path.join(documents.path, 'note.txt'))..writeAsStringSync('x');
      final support = Directory(path.join(root.path, 'support'))..createSync();
      Link(path.join(support.path, 'backend')).createSync(path.join(root.path, 'Documents'));
      final bundled = File(path.join(root.path, 'server'))..writeAsStringSync('bin');
      final host = FakeHost(answer: (executable, arguments) => executable == '/usr/bin/xattr' ? result('', arguments.first == '-p' ? 0 : 1) : null);
      await FrozenBackend.clearQuarantine(host, bundled.path);
      expect(host.runs.map((run) => run.first).toSet(), {'/usr/bin/xattr'});
      expect(note.existsSync(), isTrue);
      expect(Directory(path.join(root.path, 'Documents')).listSync(), hasLength(1));
      expect(support.listSync(), hasLength(1));
    });
  });

  group('pip', () {
    const python = '/p/venv/bin/python3';
    const requirements = '/p/requirements-desktop.txt';

    Future<StartFailure?> install(FakeHost host, {List<String>? seen, Duration quietLimit = const Duration(minutes: 3)}) =>
        PipInstall.run(
          host: host,
          python: python,
          requirements: requirements,
          workingDirectory: '/p',
          progress: (text) => seen?.add(text),
          quietLimit: quietLimit,
        );

    test('progress names each package and then the install step', () async {
      final process = FakeProcess();
      final host = FakeHost()..process = process;
      final seen = <String>[];
      final outcome = install(host, seen: seen);
      process
        ..say('Collecting flask>=3.0.0 (from -r /p/requirements-desktop.txt (line 13))')
        ..say('  Downloading flask-3.1.2-py3-none-any.whl.metadata (3.2 kB)')
        ..say('Requirement already satisfied: certifi in ./venv/lib/python3.14/site-packages (2026.1.4)')
        ..say('Installing collected packages: blinker, flask, certifi');
      await pumpEventQueue();
      process.finish(0);
      expect(await outcome, isNull);
      expect(seen, [StartText.package(1, 'flask'), StartText.package(2, 'certifi'), StartText.installing(3)]);
      expect(host.started.single, [python, ...PipInstall.arguments(requirements)]);
      expect(PipInstall.arguments(requirements), containsAll(['--timeout', '--retries', '--no-input', '--disable-pip-version-check']));
    });

    test('an offline install shows the network error from pip', () async {
      final process = FakeProcess();
      final host = FakeHost()..process = process;
      final outcome = install(host);
      process
        ..say("WARNING: Retrying (Retry(total=1, connect=None, read=None, redirect=None, status=None)) after connection broken by "
            "'NewConnectionError('<HTTPSConnection(host='pypi.org', port=443) at 0x1>: Failed to establish a new connection: "
            "[Errno 8] nodename nor servname provided, or not known')': /simple/flask/", error: true)
        ..say('ERROR: Could not find a version that satisfies the requirement flask>=3.0.0 (from versions: none)', error: true)
        ..say('ERROR: No matching distribution found for flask>=3.0.0', error: true);
      await pumpEventQueue();
      process.finish(1);
      final failure = await outcome;
      expect(failure!.message, startsWith('Keine Verbindung zum Internet.'));
      expect(failure.detail, contains('nodename nor servname'));
    });

    test('a pip that stops talking is stopped and reported', () async {
      final process = FakeProcess();
      final host = FakeHost()..process = process;
      final failure = await install(host, quietLimit: const Duration(milliseconds: 300));
      expect(process.killed, [ProcessSignal.sigkill]);
      expect(failure!.message, contains('kommt seit Minuten nicht weiter'));
    });

    test('pip errors are explained in plain words', () {
      expect(
        PipInstall.explain(["WARNING: Retrying ... SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed'))"]).message,
        contains('umgeleitet'),
      );
      expect(PipInstall.explain(["WARNING: Retrying ... ProxyError('Cannot connect to proxy.')"]).message, contains('Proxy'));
      expect(PipInstall.explain(['OSError: [Errno 28] No space left on device']).message, contains('Speicherplatz'));
      expect(
        PipInstall.explain(["ReadTimeoutError(\"HTTPSConnectionPool(host='files.pythonhosted.org', port=443): Read timed out.\")"]).message,
        contains('zu langsam'),
      );
      final other = PipInstall.explain(['Collecting x', 'ERROR: Failed building wheel for x', 'error: subprocess-exited-with-error']);
      expect(other.message, startsWith('Die Python-Pakete ließen sich nicht installieren.'));
      expect(other.detail, 'ERROR: Failed building wheel for x');
    });
  });

  group('a backend that ends during the start', () {
    test('a missing package in the venv offers a fresh install', () {
      final failure = StartText.exited(
        ['Traceback (most recent call last):', '  File "app/app.py", line 5', "ModuleNotFoundError: No module named 'flask_socketio'"],
        1,
        frozen: false,
      );
      expect(failure.reinstallPackages, isTrue);
      expect(failure.message, contains('flask_socketio'));
      expect(failure.detail, "ModuleNotFoundError: No module named 'flask_socketio'");
    });

    test('a missing module in the frozen backend means a broken download', () {
      final failure = StartText.exited(["ModuleNotFoundError: No module named 'engineio.async_drivers'"], 1, frozen: true);
      expect(failure.reinstallPackages, isFalse);
      expect(failure.message, contains('unvollständig'));
    });

    test('a refused Documents folder is named as such', () {
      final failure = StartText.exited(["PermissionError: [Errno 1] Operation not permitted: '/Users/a/Documents/App/data'"], 1, frozen: true);
      expect(failure.problem, StartProblem.documentsDenied);
      expect(failure.message, contains('Dateien und Ordner'));
    });

    test('a taken port is reported as such', () {
      expect(StartText.exited(['OSError: [Errno 48] Address already in use'], 1, frozen: true, port: 5050).message, startsWith('Port 5050'));
    });

    test('a frozen server stopped by macOS points to the Applications folder', () {
      expect(StartText.exited(const [], -9, frozen: true).message, contains('„Programme“'));
    });

    test('otherwise the last error line is shown and log lines are skipped', () {
      final failure = StartText.exited([
        'INFO:werkzeug:started',
        'app.crypto_utils.InsecureSecretError: SECRET_KEY from the environment is 8 characters long',
        'WARNING:root:bye',
      ], 1, frozen: true);
      expect(failure.detail, startsWith('app.crypto_utils.InsecureSecretError'));
      expect(StartText.exited(const [], 3, frozen: false).detail, 'Exit-Code 3');
      expect(StartText.crashed(const [], -15).detail, 'Beendet durch Signal 15');
    });

    test('nothing the start shows speaks of a server', () {
      final texts = [
        StartText.starting, StartText.slow, StartText.verySlow, StartText.environment,
        StartText.package(1, 'flask'), StartText.installing(2), StartText.pythonMissing.message,
        StartText.pythonNotFound.message, StartText.documentsDenied().message, StartText.notStartable(null).message,
        StartText.timedOut(const []).message, StartText.crashed(const [], 1).message, StartText.exited(const [], 1, frozen: true).message,
      ];
      for (final text in texts) {
        expect(text.toLowerCase(), isNot(contains('server')), reason: text);
        expect(text, isNot(contains(' – ')), reason: text);
        expect(text, isNot(contains('—')), reason: text);
      }
    });
  });
}
