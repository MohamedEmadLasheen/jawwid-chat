import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../shared/utils/signed_url.dart';
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
    this.imageHeaders,
    this.trustedBaseUrl,
    this.size = Sizes.avatarMd,
    this.badge,
  });

  final String displayName;
  final String? imageUrl;

  /// Headers for [imageUrl], when the image is behind authentication.
  ///
  /// Private object storage needs BOTH: the URL's signature authorizes the
  /// object and an Authorization header authenticates the caller. `Image.network`
  /// sends no credential of its own, so without this a private avatar 401s and
  /// silently falls back to initials. Null for every public or data URL, which is
  /// every other caller.
  final Map<String, String>? imageHeaders;

  /// The API base this build talks to: the ONLY origin [imageHeaders] may reach.
  ///
  /// Passed in rather than read here because `design` does not import `core`, and because
  /// the configured API base is already the one source of truth for where this app sends
  /// credentials. Null fails closed — no header goes anywhere, and a relative URL is left
  /// unresolved so the failure is visible rather than silently credentialled.
  final String? trustedBaseUrl;

  final double size;

  /// Small overlay, e.g. a muted indicator.
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final pixels = (size * MediaQuery.devicePixelRatioOf(context)).round();

    // Resolved AND judged in one place: a relative application path becomes absolute
    // against the configured base, and only then can its origin be compared.
    final request = (url == null || url.isEmpty)
        ? (url: '', trusted: false)
        : applicationImageRequest(url, appBaseUrl: trustedBaseUrl);

    final avatar = ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: url == null || url.isEmpty
            ? _Initials(displayName: displayName, size: size)
            : Image.network(
                request.url,
                // Sent ONLY to the origin this build was configured to talk to: an S3
                // presigned URL carries SigV4 in its query string, and S3 --
                // MinIO included -- rejects a request that ALSO sends an
                // `Authorization` header. `Image.network` then fails and the
                // initials below take over, which on screen is indistinguishable
                // from "the photo never changed". The reference storage is the
                // opposite and still needs it. And a non-SigV4 URL on a FOREIGN
                  // host looked exactly like that second case while being neither
                  // ours nor signed -- which is what the origin check now stops. This
                // widget owns both values, which is why the decision lives here
                // rather than at each call site.
                headers: request.trusted ? imageHeaders : null,
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
  /// The palette is a token role of its own ([JawwidTokens.colorAvatarTints]) rather than a
  /// list assembled here from status foregrounds. It used to be the latter, and that was
  /// wrong in a way only the dark theme revealed: a status foreground is INK, so in dark it
  /// inverts to pale in order to be readable *on* a surface — while an avatar uses the
  /// colour *as* the surface, with initials drawn on top. Three of the five slots became
  /// near-white circles.
  ///
  /// The hash is unchanged, so everybody keeps the slot they already had.
  ///
  /// [inkFor] still MEASURES the initials colour against whichever tint comes back. The two
  /// are belt and braces, not duplicates: the palette is built so white ink works, and the
  /// measurement is what keeps that true if a token is ever edited to be light again.
  ///
  /// Drawn from the brand and status foregrounds, all of which are contrast-checked against
  /// white in §2.2 — the initials sit on this colour, so it must stay legible.
  static Color tintFor(String name, JawwidTokens tokens) {
    final palette = tokens.colorAvatarTints;
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
