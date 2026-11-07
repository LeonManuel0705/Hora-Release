// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart'
    show ValueNotifier, kDebugMode, visibleForTesting;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../brand.dart';
import '../build_info.dart';
import 'backend_setup.dart';
import 'legacy_import.dart';

enum FlaskServerState { idle, starting, ready, error, alreadyRunning }

enum _Wait { ready, exited, timedOut }

class FlaskServerService {
  static final FlaskServerService _instance = FlaskServerService._internal();
  factory FlaskServerService() => _instance;
  FlaskServerService._internal();

  static const _backendPidsKey = 'hub_backend_pids';

  final String _desktopToken = _newToken();
  RandomAccessFile? _instanceLock;
  Process? _flaskProcess;
  bool _externalServer = false;
  String? _errorMessage;

  final _host = const HostSystem();
  StartProblem problem = StartProblem.none;
  String? errorDetail;
  StartFailure? _packagesFailure;
  final ValueNotifier<String> setupProgress = ValueNotifier('');

  final ValueNotifier<FlaskServerState> state =
      ValueNotifier(FlaskServerState.idle);

  String get errorMessage => _errorMessage ?? '';
  bool get isReady =>
      state.value == FlaskServerState.ready ||
      state.value == FlaskServerState.alreadyRunning;
  int get port => 5050;
  String get url => 'http://127.0.0.1:$port';
  String get hubUrl => '$url/hub';
  String get desktopToken => _desktopToken;

  bool isHubUrl(String url) {
    final uri = Uri.tryParse(url);
    return uri != null &&
        uri.scheme == 'http' &&
        uri.userInfo.isEmpty &&
        uri.host == '127.0.0.1' &&
        uri.port == port;
  }

  static String _newToken() {
    final random = Random.secure();
    return List.generate(
      32,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  @visibleForTesting
  static String handshakeMac(String token, String nonce) =>
      Hmac(sha256, utf8.encode(token))
          .convert(utf8.encode('hub-desktop-handshake:$nonce'))
          .toString();

  @visibleForTesting
  static bool sameMac(String a, String b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return diff == 0;
  }

  @visibleForTesting
  static Future<bool> verifyBackend(Uri base, String token) async {
    final nonce = _newToken();
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(base.replace(
        path: '/api/desktop-handshake',
        queryParameters: {'nonce': nonce},
      ));
      request.followRedirects = false;
      final response = await request.close().timeout(const Duration(seconds: 3));
      final body = await _smallBody(response).timeout(const Duration(seconds: 3));
      if (response.statusCode != 200 || body == null) return false;
      final mac = (jsonDecode(body) as Map<String, dynamic>)['mac'];
      return mac is String && sameMac(mac, handshakeMac(token, nonce));
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  @visibleForTesting
  static Future<String?> requestLoginCode(Uri base, String token) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request =
          await client.postUrl(base.replace(path: '/api/desktop-login-code'));
      request.followRedirects = false;
      request.headers.set('X-Hub-Token', token);
      final response = await request.close().timeout(const Duration(seconds: 3));
      final body = await _smallBody(response).timeout(const Duration(seconds: 3));
      if (response.statusCode != 200 || body == null) return null;
      final code = (jsonDecode(body) as Map<String, dynamic>)['code'];
      return code is String && RegExp(r'^[0-9a-f]{64}$').hasMatch(code)
          ? code
          : null;
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  static Future<String?> _smallBody(HttpClientResponse response) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response) {
      bytes.add(chunk);
      if (bytes.length > 4096) return null;
    }
    return utf8.decode(bytes.takeBytes());
  }

  Future<bool> _passesHandshake() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await Future.delayed(const Duration(milliseconds: 500));
      if (await verifyBackend(Uri.parse(url), _desktopToken)) return true;
    }
    return false;
  }

  Future<bool> confirmBackend() async {
    if (await _passesHandshake()) return true;
    _fail(StartFailure('Das Programm auf Port $port hat sich nicht als ${Brand.name} ausgewiesen.\n'
        'Versuch es noch einmal.'));
    return false;
  }

  void _fail(StartFailure failure) {
    _errorMessage = failure.message;
    errorDetail = failure.detail;
    problem = failure.problem;
    setupProgress.value = '';
    state.value = FlaskServerState.error;
  }

  Future<String?> fetchLoginCode() =>
      requestLoginCode(Uri.parse(url), _desktopToken);

  String get _portTakenMessage => StartText.portTaken(port).message;

  String get _homeDir =>
      Platform.environment[Platform.isWindows ? 'USERPROFILE' : 'HOME'] ?? '';

  static String _system32(String exe) => p.join(
      Platform.environment['SystemRoot'] ?? r'C:\Windows', 'System32', exe);

  String get _defaultProjectPath => p.join(_homeDir, 'Documents', Brand.name);

  Future<bool> Function(String previousName)? confirmLegacyImport;

  static String? _env(String name) {
    final prefixes = [
      'HUB',
      for (final previous in Brand.previousNames) previous.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]+'), '_'),
    ].where((prefix) => RegExp(r'^[A-Z][A-Z0-9_]*$').hasMatch(prefix));
    for (final prefix in prefixes) {
      final value = Platform.environment['${prefix}_$name'];
      if (value != null && value.isNotEmpty) return value;
    }
    return null;
  }

  String? _legacyFolder() {
    final home = _homeDir;
    if (home.isEmpty) return null;
    return LegacyImport.findLegacyFolder(
      documents: p.join(home, 'Documents'),
      target: _defaultProjectPath,
      previousNames: Brand.previousNames,
    );
  }

  Future<String?> _importLegacyData({required bool sole}) async {
    final legacy = _legacyFolder();
    if (legacy == null) return null;
    final name = p.basename(legacy);
    if (!sole) {
      return '${Brand.name} übernimmt gerade in einem anderen Fenster die Daten aus $name.\n'
          'Schließ dieses Fenster oder versuch es gleich noch einmal.';
    }
    final ask = confirmLegacyImport;
    if (ask == null || !await ask(name)) return null;
    final outcome = await LegacyImport.copyInto(
      legacy: legacy,
      target: _defaultProjectPath,
      python: await _findPythonPath(legacy),
    );
    if (kDebugMode) print('FlaskServer: Import from $legacy: $outcome');
    switch (outcome) {
      case LegacyImportOutcome.imported:
      case LegacyImportOutcome.skipped:
        return null;
      case LegacyImportOutcome.keyConflict:
        return 'Die Daten aus Dokumente/$name wurden nicht übernommen.\n'
            'Dokumente/${Brand.name}/.env hat einen anderen SECRET_KEY, damit wären deine Zugangsdaten unlesbar.';
      case LegacyImportOutcome.unclearOld:
        return 'Dokumente/$name/.env lässt sich nicht eindeutig lesen, deshalb wurde nichts übernommen.\n'
            'Prüf die Datei, zum Beispiel auf ein fehlendes Anführungszeichen, und versuch es noch einmal.';
      case LegacyImportOutcome.unclearNew:
        return 'Dokumente/${Brand.name}/.env lässt sich nicht eindeutig lesen oder nachprüfen, deshalb wurde nichts übernommen.\n'
            'Prüf die Datei, zum Beispiel auf ein fehlendes Anführungszeichen, und versuch es noch einmal.';
      case LegacyImportOutcome.failed:
        return 'Die Übernahme aus Dokumente/$name hat nicht geklappt.\n'
            'Der alte Ordner ist unverändert. Versuch es noch einmal.';
    }
  }

  Future<void> start() async {
    if (isReady) return;

    state.value = FlaskServerState.starting;
    _errorMessage = null;
    errorDetail = null;
    problem = StartProblem.none;
    setupProgress.value = '';

    // 1. Reuse an already-running server only if it answers the handshake for
    //    this run's token; anything else on the port is refused.
    bool sole;
    try {
      sole = await _isSoleInstance();
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Could not take the instance lock: $e');
      sole = false;
    }

    Set<int>? leftovers;
    if (await _isServerRunning()) {
      leftovers = sole ? await _ownLeftovers() : <int>{};
      if (leftovers.isEmpty) {
        if (!await _passesHandshake()) {
          _fail(StartFailure(!sole && _lockContended ? '${Brand.name} läuft schon in einem anderen Fenster.' : _portTakenMessage));
          return;
        }
        _externalServer = true;
        state.value = FlaskServerState.alreadyRunning;
        if (kDebugMode) {
          print('FlaskServer: Reusing already-running server on port $port');
        }
        return;
      }
    }

    if (sole) {
      try {
        LegacyImport.cleanUp(_defaultProjectPath);
      } catch (_) {}
    }
    final located = await _resolveProjectRoot();
    if (located == null || p.equals(located, _defaultProjectPath)) {
      String? importProblem;
      try {
        importProblem = await _importLegacyData(sole: sole || !_lockContended);
      } catch (_) {
        importProblem = 'Die alten Daten ließen sich nicht übernehmen.\n'
            'Der alte Ordner ist unverändert. Versuch es noch einmal.';
      }
      if (importProblem != null) {
        _fail(StartFailure(importProblem));
        return;
      }
    }

    final frozen = Platform.isMacOS
        ? await frozenServerFor(
            host: _host,
            executable: Platform.resolvedExecutable,
            located: located,
            rootOverride: _env('ROOT') != null,
          )
        : null;
    if (frozen != null) {
      await _killExistingServerOnPort(only: sole ? leftovers : const <int>{});
      await _startFrozen(frozen, located ?? _defaultProjectPath);
      return;
    }

    final copyFailure = await _extractBundledBackend();

    // Clear a dead listener squatting the port, or the backend an earlier run
    // of this app left behind, so the one started now runs the current code.
    await _killExistingServerOnPort(only: sole ? leftovers : const <int>{});

    final root = await _resolveProjectRoot();
    if (root == null) {
      _fail(copyFailure ??
          const StartFailure('Projektordner nicht gefunden.\n'
              'Erwartet: Documents/${Brand.name} mit app/app.py'));
      return;
    }

    final found = await _findPythonPath(root);
    if (found == null) {
      _fail(Platform.isMacOS ? StartText.pythonMissing : StartText.pythonNotFound);
      return;
    }
    if (!p.isWithin(root, found)) setupProgress.value = StartText.environment;
    final pythonPath = await ownEnvironment(root, found);
    if (!await _syncPipDependencies(root, pythonPath, checkout: _isCheckout(_host, root))) return;
    await _launch(
      pythonPath,
      ['-m', 'app.app'],
      root,
      {'FLASK_ENV': 'development'},
      frozen: false,
    );
  }

  static bool _isCheckout(HostSystem host, String root) {
    final git = p.join(root, '.git');
    return host.isFile(git) || host.isDirectory(git);
  }

  // A git checkout or a folder named in HUB_ROOT is developer source and keeps
  // running with Python, exactly as before; everything else gets the frozen
  // backend from the app bundle when it runs on this Mac.
  @visibleForTesting
  static Future<String?> frozenServerFor({
    required HostSystem host,
    required String executable,
    required String? located,
    required bool rootOverride,
  }) async {
    if (located != null && (rootOverride || _isCheckout(host, located))) return null;
    final server = FrozenBackend.find(host, executable);
    if (server == null || !await FrozenBackend.runsHere(host, server)) return null;
    return server;
  }

  Future<void> _startFrozen(String server, String project) async {
    try {
      Directory(project).createSync(recursive: true);
      Directory(project).listSync();
    } on FileSystemException catch (error) {
      final denied = error.osError?.errorCode == 1;
      _fail(denied ? StartText.documentsDenied(project) : StartText.notStartable('${error.message}: ${error.path}'));
      return;
    }
    await FrozenBackend.clearQuarantine(_host, server);
    await _launch(
      server,
      const [],
      project,
      {
        'HUB_DATA_DIR': p.join(project, 'data'),
        'HUB_ENV_FILE': p.join(project, '.env'),
        'PYTHONUNBUFFERED': '1',
      },
      frozen: true,
    );
  }

  Future<void> _launch(
    String executable,
    List<String> arguments,
    String workingDirectory,
    Map<String, String> environment, {
    required bool frozen,
  }) async {
    final listenersBefore = await _listenerPids();
    final output = OutputTail();
    final Process process;
    try {
      if (kDebugMode) print('FlaskServer: Starting $executable in $workingDirectory');
      process = await _host.start(
        executable,
        arguments,
        workingDirectory: workingDirectory,
        environment: {
          ...Platform.environment,
          'HUB_HOST': '127.0.0.1',
          'HUB_DESKTOP_TOKEN': _desktopToken,
          'HUB_PORT': '$port',
          'HUB_EXIT_WITH_PARENT': '1',
          ...environment,
        },
      );
    } on ProcessException catch (error) {
      _fail(StartText.notStartable(error.message));
      return;
    }
    _flaskProcess = process;
    void echo(String line) {
      if (kDebugMode) print('Backend: $line');
    }

    final streams = Future.wait([output.follow(process.stdout, echo), output.follow(process.stderr, echo)]);
    Future<StartFailure> explain(int code, {required bool running}) async {
      await streams.timeout(const Duration(seconds: 1), onTimeout: () => const []);
      final failure = running
          ? StartText.crashed(output.lines, code)
          : _packagesFailure ?? StartText.exited(output.lines, code, frozen: frozen, port: port);
      if (failure.reinstallPackages) _forgetPackages(workingDirectory);
      return failure;
    }

    final exited = process.exitCode;
    final outcome = await _waitForServer(exited);
    if (outcome == _Wait.ready && !await _passesHandshake()) {
      _fail(StartFailure(_portTakenMessage));
      await _killProcess();
    } else if (outcome == _Wait.ready) {
      await _rememberServer(listenersBefore);
      state.value = FlaskServerState.ready;
      if (kDebugMode) print('FlaskServer: Ready on port $port');
      unawaited(exited.then((code) async {
        if (_flaskProcess != process) return;
        _flaskProcess = null;
        if (state.value == FlaskServerState.ready) _fail(await explain(code, running: true));
      }));
    } else if (outcome == _Wait.exited) {
      _flaskProcess = null;
      _fail(await explain(await exited, running: false));
    } else {
      _fail(StartText.timedOut(output.lines));
      await _killProcess();
    }
  }

  void _forgetPackages(String root) {
    try {
      final hash = File(p.join(root, '.requirements_hash'));
      if (hash.existsSync()) hash.deleteSync();
    } catch (_) {}
  }

  Future<void> restart() async {
    await shutdown();
    _externalServer = false;
    await start();
  }

  Future<void> shutdown() async {
    if (_externalServer) {
      if (kDebugMode) print('FlaskServer: External server, skipping shutdown');
      state.value = FlaskServerState.idle;
      return;
    }
    await _killProcess();
    state.value = FlaskServerState.idle;
  }

  // Only processes LISTENING on 127.0.0.1:port, where the backend binds, count —
  // never processes merely connected to it (a browser tab, curl, the Electron
  // wrapper). Guarded per platform because lsof does not exist on Windows.
  Future<Set<int>> _listenerPids() async {
    final pids = <int>{};
    try {
      if (Platform.isWindows) {
        final result = await Process.run(_system32('netstat.exe'), ['-ano']);
        pids.addAll(parseNetstatListeners(result.stdout as String, port));
      } else {
        final result = await Process.run(
            'lsof', ['-t', '-iTCP@127.0.0.1:$port', '-sTCP:LISTEN']);
        for (final line in (result.stdout as String).split('\n')) {
          final pid = int.tryParse(line.trim());
          if (pid != null) pids.add(pid);
        }
      }
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Could not list listeners on port $port: $e');
    }
    return pids;
  }

  @visibleForTesting
  static Set<int> parseNetstatListeners(String output, int port) {
    final listener = RegExp(
      r'^\s*TCP\s+127\.0\.0\.1:' '$port' r'\s+0\.0\.0\.0:0\s+\S+\s+(\d+)\s*$',
      caseSensitive: false,
    );
    final pids = <int>{};
    for (final line in output.split('\n')) {
      final match = listener.firstMatch(line.trimRight());
      if (match == null) continue;
      final pid = int.tryParse(match.group(1)!);
      if (pid != null && pid != 0) pids.add(pid);
    }
    return pids;
  }

  Future<void> _killExistingServerOnPort({Set<int>? only}) async {
    var pids = await _listenerPids();
    if (only != null) pids = pids.intersection(only);
    if (pids.isEmpty) return;
    try {
      for (final pid in pids) {
        if (kDebugMode) print('FlaskServer: Stopping listener $pid on port $port');
        if (Platform.isWindows) {
          await Process.run(_system32('taskkill.exe'), ['/PID', '$pid', '/F']);
        } else {
          Process.killPid(pid, ProcessSignal.sigterm);
        }
      }
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Could not stop a listener: $e');
    }
    for (int i = 0; i < 30; i++) {
      await Future.delayed(const Duration(milliseconds: 100));
      if ((await _listenerPids()).intersection(pids).isEmpty) return;
    }
  }

  Future<void> _rememberServer(Set<int> listenersBefore) async {
    if (_instanceLock == null) return;
    try {
      final pids = (await _listenerPids()).difference(listenersBefore);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_backendPidsKey, [for (final pid in pids) '$pid']);
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Could not record the backend: $e');
    }
  }

  Future<Set<int>> _ownLeftovers() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final recorded = {
        for (final pid in prefs.getStringList(_backendPidsKey) ?? const <String>[])
          if (int.tryParse(pid) case final value?) value,
      };
      if (recorded.isEmpty) return {};
      return (await _listenerPids()).intersection(recorded);
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Could not check for a leftover backend: $e');
      return {};
    }
  }

  bool _lockContended = false;

  static bool _contention(FileSystemException error) {
    final code = error.osError?.errorCode;
    if (code == null) return true;
    if (Platform.isWindows) return code == 32 || code == 33;
    return code == 11 || code == 13 || code == 35;
  }

  Future<bool> _isSoleInstance() async {
    if (_instanceLock != null) return true;
    _lockContended = false;
    final dir = await getApplicationSupportDirectory();
    await dir.create(recursive: true);
    final file = await File(p.join(dir.path, 'backend.lock')).open(mode: FileMode.append);
    try {
      await file.lock(FileLock.exclusive);
      _instanceLock = file;
      return true;
    } on FileSystemException catch (error) {
      _lockContended = _contention(error);
      await file.close();
      return false;
    }
  }

  Future<bool> _isServerRunning() => isAnswering(Uri.parse(url));

  @visibleForTesting
  static Future<bool> isAnswering(Uri base) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(base.replace(path: '/'));
      try {
        request.followRedirects = false;
        final response =
            await request.close().timeout(const Duration(seconds: 2));
        await response
            .drain<void>()
            .timeout(const Duration(seconds: 2), onTimeout: () {});
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  Future<String?> _findPythonPath(String projectRoot) async {
    if (Platform.isMacOS) return (await MacPython.locate(_host, root: projectRoot)).path;
    final venvPaths = Platform.isWindows
        ? [
            p.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
            p.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
            p.join(projectRoot, 'env', 'Scripts', 'python.exe'),
          ]
        : [
            p.join(projectRoot, 'venv', 'bin', 'python3'),
            p.join(projectRoot, '.venv', 'bin', 'python3'),
            p.join(projectRoot, 'env', 'bin', 'python3'),
          ];
    for (final path in venvPaths) {
      if (File(path).existsSync()) {
        if (kDebugMode) print('FlaskServer: Found venv Python at $path');
        return path;
      }
    }

    final candidates =
        Platform.isWindows ? ['python', 'py'] : ['python3', 'python'];
    final locator = Platform.isWindows ? _system32('where.exe') : 'which';
    for (final cmd in candidates) {
      try {
        final result = await Process.run(
            locator, [Platform.isWindows ? '\$PATH:$cmd' : cmd]);
        if (result.exitCode == 0) {
          // `where` can return several lines; take the first hit.
          final path = (result.stdout as String)
              .trim()
              .split('\n')
              .first
              .trim();
          if (path.isNotEmpty) {
            final version = await Process.run(path, ['--version']);
            final versionStr =
                (version.stdout as String) + (version.stderr as String);
            if (versionStr.contains('Python 3')) {
              if (Platform.isWindows && cmd == 'py') {
                final interpreter = await _resolveLauncherInterpreter(path);
                if (interpreter != null) {
                  if (kDebugMode) {
                    print('FlaskServer: py launcher resolved to $interpreter');
                  }
                  return interpreter;
                }
              }
              if (kDebugMode) print('FlaskServer: Found system Python at $path');
              return path;
            }
          }
        }
      } catch (_) {}
    }
    return null;
  }

  Future<String?> _resolveLauncherInterpreter(String launcher) async {
    try {
      final result = await Process.run(
        launcher,
        ['-3', '-c', 'import sys; print(sys.executable)'],
      );
      final interpreter = (result.stdout as String).trim();
      if (result.exitCode == 0 &&
          interpreter.isNotEmpty &&
          File(interpreter).existsSync()) {
        return interpreter;
      }
    } catch (_) {}
    return null;
  }

  @visibleForTesting
  static Future<String> ownEnvironment(String root, String python) async {
    if (p.isWithin(root, python)) return python;
    final own = Platform.isWindows
        ? p.join(root, 'venv', 'Scripts', 'python.exe')
        : p.join(root, 'venv', 'bin', 'python3');
    try {
      final result = await Process.run(python, ['-m', 'venv', 'venv'], workingDirectory: root);
      if (result.exitCode != 0 || !File(own).existsSync()) return python;
      final hash = File(p.join(root, '.requirements_hash'));
      if (hash.existsSync()) hash.deleteSync();
      return own;
    } catch (_) {
      return python;
    }
  }

  // A checkout keeps syncing requirements.txt with the old hash, so a
  // developer's venv is touched exactly as before. An extracted backend only
  // needs the desktop subset.
  Future<bool> _syncPipDependencies(String root, String pythonPath, {required bool checkout}) async {
    _packagesFailure = null;
    final desktop = File(p.join(root, 'requirements-desktop.txt'));
    final requirements = !checkout && desktop.existsSync() ? desktop : File(p.join(root, 'requirements.txt'));
    if (!requirements.existsSync()) {
      setupProgress.value = '';
      return true;
    }

    final hashFile = File(p.join(root, '.requirements_hash'));
    final content = requirements.readAsStringSync();
    final currentHash = checkout ? content.hashCode.toString() : sha256.convert(utf8.encode(content)).toString();
    final installedBefore = hashFile.existsSync();
    if (installedBefore && hashFile.readAsStringSync().trim() == currentHash) {
      setupProgress.value = '';
      return true;
    }

    if (kDebugMode) print('FlaskServer: Installing ${p.basename(requirements.path)}');
    setupProgress.value = StartText.setup;
    final failure = await PipInstall.run(
      host: _host,
      python: pythonPath,
      requirements: requirements.path,
      workingDirectory: root,
      progress: (text) => setupProgress.value = text,
    );
    setupProgress.value = '';
    if (failure == null) {
      hashFile.writeAsStringSync(currentHash);
      return true;
    }
    if (kDebugMode) print('FlaskServer: pip failed: ${failure.detail}');
    // Packages from an earlier install may still be enough, so the backend
    // gets its chance; should it fail, pip's error is what the user sees.
    if (installedBefore) {
      _packagesFailure = failure;
      return true;
    }
    _fail(failure);
    return false;
  }

  String? _findBundledBackend() {
    final exeDir = File(Platform.resolvedExecutable).parent;
    final candidates = <String>[
      if (Platform.isMacOS)
        p.join(exeDir.parent.path, 'Resources', 'backend'), // macOS .app/Contents/Resources
      p.join(exeDir.path, 'backend'), // Windows/Linux next to the executable
      p.join(exeDir.path, 'data', 'backend'), // Windows/Linux data dir
    ];
    for (final c in candidates) {
      if (File(p.join(c, 'app', 'app.py')).existsSync()) return c;
    }
    return null;
  }

  static const _installedBuildFile = '.bundled-build';

  @visibleForTesting
  static bool bundleIsNewer(String dest, int build) {
    if (!File(p.join(dest, 'app', 'app.py')).existsSync()) return true;
    if (FileSystemEntity.typeSync(p.join(dest, '.git')) !=
        FileSystemEntityType.notFound) {
      return false;
    }
    final marker = File(p.join(dest, _installedBuildFile));
    if (!marker.existsSync()) return true;
    return int.tryParse(marker.readAsStringSync().trim()) != build;
  }

  @visibleForTesting
  static void installBundledBackend(String bundle, String dest, int build) {
    Directory(dest).createSync(recursive: true);
    final app = Directory(p.join(dest, 'app'));
    final incoming = Directory(p.join(dest, 'app.incoming'));
    final previous = Directory(p.join(dest, 'app.previous'));
    for (final stale in [incoming, previous]) {
      if (stale.existsSync()) stale.deleteSync(recursive: true);
    }
    _copyTree(Directory(p.join(bundle, 'app')), incoming);
    if (app.existsSync()) app.renameSync(previous.path);
    try {
      incoming.renameSync(app.path);
    } catch (_) {
      if (previous.existsSync() && !app.existsSync()) {
        previous.renameSync(app.path);
      }
      rethrow;
    }
    if (previous.existsSync()) previous.deleteSync(recursive: true);
    for (final name in ['requirements.txt', 'requirements-desktop.txt', 'calendar_sync.py']) {
      final source = File(p.join(bundle, name));
      if (source.existsSync()) source.copySync(p.join(dest, name));
    }
    File(p.join(dest, _installedBuildFile)).writeAsStringSync('$build\n');
  }

  Future<StartFailure?> _extractBundledBackend() async {
    final bundlePath = _findBundledBackend();
    if (bundlePath == null) {
      if (kDebugMode) print('FlaskServer: No bundled backend found in app bundle');
      return null;
    }

    final home = _homeDir;
    if (home.isEmpty) return null;

    final dest = _defaultProjectPath;
    const build = BuildInfo.buildNumber;

    // A git checkout is the developer's live source and is never replaced;
    // a folder this app extracted is refreshed when the app's build changes.
    if (!bundleIsNewer(dest, build)) {
      if (kDebugMode) print('FlaskServer: Backend at $dest is current');
      return null;
    }

    final updating = File(p.join(dest, 'app', 'app.py')).existsSync();
    try {
      if (kDebugMode) {
        print('FlaskServer: ${updating ? 'Updating' : 'Extracting'} backend from $bundlePath to $dest');
      }
      setupProgress.value = updating ? '${Brand.name} wird aktualisiert …' : '${Brand.name} wird eingerichtet …';
      installBundledBackend(bundlePath, dest, build);
      setupProgress.value = '';
      return null;
    } on FileSystemException catch (e) {
      setupProgress.value = '';
      if (kDebugMode) print('FlaskServer: Backend copy failed: $e');
      return e.osError?.errorCode == 1
          ? StartText.documentsDenied(dest)
          : StartText.notStartable('${e.message}: ${e.path}');
    } catch (e) {
      setupProgress.value = '';
      if (kDebugMode) print('FlaskServer: Backend copy failed: $e');
      return StartText.notStartable('$e');
    }
  }

  static void _copyTree(Directory src, Directory dest) {
    dest.createSync(recursive: true);
    for (final entity in src.listSync(recursive: false)) {
      final name = p.basename(entity.path);
      if (name == '__pycache__') continue;
      final target = p.join(dest.path, name);
      if (entity is Directory) {
        _copyTree(entity, Directory(target));
      } else if (entity is File) {
        entity.copySync(target);
      }
    }
  }

  Future<String?> _resolveProjectRoot() async {
    final envRoot = _env('ROOT');
    if (envRoot != null && _hasAppPy(envRoot)) return envRoot;

    final home = _homeDir;
    if (home.isEmpty) return null;

    var dir = File(Platform.resolvedExecutable).parent;
    for (int i = 0; i < 10 && p.isWithin(home, dir.path); i++) {
      if (_hasAppPy(dir.path)) return dir.path;
      dir = dir.parent;
    }

    final fallback = _defaultProjectPath;
    if (_hasAppPy(fallback)) return fallback;

    return null;
  }

  bool _hasAppPy(String dir) {
    return File(p.join(dir, 'app', 'app.py')).existsSync();
  }

  Future<_Wait> _waitForServer(
    Future<int> exited, {
    Duration limit = const Duration(seconds: 60),
  }) async {
    var gone = false;
    unawaited(exited.then((_) => gone = true));
    final clock = Stopwatch()..start();
    var hint = 0;
    while (clock.elapsed < limit) {
      await Future.delayed(const Duration(milliseconds: 400));
      if (gone) return _Wait.exited;
      if (await _isServerRunning()) return gone ? _Wait.exited : _Wait.ready;
      if (hint == 0 && clock.elapsed >= const Duration(seconds: 8)) {
        hint = 1;
        setupProgress.value = StartText.slow;
      } else if (hint == 1 && clock.elapsed >= const Duration(seconds: 30)) {
        hint = 2;
        setupProgress.value = StartText.verySlow;
      }
    }
    return gone ? _Wait.exited : _Wait.timedOut;
  }

  Future<void> _killProcess() async {
    final process = _flaskProcess;
    if (process == null) return;
    _flaskProcess = null;

    try {
      if (kDebugMode) print('FlaskServer: Sending SIGTERM');
      process.kill(ProcessSignal.sigterm);

      final exited = await process.exitCode
          .timeout(const Duration(seconds: 3), onTimeout: () => -1);

      if (exited == -1) {
        if (kDebugMode) print('FlaskServer: SIGTERM timeout, sending SIGKILL');
        process.kill(ProcessSignal.sigkill);
      }
    } catch (e) {
      if (kDebugMode) print('FlaskServer: Error killing process: $e');
    }
  }
}
