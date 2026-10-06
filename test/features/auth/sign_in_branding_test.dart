import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// The brand mark on the entry screen: bundled, paired, and role-blind.
//
// An asset PATH or a font family can be declared and still not ship -- that is
// exactly how the `ج` placeholder outlived the approved artwork, and how
// `fontFamily: 'IBM Plex Sans Arabic'` still resolves to the system face today.
// So these assert the bytes and the declaration, not the intention.
//
// The screen itself is not pumped. `SignInScreen` watches
// `authControllerProvider`, which throws until it is overridden, so rendering it
// needs a fake repository, a fake token store and a clear-local-data hook --
// three doubles that would exercise the auth wiring rather than the branding.
// The brand widget is private to the screen, so the honest proof of "which
// asset, chosen how" is over the source, in the same style as the
// attachment-signing proofs in `apps/api/test/unit/attachments/voice-storage.spec.ts`.

/// The `assets:` entries under `flutter:` in pubspec.yaml.
///
/// Read with a line scan rather than a YAML parser: `yaml` is only a transitive
/// dependency here, and adding one to read five lines would be a worse trade
/// than this.
List<String> _declaredAssets() {
  final lines = File('pubspec.yaml').readAsLinesSync();
  final out = <String>[];
  var inAssets = false;
  for (final line in lines) {
    final trimmed = line.trim();
    if (trimmed == 'assets:') {
      inAssets = true;
      continue;
    }
    if (!inAssets) continue;
    if (trimmed.startsWith('- ')) {
      out.add(trimmed.substring(2).trim());
    } else if (trimmed.isNotEmpty && !trimmed.startsWith('#')) {
      // Any other non-comment key ends the block.
      break;
    }
  }
  return out;
}

/// Width and height out of a PNG's IHDR, which is always the first chunk: an
/// 8-byte signature, then length and type, then two big-endian uint32s.
({int width, int height}) _pngSize(File file) {
  final bytes = file.readAsBytesSync();
  int at(int offset) =>
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
  return (width: at(16), height: at(20));
}

void main() {
  const lockup = 'assets/brand/jawwid-lockup-derived.png';
  const lockupDark = 'assets/brand/jawwid-lockup-dark-derived.png';

  final screen = File(
    'lib/features/auth/presentation/sign_in_screen.dart',
  ).readAsStringSync();

  group('the approved brand assets actually ship', () {
    final declared = _declaredAssets();

    test('pubspec declares both halves of the light/dark pair', () {
      expect(declared, contains(lockup));
      expect(declared, contains(lockupDark));
    });

    test('every declared brand asset exists on disk', () {
      for (final path in declared) {
        expect(
          File(path).existsSync(),
          isTrue,
          reason: '$path is declared but absent',
        );
      }
    });

    test('the two lockups are a pair: identical geometry, different ink', () {
      // They are swapped by brightness with no layout change, so geometry drift
      // between them would move the mark when the theme changes.
      expect(_pngSize(File(lockupDark)), equals(_pngSize(File(lockup))));
      // Same artwork, different ink -- so they must not be the same bytes.
      expect(
        File(lockupDark).readAsBytesSync(),
        isNot(equals(File(lockup).readAsBytesSync())),
      );
    });
  });

  group('the entry screen shows the mark, not a stand-in', () {
    test('the placeholder mark is gone', () {
      expect(screen, isNot(contains('Placeholder brand mark')));
      // The placeholder drew the first character of the product name inside a
      // tinted circle. Nothing should be doing that any more.
      expect(screen, isNot(contains('name.characters.first')));
    });

    test('both assets are referenced, and chosen by brightness', () {
      expect(screen, contains(lockup));
      expect(screen, contains(lockupDark));
      expect(
        screen,
        contains('Theme.of(context).brightness == Brightness.dark'),
      );
      expect(screen, contains('isDark ? _lockupDark : _lockup'));
    });

    test('the artwork is not announced twice', () {
      // The product name is rendered as real text directly below the lockup.
      expect(screen, contains('excludeFromSemantics: true'));
    });
  });

  group('branding is one implementation, not two', () {
    test('the entry screen never branches on role', () {
      // Parent and Teacher reach this screen before a role exists at all, and
      // nothing below it may reintroduce one: a role-conditional mark is the
      // first step towards a second brand.
      expect(screen, isNot(contains('UserRole')));
      expect(screen, isNot(contains('ParticipantRole')));
    });
  });
}
