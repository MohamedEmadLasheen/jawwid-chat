import 'package:flutter/material.dart';

import 'tokens.dart';
import 'typography.dart';

/// Jawwid's themes, assembled from [JawwidTokens] and [JawwidTypography].
///
/// The theme is locale-aware because the type scale is (see [JawwidTypography]), so it is
/// built per-locale rather than once at startup.
abstract final class JawwidTheme {
  static ThemeData light({required bool isArabic}) =>
      _build(JawwidTokens.light, Brightness.light, isArabic);

  static ThemeData dark({required bool isArabic}) =>
      _build(JawwidTokens.dark, Brightness.dark, isArabic);

  static ThemeData _build(
    JawwidTokens tokens,
    Brightness brightness,
    bool isArabic,
  ) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: tokens.colorBrandPrimary,
      onPrimary: tokens.colorBrandOnPrimary,
      primaryContainer: tokens.colorBrandSubtle,
      onPrimaryContainer: tokens.colorTextPrimary,
      secondary: tokens.colorAccent,
      onSecondary: tokens.colorBrandOnPrimary,
      surface: tokens.colorSurfaceDefault,
      onSurface: tokens.colorTextPrimary,
      surfaceContainerHighest: tokens.colorSurfaceMuted,
      onSurfaceVariant: tokens.colorTextSecondary,
      outline: tokens.colorBorderStrong,
      outlineVariant: tokens.colorBorderDefault,
      error: tokens.colorStatusDangerFg,
      onError: tokens.colorBrandOnPrimary,
      errorContainer: tokens.colorStatusDangerBg,
      onErrorContainer: tokens.colorStatusDangerFg,
      inverseSurface: tokens.colorSurfaceInverse,
      onInverseSurface: tokens.colorTextInverse,
    );

    final textTheme = JawwidTypography.textTheme(
      isArabic: isArabic,
      onSurface: tokens.colorTextPrimary,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      extensions: [tokens],
      textTheme: textTheme,
      scaffoldBackgroundColor: tokens.colorBackgroundPage,
      // §4: no blur, no glass, no gradients — all three are expensive on the low-end
      // Android devices that dominate the parent audience.
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: tokens.colorSurfaceDefault,
        foregroundColor: tokens.colorTextPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: textTheme.titleMedium,
        shape: Border(bottom: BorderSide(color: tokens.colorBorderSubtle)),
      ),
      dividerTheme: DividerThemeData(
        color: tokens.colorBorderSubtle,
        space: 1,
        thickness: 1,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: tokens.colorBrandPrimary,
          foregroundColor: tokens.colorBrandOnPrimary,
          minimumSize: const Size.fromHeight(Sizes.minTouchTarget),
          shape: const RoundedRectangleBorder(borderRadius: Radii.card),
          textStyle: JawwidTypography.button(isArabic),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: tokens.colorTextPrimary,
          minimumSize: const Size.fromHeight(Sizes.minTouchTarget),
          side: BorderSide(color: tokens.colorBorderDefault),
          shape: const RoundedRectangleBorder(borderRadius: Radii.card),
          textStyle: JawwidTypography.button(isArabic),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: tokens.colorTextLink,
          textStyle: JawwidTypography.button(isArabic),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: tokens.colorSurfaceDefault,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing5,
          vertical: Spacing.spacing4,
        ),
        labelStyle: textTheme.bodyMedium,
        hintStyle: textTheme.bodyMedium?.copyWith(color: tokens.colorTextMuted),
        border: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorBorderDefault),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorBorderDefault),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorBorderFocus, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorStatusDangerFg),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: tokens.colorSurfaceDefault,
        surfaceTintColor: Colors.transparent,
        indicatorColor: tokens.colorBrandSubtle,
        height: Sizes.tabBarHeight,
        // Icon *and* label, always — never icon-only (handoff §3).
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStatePropertyAll(JawwidTypography.caption(isArabic)),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(borderRadius: Radii.card),
        backgroundColor: tokens.colorSurfaceInverse,
        contentTextStyle:
            textTheme.bodyMedium?.copyWith(color: tokens.colorTextInverse),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: tokens.colorSurfaceDefault,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: Radii.sheet),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: tokens.colorSurfaceMuted,
        side: BorderSide(color: tokens.colorBorderDefault),
        shape: const StadiumBorder(),
        labelStyle: JawwidTypography.label(isArabic),
      ),
      listTileTheme: const ListTileThemeData(
        minVerticalPadding: Spacing.spacing4,
        horizontalTitleGap: Spacing.spacing4,
      ),
      // Page transitions stay at Flutter's per-platform defaults: on Android that is already
      // the cheap fade-forwards transition, and on iOS it is the native interactive back
      // swipe, which a custom builder would break.
    );
  }
}
