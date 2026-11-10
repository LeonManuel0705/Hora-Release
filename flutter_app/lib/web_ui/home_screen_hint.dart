// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:math' as math;

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
  static final _browsers = RegExp('CriOS|FxiOS|EdgiOS|OPiOS|OPT/|Ddg/|DuckDuckGo');

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

  String get tabLimits => safariVersion != null
      ? 'Im Safari-Tab gibt es keine Erinnerungen, und Safari kann deine Einträge nach etwa einer Woche ohne Besuch löschen.'
      : 'Im Browser-Tab gibt es keine Erinnerungen, und der Browser kann deine Einträge nach etwa einer Woche ohne Besuch löschen.';

  /// The buttons the first step names, in the order they are tapped.
  List<IconData> get shareGlyphs {
    if (insideApp) return const [Icons.explore_outlined];
    final safari = safariVersion;
    if (safari != null && safari >= 26 && name == 'iPhone') return const [Icons.more_horiz_rounded, Icons.ios_share];
    return const [Icons.ios_share];
  }

  /// Where Safari keeps the button of the first step, or null for browsers that each put it elsewhere.
  Alignment? get shareSpot {
    final safari = safariVersion;
    if (safari == null) return null;
    if (name == 'iPad') return Alignment.topRight;
    return safari >= 26 ? Alignment.bottomRight : Alignment.bottomCenter;
  }
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

class _HomeScreenHintState extends State<HomeScreenHint> with TickerProviderStateMixin {
  late final AnimationController _entrance = AnimationController(vsync: this, duration: const Duration(milliseconds: 640));
  late final AnimationController _steps = AnimationController(vsync: this, duration: const Duration(milliseconds: 640));
  late final AnimationController _nudge = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500));
  late final List<CurvedAnimation> _phases = _staggered(_entrance);
  late final List<CurvedAnimation> _stepPhases = _staggered(_steps);
  bool _guiding = false;

  bool get _still => MediaQuery.of(context).disableAnimations;

  static List<CurvedAnimation> _staggered(AnimationController parent) => [
        for (var index = 0; index < 4; index++)
          CurvedAnimation(parent: parent, curve: Interval(index * .12, index * .12 + .52, curve: Curves.easeOutCubic)),
      ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_entrance.isAnimating || _entrance.isCompleted) return;
    if (_still) {
      _entrance.value = 1;
    } else {
      _entrance.forward();
    }
  }

  @override
  void dispose() {
    for (final phase in [..._phases, ..._stepPhases]) {
      phase.dispose();
    }
    _entrance.dispose();
    _steps.dispose();
    _nudge.dispose();
    super.dispose();
  }

  void _guide() {
    setState(() => _guiding = true);
    if (_still) {
      _steps.value = 1;
      return;
    }
    _steps.forward(from: 0);
    _nudge.forward(from: 0);
  }

  Color _ink(bool dark) => dark ? AppPalette.inkDark : AppPalette.ink;

  Color _soft(bool dark) => dark ? AppPalette.inkSoftDark : AppPalette.inkSoft;

  Widget _rise(int index, Widget child, {bool step = false}) {
    final phase = (step ? _stepPhases : _phases)[index];
    return FadeTransition(
      opacity: phase,
      child: SlideTransition(position: Tween(begin: const Offset(0, .22), end: Offset.zero).animate(phase), child: child),
    );
  }

  Widget _glyphs(bool dark, List<IconData> glyphs) {
    final tint = dark ? AppPalette.lake.withValues(alpha: .9) : AppPalette.lake;
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(color: dark ? AppPalette.hoverDark : AppPalette.sunken, borderRadius: BorderRadius.circular(12)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var index = 0; index < glyphs.length; index++) ...[
            if (index > 0) Icon(Icons.chevron_right_rounded, size: 14, color: dark ? AppPalette.inkMutedDark : AppPalette.inkMuted),
            Icon(glyphs[index], size: 22, color: tint),
          ],
        ],
      ),
    );
  }

  Widget _step(bool dark, int number, List<IconData> glyphs, String text) {
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
          Expanded(child: Text(text, style: TextStyle(fontSize: 15, height: 1.35, fontWeight: FontWeight.w600, color: _ink(dark)))),
          const SizedBox(width: 10),
          _glyphs(dark, glyphs),
        ],
      ),
    );
  }

  BoxDecoration _sheet(bool dark) => BoxDecoration(
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
      );

  Widget _browserButton(bool dark) => TextButton(
        onPressed: () => Navigator.of(context).pop(),
        style: TextButton.styleFrom(
          foregroundColor: _soft(dark),
          minimumSize: const Size.fromHeight(46),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: AppTheme.fontFamily, fontSize: 15, fontWeight: FontWeight.w600),
        ),
        child: const Text('Im Browser weiter'),
      );

  Widget _intro(bool dark) {
    final note = widget.withData
        ? 'Deine Einträge von hier kommen nicht von selbst mit. Sichere sie vorher unter Einstellungen › Daten und lies die Datei in der App wieder ein.'
        : 'Was du hier einträgst, kommt nicht mit. Die App auf dem Home-Bildschirm fängt leer an.';
    return Dialog(
      key: const ValueKey('intro'),
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 400),
        clipBehavior: Clip.antiAlias,
        decoration: _sheet(dark),
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
                          Text(widget.device.subtitle, style: TextStyle(color: AppPalette.chalk.withValues(alpha: .8), fontSize: 15)),
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
                    _rise(0, Text(widget.device.tabLimits, style: TextStyle(fontSize: 16, height: 1.42, fontWeight: FontWeight.w600, color: _ink(dark)))),
                    const SizedBox(height: 10),
                    _rise(
                      1,
                      Text(
                        'Vom Home-Bildschirm aus bleiben deine Einträge, und ${Brand.name} erinnert dich, solange die App geöffnet ist.',
                        style: TextStyle(fontSize: 15, height: 1.45, color: _soft(dark)),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _rise(
                      2,
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: dark ? AppPalette.surfaceDark : AppPalette.sunken, borderRadius: BorderRadius.circular(14)),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.info_outline_rounded, size: 18, color: dark ? AppPalette.inkMutedDark : AppPalette.inkMuted),
                            const SizedBox(width: 10),
                            Expanded(child: Text(note, style: TextStyle(fontSize: 13.5, height: 1.4, color: _soft(dark)))),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
                child: _rise(
                  3,
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ElevatedButton(
                        onPressed: _guide,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: dark ? AppPalette.brandDark : AppPalette.pine,
                          foregroundColor: dark ? AppPalette.inkDark : AppPalette.chalk,
                          elevation: 0,
                          shadowColor: Colors.transparent,
                          minimumSize: const Size.fromHeight(50),
                          shape: StadiumBorder(side: dark ? const BorderSide(color: Color(0xFF3E5541)) : BorderSide.none),
                          textStyle: const TextStyle(fontFamily: AppTheme.fontFamily, fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                        child: const Text('Zum Home-Bildschirm hinzufügen', textAlign: TextAlign.center),
                      ),
                      const SizedBox(height: 4),
                      _browserButton(dark),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _arrow(bool dark, bool up) => ExcludeSemantics(
        child: AnimatedBuilder(
          animation: _nudge,
          builder: (context, child) {
            final t = _nudge.value;
            final lift = math.sin(t * math.pi * 3).abs() * 10 * (1 - t);
            return Transform.translate(offset: Offset(0, up ? -lift : lift), child: child);
          },
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: dark ? AppPalette.brandDark : AppPalette.pine,
              shape: BoxShape.circle,
              border: dark ? Border.all(color: const Color(0xFF3E5541)) : null,
              boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .22), blurRadius: 14, offset: const Offset(0, 6))],
            ),
            child: Icon(up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded, color: AppPalette.chalk, size: 22),
          ),
        ),
      );

  Widget _guideView(bool dark) {
    final device = widget.device;
    final size = MediaQuery.sizeOf(context);
    final spot = device.name == 'iPad' || size.height > size.width ? device.shareSpot : null;
    final up = spot != null && spot.y < 0;
    final card = Container(
      constraints: const BoxConstraints(maxWidth: 400),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
      decoration: _sheet(dark),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _rise(0, _step(dark, 1, device.shareGlyphs, device.shareStep), step: true),
          const SizedBox(height: 8),
          _rise(1, _step(dark, 2, const [Icons.add_box_outlined], device.addStep), step: true),
          const SizedBox(height: 12),
          _rise(
            2,
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                'Danach öffnest du ${Brand.name} über das neue Symbol auf dem Home-Bildschirm.',
                style: TextStyle(fontSize: 14, height: 1.4, color: _soft(dark)),
              ),
            ),
            step: true,
          ),
          const SizedBox(height: 4),
          _rise(3, _browserButton(dark), step: true),
        ],
      ),
    );
    final side = Alignment(spot?.x ?? 0, 0);
    return Material(
      key: const ValueKey('guide'),
      type: MaterialType.transparency,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Align(
          alignment: spot == null ? Alignment.center : (up ? Alignment.topCenter : Alignment.bottomCenter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (up) ...[Align(alignment: side, child: _arrow(dark, true)), const SizedBox(height: 10)],
              Align(alignment: side, child: card),
              if (spot != null && !up) ...[const SizedBox(height: 10), Align(alignment: side, child: _arrow(dark, false))],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return AnimatedSwitcher(
      duration: _still ? Duration.zero : const Duration(milliseconds: 280),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(scale: Tween(begin: .96, end: 1.0).animate(animation), child: child),
      ),
      child: _guiding ? _guideView(dark) : _intro(dark),
    );
  }
}
