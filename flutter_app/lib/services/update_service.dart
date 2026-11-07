// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Directory, File, FileSystemEntity, FileSystemEntityType, Platform;
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode, visibleForTesting;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../brand.dart';
import '../build_info.dart';
import '../theme.dart';
import 'android_device.dart';
import 'notification_service.dart';

class UpdateService {
  static String get currentVersion => BuildInfo.version;
  static String get currentVersionName => BuildInfo.versionName;

  static const String _versionUrl = '${Brand.website}/version.json';
  static const Duration _connectionTimeout = Duration(seconds: 2);
  static const String _skippedVersionKey = 'update_skipped_version';
  static final List<String> _trustedUpdateDomains = [
    Uri.parse(Brand.website).host,
  ];

  static final List<String> _trustedGitHubPaths = [
    '${Uri.parse(Brand.repository).path}/releases/',
  ];


  static Future<UpdateInfo?> checkForUpdate({bool ignoreSkipped = false}) async {
    try {
      final response = await http.get(Uri.parse(_versionUrl))
          .timeout(_connectionTimeout);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final remoteVersion = data['version'] as String;

        if (_isNewerVersion(remoteVersion, currentVersion)) {
          if (!ignoreSkipped) {
            final prefs = await SharedPreferences.getInstance();
            final skippedVersion = prefs.getString(_skippedVersionKey);
            if (skippedVersion == remoteVersion) return null;
          }

          final rawUpdateUrl = _getPlatformUrl(data) ?? data['updateUrl'] as String? ?? '${Brand.website}/download';
          final updateUrl = _validateUpdateUrl(rawUpdateUrl)
              ? rawUpdateUrl
              : '${Brand.website}/download';
          final package = !kIsWeb && Platform.isAndroid ? packageFor(data, 'android') : null;
          unawaited(UpdateDownloader.tidy(keep: package == null ? null : remoteVersion));
          return UpdateInfo(
            version: remoteVersion,
            versionName: data['versionName'] as String? ?? remoteVersion,
            updateUrl: updateUrl,
            changelog: (data['changelog'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ?? [],
            package: package,
          );
        }
        unawaited(UpdateDownloader.tidy());
      }
    } on TimeoutException {
      debugPrint('Update check: Connection timeout');
    } catch (e) {
      debugPrint('Update check error: $e');
    }
    return null;
  }


  static const maxPackageBytes = 400 * 1024 * 1024;
  static final _digest = RegExp(r'^[0-9a-fA-F]{64}$');

  /// The optional `downloads.<platform>` entry of version.json: `url` of the file, its `size`
  /// in bytes and, when known, its `sha256`. Clients before 0.6 ignore it and keep using
  /// `platformUrls`, and a missing or broken entry falls back to that page as well. A file
  /// named for another version is a leftover of the last release and is ignored too.
  @visibleForTesting
  static UpdatePackage? packageFor(Map<String, dynamic> data, String platform) {
    final downloads = data['downloads'];
    final entry = downloads is Map ? downloads[platform] : null;
    if (entry is! Map) return null;
    final url = entry['url'], size = entry['size'], digest = entry['sha256'], version = data['version'];
    if (url is! String || version is! String || !_validateUpdateUrl(url)) return null;
    final file = Uri.parse(url).pathSegments.lastOrNull?.toLowerCase() ?? '';
    if (!file.endsWith('-${version.toLowerCase()}.apk')) return null;
    if (size is! int || size <= 0 || size > maxPackageBytes) return null;
    if (digest != null && (digest is! String || !_digest.hasMatch(digest))) return null;
    return UpdatePackage(url: url, size: size, sha256: (digest as String?)?.toLowerCase());
  }

  static Future<void> skipVersion(String version) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_skippedVersionKey, version);
  }


  static Future<void> sendUpdateNotification(UpdateInfo updateInfo) async {
    try {
      final notificationService = NotificationService();
      if (!notificationService.isInitialized) {
        await notificationService.initialize();
      }
      await notificationService.showNotification(
        id: 9999,
        title: '${Brand.name} Update verfügbar',
        body: '${updateInfo.versionName} ist jetzt verfügbar. Tippe, um es zu laden.',
        payload: updateInfo.package == null ? updateInfo.updateUrl : null,
      );
    } catch (e) {
      if (kDebugMode) debugPrint('Update notification error: $e');
    }
  }

  static String? _getPlatformUrl(Map<String, dynamic> data) {
    final platformUrls = data['platformUrls'] as Map<String, dynamic>?;
    if (platformUrls == null) return null;

    String platformKey;
    if (kIsWeb) {
      platformKey = 'web';
    } else if (Platform.isAndroid) {
      platformKey = 'android';
    } else if (Platform.isIOS) {
      platformKey = 'ios';
    } else if (Platform.isMacOS) {
      platformKey = 'macos';
    } else if (Platform.isWindows) {
      platformKey = 'windows';
    } else if (Platform.isLinux) {
      platformKey = 'linux';
    } else {
      return null;
    }

    return platformUrls[platformKey] as String?;
  }

  static bool _isNewerVersion(String remote, String current) {
    try {
      final remoteParts = remote.split('.').map(int.parse).toList();
      final currentParts = current.split('.').map(int.parse).toList();

      for (int i = 0; i < remoteParts.length && i < currentParts.length; i++) {
        if (remoteParts[i] > currentParts[i]) return true;
        if (remoteParts[i] < currentParts[i]) return false;
      }
      return remoteParts.length > currentParts.length;
    } catch (e) {
      return remote != current;
    }
  }

  @visibleForTesting
  static bool validateUpdateUrl(String url) => _validateUpdateUrl(url);

  static bool _validateUpdateUrl(String url) {
    try {
      final uri = Uri.parse(url);
      if (uri.scheme != 'https') return false;
      final host = uri.host.toLowerCase();
      if (_trustedUpdateDomains.any((domain) =>
          host == domain || host.endsWith('.$domain'))) {
        return true;
      }
      if (host == 'github.com') {
        final path = uri.path.toLowerCase();
        return _trustedGitHubPaths.any((trustedPath) =>
            path.startsWith(trustedPath.toLowerCase()));
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> showUpdateDialog(BuildContext context, UpdateInfo updateInfo) async {
    return showDialog(
      context: context,
      barrierDismissible: true,
      barrierColor: Colors.black.withValues(alpha: 0.7),
      builder: (context) => UpdateDialog(updateInfo: updateInfo),
    );
  }
}

class UpdateInfo {
  final String version;
  final String versionName;
  final String updateUrl;
  final List<String> changelog;
  final UpdatePackage? package;

  UpdateInfo({
    required this.version,
    required this.versionName,
    required this.updateUrl,
    required this.changelog,
    this.package,
  });
}

class UpdatePackage {
  const UpdatePackage({required this.url, required this.size, this.sha256});

  final String url;
  final int size;
  final String? sha256;
}

class UpdateBroken implements Exception {
  const UpdateBroken();
}

class UpdateDownloader {
  UpdateDownloader({Dio? dio, Future<Directory> Function()? folder})
      : _dio = dio ?? Dio(BaseOptions(connectTimeout: const Duration(seconds: 15), receiveTimeout: const Duration(seconds: 30))),
        _folder = folder ?? getTemporaryDirectory;

  final Dio _dio;
  final Future<Directory> Function() _folder;

  static Future<Directory> _updates(Future<Directory> Function() folder) async => Directory(p.join((await folder()).path, 'updates'));

  static String fileName(String version) => '${Brand.name}-$version.apk';

  /// Removes downloaded installers except the one for [keep], so an old 100 MB file never lingers.
  static Future<void> tidy({String? keep, Future<Directory> Function()? folder}) async {
    if (folder == null && (kIsWeb || !Platform.isAndroid)) return;
    try {
      final directory = await _updates(folder ?? getTemporaryDirectory);
      if (!await directory.exists()) return;
      await for (final entry in directory.list()) {
        if (keep == null || !p.basename(entry.path).startsWith(fileName(keep))) await entry.delete(recursive: true);
      }
    } catch (_) {}
  }

  static Future<bool> matches(File file, UpdatePackage package) async {
    if (!await file.exists() || await file.length() != package.size) return false;
    final digest = package.sha256;
    if (digest == null) return true;
    return (await sha256.bind(file.openRead()).first).toString() == digest;
  }

  Future<File> fetch(UpdatePackage package, String version, {void Function(int received, int total)? progress, CancelToken? cancel}) async {
    final directory = await _updates(_folder);
    await directory.create(recursive: true);
    final target = File(p.join(directory.path, fileName(version)));
    if (await matches(target, package)) return target;
    final part = File('${target.path}.part');
    final token = cancel ?? CancelToken();
    var overrun = false;
    try {
      await _dio.download(
        package.url,
        part.path,
        cancelToken: token,
        onReceiveProgress: (received, _) {
          if (received > package.size && !overrun) {
            overrun = true;
            token.cancel();
            return;
          }
          progress?.call(received, package.size);
        },
      );
    } on DioException {
      if (!overrun) rethrow;
    }
    if (overrun || !await matches(part, package)) {
      if (await FileSystemEntity.type(part.path) != FileSystemEntityType.notFound) await part.delete();
      throw const UpdateBroken();
    }
    return part.rename(target.path);
  }
}

enum _Step { ready, loading, checking, permission, installing, failed }

class UpdateDialog extends StatefulWidget {
  final UpdateInfo updateInfo;

  const UpdateDialog({super.key, required this.updateInfo});

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> with WidgetsBindingObserver {
  _Step _step = _Step.ready;
  int _received = 0;
  String _problem = '';
  File? _file;
  CancelToken? _cancel;

  UpdateInfo get updateInfo => widget.updateInfo;
  UpdatePackage? get _package => updateInfo.package;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cancel?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _step == _Step.permission) unawaited(_install());
  }

  static String _megabytes(int bytes) => (bytes / 1e6).toStringAsFixed(bytes < 10e6 ? 1 : 0).replaceAll('.', ',');

  void _go(_Step step, {String problem = ''}) {
    if (!mounted) return;
    setState(() {
      _step = step;
      _problem = problem;
    });
  }

  Future<void> _download() async {
    final package = _package;
    if (package == null) return;
    final cancel = _cancel = CancelToken();
    setState(() {
      _step = _Step.loading;
      _received = 0;
    });
    try {
      _file = await UpdateDownloader().fetch(package, updateInfo.version, cancel: cancel, progress: (received, total) {
        if (!mounted) return;
        setState(() {
          _received = received;
          if (received >= total) _step = _Step.checking;
        });
      });
    } on UpdateBroken {
      _go(_Step.failed, problem: 'Die Datei kam nicht vollständig an. Lad sie noch einmal oder im Browser.');
      return;
    } catch (_) {
      if (cancel.isCancelled) {
        _go(_Step.ready);
      } else {
        _go(_Step.failed, problem: 'Der Download hat nicht geklappt. Prüf die Verbindung und versuch es noch einmal.');
      }
      return;
    }
    if (cancel.isCancelled) {
      _go(_Step.ready);
      return;
    }
    await _install();
  }

  Future<void> _install() async {
    final file = _file;
    if (file == null) return;
    if (!await AndroidDevice.canInstall()) {
      _go(_Step.permission);
      return;
    }
    if (await AndroidDevice.install(file.path)) {
      _go(_Step.installing);
    } else {
      _go(_Step.failed, problem: 'Android hat die Installation nicht gestartet. Lad das Update im Browser.');
    }
  }

  Future<void> _openUpdateUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        return;
      }
    } catch (e) {
      debugPrint('canLaunchUrl error: $e');
    }
    // canLaunchUrl can be over-conservative (Android package-visibility, some
    // desktop setups); attempt the launch directly rather than silently failing.
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('Error opening URL: $e');
    }
  }

  ButtonStyle _primaryStyle(bool isDark) => ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 16),
        backgroundColor: isDark ? AppPalette.brandDark : AppPalette.pine,
        foregroundColor: isDark ? AppPalette.inkDark : AppPalette.chalk,
        elevation: 0,
        shadowColor: Colors.transparent,
        shape: StadiumBorder(
          side: isDark ? const BorderSide(color: Color(0xFF3E5541)) : BorderSide.none,
        ),
      );

  Widget _primary(bool isDark, IconData icon, String label, VoidCallback? onPressed) => SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: onPressed,
          icon: Icon(icon, size: 20),
          label: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          style: _primaryStyle(isDark),
        ),
      );

  Widget _quiet(bool isDark, String label, VoidCallback onPressed, {bool faint = false}) => TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12), minimumSize: const Size(0, 44)),
        child: Text(
          label,
          style: TextStyle(
            color: (isDark ? AppTheme.darkTextMuted : AppTheme.lightTextMuted).withValues(alpha: faint ? 0.7 : 1),
            fontSize: faint ? 13 : 14,
            fontWeight: faint ? FontWeight.w400 : FontWeight.w500,
          ),
        ),
      );

  Widget _note(bool isDark, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, height: 1.4, color: isDark ? AppTheme.darkTextSecondary : AppTheme.lightTextSecondary),
        ),
      );

  Widget _laterRow(bool isDark) => Row(
        children: [
          Expanded(child: _quiet(isDark, 'Später', () => Navigator.of(context).pop())),
          Container(
            width: 1,
            height: 20,
            color: (isDark ? AppTheme.darkBorder : AppTheme.lightBorder).withValues(alpha: 0.5),
          ),
          Expanded(
            child: _quiet(isDark, 'Überspringen', () {
              UpdateService.skipVersion(updateInfo.version);
              Navigator.of(context).pop();
            }, faint: true),
          ),
        ],
      );

  Widget _progress(bool isDark, int total) {
    final fraction = _step == _Step.loading ? (_received / total).clamp(0.0, 1.0) : 1.0;
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 10,
            backgroundColor: (isDark ? AppPalette.lineDark : AppPalette.line),
            color: isDark ? AppPalette.brandDark : AppPalette.pine,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          _step == _Step.loading ? '${_megabytes(_received)} von ${_megabytes(total)} MB' : 'Wird geprüft',
          style: TextStyle(
            fontSize: 14,
            fontFeatures: const [FontFeature.tabularFigures()],
            color: isDark ? AppTheme.darkTextSecondary : AppTheme.lightTextSecondary,
          ),
        ),
        const SizedBox(height: 6),
        if (_step == _Step.loading) _quiet(isDark, 'Abbrechen', () => _cancel?.cancel()) else const SizedBox(height: 44),
      ],
    );
  }

  Widget _actions(bool isDark) {
    final package = _package;
    if (package == null) {
      return Column(children: [
        _primary(isDark, Icons.download_rounded, 'Herunterladen', () {
          Navigator.of(context).pop();
          _openUpdateUrl(updateInfo.updateUrl);
        }),
        const SizedBox(height: 12),
        _laterRow(isDark),
      ]);
    }
    return switch (_step) {
      _Step.ready => Column(children: [
          _note(isDark, 'Lädt ${_megabytes(package.size)} MB direkt in der App.'),
          _primary(isDark, Icons.system_update_rounded, 'Aktualisieren', _download),
          const SizedBox(height: 12),
          _laterRow(isDark),
        ]),
      _Step.loading || _Step.checking => _progress(isDark, package.size),
      _Step.permission => Column(children: [
          _note(isDark, 'Erlaube ${Brand.name} einmal, Apps zu installieren. Danach geht es hier weiter.'),
          _primary(isDark, Icons.lock_open_rounded, 'Erlauben', () => unawaited(AndroidDevice.allowInstall())),
          const SizedBox(height: 12),
          _quiet(isDark, 'Später', () => Navigator.of(context).pop()),
        ]),
      _Step.installing => Column(children: [
          _note(isDark, 'Bestätige das Update im Fenster von Android.'),
          _primary(isDark, Icons.install_mobile_rounded, 'Installation öffnen', () => unawaited(_install())),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _quiet(isDark, 'Später', () => Navigator.of(context).pop())),
            Expanded(
              child: _quiet(isDark, 'Im Browser laden', () {
                Navigator.of(context).pop();
                _openUpdateUrl(updateInfo.updateUrl);
              }),
            ),
          ]),
        ]),
      _Step.failed => Column(children: [
          _note(isDark, _problem),
          _primary(isDark, Icons.refresh_rounded, 'Noch einmal', _download),
          const SizedBox(height: 12),
          _quiet(isDark, 'Im Browser laden', () {
            Navigator.of(context).pop();
            _openUpdateUrl(updateInfo.updateUrl);
          }),
        ]),
    };
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final still = MediaQuery.disableAnimationsOf(context);

    return PopScope(
      canPop: _step != _Step.loading && _step != _Step.checking,
      child: Dialog(
        backgroundColor: Colors.transparent,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 400),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: isDark ? AppPalette.overlayDark : AppPalette.overlay,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: isDark ? AppPalette.lineDark : AppPalette.line),
            boxShadow: [
              BoxShadow(
                color: isDark ? Colors.black.withValues(alpha: .5) : const Color(0xFF14201A).withValues(alpha: .18),
                blurRadius: 36,
                spreadRadius: -10,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppTheme.primaryColor,
                      ),
                      child: const Icon(
                        Icons.system_update_rounded,
                        color: Colors.white,
                        size: 32,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Neues Update verfügbar',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: isDark ? AppTheme.darkText : AppTheme.lightText,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        color: AppTheme.primaryColor.withValues(alpha: 0.1),
                      ),
                      child: Text(
                        'Version ${updateInfo.versionName}',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.primaryColor,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              if (updateInfo.changelog.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Neuheiten',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppTheme.darkTextSecondary
                              : AppTheme.lightTextSecondary,
                        ),
                      ),
                      const SizedBox(height: 12),
                      ...updateInfo.changelog.take(4).map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              margin: const EdgeInsets.only(top: 6),
                              width: 6,
                              height: 6,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppTheme.primaryColor,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                item,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: isDark
                                      ? AppTheme.darkTextMuted
                                      : AppTheme.lightTextMuted,
                                  height: 1.4,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )),
                    ],
                  ),
                ),

              Container(
                height: 1,
                color: isDark ? AppPalette.lineDark : AppPalette.line,
              ),

              Padding(
                padding: const EdgeInsets.all(24),
                child: AnimatedSize(
                  duration: still ? Duration.zero : const Duration(milliseconds: 240),
                  curve: Curves.easeOutCubic,
                  child: AnimatedSwitcher(
                    duration: still ? Duration.zero : const Duration(milliseconds: 200),
                    child: KeyedSubtree(key: ValueKey(_step), child: _actions(isDark)),
                  ),
                ),
              ),

              Container(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  'Installiert: ${UpdateService.currentVersionName}',
                  style: TextStyle(
                    fontSize: 12,
                    color: (isDark ? AppTheme.darkTextMuted : AppTheme.lightTextMuted)
                        .withValues(alpha: 0.6),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
