import 'package:flutter/material.dart';

/// The Jawwid design system, materialised once.
///
/// Per `docs/design/handoff-mobile.md` §4 this is the **only** file in the app allowed to
/// contain a `Color(0x…)`, a raw spacing number, or a radius. Semantic names match
/// `design-system.md` §2–§5 verbatim, so a brand sign-off changes exactly one file.
///
/// **Two token families from §2 are deliberately absent: attention and workload** (and the
/// case-status family). Handoff rules 1 and 2 forbid a parent or teacher surface from ever
/// rendering an attention bucket, score, workload level, case type, or internal note. Not
/// defining those colours here is what makes that rule structural rather than a convention
/// somebody has to remember — there is simply no token to reach for.
@immutable
class JawwidTokens extends ThemeExtension<JawwidTokens> {
  const JawwidTokens({
    required this.colorBackgroundPage,
    required this.colorBackgroundSunken,
    required this.colorSurfaceDefault,
    required this.colorSurfaceRaised,
    required this.colorSurfaceMuted,
    required this.colorSurfaceInverse,
    required this.colorTextPrimary,
    required this.colorTextSecondary,
    required this.colorTextMuted,
    required this.colorTextInverse,
    required this.colorTextLink,
    required this.colorBorderSubtle,
    required this.colorBorderDefault,
    required this.colorBorderStrong,
    required this.colorBorderFocus,
    required this.colorBrandPrimary,
    required this.colorBrandPrimaryHover,
    required this.colorBrandPrimaryPressed,
    required this.colorBrandOnPrimary,
    required this.colorBrandSubtle,
    required this.colorAccent,
    required this.colorStatusSuccessFg,
    required this.colorStatusSuccessBg,
    required this.colorStatusWarningFg,
    required this.colorStatusWarningBg,
    required this.colorStatusDangerFg,
    required this.colorStatusDangerBg,
    required this.colorStatusInfoFg,
    required this.colorStatusInfoBg,
    required this.colorStatusNeutralFg,
    required this.colorStatusNeutralBg,
    required this.colorMessageIncomingBg,
    required this.colorMessageIncomingText,
    required this.colorMessageOutgoingBg,
    required this.colorMessageOutgoingText,
    required this.colorMessageSystemBg,
    required this.colorMessageSystemText,
    required this.colorMessagePendingBg,
    required this.colorMessageFailedBorder,
    required this.colorMediaSurface,
    required this.colorMediaOnSurface,
    required this.colorMediaOnSurfaceMuted,
    required this.colorMediaScrim,
    required this.colorMediaScrimStrong,
  });

  // --- §2.2 background / surface -----------------------------------------------------
  final Color colorBackgroundPage;
  final Color colorBackgroundSunken;
  final Color colorSurfaceDefault;
  final Color colorSurfaceRaised;
  final Color colorSurfaceMuted;
  final Color colorSurfaceInverse;

  // --- §2.2 text ---------------------------------------------------------------------
  final Color colorTextPrimary;
  final Color colorTextSecondary;
  final Color colorTextMuted;
  final Color colorTextInverse;
  final Color colorTextLink;

  // --- §2.2 border -------------------------------------------------------------------
  final Color colorBorderSubtle;
  final Color colorBorderDefault;
  final Color colorBorderStrong;
  final Color colorBorderFocus;

  // --- §2.2 brand --------------------------------------------------------------------
  final Color colorBrandPrimary;
  final Color colorBrandPrimaryHover;
  final Color colorBrandPrimaryPressed;
  final Color colorBrandOnPrimary;
  final Color colorBrandSubtle;
  final Color colorAccent;

  // --- §2.2 status -------------------------------------------------------------------
  final Color colorStatusSuccessFg;
  final Color colorStatusSuccessBg;
  final Color colorStatusWarningFg;
  final Color colorStatusWarningBg;
  final Color colorStatusDangerFg;
  final Color colorStatusDangerBg;
  final Color colorStatusInfoFg;
  final Color colorStatusInfoBg;
  final Color colorStatusNeutralFg;
  final Color colorStatusNeutralBg;

  // --- §2.6 message ------------------------------------------------------------------
  // The internal-note tokens from §2.6 are intentionally omitted: internal notes are an
  // admin surface and must never appear in this app.
  final Color colorMessageIncomingBg;
  final Color colorMessageIncomingText;
  final Color colorMessageOutgoingBg;
  final Color colorMessageOutgoingText;
  final Color colorMessageSystemBg;
  final Color colorMessageSystemText;
  final Color colorMessagePendingBg;
  final Color colorMessageFailedBorder;

  // --- media -------------------------------------------------------------------------
  //
  // The one place the palette does NOT follow the theme. A photo is judged
  // against what surrounds it, so a full-screen viewer is dark in both themes
  // and its chrome is light in both — a white ground under someone's photo is
  // the ground passing judgement on it. These are named tokens rather than
  // `Colors.black` at the call site so that the rule has a home and the
  // design-system guard keeps holding.
  final Color colorMediaSurface;
  final Color colorMediaOnSurface;
  final Color colorMediaOnSurfaceMuted;

  /// Laid over a photo that is still uploading.
  final Color colorMediaScrim;

  /// Laid over a photo whose upload failed, where the icon needs more contrast.
  final Color colorMediaScrimStrong;

  static const light = JawwidTokens(
    colorBackgroundPage: _neutral25,
    colorBackgroundSunken: _neutral50,
    colorSurfaceDefault: _neutral0,
    colorSurfaceRaised: _neutral0,
    colorSurfaceMuted: _neutral50,
    colorSurfaceInverse: _neutral800,
    colorTextPrimary: _neutral900,
    colorTextSecondary: _neutral600,
    colorTextMuted: _neutral500,
    colorTextInverse: _neutral0,
    colorTextLink: _primary600,
    colorBorderSubtle: _neutral100,
    colorBorderDefault: _neutral200,
    colorBorderStrong: _neutral300,
    colorBorderFocus: _primary500,
    colorBrandPrimary: _primary500,
    colorBrandPrimaryHover: _primary600,
    colorBrandPrimaryPressed: _primary700,
    colorBrandOnPrimary: _neutral0,
    colorBrandSubtle: _primary50,
    colorAccent: _accent500,
    colorStatusSuccessFg: _green600,
    colorStatusSuccessBg: _green100,
    colorStatusWarningFg: _amber600,
    colorStatusWarningBg: _amber100,
    colorStatusDangerFg: _red600,
    colorStatusDangerBg: _red100,
    colorStatusInfoFg: _blue600,
    colorStatusInfoBg: _blue100,
    colorStatusNeutralFg: _neutral600,
    colorStatusNeutralBg: _neutral100,
    colorMessageIncomingBg: _neutral0,
    colorMessageIncomingText: _neutral900,
    colorMessageOutgoingBg: _primary50,
    colorMessageOutgoingText: Color(0xFF06322E),
    colorMessageSystemBg: _neutral50,
    colorMessageSystemText: _neutral600,
    colorMessagePendingBg: _neutral50,
    colorMessageFailedBorder: _red600,
    colorMediaSurface: Color(0xFF000000),
    colorMediaOnSurface: Color(0xFFFFFFFF),
    colorMediaOnSurfaceMuted: Color(0xB3FFFFFF),
    colorMediaScrim: Color(0x40000000),
    colorMediaScrimStrong: Color(0x61000000),
  );

  /// §2.7 — mobile honours the system setting, so every token has a dark value and none is
  /// defined only inside a dark block.
  static const dark = JawwidTokens(
    colorBackgroundPage: _neutral900,
    colorBackgroundSunken: Color(0xFF121110),
    colorSurfaceDefault: _neutral800,
    colorSurfaceRaised: _neutral700,
    colorSurfaceMuted: Color(0xFF211F1C),
    colorSurfaceInverse: _neutral50,
    colorTextPrimary: Color(0xFFF5F3F0),
    colorTextSecondary: _neutral300,
    colorTextMuted: _neutral400,
    colorTextInverse: _neutral900,
    colorTextLink: _primary300,
    colorBorderSubtle: Color(0xFF33302B),
    colorBorderDefault: Color(0xFF45413A),
    colorBorderStrong: _neutral600,
    colorBorderFocus: _primary300,
    colorBrandPrimary: _primary500,
    colorBrandPrimaryHover: _primary600,
    colorBrandPrimaryPressed: _primary700,
    colorBrandOnPrimary: _neutral0,
    colorBrandSubtle: Color(0xFF0B2E2B),
    colorAccent: _accent500,
    colorStatusSuccessFg: _green100,
    colorStatusSuccessBg: _green700,
    colorStatusWarningFg: _amber100,
    colorStatusWarningBg: _amber700,
    colorStatusDangerFg: _red100,
    colorStatusDangerBg: _red700,
    colorStatusInfoFg: _blue100,
    colorStatusInfoBg: _blue700,
    colorStatusNeutralFg: _neutral300,
    colorStatusNeutralBg: _neutral700,
    colorMessageIncomingBg: _neutral800,
    colorMessageIncomingText: Color(0xFFF5F3F0),
    colorMessageOutgoingBg: Color(0xFF0B2E2B),
    colorMessageOutgoingText: Color(0xFFDCEFE5),
    colorMessageSystemBg: Color(0xFF211F1C),
    colorMessageSystemText: _neutral300,
    colorMessagePendingBg: Color(0xFF211F1C),
    colorMessageFailedBorder: _red500,
    colorMediaSurface: Color(0xFF000000),
    colorMediaOnSurface: Color(0xFFFFFFFF),
    colorMediaOnSurfaceMuted: Color(0xB3FFFFFF),
    colorMediaScrim: Color(0x40000000),
    colorMediaScrimStrong: Color(0x61000000),
  );

  /// Read the tokens for the current theme.
  static JawwidTokens of(BuildContext context) =>
      Theme.of(context).extension<JawwidTokens>() ?? light;

  @override
  JawwidTokens copyWith() => this;

  @override
  JawwidTokens lerp(ThemeExtension<JawwidTokens>? other, double t) {
    // The palette is a discrete pair, not a continuum: snapping at the midpoint avoids
    // interpolating dozens of colours on every theme change, which is wasted work on the
    // low-end devices this app targets (§9 of the handoff).
    if (other is! JawwidTokens) return this;
    return t < 0.5 ? this : other;
  }

  // --- §2.1 raw ramps. Referenced only by the two maps above, never used directly. ----
  static const _neutral0 = Color(0xFFFFFFFF);
  static const _neutral25 = Color(0xFFFBFAF8);
  static const _neutral50 = Color(0xFFF5F3F0);
  static const _neutral100 = Color(0xFFEBE8E3);
  static const _neutral200 = Color(0xFFDCD7D0);
  static const _neutral300 = Color(0xFFC2BBB2);
  static const _neutral400 = Color(0xFF9C948A);
  static const _neutral500 = Color(0xFF776E64);
  static const _neutral600 = Color(0xFF5A534B);
  static const _neutral700 = Color(0xFF423C36);
  static const _neutral800 = Color(0xFF2B2823);
  static const _neutral900 = Color(0xFF1A1815);

  static const _primary50 = Color(0xFFE7F2F1);
  static const _primary300 = Color(0xFF66ABA4);
  static const _primary500 = Color(0xFF0F7A72);
  static const _primary600 = Color(0xFF0B635C);
  static const _primary700 = Color(0xFF084B46);

  static const _accent500 = Color(0xFFC57A1E);

  static const _red100 = Color(0xFFFBE9E7);
  static const _red500 = Color(0xFFC4362C);
  static const _red600 = Color(0xFFB3261E);
  static const _red700 = Color(0xFF8C1D17);

  static const _amber100 = Color(0xFFFCF1DC);
  static const _amber600 = Color(0xFF9A6100);
  static const _amber700 = Color(0xFF7A4D00);

  static const _green100 = Color(0xFFE4F2EA);
  static const _green600 = Color(0xFF1E7A46);
  static const _green700 = Color(0xFF176037);

  static const _blue100 = Color(0xFFE8F2F7);
  static const _blue600 = Color(0xFF14607F);
  static const _blue700 = Color(0xFF0F4A62);
}

/// §4 — 4px base grid. `spacing1` (2px) exists only for optical badge padding.
abstract final class Spacing {
  static const double spacing0 = 0;
  static const double spacing1 = 2;
  static const double spacing2 = 4;
  static const double spacing3 = 8;
  static const double spacing4 = 12;
  static const double spacing5 = 16;
  static const double spacing6 = 20;
  static const double spacing7 = 24;
  static const double spacing8 = 32;
  static const double spacing9 = 40;
  static const double spacing10 = 48;
  static const double spacing11 = 64;

  /// Mobile grid: `space.5` gutters and page padding.
  static const double pagePadding = spacing5;
}

/// §4 — radii.
abstract final class Radii {
  static const Radius radiusSm = Radius.circular(6);
  static const Radius radiusMd = Radius.circular(10);
  static const Radius radiusLg = Radius.circular(14);
  static const Radius radiusXl = Radius.circular(20);
  static const Radius radiusFull = Radius.circular(999);

  /// The one corner of a bubble nearest its author.
  static const Radius radiusBubbleTail = Radius.circular(4);

  static const BorderRadius card = BorderRadius.all(radiusMd);
  static const BorderRadius control = BorderRadius.all(radiusSm);
  static const BorderRadius sheet = BorderRadius.vertical(top: radiusXl);
}

/// §5 — motion. Lists never animate.
abstract final class Motion {
  static const Duration motionInstant = Duration.zero;
  static const Duration motionFast = Duration(milliseconds: 120);
  static const Duration motionBase = Duration(milliseconds: 200);
  static const Duration motionSlow = Duration(milliseconds: 280);

  static const Curve easingStandard = Cubic(0.2, 0, 0, 1);
  static const Curve easingExit = Cubic(0.4, 0, 1, 1);

  /// Collapse to instant when the platform asks for reduced motion.
  static Duration respecting(BuildContext context, Duration duration) =>
      MediaQuery.disableAnimationsOf(context) ? motionInstant : duration;
}

/// Sizes that are not in the token spec but follow from it plus the accessibility floor.
abstract final class Sizes {
  /// 48dp accessibility floor for anything tappable.
  static const double minTouchTarget = 48;
  static const double avatarSm = 32;
  static const double avatarMd = 40;
  static const double avatarLg = 56;
  static const double avatarXl = 96;

  /// Bottom tab bar, before safe-area inset.
  static const double tabBarHeight = 56;

  static const double maxBubbleWidthFraction = 0.78;
}
