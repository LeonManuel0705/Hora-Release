// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as path;

import '../brand.dart';

final _macPath = path.posix;

class HostSystem {
  const HostSystem();

  bool isFile(String path) => FileSystemEntity.typeSync(path) == FileSystemEntityType.file;

  bool isDirectory(String path) => FileSystemEntity.typeSync(path) == FileSystemEntityType.directory;

  List<String> list(String directory) {
    try {
      return [for (final entity in Directory(directory).listSync(followLinks: false)) entity.path];
    } on FileSystemException {
      return const [];
    }
  }

  List<int> head(String path, int length) {
    RandomAccessFile? file;
    try {
      file = File(path).openSync();
      return file.readSync(length);
    } on FileSystemException {
      return const [];
    } finally {
      file?.closeSync();
    }
  }

  Future<ProcessResult?> run(
    String executable,
    List<String> arguments, {
    String? workingDirectory,
    Duration? timeout = const Duration(seconds: 20),
  }) async {
    final Process process;
    try {
      process = await Process.start(executable, arguments, workingDirectory: workingDirectory);
    } on ProcessException {
      return null;
    }
    final out = process.stdout.transform(const SystemEncoding().decoder).join();
    final err = process.stderr.transform(const SystemEncoding().decoder).join();
    var timedOut = false;
    final code = timeout == null
        ? await process.exitCode
        : await process.exitCode.timeout(timeout, onTimeout: () {
            timedOut = true;
            process.kill(ProcessSignal.sigkill);
            return process.exitCode;
          });
    if (timedOut) return null;
    final output = await Future.wait([out, err]).timeout(const Duration(seconds: 2), onTimeout: () => ['', '']);
    return ProcessResult(process.pid, code, output[0], output[1]);
  }

  Future<Process> start(
    String executable,
    List<String> arguments, {
    String? workingDirectory,
    Map<String, String>? environment,
  }) =>
      Process.start(executable, arguments, workingDirectory: workingDirectory, environment: environment);
}

class OutputTail {
  OutputTail([this.limit = 80]);

  final int limit;
  final _lines = ListQueue<String>();

  void add(String line) {
    if (line.trim().isEmpty) return;
    _lines.add(line);
    while (_lines.length > limit) {
      _lines.removeFirst();
    }
  }

  List<String> get lines => List.unmodifiable(_lines);

  Future<void> follow(Stream<List<int>> stream, [void Function(String line)? onLine]) {
    final done = Completer<void>();
    stream.transform(const SystemEncoding().decoder).transform(const LineSplitter()).listen(
      (line) {
        add(line);
        onLine?.call(line);
      },
      onError: (Object _) {},
      onDone: done.complete,
    );
    return done.future;
  }
}

enum PythonStatus { found, needsDeveloperTools, missing }

class PythonLookup {
  const PythonLookup.found(String this.path) : status = PythonStatus.found;
  const PythonLookup.needsDeveloperTools()
      : status = PythonStatus.needsDeveloperTools,
        path = null;
  const PythonLookup.missing()
      : status = PythonStatus.missing,
        path = null;

  final PythonStatus status;
  final String? path;
}

class MacPython {
  MacPython._();

  static const appleShim = '/usr/bin/python3';
  static const frameworks = '/Library/Frameworks/Python.framework/Versions';
  static const minimumMinor = 9;
  static const installerUrl = 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-macos11.pkg';
  static const installerSize = '76 MB';

  static List<String> venvPythons(String root) =>
      [for (final name in ['venv', '.venv', 'env']) _macPath.join(root, name, 'bin', 'python3')];

  static List<String> candidates(HostSystem host) {
    final versions = <(int, String)>[];
    for (final folder in host.list(frameworks)) {
      final match = RegExp(r'^3\.(\d+)$').firstMatch(_macPath.basename(folder));
      if (match != null) versions.add((int.parse(match[1]!), folder));
    }
    versions.sort((a, b) => b.$1.compareTo(a.$1));
    return [
      for (final (_, folder) in versions) _macPath.join(folder, 'bin', 'python3'),
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
    ];
  }

  static Future<bool> usable(HostSystem host, String python) async {
    final result = await host.run(python, ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
    if (result == null || result.exitCode != 0) return false;
    final match = RegExp(r'^3\.(\d+)$').firstMatch('${result.stdout}'.trim());
    return match != null && int.parse(match[1]!) >= minimumMinor;
  }

  // Running Apple's /usr/bin/python3 without the Command Line Tools opens the
  // system dialog that offers to install them, so it is only run once they exist.
  static Future<bool> developerToolsInstalled(HostSystem host) async {
    final result = await host.run('/usr/bin/xcode-select', ['-p']);
    final folder = '${result?.stdout ?? ''}'.trim();
    return result != null && result.exitCode == 0 && folder.isNotEmpty && host.isDirectory(folder);
  }

  static Future<PythonLookup> locate(HostSystem host, {String? root}) async {
    if (root != null) {
      for (final venv in venvPythons(root)) {
        if (host.isFile(venv)) return PythonLookup.found(venv);
      }
    }
    final tried = <String>{appleShim};
    for (final candidate in candidates(host)) {
      if (!tried.add(candidate) || !host.isFile(candidate)) continue;
      if (await usable(host, candidate)) return PythonLookup.found(candidate);
    }
    final which = await host.run('/usr/bin/which', ['python3']);
    final onPath = '${which?.stdout ?? ''}'.trim().split('\n').first.trim();
    if (onPath.isNotEmpty && tried.add(onPath) && await usable(host, onPath)) return PythonLookup.found(onPath);
    if (!host.isFile(appleShim)) return const PythonLookup.missing();
    if (!await developerToolsInstalled(host)) return const PythonLookup.needsDeveloperTools();
    return await usable(host, appleShim) ? const PythonLookup.found(appleShim) : const PythonLookup.missing();
  }
}

class FrozenBackend {
  FrozenBackend._();

  static const _quarantine = 'com.apple.quarantine';
  static const _cpuTypes = {0x0100000c: 'arm64', 0x01000007: 'x86_64'};

  static String? find(HostSystem host, String executable) {
    final contents = _macPath.dirname(_macPath.dirname(executable));
    final server = _macPath.join(contents, 'Resources', 'backend', 'server', 'server');
    return host.isFile(server) ? server : null;
  }

  static Set<String> architectures(List<int> head) {
    if (head.length < 8) return const {};
    final bytes = ByteData.sublistView(Uint8List.fromList(head));
    final magic = bytes.getUint32(0, Endian.big);
    if (magic == 0xcffaedfe) {
      final name = _cpuTypes[bytes.getUint32(4, Endian.little)];
      return {if (name != null) name};
    }
    if (magic != 0xcafebabe && magic != 0xcafebabf) return const {};
    final stride = magic == 0xcafebabe ? 20 : 32;
    final count = bytes.getUint32(4, Endian.big);
    return {
      for (var index = 0; index < count && 8 + (index + 1) * stride <= head.length; index++)
        if (_cpuTypes[bytes.getUint32(8 + index * stride, Endian.big)] case final name?) name,
    };
  }

  static Future<bool> runsHere(HostSystem host, String server) async {
    final built = architectures(host.head(server, 4096));
    if (built.isEmpty) return false;
    final probe = await host.run('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']);
    final appleSilicon = '${probe?.stdout ?? ''}'.trim() == '1';
    return built.contains(appleSilicon ? 'arm64' : 'x86_64');
  }

  static Future<bool> quarantined(HostSystem host, String path) async =>
      (await host.run('/usr/bin/xattr', ['-p', _quarantine, path]))?.exitCode == 0;

  // A browser download marks every file in the app as quarantined, and opening
  // the app may leave the flag on the server inside it. It is removed where the
  // app can be changed. A read-only app (opened straight from Downloads, or one
  // that belongs to another user) starts its server as it is; should macOS stop
  // it, the start explains what to do. Nothing outside the app is copied or
  // deleted, so no folder the app writes to can redirect what it runs.
  static Future<void> clearQuarantine(HostSystem host, String server) async {
    if (!await quarantined(host, server)) return;
    await host.run('/usr/bin/xattr', ['-dr', _quarantine, _macPath.dirname(server)], timeout: const Duration(minutes: 1));
  }
}

enum StartProblem { none, pythonMissing, documentsDenied, other }

class StartFailure {
  const StartFailure(this.message, {this.detail, this.problem = StartProblem.other, this.reinstallPackages = false});

  final String message;
  final String? detail;
  final StartProblem problem;
  final bool reinstallPackages;
}

class StartText {
  StartText._();

  static const privacySettings = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';
  static const setup = 'Einmalige Einrichtung, das dauert ein paar Minuten.';
  static const environment = '$setup\nDie Python-Umgebung wird angelegt …';
  static const slow = 'Der erste Start dauert etwas länger.';
  static String get starting => '${Brand.name} startet …';
  static String get verySlow => 'Das dauert ungewöhnlich lange. ${Brand.name} wartet noch bis zu 30 Sekunden.';
  static String package(int count, String name) => '$setup\nPaket $count: $name';
  static String installing(int count) => '$setup\n$count Pakete werden eingerichtet …';

  static const pythonMissing = StartFailure(
    'Auf diesem Mac fehlt Python 3, das ${Brand.name} hier zum Starten braucht.\n'
    'Lade das Installationspaket von python.org (${MacPython.installerSize}), öffne es und folge den Schritten. '
    'Danach startet ${Brand.name} von selbst.',
    problem: StartProblem.pythonMissing,
  );

  static const pythonNotFound = StartFailure(
    'Python 3 wurde nicht gefunden.\nInstalliere Python 3 von python.org und versuch es dann noch einmal.',
    problem: StartProblem.pythonMissing,
  );

  static StartFailure documentsDenied([String? detail]) => StartFailure(
        '${Brand.name} darf nicht auf deinen Ordner „Dokumente“ zugreifen. Dort liegen deine Daten.\n'
        'Erlaube den Zugriff in den Systemeinstellungen unter Datenschutz & Sicherheit › Dateien und Ordner.',
        detail: detail,
        problem: StartProblem.documentsDenied,
      );

  static StartFailure notStartable(String? detail) => StartFailure(
        '${Brand.name} ließ sich nicht starten.\n'
        'Versuch es noch einmal. Klappt es dann auch nicht, lade ${Brand.name} neu von der Website. Deine Daten bleiben dabei erhalten.',
        detail: detail,
      );

  static StartFailure timedOut(List<String> output) => StartFailure(
        '${Brand.name} hat nach einer Minute noch nicht geantwortet.\nVersuch es noch einmal.',
        detail: problemLine(output),
      );

  static StartFailure crashed(List<String> output, int code) => StartFailure(
        '${Brand.name} wurde unerwartet beendet.\nMit „Erneut versuchen“ startet es neu.',
        detail: problemLine(output) ?? (code < 0 ? 'Beendet durch Signal ${-code}' : 'Exit-Code $code'),
      );

  static StartFailure portTaken(int port) => StartFailure(
        'Port $port ist schon belegt.\n'
        'Dort läuft ein anderes Programm, zum Beispiel ein älteres ${Brand.name}, das noch im Hintergrund läuft, '
        'oder eines aus dem Terminal. Beende es und versuch es noch einmal.',
      );

  static String clip(String line, [int at = 0]) {
    if (line.length <= 240) return line;
    final start = (at - 100).clamp(0, line.length - 236);
    final end = start + 236;
    return '${start > 0 ? '…' : ''}${line.substring(start, end)}${end < line.length ? '…' : ''}';
  }

  static String? problemLine(List<String> output) {
    final error = RegExp(r'^[A-Za-z_][\w.]*(?:Error|Exception)\b');
    for (final line in output.reversed) {
      if (error.hasMatch(line.trim())) return clip(line.trim());
    }
    for (final line in output.reversed) {
      final text = line.trim();
      if (text.isNotEmpty && !RegExp(r'^(?:INFO|DEBUG|WARNING)\b').hasMatch(text)) return clip(text);
    }
    return null;
  }

  // An earlier pip error only explains an exit that failed on an import; a
  // taken port or a refused Documents folder keeps its own message and action.
  // A git checkout is never told that the app reinstalls its packages.
  static StartFailure exited(
    List<String> output,
    int? code, {
    required bool frozen,
    bool checkout = false,
    StartFailure? packages,
    int port = 5050,
  }) {
    final text = output.join('\n');
    if (packages != null && (text.contains('ModuleNotFoundError') || text.contains('ImportError'))) return packages;
    final missing = RegExp(r"ModuleNotFoundError: No module named '([^']+)'").firstMatch(text);
    if (missing != null && frozen) {
      return StartFailure(
        'Diese Installation von ${Brand.name} ist unvollständig.\n'
        'Lade ${Brand.name} noch einmal von der Website. Deine Daten bleiben dabei erhalten.',
        detail: missing[0],
      );
    }
    if (missing != null && checkout) {
      return StartFailure(
        'Ein Python-Paket fehlt (${missing[1]}).\nInstallier es in der venv dieses Checkouts und versuch es dann noch einmal.',
        detail: missing[0],
      );
    }
    if (missing != null) {
      return StartFailure(
        'Ein Python-Paket fehlt (${missing[1]}).\nMit „Erneut versuchen“ installiert ${Brand.name} die Pakete neu.',
        detail: missing[0],
        reinstallPackages: true,
      );
    }
    for (final line in output) {
      if (line.contains('[Errno 1] Operation not permitted') && line.contains('/Documents/')) {
        return documentsDenied(clip(line.trim()));
      }
    }
    if (text.contains('Address already in use')) return portTaken(port);
    if (frozen && code == -9) {
      return const StartFailure(
        'macOS hat ${Brand.name} beim Start angehalten.\n'
        'Zieh ${Brand.name} in den Ordner „Programme“, öffne es dort und versuch es noch einmal.',
        detail: 'Beendet durch SIGKILL',
      );
    }
    final exit = code == null ? null : (code < 0 ? 'Beendet durch Signal ${-code}' : 'Exit-Code $code');
    return StartFailure(
      '${Brand.name} hat sich beim Start beendet.\nVersuch es noch einmal.',
      detail: problemLine(output) ?? exit,
    );
  }
}

class PipInstall {
  PipInstall._();

  static final _package = RegExp(r'^(?:Collecting|Requirement already satisfied:)\s+([A-Za-z0-9][A-Za-z0-9_.\-]*)');

  static List<String> arguments(String requirements) => [
        '-m', 'pip', 'install', //
        '--disable-pip-version-check', '--no-input', '--progress-bar', 'off',
        '--timeout', '30', '--retries', '2',
        '-r', requirements,
      ];

  static Future<StartFailure?> run({
    required HostSystem host,
    required String python,
    required String requirements,
    required String workingDirectory,
    required void Function(String text) progress,
    Duration quietLimit = const Duration(minutes: 3),
    Duration timeLimit = const Duration(minutes: 20),
  }) async {
    final Process process;
    try {
      process = await host.start(python, arguments(requirements),
          workingDirectory: workingDirectory, environment: {...Platform.environment, 'PYTHONUNBUFFERED': '1'});
    } on ProcessException catch (error) {
      return explain([error.message]);
    }
    final tail = OutputTail();
    final quiet = Stopwatch()..start();
    var count = 0;
    void onLine(String line) {
      quiet.reset();
      final package = _package.firstMatch(line.trim());
      if (package != null) {
        count++;
        progress(StartText.package(count, package[1]!));
      } else if (line.startsWith('Installing collected packages:')) {
        progress(StartText.installing(','.allMatches(line).length + 1));
      }
    }

    final streams = Future.wait([tail.follow(process.stdout, onLine), tail.follow(process.stderr, onLine)]);
    var stalled = false;
    var tooLong = false;
    final watch = Timer.periodic(const Duration(milliseconds: 500), (timer) {
      if (quiet.elapsed < quietLimit) return;
      stalled = true;
      timer.cancel();
      process.kill(ProcessSignal.sigkill);
    });
    final limit = Timer(timeLimit, () {
      tooLong = true;
      process.kill(ProcessSignal.sigkill);
    });
    final code = await process.exitCode;
    watch.cancel();
    limit.cancel();
    await streams.timeout(const Duration(seconds: 2), onTimeout: () => const []);
    if (code == 0 && !stalled && !tooLong) return null;
    return explain(tail.lines, stalled: stalled, tooLong: tooLong);
  }

  static const _again = 'Versuch es noch einmal, am besten in einem anderen Netz.';

  static List<(List<String>, String)> get _causes => [
        (
          ['no space left on device', '[errno 28]'],
          'Auf dem Mac ist nicht genug Speicherplatz für die Python-Pakete frei.\nGib etwas Platz frei und versuch es noch einmal.',
        ),
        (
          ['proxyerror', 'tunnel connection failed', '407 proxy'],
          'Ein Proxy lässt die Verbindung zu pypi.org nicht durch.\nNimm ein anderes Netz und versuch es noch einmal.',
        ),
        (
          ['certificate_verify_failed', 'certificate verify failed', 'sslerror', 'ssl:', 'wrong_version_number', '511 network authentication'],
          'Die Verbindung zu pypi.org wurde umgeleitet. In Schul-WLANs passiert das, solange du dich nicht im Browser angemeldet hast.\n'
              'Melde dich an oder nimm ein anderes Netz und versuch es dann noch einmal.',
        ),
        (
          [
            'nodename nor servname', 'name or service not known', 'temporary failure in name resolution',
            'failed to establish a new connection', 'network is unreachable', 'no route to host', 'getaddrinfo failed',
          ],
          'Keine Verbindung zum Internet. Beim ersten Start lädt ${Brand.name} einmalig Python-Pakete von pypi.org.\n'
              'Verbinde dich mit dem Internet und versuch es noch einmal.',
        ),
        (
          ['read timed out', 'readtimeouterror', 'connecttimeouterror', 'timed out'],
          'Die Verbindung zu pypi.org ist zu langsam oder bricht ab.\n$_again',
        ),
      ];

  static String? _lastError(List<String> output) {
    for (final line in output.reversed) {
      if (line.trim().startsWith('ERROR:')) return StartText.clip(line.trim());
    }
    return output.isEmpty ? null : StartText.clip(output.last.trim());
  }

  static StartFailure explain(List<String> output, {bool stalled = false, bool tooLong = false}) {
    if (stalled) {
      return StartFailure('Die Installation der Python-Pakete kommt seit Minuten nicht weiter.\n$_again', detail: _lastError(output));
    }
    if (tooLong) return StartFailure('Die Python-Pakete brauchen viel zu lange.\n$_again', detail: _lastError(output));
    for (final (needles, message) in _causes) {
      for (final line in output) {
        final text = line.trim();
        final lower = text.toLowerCase();
        for (final needle in needles) {
          final at = lower.indexOf(needle);
          if (at >= 0) return StartFailure(message, detail: StartText.clip(text, at));
        }
      }
    }
    return StartFailure(
      'Die Python-Pakete ließen sich nicht installieren.\nVersuch es noch einmal. Unten steht die Meldung von pip.',
      detail: _lastError(output),
    );
  }
}
