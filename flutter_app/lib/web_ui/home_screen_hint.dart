// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../brand.dart';
import '../theme.dart';

const homeScreenHintKey = 'home_screen_hint_seen';

class HomeScreenDevice {
  const HomeScreenDevice({required this.agent, required this.touchPoints, required this.platform, required this.standalone});

  final String agent;
  final int touchPoints;
  final String platform;
  final bool standalone;

  String? get name {
    if (agent.contains('iPad') || (touchPoints > 1 && platform.contains('Mac'))) return 'iPad';
    if (agent.contains('iPhone') || agent.contains('iPod')) return 'iPhone';
    return null;
  }

  bool get inBrowserTab => name != null && !standalone;

  static final _apps = RegExp('GSA/|FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Line/|Pinterest');
  static final _browsers = RegExp('CriOS|FxiOS|EdgiOS|OPiOS|OPT/|Ddg/|DuckDuckGo|Brave');

  bool get insideApp => !agent.contains('Safari/') || _apps.hasMatch(agent);

  int? get safariVersion {
    if (insideApp || _browsers.hasMatch(agent)) return null;
    return int.tryParse(RegExp(r'Version/(\d+)').firstMatch(agent)?.group(1) ?? '');
  }

  String get subtitle => insideApp || safariVersion != null ? 'Zwei Schritte in Safari' : 'Zwei Schritte im Browser';

  String get shareStep {
    if (insideApp) return 'Öffne die Seite in Safari, meist über „…“ oder „In Safari öffnen“.';
    final safari = safariVersion;
    if (safari == null) return 'Tippe im Browser auf Teilen.';
    if (name == 'iPad') return 'Tippe oben auf Teilen.';
    return safari >= 26 ? 'Tippe neben der Adresse auf „…“ und dann auf Teilen.' : 'Tippe unten auf Teilen.';
  }

  String get addStep => insideApp ? 'Tippe dort auf Teilen und dann auf „Zum Home-Bildschirm“.' : 'Wähle „Zum Home-Bildschirm“.';
}

Future<bool> homeScreenHintDue(HomeScreenDevice device) async {
  if (!device.inBrowserTab) return false;
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool(homeScreenHintKey) != true;
}

Future<void> showHomeScreenHint(BuildContext context, HomeScreenDevice device, {required bool withData}) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => HomeScreenHint(device: device, withData: withData),
  );
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(homeScreenHintKey, true);
}

class HomeScreenHint extends StatefulWidget {
  const HomeScreenHint({super.key, required this.device, required this.withData});

  final HomeScreenDevice device;
  final bool withData;

  @override
  State<HomeScreenHint> createState() => _HomeScreenHintState();
}

class _HomeScreenHintState extends State<HomeScreenHint> with SingleTickerProviderStateMixin {
  late final AnimationController _entrance = AnimationController(vsync: this, duration: const Duration(milliseconds: 640));
  late final List<CurvedAnimation> _phases = [
    for (var index = 0; index < 4; index++)
      CurvedAnimation(parent: _entrance, curve: Interval(index * .12, index * .12 + .52, curve: Curves.easeOutCubic)),
  ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_entrance.isAnimating || _entrance.isCompleted) return;
    if (MediaQuery.of(context).disableAnimations) {
      _entrance.value = 1;
    } else {
      _entrance.forward();
    }
  }

  @override
  void dispose() {
    for (final phase in _phases) {
      phase.dispose();
    }
    _entrance.dispose();
    super.dispose();
  }

  Widget _rise(int index, Widget child) => FadeTransition(
        opacity: _phases[index],
        child: SlideTransition(position: Tween(begin: const Offset(0, .22), end: Offset.zero).animate(_phases[index]), child: child),
      );

  Widget _step(bool dark, int number, IconData glyph, String text) {
    final ink = dark ? AppPalette.inkDark : AppPalette.ink;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
      decoration: BoxDecoration(
        color: dark ? AppPalette.surfaceDark : AppPalette.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: dark ? AppPalette.lineDark : AppPalette.line),
      ),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: dark ? AppPalette.sageSoftDark : AppPalette.sageSoft, shape: BoxShape.circle),
            child: Text('$number', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: dark ? AppPalette.sageDark : AppPalette.sageInk)),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: TextStyle(fontSize: 15, height: 1.35, fontWeight: FontWeight.w600, color: ink))),
          const SizedBox(width: 10),
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: dark ? AppPalette.hoverDark : AppPalette.sunken, borderRadius: BorderRadius.circular(12)),
            child: Icon(glyph, size: 22, color: dark ? AppPalette.lake.withValues(alpha: .9) : AppPalette.lake),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final soft = dark ? AppPalette.inkSoftDark : AppPalette.inkSoft;
    final device = widget.device.name ?? 'Gerät';
    final note = widget.withData
        ? 'Deine Einträge von hier kommen nicht von selbst mit. Sichere sie vorher unter Einstellungen › Daten und lies die Datei in der App wieder ein.'
        : 'Was du hier einträgst, kommt nicht mit. Die App auf dem Home-Bildschirm fängt leer an.';
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 400),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: dark ? AppPalette.overlayDark : AppPalette.overlay,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: dark ? AppPalette.lineDark : AppPalette.line),
          boxShadow: [
            BoxShadow(
              color: dark ? Colors.black.withValues(alpha: .5) : const Color(0xFF14201A).withValues(alpha: .18),
              blurRadius: 36,
              spreadRadius: -10,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(18, 22, 18, 20),
                color: dark ? AppPalette.heroDark : AppPalette.pine,
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: AppPalette.chalk.withValues(alpha: .12), borderRadius: BorderRadius.circular(14)),
                      child: const Icon(Icons.add_to_home_screen_rounded, color: AppPalette.chalk, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Semantics(
                            header: true,
                            child: const Text(
                              'Auf den Home-Bildschirm',
                              style: TextStyle(color: AppPalette.chalk, fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -0.3),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            widget.device.subtitle,
                            style: TextStyle(color: AppPalette.chalk.withValues(alpha: .8), fontSize: 15),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _rise(
                      0,
                      Text(
                        'Als App vom Home-Bildschirm bleibt alles gespeichert, auch wenn du ${Brand.name} eine Woche nicht öffnest. '
                        'Erinnerungen gibt es auf dem $device nur dort, solange die App offen ist.',
                        style: TextStyle(fontSize: 15, height: 1.45, color: soft),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _rise(1, _step(dark, 1, Icons.ios_share, widget.device.shareStep)),
                    const SizedBox(height: 8),
                    _rise(2, _step(dark, 2, Icons.add_box_outlined, widget.device.addStep)),
                    const SizedBox(height: 12),
                    _rise(
                      3,
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: dark ? AppPalette.hoverDark : AppPalette.sunken, borderRadius: BorderRadius.circular(14)),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.info_outline_rounded, size: 18, color: dark ? AppPalette.inkMutedDark : AppPalette.inkMuted),
                            const SizedBox(width: 10),
                            Expanded(child: Text(note, style: TextStyle(fontSize: 13.5, height: 1.4, color: soft))),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: dark ? AppPalette.brandDark : AppPalette.pine,
                    foregroundColor: dark ? AppPalette.inkDark : AppPalette.chalk,
                    elevation: 0,
                    shadowColor: Colors.transparent,
                    minimumSize: const Size.fromHeight(50),
                    shape: StadiumBorder(side: dark ? const BorderSide(color: Color(0xFF3E5541)) : BorderSide.none),
                    textStyle: const TextStyle(fontFamily: AppTheme.fontFamily, fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  child: const Text('Im Browser weiter'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
