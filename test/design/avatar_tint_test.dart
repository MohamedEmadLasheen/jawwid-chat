import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';

/// Avatar tints have to work as SURFACES, in both themes.
///
/// The bug these tests exist for: the palette was assembled from status *foregrounds*.
/// A foreground is ink — in the dark theme it inverts to pale so it can be read on a dark
/// surface. An avatar uses the colour the other way round, as the surface, with white
/// initials on top. So three of five slots turned into near-white circles carrying white
/// letters at ~1.15:1, and a fourth (the deepest teal) was so dark it vanished into the
/// page instead. Both failures are invisible to a build and to the light theme.
///
/// Two thresholds, because a tint can fail in two opposite directions:
///   * against the INITIALS it must clear 4.5:1, or the letters cannot be read;
///   * against its own PAGE it must clear 2.0:1, or the circle cannot be seen.
void main() {
  /// WCAG relative luminance.
  double luminance(Color c) {
    double channel(double v) =>
        v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  double contrast(Color a, Color b) {
    final la = luminance(a), lb = luminance(b);
    final hi = math.max(la, lb), lo = math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  String hex(Color c) =>
      '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

  const themes = {'light': JawwidTokens.light, 'dark': JawwidTokens.dark};

  // -------------------------------------------------------------------------
  group('every tint is legible and visible, in both themes', () {
    themes.forEach((name, tokens) {
      test('$name: initials clear 4.5:1 on every tint', () {
        for (final tint in tokens.colorAvatarTints) {
          final ratio = contrast(tint, tokens.colorBrandOnPrimary);
          expect(ratio, greaterThanOrEqualTo(4.5),
              reason: '$name tint ${hex(tint)} gives initials only '
                  '${ratio.toStringAsFixed(2)}:1');
        }
      });

      test('$name: every tint separates from the page behind it', () {
        for (final tint in tokens.colorAvatarTints) {
          final ratio = contrast(tint, tokens.colorBackgroundPage);
          expect(ratio, greaterThanOrEqualTo(2.0),
              reason: '$name tint ${hex(tint)} sits at only '
                  '${ratio.toStringAsFixed(2)}:1 against the page — the circle disappears');
        }
      });
    });

    test('no dark tint is pale enough to read as a light-mode colour', () {
      // The reported symptom, stated directly. #E8F2F7 and #E4F2EA measured 0.86 and 0.85;
      // a real surface colour on this page sits far below that.
      for (final tint in JawwidTokens.dark.colorAvatarTints) {
        expect(luminance(tint), lessThan(0.25),
            reason: '${hex(tint)} is a pale tint on a dark canvas');
      }
    });

    test('no tint is so dark it reads as empty space', () {
      for (final tint in JawwidTokens.dark.colorAvatarTints) {
        expect(contrast(tint, JawwidTokens.dark.colorBackgroundPage),
            greaterThanOrEqualTo(2.0),
            reason: '${hex(tint)} is indistinguishable from the dark page');
      }
    });
  });

  // -------------------------------------------------------------------------
  group('light mode is unchanged', () {
    /// The exact five colours the previous hard-coded palette resolved to in the light
    /// theme, written out so a future edit to the token list cannot quietly restyle
    /// light-mode avatars while "only" fixing dark mode.
    const historicalLightPalette = [
      Color(0xFF0F7A72), // was colorBrandPrimary
      Color(0xFF084B46), // was colorBrandPrimaryPressed
      Color(0xFF14607F), // was colorStatusInfoFg
      Color(0xFF1E7A46), // was colorStatusSuccessFg
      Color(0xFF5A534B), // was colorTextSecondary
    ];

    test('the light palette is identical to the pre-fix one, slot for slot', () {
      expect(JawwidTokens.light.colorAvatarTints, historicalLightPalette);
    });

    test('a sample of names resolve to the same light colour as before', () {
      for (final name in [
        'Adam QA',
        'Mariam QA',
        'QA Admin',
        'Youssef QA',
        'ولي أمر',
        'أحمد · جوِّد',
      ]) {
        final before = historicalLightPalette[
            name.codeUnits.fold<int>(0, (a, u) => (a * 31 + u) & 0xFFFF) % 5];
        expect(avatarTintFor(name, JawwidTokens.light), before, reason: name);
      }
    });
  });

  // -------------------------------------------------------------------------
  group('the mapping stays deterministic and theme-stable', () {
    const names = ['Adam QA', 'Mariam QA', 'QA Admin', 'Youssef QA', 'ولي أمر'];

    test('the same name always lands on the same slot', () {
      for (final name in names) {
        final first = avatarTintFor(name, JawwidTokens.light);
        for (var i = 0; i < 5; i++) {
          expect(avatarTintFor(name, JawwidTokens.light), first, reason: name);
        }
      }
    });

    test('a name keeps its SLOT across themes, so identity survives a theme switch', () {
      // Not the same colour -- slot 1 legitimately differs -- but the same index, so a
      // person does not become a different colour family when the appearance changes.
      for (final name in names) {
        final light = JawwidTokens.light.colorAvatarTints
            .indexOf(avatarTintFor(name, JawwidTokens.light));
        final dark = JawwidTokens.dark.colorAvatarTints
            .indexOf(avatarTintFor(name, JawwidTokens.dark));
        expect(dark, light, reason: '$name moved slot between themes');
      }
    });

    test('both palettes have the same length — the hash depends on it', () {
      expect(JawwidTokens.dark.colorAvatarTints,
          hasLength(JawwidTokens.light.colorAvatarTints.length));
    });

    test('variety is preserved: the palette is not collapsed to one brand colour', () {
      for (final tokens in themes.values) {
        expect(tokens.colorAvatarTints.toSet(), hasLength(5),
            reason: 'duplicate tints reduce the variety the design provides');
      }
    });
  });

  // -------------------------------------------------------------------------
  group('the widget draws the token colour', () {
    for (final (label, tokens, theme) in [
      ('light', JawwidTokens.light, ThemeData.light()),
      ('dark', JawwidTokens.dark, ThemeData.dark()),
    ]) {
      testWidgets('$label: the rendered background is the tint for that name',
          (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: theme.copyWith(extensions: [tokens]),
            home: const Scaffold(
              body: Center(child: JawwidAvatar(displayName: 'Mariam QA')),
            ),
          ),
        );
        await tester.pump();

        final box = tester.widget<ColoredBox>(
          find.descendant(
            of: find.byType(JawwidAvatar),
            matching: find.byType(ColoredBox),
          ),
        );
        expect(box.color, avatarTintFor('Mariam QA', tokens));
        expect(tokens.colorAvatarTints, contains(box.color));
      });
    }
  });
}
