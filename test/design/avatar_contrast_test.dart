import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';

// The avatar initials must be readable on every tint the palette can produce,
// in both themes.
//
// They used to be white unconditionally. That held while every tint was dark,
// which is true of the LIGHT token set -- but `colorStatusInfoFg`,
// `colorStatusSuccessFg` and `colorTextSecondary` all resolve to near-white in
// DARK, so three avatars in five were white on near-white. These assert the
// property rather than the three cases that happened to be broken, so a token
// that flips light in some future theme cannot reintroduce it quietly.

/// 4.5:1 — the body-text floor the design system sets (`design-system.md` §483).
/// Initials are text, so they are held to the text bar, not the 3:1 UI bar.
const _textContrastFloor = 4.5;

/// The five palette entries, named as the implementation names them.
List<(String, Color)> _palette(JawwidTokens t) => [
      ('colorBrandPrimary', t.colorBrandPrimary),
      ('colorBrandPrimaryPressed', t.colorBrandPrimaryPressed),
      ('colorStatusInfoFg', t.colorStatusInfoFg),
      ('colorStatusSuccessFg', t.colorStatusSuccessFg),
      ('colorTextSecondary', t.colorTextSecondary),
    ];

void main() {
  group('every palette entry carries readable initials', () {
    for (final (themeName, tokens) in [
      ('light', JawwidTokens.light),
      ('dark', JawwidTokens.dark),
    ]) {
      for (final (tokenName, tint) in _palette(tokens)) {
        test('$themeName / $tokenName clears $_textContrastFloor to 1', () {
          final ink = avatarInkFor(tint, tokens);
          final ratio = avatarContrast(ink, tint);
          expect(
            ratio,
            greaterThanOrEqualTo(_textContrastFloor),
            reason: '$themeName $tokenName: ink $ink on $tint is $ratio:1',
          );
        });
      }
    }
  });

  group('the ink is one of the two inks the system already has', () {
    for (final (themeName, tokens) in [
      ('light', JawwidTokens.light),
      ('dark', JawwidTokens.dark),
    ]) {
      test('$themeName never invents a colour', () {
        for (final (_, tint) in _palette(tokens)) {
          expect(
            avatarInkFor(tint, tokens),
            anyOf(equals(tokens.colorBrandOnPrimary), equals(tokens.colorTextInverse)),
          );
        }
      });
    }
  });

  group('light mode is untouched', () {
    test('every light tint still takes the white ink it always had', () {
      // Both candidate inks are white in the light theme, so this is not a
      // coincidence that could drift -- it is the same colour either way.
      for (final (name, tint) in _palette(JawwidTokens.light)) {
        expect(
          avatarInkFor(tint, JawwidTokens.light),
          equals(JawwidTokens.light.colorBrandOnPrimary),
          reason: 'light $name changed ink',
        );
      }
    });
  });

  group('dark mode flips only where it must', () {
    test('the two dark tints keep the light ink', () {
      const dark = JawwidTokens.dark;
      for (final tint in [dark.colorBrandPrimary, dark.colorBrandPrimaryPressed]) {
        expect(avatarInkFor(tint, dark), equals(dark.colorBrandOnPrimary));
      }
    });

    test('the three near-white tints take the dark ink', () {
      const dark = JawwidTokens.dark;
      for (final tint in [
        dark.colorStatusInfoFg,
        dark.colorStatusSuccessFg,
        dark.colorTextSecondary,
      ]) {
        expect(avatarInkFor(tint, dark), equals(dark.colorTextInverse));
      }
    });

    test('the cases that were unreadable now clear the floor by a margin', () {
      const dark = JawwidTokens.dark;
      for (final tint in [
        dark.colorStatusInfoFg,
        dark.colorStatusSuccessFg,
        dark.colorTextSecondary,
      ]) {
        // White on these measured 1.14, 1.15 and 1.90:1.
        expect(avatarContrast(dark.colorBrandOnPrimary, tint), lessThan(3.0));
        expect(avatarContrast(avatarInkFor(tint, dark), tint),
            greaterThanOrEqualTo(_textContrastFloor));
      }
    });
  });

  group('a person keeps their colour', () {
    test('the tint still comes only from the five palette entries', () {
      for (final tokens in [JawwidTokens.light, JawwidTokens.dark]) {
        final allowed = _palette(tokens).map((e) => e.$2).toSet();
        for (final name in [
          'QA Learner',
          'ولي أمر',
          'Admin A',
          'Layla Hassan',
          'QL',
          'Ahmed',
          'المشرفة المناوبة',
        ]) {
          expect(allowed, contains(avatarTintFor(name, tokens)));
        }
      }
    });

    test('the same name maps to the same tint every time', () {
      for (final name in ['QA Learner', 'QL', 'ولي أمر']) {
        final first = avatarTintFor(name, JawwidTokens.light);
        for (var i = 0; i < 5; i++) {
          expect(avatarTintFor(name, JawwidTokens.light), equals(first));
        }
      }
    });

    test('different names still spread across more than one tint', () {
      // The point of the palette is that a long list is not one colour.
      final seen = {
        for (final n in ['QA Learner', 'Qa Learner', 'QL', 'Ahmed', 'Layla', 'Jawwid'])
          avatarTintFor(n, JawwidTokens.dark),
      };
      expect(seen.length, greaterThan(1));
    });
  });

  group('the QL avatar specifically', () {
    test('is readable in both themes', () {
      for (final tokens in [JawwidTokens.light, JawwidTokens.dark]) {
        final tint = avatarTintFor('QL', tokens);
        expect(
          avatarContrast(avatarInkFor(tint, tokens), tint),
          greaterThanOrEqualTo(_textContrastFloor),
        );
      }
    });

    test('renders its initials', () {
      expect(avatarInitialsOf('QL'), 'Q');
      expect(avatarInitialsOf('QA Learner'), 'QL');
    });
  });

  testWidgets('the widget paints the measured ink, not a hardcoded white',
      (tester) async {
    const name = 'QA Learner';
    const tokens = JawwidTokens.dark;
    final tint = avatarTintFor(name, tokens);

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData(extensions: const [tokens]),
      home: const Scaffold(body: Center(child: JawwidAvatar(displayName: name))),
    ));

    final text = tester.widget<Text>(find.text(avatarInitialsOf(name)));
    expect(text.style?.color, equals(avatarInkFor(tint, tokens)));
    expect(find.byType(JawwidAvatar), findsOneWidget);
  });
}
