// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'package:flutter/material.dart';

import '../theme.dart';

class AppBackground extends StatelessWidget {
  final Widget child;
  final bool keepCenterClear;

  const AppBackground({
    super.key,
    required this.child,
    this.keepCenterClear = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ColoredBox(
      color: isDark ? AppPalette.canvasDark : AppPalette.canvas,
      child: child,
    );
  }
}
