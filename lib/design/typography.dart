import 'package:flutter/material.dart';

/// §3 of `design-system.md`, materialised.
///
/// The type scale is locale-sensitive by design: Arabic needs more leading than Latin at the
/// same size, so every token carries both line heights and the active one is chosen from the
/// locale. Rendering Arabic at Latin leading is the single most visible Arabic-first mistake
/// — diacritics clip against the line above.
abstract final class JawwidTypography {
  /// §3.1. IBM Plex Sans Arabic is one family with genuinely matched Arabic and Latin
  /// designs, so a mixed string sits on one baseline.
  ///
  /// The font files are **not yet bundled** — see `pubspec.yaml`. Until they are, the
  /// fallbacks below carry the app, and they are mandatory regardless: Arabic must render
  /// correctly before any custom font loads.
  static const fontFamily = 'IBM Plex Sans Arabic';

  static const fontFamilyFallback = <String>[
    'IBM Plex Sans',
    '.SF Arabic',
    'SF Pro Text',
    'Segoe UI',
    'Roboto',
    'Noto Sans Arabic',
    'Noto Naskh Arabic',
  ];

  /// One entry of the §3.2 scale.
  static TextStyle _style({
    required double size,
    required FontWeight weight,
    required double lhLatin,
    required double lhArabic,
    required bool isArabic,
  }) {
    return TextStyle(
      fontSize: size,
      fontWeight: weight,
      // Flutter's `height` is a multiple of font size, so convert from the spec's px value.
      height: (isArabic ? lhArabic : lhLatin) / size,
      fontFamilyFallback: fontFamilyFallback,
      leadingDistribution: TextLeadingDistribution.even,
    );
  }

  static TextStyle display(bool ar) =>
      _style(size: 28, weight: FontWeight.w700, lhLatin: 36, lhArabic: 40, isArabic: ar);

  static TextStyle h1(bool ar) =>
      _style(size: 22, weight: FontWeight.w700, lhLatin: 30, lhArabic: 34, isArabic: ar);

  static TextStyle h2(bool ar) =>
      _style(size: 18, weight: FontWeight.w600, lhLatin: 26, lhArabic: 30, isArabic: ar);

  static TextStyle h3(bool ar) =>
      _style(size: 16, weight: FontWeight.w600, lhLatin: 24, lhArabic: 28, isArabic: ar);

  /// Mobile message text.
  static TextStyle bodyLg(bool ar) =>
      _style(size: 17, weight: FontWeight.w400, lhLatin: 26, lhArabic: 30, isArabic: ar);

  static TextStyle body(bool ar) =>
      _style(size: 15, weight: FontWeight.w400, lhLatin: 24, lhArabic: 28, isArabic: ar);

  static TextStyle bodySm(bool ar) =>
      _style(size: 13, weight: FontWeight.w400, lhLatin: 20, lhArabic: 24, isArabic: ar);

  static TextStyle label(bool ar) =>
      _style(size: 13, weight: FontWeight.w600, lhLatin: 18, lhArabic: 22, isArabic: ar);

  /// Timestamps and metadata. 12px is the floor — nothing smaller exists in the system.
  static TextStyle caption(bool ar) =>
      _style(size: 12, weight: FontWeight.w500, lhLatin: 18, lhArabic: 20, isArabic: ar);

  static TextStyle button(bool ar) =>
      _style(size: 15, weight: FontWeight.w600, lhLatin: 20, lhArabic: 24, isArabic: ar);

  /// Map the scale onto Flutter's [TextTheme] slots.
  static TextTheme textTheme({required bool isArabic, required Color onSurface}) {
    TextStyle t(TextStyle style) => style.copyWith(color: onSurface);

    return TextTheme(
      displaySmall: t(display(isArabic)),
      headlineMedium: t(display(isArabic)),
      titleLarge: t(h1(isArabic)),
      titleMedium: t(h2(isArabic)),
      titleSmall: t(h3(isArabic)),
      bodyLarge: t(bodyLg(isArabic)),
      bodyMedium: t(body(isArabic)),
      bodySmall: t(bodySm(isArabic)),
      labelLarge: t(button(isArabic)),
      labelMedium: t(label(isArabic)),
      labelSmall: t(caption(isArabic)),
    );
  }
}
