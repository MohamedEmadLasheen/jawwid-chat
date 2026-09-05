import 'package:flutter/material.dart';

import 'tokens.dart';

/// Jawwid's Material 3 themes.
///
/// Two things here are load-bearing beyond ordinary styling:
///
/// * **Arabic-capable type.** The font stack must fall back to a face with full Arabic
///   coverage on both platforms, or long Arabic names render in tofu on some Android builds
///   (§45).
/// * **Generous line height.** Arabic diacritics need vertical room; the tight leading that
///   looks good in English clips them.
abstract final class JawwidTheme {
  /// Platform fallbacks with Arabic coverage, in preference order.
  static const _fontFallback = <String>[
    'SF Arabic', // iOS 16+
    'Geeza Pro', // older iOS
    'Noto Sans Arabic', // Android
    'Noto Naskh Arabic',
    'Arial',
  ];

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final scheme = ColorScheme.fromSeed(
      seedColor: JawwidColors.brand,
      brightness: brightness,
    ).copyWith(
      primary: isDark ? JawwidColors.brandLight : JawwidColors.brand,
      onPrimary: JawwidColors.textOnBrand,
      secondary: JawwidColors.accent,
      surface: isDark ? JawwidColors.surfaceDark : JawwidColors.surface,
      onSurface: isDark ? JawwidColors.textPrimaryDark : JawwidColors.textPrimary,
      surfaceContainerHighest:
          isDark ? JawwidColors.surfaceSunkenDark : JawwidColors.surfaceSunken,
      outlineVariant: isDark ? JawwidColors.outlineDark : JawwidColors.outline,
      error: isDark ? JawwidColors.dangerDark : JawwidColors.danger,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor:
          isDark ? JawwidColors.surfaceDark : JawwidColors.surfaceMuted,
      splashFactory: InkSparkle.splashFactory,
    );

    return base.copyWith(
      textTheme: _textTheme(base.textTheme, scheme),
      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? JawwidColors.surfaceDark : JawwidColors.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        space: 1,
        thickness: 1,
      ),
      listTileTheme: const ListTileThemeData(
        minVerticalPadding: Spacing.md,
        horizontalTitleGap: Spacing.md,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(Sizes.minTouchTarget),
          shape: const RoundedRectangleBorder(borderRadius: Radii.control),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(Sizes.minTouchTarget),
          shape: const RoundedRectangleBorder(borderRadius: Radii.control),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? JawwidColors.surfaceMutedDark : JawwidColors.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.lg,
          vertical: Spacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: scheme.error),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(borderRadius: Radii.control),
        backgroundColor: isDark ? JawwidColors.surfaceSunkenDark : const Color(0xFF23302A),
        contentTextStyle: const TextStyle(color: Colors.white),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: const StadiumBorder(),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      // Page transitions are left at Flutter's per-platform defaults: on Android that is
      // already the cheap fade-forwards transition §47 asks for, and on iOS it is the
      // native interactive back swipe, which a custom builder would break.
    );
  }

  static TextTheme _textTheme(TextTheme base, ColorScheme scheme) {
    TextStyle? style(TextStyle? from, {double height = 1.45}) => from?.copyWith(
          fontFamilyFallback: _fontFallback,
          height: height,
          color: scheme.onSurface,
        );

    return base.copyWith(
      titleLarge: style(base.titleLarge, height: 1.3),
      titleMedium: style(base.titleMedium, height: 1.3),
      titleSmall: style(base.titleSmall, height: 1.3),
      bodyLarge: style(base.bodyLarge),
      bodyMedium: style(base.bodyMedium),
      bodySmall: style(base.bodySmall),
      labelLarge: style(base.labelLarge, height: 1.2),
      labelMedium: style(base.labelMedium, height: 1.2),
      labelSmall: style(base.labelSmall, height: 1.2),
    );
  }
}
