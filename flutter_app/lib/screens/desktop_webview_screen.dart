// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:async';
import 'dart:collection';
import 'dart:io' show PathAccessException, Platform;
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

import '../brand.dart';
import '../services/downloads.dart';
import '../services/backend_setup.dart';
import '../services/flask_server_service.dart';
import '../services/login_item.dart';
import '../services/notification_service.dart';
import '../services/update_service.dart';
import '../theme.dart';
import '../widgets/app_background.dart';

const feedbackAddress = 'horaapp.team@gmail.com';

/// The page may hand over a feedback draft to the published address with a subject and a body, and nothing else.
Uri? mailDraft(Object? value) {
  if (value is! String || value.length > 8000) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.scheme != 'mailto' || uri.hasFragment) return null;
  try {
    if (Uri.decodeComponent(uri.path).toLowerCase() != feedbackAddress) return null;
    return uri.queryParametersAll.keys.every((key) => key == 'subject' || key == 'body') ? uri : null;
  } on ArgumentError {
    return null;
  } on FormatException {
    return null;
  }
}

class DesktopWebViewScreen extends StatefulWidget {
  const DesktopWebViewScreen({super.key});

  @override
  State<DesktopWebViewScreen> createState() => _DesktopWebViewScreenState();
}

class _DesktopWebViewScreenState extends State<DesktopWebViewScreen>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  final FlaskServerService _flask = FlaskServerService();
  Timer? _updateCheckTimer;

  // flutter_inappwebview has no Linux implementation, so on Linux the hub is
  // opened in the system browser instead of an embedded WebView.
  bool get _useEmbeddedWebView => !Platform.isLinux;
  bool _openedInBrowser = false;
  InAppWebViewController? _web;
  bool _asking = false;

  static const _notificationSettings = 'x-apple.systempreferences:com.apple.preference.notifications';

  String get _startScript => '''
(function () {
  var permission = "${NotificationService().permission}";
  function bridge(name, value) {
    if (!window.flutter_inappwebview || !window.flutter_inappwebview.callHandler) return Promise.resolve(null);
    return window.flutter_inappwebview.callHandler(name, value);
  }
  function Reminder(title, options) {
    bridge("notify", { title: String(title || ""), body: options && options.body ? String(options.body) : "" });
  }
  Object.defineProperty(Reminder, "permission", { get: function () { return permission; } });
  Reminder.requestPermission = function () {
    return bridge("notifyPermission", true).then(function (value) {
      permission = value || permission;
      return permission;
    });
  };
  window.Notification = Reminder;
  function encoded(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        resolve(text.slice(text.lastIndexOf(",") + 1));
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }
  function saveFile(name, content) {
    var blob = content instanceof Blob ? content : new Blob([content == null ? "" : content]);
    if (blob.size > ${Downloads.maxBytes}) return Promise.resolve(null);
    return encoded(blob).then(function (data) {
      return bridge("saveFile", { name: String(name || ""), data: data });
    });
  }
  window.hubShell = Object.freeze({
    nativeNotifications: true,
    openInBrowser: function () { return bridge("openInBrowser", true); },
    openMail: function (url) { return bridge("openMail", String(url || "")); },
    saveFile: saveFile${Platform.isMacOS ? _macShellScript : ''}
  });
})();
''';

  static const _macShellScript = ''',
    showFile: function (path) { return bridge("showFile", String(path || "")); },
    startAtLogin: function () { return bridge("loginItem", null); },
    setStartAtLogin: function (on) { return bridge("loginItem", on === true); },
    openLoginItems: function () { return bridge("loginItemSettings", true); },
    openNotificationSettings: function () { return bridge("notificationSettings", true); }''';

  late AnimationController _logoController;
  late AnimationController _textController;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _flask.state.addListener(_onStateChange);
    _startPeriodicUpdateCheck();

    _logoController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    _textController = AnimationController(
      duration: const Duration(milliseconds: 420),
      vsync: this,
    );

    _logoController.forward();
    Future.delayed(const Duration(milliseconds: 180), () {
      if (mounted) _textController.forward();
    });

    _flask.confirmLegacyImport = _askLegacyImport;
    _flask.start();
  }

  Future<bool> _askLegacyImport(String previousName) async {
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return false;
    final colors = _DesktopColors.of(context);
    final answer = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        title: Text(
          'Daten aus $previousName gefunden',
          style: TextStyle(color: colors.ink, fontWeight: FontWeight.w700, letterSpacing: -0.2),
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Text(
            'Im Ordner „Dokumente/$previousName“ liegen deine Daten aus der Zeit, '
            'als ${Brand.name} noch $previousName hieß. Soll ${Brand.name} sie übernehmen? '
            'Der alte Ordner bleibt als Sicherung, wie er ist.',
            style: TextStyle(color: colors.soft, fontSize: 15, height: 1.45),
          ),
        ),
        actionsPadding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(false),
            style: colors.quietButton,
            child: const Text('Neu anfangen'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: colors.primaryButton,
            child: const Text('Übernehmen'),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  @override
  void dispose() {
    _updateCheckTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _flask.state.removeListener(_onStateChange);
    _logoController.dispose();
    _textController.dispose();
    _flask.shutdown();
    super.dispose();
  }

  void _startPeriodicUpdateCheck() {
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted) _checkForUpdates();
    });
    _updateCheckTimer = Timer.periodic(const Duration(hours: 2), (_) {
      _checkForUpdates();
    });
  }

  Future<void> _checkForUpdates() async {
    final updateInfo = await UpdateService.checkForUpdate();
    if (updateInfo == null) return;
    await UpdateService.sendUpdateNotification(updateInfo);
    // Show the in-app dialog (with a working download button) — the desktop
    // notification tap path is unreliable, so this is the primary update UX.
    if (mounted) {
      await UpdateService.showUpdateDialog(context, updateInfo);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      _flask.shutdown();
    }
    if (state == AppLifecycleState.resumed) unawaited(_recheckPermission());
    // Back from the Python installer or the privacy settings: try again by itself.
    if (state == AppLifecycleState.resumed &&
        _flask.state.value == FlaskServerState.error &&
        (_flask.problem == StartProblem.pythonMissing || _flask.problem == StartProblem.documentsDenied)) {
      _flask.restart();
    }
  }

  // The page reads the permission from its start script, so a change made in the system settings renews it and reloads.
  Future<void> _recheckPermission() async {
    final controller = _web;
    final service = NotificationService();
    if (controller == null || _asking || !service.isInitialized) return;
    final known = service.permission;
    if (await service.refreshPermission() == known) return;
    try {
      await controller.removeAllUserScripts();
      await controller.addUserScript(userScript: UserScript(source: _startScript, injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START));
      await controller.reload();
    } catch (_) {}
  }

  void _onStateChange() {
    if (!mounted) return;
    // On Linux we cannot embed a WebView; open the hub in the browser once the
    // server is up.
    if (!_useEmbeddedWebView && _flask.isReady && !_openedInBrowser) {
      _openedInBrowser = true;
      _openHubInBrowser();
    }
    setState(() {});
  }

  Future<bool> _openHubInBrowser() async {
    if (!await _flask.confirmBackend()) return false;
    final code = await _flask.fetchLoginCode();
    final uri = Uri.tryParse(
        code == null ? _flask.hubUrl : '${_flask.hubUrl}?login_code=$code');
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    switch (_flask.state.value) {
      case FlaskServerState.idle:
      case FlaskServerState.starting:
        return _buildLoadingScreen();
      case FlaskServerState.error:
        return _buildErrorScreen();
      case FlaskServerState.ready:
      case FlaskServerState.alreadyRunning:
        return _useEmbeddedWebView
            ? _buildWebView()
            : _buildBrowserFallbackScreen();
    }
  }

  Widget _buildBrowserFallbackScreen() {
    return Builder(builder: (context) {
      final c = _DesktopColors.of(context);
      return AppBackground(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/logo.png', width: 80, height: 80, fit: BoxFit.contain),
                const SizedBox(height: 20),
                Text(
                  '${Brand.name} läuft',
                  style: TextStyle(color: c.ink, fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.4),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 40),
                  child: Text(
                    '${Brand.name} wurde in deinem Standard-Browser geöffnet.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: c.muted, fontSize: 15, height: 1.5),
                  ),
                ),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: _openHubInBrowser,
                  icon: const Icon(Icons.open_in_browser, size: 18),
                  label: const Text('Im Browser öffnen'),
                  style: c.primaryButton,
                ),
              ],
            ),
          ),
        ),
      );
    });
  }

  Widget _buildLoadingScreen() {
    return Builder(builder: (context) {
      final c = _DesktopColors.of(context);
      return AppBackground(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: _logoController,
                  builder: (context, child) {
                    final k = Curves.easeOutCubic.transform(_logoController.value);
                    return Opacity(
                      opacity: k,
                      child: Transform.scale(scale: .96 + .04 * k, child: child),
                    );
                  },
                  child: Image.asset('assets/logo.png', width: 88, height: 88, fit: BoxFit.contain),
                ),
                const SizedBox(height: 20),
                AnimatedBuilder(
                  animation: _textController,
                  builder: (context, child) {
                    final k = Curves.easeOutCubic.transform(_textController.value);
                    return Opacity(
                      opacity: k,
                      child: Transform.translate(offset: Offset(0, 6 * (1 - k)), child: child),
                    );
                  },
                  child: Text(
                    Brand.name,
                    style: TextStyle(color: c.ink, fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.4),
                  ),
                ),
                const SizedBox(height: 28),
                FadeTransition(
                  opacity: _textController,
                  child: Column(
                    children: [
                      SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: c.sage, backgroundColor: c.line),
                      ),
                      const SizedBox(height: 16),
                      ValueListenableBuilder<String>(
                        valueListenable: _flask.setupProgress,
                        builder: (context, progress, _) => Text(
                          progress.isEmpty ? StartText.starting : progress,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: c.muted, fontSize: 13, height: 1.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    });
  }

  ({String label, IconData icon, Uri target})? get _errorAction => switch (_flask.problem) {
        StartProblem.pythonMissing => (
            label: 'Python laden',
            icon: Icons.download_rounded,
            target: Uri.parse(Platform.isMacOS ? MacPython.installerUrl : 'https://www.python.org/downloads/'),
          ),
        StartProblem.documentsDenied => (
            label: 'Systemeinstellungen öffnen',
            icon: Icons.settings_outlined,
            target: Uri.parse(StartText.privacySettings),
          ),
        _ => null,
      };

  Widget _buildErrorScreen() {
    return Builder(builder: (context) {
      final c = _DesktopColors.of(context);
      final action = _errorAction;
      final detail = _flask.errorDetail;
      return AppBackground(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/logo.png', width: 80, height: 80, fit: BoxFit.contain),
                  const SizedBox(height: 20),
                  Text(
                    Brand.name,
                    style: TextStyle(color: c.ink, fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.4),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(20),
                    margin: const EdgeInsets.symmetric(horizontal: 40),
                    constraints: const BoxConstraints(maxWidth: 480),
                    decoration: BoxDecoration(
                      color: action == null ? c.urgentSoft : c.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: action == null ? c.urgent.withValues(alpha: .35) : c.line),
                    ),
                    child: Column(
                      children: [
                        Icon(
                          action == null ? Icons.error_outline : Icons.info_outline_rounded,
                          color: action == null ? c.urgent : c.ink,
                          size: 28,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _flask.errorMessage,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: c.soft, fontSize: 15, height: 1.5),
                        ),
                        if (detail != null && detail.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          SelectableText(
                            detail,
                            textAlign: TextAlign.center,
                            style: TextStyle(color: c.muted, fontSize: 12, height: 1.4, fontFamily: 'Menlo'),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (action != null) ...[
                    ElevatedButton.icon(
                      onPressed: () => launchUrl(action.target, mode: LaunchMode.externalApplication),
                      icon: Icon(action.icon, size: 18),
                      label: Text(action.label),
                      style: c.primaryButton,
                    ),
                    const SizedBox(height: 12),
                  ],
                  ElevatedButton.icon(
                    onPressed: () => _flask.restart(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Erneut versuchen'),
                    style: action == null ? c.primaryButton : c.quietButton,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }

  Widget _buildWebView() {
    return Scaffold(
      backgroundColor: Theme.of(context).brightness == Brightness.dark ? AppPalette.canvasDark : AppPalette.canvas,
      body: InAppWebView(
          initialUserScripts: UnmodifiableListView([
            UserScript(source: _startScript, injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START),
          ]),
          initialSettings: InAppWebViewSettings(
            javaScriptEnabled: true,
            domStorageEnabled: true,
            databaseEnabled: true,
            cacheEnabled: false,
            cacheMode: CacheMode.LOAD_NO_CACHE,
            supportZoom: false,
            transparentBackground: false,
            useShouldOverrideUrlLoading: true,
            allowFileAccessFromFileURLs: false,
            allowUniversalAccessFromFileURLs: false,
            allowsBackForwardNavigationGestures: false,
          ),
          onWebViewCreated: (controller) async {
            _web = controller;
            try {
              await InAppWebViewController.clearAllCache();
              await WebStorageManager.instance().deleteAllData();
            } catch (_) {}

            controller.addJavaScriptHandler(
              handlerName: 'notifyPermission',
              callback: (args) async {
                final service = NotificationService();
                if (!service.isInitialized) await service.initialize();
                if (service.permissionGranted) return 'granted';
                _asking = true;
                try {
                  return await service.requestPermissions() ? 'granted' : 'denied';
                } finally {
                  _asking = false;
                }
              },
            );
            controller.addJavaScriptHandler(
              handlerName: 'notificationSettings',
              callback: (args) async => Platform.isMacOS && await launchUrl(Uri.parse(_notificationSettings)),
            );
            controller.addJavaScriptHandler(
              handlerName: 'notify',
              callback: (args) async {
                final value = args.isNotEmpty && args.first is Map ? args.first as Map : const {};
                final title = '${value['title'] ?? ''}'.trim();
                if (title.isEmpty) return false;
                return NotificationService().showNotification(
                  id: DateTime.now().millisecondsSinceEpoch & 0x7fffffff,
                  title: title,
                  body: '${value['body'] ?? ''}',
                );
              },
            );
            controller.addJavaScriptHandler(
              handlerName: 'openInBrowser',
              callback: (args) => _openHubInBrowser(),
            );
            controller.addJavaScriptHandler(
              handlerName: 'openMail',
              callback: (args) async {
                final draft = mailDraft(args.isEmpty ? null : args.first);
                return draft != null && await launchUrl(draft, mode: LaunchMode.externalApplication);
              },
            );
            controller.addJavaScriptHandler(
              handlerName: 'saveFile',
              callback: (args) async {
                final value = args.isNotEmpty && args.first is Map ? args.first as Map : const {};
                try {
                  return (await Downloads.saveEncoded(value['name'], value['data']))?.toJson();
                } on PathAccessException {
                  return Platform.isMacOS ? const {'error': 'denied'} : null;
                }
              },
            );
            controller.addJavaScriptHandler(
              handlerName: 'showFile',
              callback: (args) => args.isNotEmpty && args.first is String ? Downloads.show(args.first as String) : false,
            );
            controller.addJavaScriptHandler(
              handlerName: 'loginItem',
              callback: (args) => LoginItem.change(args.isNotEmpty && args.first is bool ? args.first as bool : null),
            );
            controller.addJavaScriptHandler(
              handlerName: 'loginItemSettings',
              callback: (args) => LoginItem.openSettings(),
            );

            if (!await _flask.confirmBackend()) return;
            await controller.loadUrl(
              urlRequest: URLRequest(
                url: WebUri(_flask.hubUrl),
                headers: {
                  'Cache-Control': 'no-cache, no-store',
                  'X-Hub-Token': _flask.desktopToken,
                },
              ),
            );

            controller.addJavaScriptHandler(
              handlerName: 'showNativeNotification',
              callback: (args) async {
                if (args.isEmpty) return;
                final data = args[0] as Map<dynamic, dynamic>?;
                final title = data?['title']?.toString() ?? '';
                final body = data?['body']?.toString() ?? '';
                if (title.isNotEmpty) {
                  await NotificationService().showNotification(
                    id: title.hashCode ^ body.hashCode,
                    title: title,
                    body: body,
                  );
                }
              },
            );
          },
          shouldOverrideUrlLoading: (controller, navigationAction) async {
            final url = navigationAction.request.url?.toString() ?? '';

            if (_flask.isHubUrl(url)) {
              return NavigationActionPolicy.ALLOW;
            }

            if (url.startsWith('http://') || url.startsWith('https://')) {
              final uri = Uri.tryParse(url);
              if (uri != null) {
                launchUrl(uri, mode: LaunchMode.externalApplication);
              }
              return NavigationActionPolicy.CANCEL;
            }

            return NavigationActionPolicy.CANCEL;
          },
          onLoadStop: (controller, url) async {
            await controller.evaluateJavascript(source: '''
              (function() {
                var mc = document.querySelector('.main-content');
                if (mc && mc.style.opacity === '0') {
                  mc.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
                  mc.style.opacity = '1';
                  mc.style.transform = 'translateY(0)';
                }
              })();
            ''');
          },
          onReceivedError: (controller, request, error) {
            if (mounted) {
              setState(() {});
            }
          },
        ),
    );
  }
}

class _DesktopColors {
  const _DesktopColors(this.dark);

  factory _DesktopColors.of(BuildContext context) => _DesktopColors(Theme.of(context).brightness == Brightness.dark);

  final bool dark;

  Color get ink => dark ? AppPalette.inkDark : AppPalette.ink;
  Color get soft => dark ? AppPalette.inkSoftDark : AppPalette.inkSoft;
  Color get muted => dark ? AppPalette.inkMutedDark : AppPalette.inkMuted;
  Color get line => dark ? AppPalette.lineDark : AppPalette.line;
  Color get surface => dark ? AppPalette.surfaceDark : AppPalette.surface;
  Color get sage => dark ? AppPalette.sageDark : AppPalette.sage;
  Color get urgent => dark ? AppPalette.terracottaDark : AppPalette.terracotta;
  Color get urgentSoft => dark ? AppPalette.terracottaSoftDark : AppPalette.terracottaSoft;

  ButtonStyle get primaryButton => ElevatedButton.styleFrom(
        backgroundColor: dark ? AppPalette.brandDark : AppPalette.pine,
        foregroundColor: dark ? AppPalette.inkDark : AppPalette.chalk,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        shape: StadiumBorder(side: dark ? const BorderSide(color: Color(0xFF3E5541)) : BorderSide.none),
      );

  ButtonStyle get quietButton => ElevatedButton.styleFrom(
        backgroundColor: surface,
        foregroundColor: ink,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        shape: StadiumBorder(side: BorderSide(color: line)),
      );
}
