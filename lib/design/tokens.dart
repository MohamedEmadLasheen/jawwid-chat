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
    required this.colorAccentStrong,
    required this.colorAccentSubtle,
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
    required this.trialBadgeFg,
    required this.trialBadgeBg,
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

  /// The gold's decorative shade: indicators, rules, a pin star. Never text --
  /// accent-500 measures 3.40:1 on white (memory: gold is split by job).
  final Color colorAccent;

  /// The only gold that may carry text (accent-700 in light, a light gold in dark),
  /// and what is drawn on [colorAccentSubtle].
  final Color colorAccentStrong;

  /// A quiet gold ground: a selected chip, a notice.
  final Color colorAccentSubtle;

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

  // --- PD-32: the "Trial" label on a trial group ------------------------------------
  //
  // Its own violet pair rather than a status colour: a trial group is not a success, a
  // warning or a piece of information about state, and borrowing one of those would make
  // the label read as one. Measured in test/design/theme_contrast_test.dart.
  final Color trialBadgeFg;
  final Color trialBadgeBg;

  static const light = JawwidTokens(
    colorBackgroundPage: _neutral25,
    colorBackgroundSunken: _neutral50,
    colorSurfaceDefault: _neutral0,
    colorSurfaceRaised: _neutral0,
    colorSurfaceMuted: _neutral50,
    colorSurfaceInverse: _neutral800,
    colorTextPrimary: _neutral900,
    colorTextSecondary: _neutral600,
    // WCAG AA (2026-10-24): neutral-500 measured 4.37:1 on the brand-subtle ground
    // and 4.52:1 on sunken. This shade clears 5:1 on every light surface.
    colorTextMuted: _neutralMutedLight,
    colorTextInverse: _neutral0,
    colorTextLink: _primary600,
    colorBorderSubtle: _neutral100,
    colorBorderDefault: _neutral200,
    // The border that identifies a control (a text field, a switch track, a radio):
    // 3:1 against every light surface, as WCAG 1.4.11 asks of a UI component.
    // Decorative dividers stay on subtle/default.
    colorBorderStrong: _neutralControlLight,
    colorBorderFocus: _primary500,
    colorBrandPrimary: _primary500,
    colorBrandPrimaryHover: _primary600,
    colorBrandPrimaryPressed: _primary700,
    colorBrandOnPrimary: _neutral0,
    colorBrandSubtle: _primary50,
    colorAccent: _accent500,
    colorAccentStrong: _accent700,
    colorAccentSubtle: _accent50,
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
    trialBadgeFg: _violet800,
    trialBadgeBg: _violet100,
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
    // neutral-400 measured 3.63:1 on the raised surface; this clears 4.5:1 on all.
    colorTextMuted: _neutralMutedDark,
    colorTextInverse: _neutral900,
    colorTextLink: _primary300,
    colorBorderSubtle: Color(0xFF33302B),
    colorBorderDefault: Color(0xFF45413A),
    colorBorderStrong: _neutralControlDark,
    colorBorderFocus: _primary300,
    // A FILL in dark (white on it: 5.19:1). As text or a control's mark it
    // measures 2.83:1 on the dark surface, so the theme's `primary` role in dark
    // is colorTextLink -- see theme.dart.
    colorBrandPrimary: _primary500,
    colorBrandPrimaryHover: _primary600,
    colorBrandPrimaryPressed: _primary700,
    colorBrandOnPrimary: _neutral0,
    colorBrandSubtle: Color(0xFF0B2E2B),
    colorAccent: _accent500,
    colorAccentStrong: _accent200,
    colorAccentSubtle: Color(0xFF3A2A12),
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
    trialBadgeFg: _violet200,
    trialBadgeBg: _violet900,
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
  static const _neutral600 = Color(0xFF5A534B);
  static const _neutral700 = Color(0xFF423C36);
  static const _neutral800 = Color(0xFF2B2823);
  static const _neutral900 = Color(0xFF1A1815);
  // Between the ramp steps, chosen by measurement (test/design/theme_contrast_test.dart).
  static const _neutralMutedLight = Color(0xFF685F56);
  static const _neutralMutedDark = Color(0xFFB3ABA1);
  static const _neutralControlLight = Color(0xFF857C71);
  static const _neutralControlDark = Color(0xFF948B80);

  static const _primary50 = Color(0xFFE7F2F1);
  static const _primary300 = Color(0xFF66ABA4);
  static const _primary500 = Color(0xFF0F7A72);
  static const _primary600 = Color(0xFF0B635C);
  static const _primary700 = Color(0xFF084B46);

  static const _accent50 = Color(0xFFFBF1E2);
  static const _accent200 = Color(0xFFF0C98A);
  static const _accent500 = Color(0xFFC57A1E);
  static const _accent700 = Color(0xFF8A5310);

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

  static const _violet100 = Color(0xFFEDE9FE);
  static const _violet200 = Color(0xFFDDD6FE);
  static const _violet800 = Color(0xFF5B21B6);
  static const _violet900 = Color(0xFF3B2A6B);
}

/// §4 — 4px base grid. `spacing1` (2px) exists only for optical badge padding.
/// Story colours (2026-10-17): the eight backgrounds a text or voice story may have, and the
/// colours drawn over them. Identical in both themes -- a story is the publisher's artwork,
/// not app chrome -- and identical to Admin Web's preview (`apps/admin-web/src/features/
/// stories/stories.css`) and the database's `story_background_check`, so what the publisher
/// saw is what the reader gets. White text clears 3:1 (large text) on every background.
abstract final class StoryPalette {
  static const backgrounds = <String, List<Color>>{
    'teal': [Color(0xFF0B4856), Color(0xFF0E5A6B), Color(0xFF1B7487)],
    'gold': [Color(0xFF5C410F), Color(0xFF7A5716), Color(0xFF94691B)],
    'plum': [Color(0xFF3B2257), Color(0xFF57357E), Color(0xFF6D4597)],
    'ink': [Color(0xFF0D1A20), Color(0xFF13232A), Color(0xFF24363E)],
    'rose': [Color(0xFF7A1F42), Color(0xFF9C2F55), Color(0xFFB5476D)],
    'sky': [Color(0xFF123F69), Color(0xFF1D5A94), Color(0xFF2A6FAE)],
    'forest': [Color(0xFF143F28), Color(0xFF1E5B3A), Color(0xFF2A7049)],
    'sunset': [Color(0xFF7C2D12), Color(0xFFA83C0C), Color(0xFFC2510C)],
  };

  /// Words and controls drawn on a story background.
  static const onStory = Color(0xFFFFFFFF);

  /// The story's button: a white pill with dark text, readable over any photo.
  static const ctaSurface = Color(0xFFFFFFFF);
  static const ctaForeground = Color(0xFF13232A);
}

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

/// The call screen's own colours. The call screen is ALWAYS dark, in both app
/// themes, like a messenger's call screen: a call is a different mode from the
/// app around it. Named once here; white on each fill clears 4.5:1. The Admin
/// Web call window uses the same values (`features/calls/calls.css`).
abstract final class CallPalette {
  static const background = Color(0xFF111B21);
  static const panel = Color(0xFF1F2C33);
  static const foreground = Color(0xFFE9EDEF);
  static const muted = Color(0xFFAEBAC1);
  static const control = Color(0x1FFFFFFF);
  static const controlOn = Color(0xFFE9EDEF);
  static const hangUp = Color(0xFFD92D20);
  static const accept = Color(0xFF18794E);
  static const alert = Color(0xFFFFB4A8);

  /// Glyphs on a solid fill (End, Accept, Call again).
  static const onFill = Color(0xFFFFFFFF);
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

/// Sender names in a group chat, WhatsApp-style: one of eight colours, stable
/// per person. Each is at least 4.5:1 on the incoming, pending and highlighted
/// bubbles of its theme, and they are the same eight Admin Web's chat uses
/// (apps/admin-web/src/features/chat/chat.css), so a person reads the same
/// colour in every app.
abstract final class SenderNameColors {
  static const light = <Color>[
    Color(0xFFB4441C), Color(0xFF1F6FB2), Color(0xFF2A722E), Color(0xFF8E3FA6),
    Color(0xFFA8327A), Color(0xFF0F766E), Color(0xFF8A5A00), Color(0xFF4B55C4),
  ];
  static const dark = <Color>[
    Color(0xFFF4A27F), Color(0xFF7CB8F2), Color(0xFF86D18A), Color(0xFFD49AE6),
    Color(0xFFF08FC7), Color(0xFF5FD3C6), Color(0xFFE9BD5C), Color(0xFFA7AEF5),
  ];
}

/// Chat themes (owner decisions 2026-10-20): the viewer's OWN background for a
/// chat, as a soft two-stop gradient per theme, light and dark. The same eight
/// as Admin Web (apps/admin-web/src/features/chat/chat.css). Only the
/// background behind the messages changes; bubbles keep their checked colours.
abstract final class ChatThemePalette {
  /// The server's CHAT_THEMES, in display order.
  static const keys = <String>['lagoon', 'sand', 'rose', 'sky', 'lilac', 'olive', 'slate', 'dusk'];

  static const _light = <String, List<Color>>{
    'lagoon': [Color(0xFFE3F1EF), Color(0xFFD3E9E5)],
    'sand': [Color(0xFFF5EEDF), Color(0xFFEDE2CB)],
    'rose': [Color(0xFFF8E8EC), Color(0xFFF1D9E0)],
    'sky': [Color(0xFFE4EEF8), Color(0xFFD6E5F4)],
    'lilac': [Color(0xFFEEE8F7), Color(0xFFE3DAF2)],
    'olive': [Color(0xFFEBEFDF), Color(0xFFDFE6CC)],
    'slate': [Color(0xFFE8EBEE), Color(0xFFDADFE4)],
    'dusk': [Color(0xFFF6E7DD), Color(0xFFEED7C7)],
  };
  static const _dark = <String, List<Color>>{
    'lagoon': [Color(0xFF0F2624), Color(0xFF132E2B)],
    'sand': [Color(0xFF2A241A), Color(0xFF30291D)],
    'rose': [Color(0xFF2C1A20), Color(0xFF331F26)],
    'sky': [Color(0xFF15202C), Color(0xFF192634)],
    'lilac': [Color(0xFF221C2E), Color(0xFF282135)],
    'olive': [Color(0xFF1F241A), Color(0xFF252B1F)],
    'slate': [Color(0xFF1A1D21), Color(0xFF1F2328)],
    'dusk': [Color(0xFF2B1D16), Color(0xFF33231B)],
  };

  /// The gradient stops for [key] in this brightness; null for the default look
  /// or a key this build does not know.
  static List<Color>? stops(String? key, Brightness brightness) =>
      key == null ? null : (brightness == Brightness.dark ? _dark : _light)[key];

  /// Laid over a photo wallpaper so messages stay easy to read.
  static const photoScrimLight = Color(0x8CFFFFFF);
  static const photoScrimDark = Color(0x8C000000);
}

/// PD-39: the teacher whiteboard's colours (docs/product/pd039-whiteboard-design.md
/// §4.1, §4.2). A board is a page of paper, not app chrome, so it keeps these in
/// both app themes. The pens are eight clear inks that read on every page colour;
/// the Tajweed swatches are the four rules the highlighter offers by name, for
/// the academy's Quran teacher to confirm (design §4.1).
abstract final class BoardPalette {
  static const pens = <Color>[
    Color(0xFF1B1B1B), // ink
    Color(0xFFC62828), // red
    Color(0xFF1565C0), // blue
    Color(0xFF2E7D32), // green
    Color(0xFFEF6C00), // orange
    Color(0xFF6A1B9A), // purple
    Color(0xFF8D6E63), // brown
    Color(0xFFFFFFFF), // chalk (for the dark pages)
  ];

  /// The default ink, and what an element with a missing colour is drawn in.
  static const ink = Color(0xFF1B1B1B);

  /// Highlighter: madd, ghunnah, ikhfa', izhar.
  static const tajweedMadd = Color(0xFFE53935);
  static const tajweedGhunnah = Color(0xFF43A047);
  static const tajweedIkhfa = Color(0xFFFB8C00);
  static const tajweedIzhar = Color(0xFF1E88E5);

  /// Plain highlighter yellow.
  static const highlighter = Color(0xFFFDD835);

  /// Page colours: white, cream, grey, blackboard green, dark.
  static const pageWhite = Color(0xFFFFFFFF);
  static const pageCream = Color(0xFFFBF6E9);
  static const pageGrey = Color(0xFFEFF1F3);
  static const pageGreen = Color(0xFF1F4A3A);
  static const pageDark = Color(0xFF1D232A);

  /// Rulings, and the frame of an element this build does not draw.
  static const ruleOnLight = Color(0x475B7083);
  static const ruleOnDark = Color(0x38FFFFFF);
  static const placeholderOnLight = Color(0xFF5B7083);
  static const placeholderOnDark = Color(0xB3FFFFFF);

  /// Stamps: the reward gold and the praise green.
  static const stampGold = Color(0xFFF9A825);
  static const stampGreen = Color(0xFF2E7D32);

  /// Selection outline and handles.
  static const selection = Color(0xFF0E7C86);
}
