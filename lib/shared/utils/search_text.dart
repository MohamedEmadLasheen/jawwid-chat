/// Text folding for search, written for an Arabic-first product.
///
/// Latin-only `toLowerCase().contains()` is the usual shortcut and it fails this audience
/// outright: a parent who types `احمد` must find `أحمد`, and a name stored with tashkeel
/// (`جَوِّد`) must be found by someone typing it without (`جود`). None of that is possible
/// without folding both sides of the comparison first.
///
/// Deliberately a pure function over a string, with no locale argument: a mixed
/// Arabic/Latin name is one string, and folding it must not depend on which language the
/// UI happens to be in.
abstract final class SearchText {
  /// Fold [input] to its comparable form.
  ///
  /// Applied to the haystack and the needle alike, so the two always meet in the same
  /// normalised space.
  static String fold(String input) {
    final buffer = StringBuffer();

    for (final rune in input.runes) {
      // Marks that carry no identity for search: tashkeel, superscript alef, the dagger
      // marks, and tatweel (the decorative kashida stretch).
      if (_isArabicDiacritic(rune) || rune == _tatweel) continue;

      buffer.writeCharCode(_foldRune(rune));
    }

    // Collapse runs of whitespace so "أحمد   ·  جود" and "أحمد · جود" match.
    return buffer.toString().trim().replaceAll(RegExp(r'\s+'), ' ');
  }

  /// Whether [haystack] contains [needle], both folded.
  ///
  /// Substring rather than prefix matching: group titles here are composed
  /// (`'<child> · <academy>'`), so a parent searching for the child's name is searching
  /// the middle of the string as often as the start.
  static bool matches(String haystack, String needle) {
    final folded = fold(needle);
    if (folded.isEmpty) return true;
    return fold(haystack).contains(folded);
  }

  static int _foldRune(int rune) {
    // Latin case folding. Arabic has no case, so this is safe to apply to every rune.
    if (rune >= 0x41 && rune <= 0x5A) return rune + 0x20;

    // Arabic-Indic and extended Arabic-Indic digits fold to ASCII, so a phone-free world
    // still lets someone search "٢٠٢٦" and "2026" interchangeably.
    if (rune >= 0x0660 && rune <= 0x0669) return rune - 0x0660 + 0x30;
    if (rune >= 0x06F0 && rune <= 0x06F9) return rune - 0x06F0 + 0x30;

    return switch (rune) {
      // Every hamza-bearing alef, plus the bare alef and alef maqsura, fold together:
      // users type whichever their keyboard offers and expect the same result.
      0x0622 || 0x0623 || 0x0625 || 0x0671 || 0x0672 || 0x0673 => 0x0627,
      // Alef maqsura → yaa, and farsi yeh → yaa.
      0x0649 || 0x06CC || 0x06D2 => 0x064A,
      // Taa marbuta → haa. Egyptian typing drops the dots constantly.
      0x0629 => 0x0647,
      // Standalone and seated hamza fold to a plain hamza rather than disappearing, so
      // "مسؤول" and "مسئول" meet.
      0x0624 || 0x0626 => 0x0621,
      // Farsi/Urdu keh and gaf variants that stand in for Arabic kaf.
      0x06A9 || 0x06AA => 0x0643,
      _ => rune,
    };
  }

  /// U+064B–U+0652 tashkeel, U+0653–U+0655 maddah/hamza marks, U+0670 superscript alef,
  /// and the U+06D6–U+06ED Quranic annotation marks — which matter a great deal in a Quran
  /// academy's content and not at all when matching a name.
  static bool _isArabicDiacritic(int rune) =>
      (rune >= 0x064B && rune <= 0x065F) ||
      rune == 0x0670 ||
      (rune >= 0x06D6 && rune <= 0x06ED);

  static const _tatweel = 0x0640;
}
