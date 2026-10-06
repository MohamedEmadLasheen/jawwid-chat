import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../tokens.dart';

/// An identity avatar.
///
/// Falls back to initials rather than to a generic silhouette, because a list of identical
/// silhouettes is unreadable — and because there is no phone number or other identifier to
/// fall back to (§5).
///
/// Deliberately cheap to build: no shadows, no animation, and images are decoded at display
/// size so a long chat list stays affordable on low-end Android (§47).
class JawwidAvatar extends StatelessWidget {
  const JawwidAvatar({
    super.key,
    required this.displayName,
    this.imageUrl,
    this.size = Sizes.avatarMd,
    this.badge,
  });

  final String displayName;
  final String? imageUrl;
  final double size;

  /// Small overlay, e.g. a muted indicator.
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final pixels = (size * MediaQuery.devicePixelRatioOf(context)).round();

    final avatar = ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: url == null || url.isEmpty
            ? _Initials(displayName: displayName, size: size)
            : Image.network(
                url,
                fit: BoxFit.cover,
                cacheWidth: pixels,
                cacheHeight: pixels,
                errorBuilder: (context, _, _) =>
                    _Initials(displayName: displayName, size: size),
                loadingBuilder: (context, child, progress) => progress == null
                    ? child
                    : ColoredBox(color: JawwidTokens.of(context).colorSurfaceMuted),
              ),
      ),
    );

    if (badge == null) {
      // The name is already rendered next to the avatar in every current usage, so the
      // image itself is decorative to a screen reader (§53).
      return ExcludeSemantics(child: avatar);
    }

    return ExcludeSemantics(
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          avatar,
          PositionedDirectional(bottom: -2, end: -2, child: badge!),
        ],
      ),
    );
  }
}

class _Initials extends StatelessWidget {
  const _Initials({required this.displayName, required this.size});

  final String displayName;
  final double size;

  /// First letter of the first two words. Works for Arabic and Latin alike, and avoids
  /// slicing a grapheme cluster in half.
  static String initialsOf(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
    if (words.isEmpty) return '؟';

    final letters = words.take(2).map((w) => w.characters.first);
    return letters.join();
  }

  /// Stable per-name tint, so the same person keeps the same colour between sessions.
  ///
  /// Drawn from the brand and status foregrounds, all of which are contrast-checked against
  /// white in §2.2 — the initials sit on this colour, so it must stay legible.
  static Color tintFor(String name, JawwidTokens tokens) {
    final palette = [
      tokens.colorBrandPrimary,
      tokens.colorBrandPrimaryPressed,
      tokens.colorStatusInfoFg,
      tokens.colorStatusSuccessFg,
      tokens.colorTextSecondary,
    ];
    final hash = name.codeUnits.fold<int>(0, (acc, unit) => (acc * 31 + unit) & 0xFFFF);
    return palette[hash % palette.length];
  }

  /// Relative luminance, WCAG 2.1 §1.4.3.
  static double _luminance(Color c) {
    double channel(double v) =>
        v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  /// WCAG contrast ratio between two opaque colours.
  @visibleForTesting
  static double contrast(Color a, Color b) {
    final la = _luminance(a);
    final lb = _luminance(b);
    final hi = la > lb ? la : lb;
    final lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  /// The initials colour, chosen against the tint rather than assumed.
  ///
  /// The initials used to be `colorBrandOnPrimary` unconditionally, and the
  /// palette comment said the tints were contrast-checked against white. That
  /// check only ever held for the LIGHT token set: in dark, `colorStatusInfoFg`,
  /// `colorStatusSuccessFg` and `colorTextSecondary` resolve to near-white, so
  /// three avatars in five rendered white initials on a near-white circle --
  /// 1.14:1, 1.15:1 and 1.90:1. Readable is not a thing to assume once a token
  /// is allowed to flip with the theme.
  ///
  /// So the colour is measured, between the only two inks the design system
  /// already offers for this job. In LIGHT both resolve to white, so light-mode
  /// avatars are unchanged to the byte; in DARK `colorTextInverse` is the dark
  /// ink and wins on exactly the three light tints. The tint itself -- and so a
  /// person's colour -- is untouched.
  @visibleForTesting
  static Color inkFor(Color tint, JawwidTokens tokens) {
    final onPrimary = tokens.colorBrandOnPrimary;
    final inverse = tokens.colorTextInverse;
    return contrast(onPrimary, tint) >= contrast(inverse, tint)
        ? onPrimary
        : inverse;
  }

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final tint = tintFor(displayName, tokens);

    return ColoredBox(
      color: tint,
      child: Center(
        child: Text(
          initialsOf(displayName),
          textAlign: TextAlign.center,
          style: TextStyle(
            color: inkFor(tint, tokens),
            fontSize: size * 0.38,
            fontWeight: FontWeight.w600,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// Exposed for tests.
@visibleForTesting
String avatarInitialsOf(String name) => _Initials.initialsOf(name);

/// Exposed for tests: the per-name tint, unchanged by the contrast work.
@visibleForTesting
Color avatarTintFor(String name, JawwidTokens tokens) =>
    _Initials.tintFor(name, tokens);

/// Exposed for tests: the measured initials colour.
@visibleForTesting
Color avatarInkFor(Color tint, JawwidTokens tokens) =>
    _Initials.inkFor(tint, tokens);

/// Exposed for tests: the WCAG contrast ratio used to choose it.
@visibleForTesting
double avatarContrast(Color a, Color b) => _Initials.contrast(a, b);
