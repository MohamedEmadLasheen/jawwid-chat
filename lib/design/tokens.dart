import 'package:flutter/widgets.dart';

/// The single source of truth for every raw design value in the app.
///
/// **Brand status:** Jawwid's official palette, logo, and typeface were not supplied with the
/// project brief. The values below are a deliberate, documented placeholder chosen to read as
/// a calm, professional Quran-academy product — *not* as WhatsApp, whose palette and branding
/// must not be copied (§54). Swapping in the real brand should be a change to this file
/// alone; nothing else in the app names a colour literal.
abstract final class JawwidColors {
  // --- Brand -------------------------------------------------------------------------
  /// Primary brand green. Placeholder pending official brand assets.
  static const brand = Color(0xFF11704F);
  static const brandDark = Color(0xFF0B5239);
  static const brandLight = Color(0xFF2E9B72);

  /// Warm secondary, used for highlights and the "important" affordances.
  static const accent = Color(0xFFC8974B);

  // --- Light surfaces ----------------------------------------------------------------
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF4F6F5);
  static const surfaceSunken = Color(0xFFE9EDEB);
  static const outline = Color(0xFFD5DBD8);

  static const textPrimary = Color(0xFF14201B);
  static const textSecondary = Color(0xFF5A6862);
  static const textOnBrand = Color(0xFFFFFFFF);

  // --- Dark surfaces -----------------------------------------------------------------
  static const surfaceDark = Color(0xFF111714);
  static const surfaceMutedDark = Color(0xFF1A221E);
  static const surfaceSunkenDark = Color(0xFF232D28);
  static const outlineDark = Color(0xFF36423B);

  static const textPrimaryDark = Color(0xFFEEF2F0);
  static const textSecondaryDark = Color(0xFFA3B0AA);

  // --- Semantic ----------------------------------------------------------------------
  static const danger = Color(0xFFB3261E);
  static const dangerDark = Color(0xFFF2B8B5);
  static const warning = Color(0xFF8A6100);
  static const success = Color(0xFF1B6C3A);
  static const info = Color(0xFF1B5E8A);

  // --- Message bubbles ---------------------------------------------------------------
  /// Outgoing bubble. A muted brand tint rather than WhatsApp's signature green.
  static const bubbleMine = Color(0xFFDCEFE5);
  static const bubbleMineDark = Color(0xFF1F3B30);
  static const bubbleTheirs = Color(0xFFF4F6F5);
  static const bubbleTheirsDark = Color(0xFF222C27);

  /// System/operational messages sit apart from the conversation (§27).
  static const bubbleSystem = Color(0xFFEFEAE0);
  static const bubbleSystemDark = Color(0xFF2A2721);
}

/// A 4pt spacing scale. Using a scale rather than ad-hoc numbers is what keeps RTL mirroring
/// predictable, because every gap is expressed the same way.
abstract final class Spacing {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}

abstract final class Radii {
  static const Radius sm = Radius.circular(6);
  static const Radius md = Radius.circular(10);
  static const Radius lg = Radius.circular(16);
  static const Radius pill = Radius.circular(999);

  static const BorderRadius bubble = BorderRadius.all(lg);
  static const BorderRadius card = BorderRadius.all(md);
  static const BorderRadius control = BorderRadius.all(sm);
}

/// Minimum interactive size. 48dp is the accessibility floor (§53) and also helps the
/// low-end Android audience, who are often tapping on small, low-resolution screens (§47).
abstract final class Sizes {
  static const double minTouchTarget = 48;
  static const double avatarSm = 32;
  static const double avatarMd = 40;
  static const double avatarLg = 56;
  static const double avatarXl = 96;
  static const double maxBubbleWidthFraction = 0.78;
}

/// Animation durations are kept short and few. §47 warns against unnecessary animation on
/// low-end devices, so anything longer than [medium] needs a specific justification.
abstract final class Motion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration medium = Duration(milliseconds: 200);
}
