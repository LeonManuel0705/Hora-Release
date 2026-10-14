// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../services/site_icons.dart';
import '../theme.dart';

/// The logo of a bookmarked site on a light tile, and the first letter of the title until it is there or where there is none.
class BookmarkIcon extends StatefulWidget {
  final String url;
  final String title;

  const BookmarkIcon({super.key, required this.url, required this.title});

  @override
  State<BookmarkIcon> createState() => _BookmarkIconState();
}

class _BookmarkIconState extends State<BookmarkIcon> {
  late Future<Uint8List?> _icon = siteIcon(widget.url);
  bool _unreadable = false;

  @override
  void didUpdateWidget(BookmarkIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _icon = siteIcon(widget.url);
      _unreadable = false;
    }
  }

  Widget _letter() {
    final title = widget.title.trim();
    return Container(
      key: const ValueKey('letter'),
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: AppTheme.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: Text(
          title.isEmpty ? '?' : title.characters.first.toUpperCase(),
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: AppTheme.primary,
          ),
        ),
      ),
    );
  }

  Widget _logo(Uint8List bytes) {
    return Container(
      key: const ValueKey('logo'),
      width: 44,
      height: 44,
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Image.memory(
          bytes,
          fit: BoxFit.contain,
          gaplessPlayback: true,
          filterQuality: FilterQuality.medium,
          errorBuilder: (context, error, stackTrace) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) setState(() => _unreadable = true);
            });
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _icon,
      builder: (context, snapshot) {
        final bytes = _unreadable ? null : snapshot.data;
        return AnimatedSwitcher(
          duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 280),
          transitionBuilder: (child, animation) => FadeTransition(
            opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
            child: ScaleTransition(
              scale: Tween<double>(begin: 0.6, end: 1).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutBack)),
              child: child,
            ),
          ),
          child: bytes == null ? _letter() : _logo(bytes),
        );
      },
    );
  }
}
