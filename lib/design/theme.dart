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
    // EVERY role is named. A role left out of this constructor falls back to
    // another (secondaryContainer -> secondary, onSecondaryContainer ->
    // onSecondary, surfaceContainer* -> surface ...), and those fallbacks put
    // white text on the gold accent (3.40:1) wherever Material reached for a
    // container -- a selected chip, a notice. test/design/theme_contrast_test.dart
    // measures every on-X / X pair below against WCAG AA.
    //
    // The gold is split by job: `secondary` is the text-capable gold
    // (accent-700 in light), `colorAccent` stays decorative.
    final dark = brightness == Brightness.dark;
    final scheme = ColorScheme(
      brightness: brightness,
      // In dark, teal-500 is a fill only (2.83:1 as text on the dark surface);
      // the role Material uses for headings, radios, switches and badges is the
      // light teal, with dark ink on it.
      primary: dark ? tokens.colorTextLink : tokens.colorBrandPrimary,
      onPrimary: dark ? tokens.colorTextInverse : tokens.colorBrandOnPrimary,
      primaryContainer: tokens.colorBrandSubtle,
      onPrimaryContainer: tokens.colorTextPrimary,
      secondary: tokens.colorAccentStrong,
      onSecondary: dark ? tokens.colorTextInverse : tokens.colorSurfaceDefault,
      secondaryContainer: tokens.colorAccentSubtle,
      onSecondaryContainer: dark ? tokens.colorAccentStrong : tokens.colorTextPrimary,
      tertiary: tokens.colorStatusInfoFg,
      onTertiary: dark ? tokens.colorTextInverse : tokens.colorSurfaceDefault,
      tertiaryContainer: tokens.colorStatusInfoBg,
      onTertiaryContainer: dark ? tokens.colorStatusInfoFg : tokens.colorTextPrimary,
      surface: tokens.colorSurfaceDefault,
      onSurface: tokens.colorTextPrimary,
      surfaceDim: tokens.colorBackgroundSunken,
      surfaceBright: tokens.colorSurfaceDefault,
      surfaceContainerLowest: dark ? tokens.colorBackgroundSunken : tokens.colorSurfaceDefault,
      surfaceContainerLow: dark ? tokens.colorBackgroundPage : tokens.colorBackgroundPage,
      surfaceContainer: tokens.colorSurfaceMuted,
      surfaceContainerHigh: tokens.colorSurfaceDefault,
      surfaceContainerHighest: tokens.colorSurfaceMuted,
      onSurfaceVariant: tokens.colorTextSecondary,
      outline: tokens.colorBorderStrong,
      outlineVariant: tokens.colorBorderDefault,
      error: tokens.colorStatusDangerFg,
      onError: dark ? tokens.colorTextInverse : tokens.colorSurfaceDefault,
      errorContainer: tokens.colorStatusDangerBg,
      onErrorContainer: tokens.colorStatusDangerFg,
      inverseSurface: tokens.colorSurfaceInverse,
      onInverseSurface: tokens.colorTextInverse,
      inversePrimary: dark ? tokens.colorBrandSubtle : tokens.colorTextLink,
      surfaceTint: Colors.transparent,
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
        // A text field is identified by its border, so the border is a UI
        // component and needs 3:1 (WCAG 1.4.11) -- colorBorderDefault was 1.43:1.
        border: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorBorderStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.control,
          borderSide: BorderSide(color: tokens.colorBorderStrong),
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
        // Stated, not inherited. Material resolves a selected destination's icon
        // from `onSecondaryContainer`; this scheme never sets that, so it fell
        // back to `onSecondary` -- white -- in BOTH themes. On the light
        // indicator (#E7F2F1) white measures 1.14:1, which is less a colour
        // choice than an invisible icon.
        //
        // So the selected icon is brand-tinted per theme, from tokens that
        // already exist: gold on the dark indicator (4.29:1) and the brand teal
        // on the light one (4.54:1). Gold cannot serve both -- on #E7F2F1 it
        // measures 2.97:1 and misses the 3:1 the design system asks of a UI
        // element (`design-system.md` §483). That is the same reason the login
        // lockup ships as a light/dark pair rather than one asset.
        //
        // Unselected does not move: `colorTextSecondary` is the token behind
        // `onSurfaceVariant`, which is exactly what Material already resolved.
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (!states.contains(WidgetState.selected)) {
            return IconThemeData(color: tokens.colorTextSecondary);
          }
          return IconThemeData(
            color: brightness == Brightness.dark
                ? tokens.colorAccent
                : tokens.colorBrandPrimary,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) => JawwidTypography.caption(isArabic).copyWith(
              color: states.contains(WidgetState.selected) ? tokens.colorTextPrimary : tokens.colorTextSecondary,
            )),
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
      // A theme's chip labelStyle REPLACES Material's default rather than merging
      // into it, so a style with no colour drew every plain Chip's label in the
      // engine's default -- white on the light pill: the Schedule's unreadable
      // "Upcoming". The colour is stated, per state.
      chipTheme: ChipThemeData(
        backgroundColor: tokens.colorSurfaceMuted,
        disabledColor: tokens.colorSurfaceMuted,
        selectedColor: scheme.secondaryContainer,
        side: BorderSide(color: tokens.colorBorderStrong),
        shape: const StadiumBorder(),
        labelStyle: JawwidTypography.label(isArabic).copyWith(
          color: WidgetStateColor.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) return tokens.colorTextMuted;
            if (states.contains(WidgetState.selected)) return scheme.onSecondaryContainer;
            return tokens.colorTextPrimary;
          }),
        ),
        checkmarkColor: scheme.onSecondaryContainer,
        iconTheme: IconThemeData(color: tokens.colorTextSecondary, size: 18),
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
