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

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return ColoredBox(
      color: tintFor(displayName, tokens),
      child: Center(
        child: Text(
          initialsOf(displayName),
          textAlign: TextAlign.center,
          style: TextStyle(
            color: tokens.colorBrandOnPrimary,
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
