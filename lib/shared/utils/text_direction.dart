import 'package:flutter/widgets.dart';

import '../../design/tokens.dart';
import 'search_fold.dart';

/// Paragraph direction for a string whose language is not known in advance.
///
/// Flutter lays every paragraph out in the *ambient* direction, which is the app's UI
/// language. That is right for UI chrome and wrong for content: this product's UI can be in
/// English while every conversation in it is in Arabic, and the reverse. An Arabic sentence
/// laid out in an LTR paragraph puts its full stop on the left — the sentence still reads,
/// but it ends in the wrong place, and it is the single most recognisable sign that an app
/// was built LTR-first and mirrored afterwards.
///
/// A name or message is therefore laid out in *its own* direction, while the surrounding
/// row keeps the UI's direction.
///
/// **Why not `intl`'s `Bidi.detectRtlDirectionality`.** That counts RTL *words* and calls
/// the string RTL past a 40% threshold, so `'Jawwid · أحمد'` comes back RTL — and it treats
/// Arabic-Indic digits as strong, so a timestamp like `'١٢:٤٥'` flips a whole row. The rule
/// below is instead the first-strong-character rule from UAX #9, which is what `dir="auto"`
/// does on the web and what people's other apps therefore already do.
abstract final class TextDirectionOf {
  /// The direction [text] should be laid out in, decided by its first strong character —
  /// or `null` when it has none (digits, punctuation, an emoji) and should simply inherit.
  ///
  /// Returning `null` rather than guessing matters: a timestamp or a lone "👍" has no
  /// direction of its own and must follow the row it sits in.
  static TextDirection? forContent(String text) {
    for (final rune in text.runes) {
      if (_isStrongRtl(rune)) return TextDirection.rtl;
      if (_isStrongLtr(rune)) return TextDirection.ltr;
    }
    return null;
  }

  /// Arabic and Hebrew letters, plus the Arabic presentation forms.
  ///
  /// The gaps are deliberate. U+0600–060F are Arabic number signs, U+0660–0669 are
  /// Arabic-Indic digits, and U+064B–065F/U+0670 are the tashkeel marks — none of which is
  /// a strong character, and treating any of them as one is how "١٢:٤٥" ends up deciding
  /// the direction of a row.
  static bool _isStrongRtl(int rune) =>
      (rune >= 0x05D0 && rune <= 0x05F4) || // Hebrew
      (rune >= 0x0620 && rune <= 0x064A) || // Arabic letters
      (rune >= 0x066E && rune <= 0x066F) ||
      (rune >= 0x0671 && rune <= 0x06D3) ||
      rune == 0x06D5 ||
      (rune >= 0x06EE && rune <= 0x06EF) ||
      (rune >= 0x06FA && rune <= 0x06FF) ||
      (rune >= 0x0750 && rune <= 0x077F) || // Arabic Supplement
      (rune >= 0x08A0 && rune <= 0x08BF) || // Arabic Extended-A letters
      (rune >= 0xFB1D && rune <= 0xFDFF) || // Hebrew/Arabic presentation forms A
      (rune >= 0xFE70 && rune <= 0xFEFC); // Arabic presentation forms B

  /// Latin, Latin Extended, Greek and Cyrillic. Not exhaustive over Unicode by design —
  /// this app has two languages, and an unmatched string correctly falls through to the
  /// next rune and, eventually, to inheriting.
  static bool _isStrongLtr(int rune) =>
      (rune >= 0x0041 && rune <= 0x005A) ||
      (rune >= 0x0061 && rune <= 0x007A) ||
      (rune >= 0x00C0 && rune <= 0x02B8) ||
      (rune >= 0x0370 && rune <= 0x03FF) ||
      (rune >= 0x0400 && rune <= 0x04FF);
}

/// [Text] that lays itself out in the direction of what it is showing.
///
/// A drop-in replacement for [Text] at exactly the places that render user or backend
/// content — names, message previews — and nowhere else. UI chrome must keep following the
/// app's language.
class ContentText extends StatelessWidget {
  const ContentText(
    this.data, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
    this.textAlign,
    this.highlight,
    this.chips = const [],
  });

  final String data;

  /// PD-36: "@..." mentions to draw as chips, by UTF-16 offset into [data]. A chip is
  /// wrapped in Unicode isolates, so an Arabic name inside English text (or the reverse)
  /// keeps its own direction and never reorders the words around it. [mine] draws the
  /// viewer's own mention stronger. Ignored while a search [highlight] is shown.
  final List<({int start, int length, bool mine})> chips;

  /// While searching: the term to mark wherever it occurs (matched the way the
  /// server matches -- see `search_fold.dart`).
  final String? highlight;

  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;

  /// Overrides the leading-edge alignment this widget would otherwise choose. Set it only
  /// where the alignment is a deliberate design choice — a centred system message — never
  /// to hand-place a name or a preview.
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final direction = TextDirectionOf.forContent(data);
    final ranges = highlight == null ? const <(int, int)>[] : searchMatchRanges(data, highlight!);
    final align = textAlign ??
        (direction == null
            ? null
            : (direction == Directionality.of(context) ? TextAlign.start : TextAlign.end));

    if (ranges.isNotEmpty) {
      // The warning pair: its foreground is checked against its background,
      // so a mark reads on an incoming and an outgoing bubble alike.
      final tokens = JawwidTokens.of(context);
      final mark = TextStyle(
        backgroundColor: tokens.colorStatusWarningBg,
        color: tokens.colorStatusWarningFg,
        fontWeight: FontWeight.w600,
      );
      final spans = <TextSpan>[];
      var last = 0;
      for (final (start, end) in ranges) {
        if (start > last) spans.add(TextSpan(text: data.substring(last, start)));
        spans.add(TextSpan(text: data.substring(start, end), style: mark));
        last = end;
      }
      if (last < data.length) spans.add(TextSpan(text: data.substring(last)));
      return Text.rich(
        TextSpan(children: spans),
        style: style,
        maxLines: maxLines,
        overflow: overflow,
        textDirection: direction,
        textAlign: align,
      );
    }

    final fitting = [
      for (final c in chips)
        if (c.start >= 0 && c.length > 0 && c.start + c.length <= data.length) c,
    ]..sort((a, b) => a.start.compareTo(b.start));
    if (fitting.isNotEmpty) {
      final tokens = JawwidTokens.of(context);
      TextStyle chip(bool mine) => TextStyle(
            fontWeight: FontWeight.w700,
            color: tokens.colorAccentStrong,
            backgroundColor: mine ? tokens.colorAccentSubtle : null,
          );
      final spans = <TextSpan>[];
      var last = 0;
      for (final c in fitting) {
        if (c.start < last) continue; // overlapping: the first wins
        if (c.start > last) spans.add(TextSpan(text: data.substring(last, c.start)));
        spans.add(TextSpan(
          text: '\u2068${data.substring(c.start, c.start + c.length)}\u2069',
          style: chip(c.mine),
        ));
        last = c.start + c.length;
      }
      if (last < data.length) spans.add(TextSpan(text: data.substring(last)));
      return Text.rich(
        TextSpan(children: spans),
        style: style,
        maxLines: maxLines,
        overflow: overflow,
        textDirection: direction,
        textAlign: align,
      );
    }

    return Text(
      data,
      style: style,
      maxLines: maxLines,
      overflow: overflow,
      textDirection: direction,
      // The line still begins at the *row's* leading edge, so a list of mixed Arabic and
      // English names stays a straight column rather than a ragged zig-zag. Within an RTL
      // paragraph sitting in an LTR row, that edge is the paragraph's "end".
      textAlign: textAlign ??
          (direction == null
              ? null
              : (direction == Directionality.of(context)
                  ? TextAlign.start
                  : TextAlign.end)),
    );
  }
}
