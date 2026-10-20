import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/typography.dart';

/// The brand face has to be *named*, not just shipped.
///
/// `JawwidTypography.fontFamily` existed from the day the design system landed, but
/// nothing ever set it on a style and no font file was bundled — so every string in the
/// product rendered in the platform fallback while the build stayed green and the
/// constant sat there looking correct. Two halves have to agree for the brand face to
/// reach the screen, and a compile can't check either: the styles must name the family,
/// and `pubspec.yaml` must bundle a file for every weight those styles ask for.
///
/// These tests fail if either half goes missing again.
void main() {
  const family = 'IBM Plex Sans Arabic';

  /// The weights §3.2 actually uses. A style asking for a weight with no bundled file
  /// does not fail — the engine silently synthesises it, which is the failure mode this
  /// whole file exists to catch.
  const usedWeights = {400, 500, 600, 700};

  // -------------------------------------------------------------------------
  group('every style names the brand family', () {
    test('each token in the scale carries fontFamily, in both scripts', () {
      for (final isArabic in [false, true]) {
        final styles = <String, TextStyle>{
          'display': JawwidTypography.display(isArabic),
          'h1': JawwidTypography.h1(isArabic),
          'h2': JawwidTypography.h2(isArabic),
          'h3': JawwidTypography.h3(isArabic),
          'bodyLg': JawwidTypography.bodyLg(isArabic),
          'body': JawwidTypography.body(isArabic),
          'bodySm': JawwidTypography.bodySm(isArabic),
          'label': JawwidTypography.label(isArabic),
          'caption': JawwidTypography.caption(isArabic),
          'button': JawwidTypography.button(isArabic),
        };

        styles.forEach((name, style) {
          expect(style.fontFamily, family,
              reason: '$name (isArabic=$isArabic) would render in the fallback font');
        });
      }
    });

    test('the fallback chain survives — it is what carries uncovered glyphs', () {
      final style = JawwidTypography.body(true);
      expect(style.fontFamilyFallback, isNotEmpty);
      expect(style.fontFamilyFallback, contains('Noto Sans Arabic'),
          reason: 'Arabic must still render if the bundled asset fails to load');
    });

    test('the ThemeData both roles are built from resolves to the family', () {
      for (final theme in [
        JawwidTheme.light(isArabic: true),
        JawwidTheme.light(isArabic: false),
        JawwidTheme.dark(isArabic: true),
        JawwidTheme.dark(isArabic: false),
      ]) {
        final t = theme.textTheme;
        for (final style in [t.bodyMedium, t.titleLarge, t.labelSmall, t.bodyLarge]) {
          expect(style?.fontFamily, family);
        }
      }
    });

    test('only weights that are bundled are ever requested', () {
      for (final isArabic in [false, true]) {
        for (final style in [
          JawwidTypography.display(isArabic),
          JawwidTypography.h1(isArabic),
          JawwidTypography.h2(isArabic),
          JawwidTypography.h3(isArabic),
          JawwidTypography.bodyLg(isArabic),
          JawwidTypography.body(isArabic),
          JawwidTypography.bodySm(isArabic),
          JawwidTypography.label(isArabic),
          JawwidTypography.caption(isArabic),
          JawwidTypography.button(isArabic),
        ]) {
          expect(usedWeights, contains(style.fontWeight!.value),
              reason: 'weight ${style.fontWeight!.value} has no bundled file');
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  group('pubspec bundles what the scale asks for', () {
    // Read as text rather than through a YAML package: this assertion is not worth a
    // new dependency, and the shape being checked is a handful of literal lines.
    final pubspec = File('pubspec.yaml').readAsStringSync();

    /// The `fonts:` entries declared under [family], as (weight, assetPath) pairs.
    List<(int, String)> declaredFonts() {
      final block = pubspec.substring(pubspec.indexOf('- family: $family'));
      final end = block.indexOf(RegExp(r'\n  [a-z]'));
      final scoped = end == -1 ? block : block.substring(0, end);

      return RegExp(r'- asset:\s*(\S+)\s*\n\s*weight:\s*(\d+)')
          .allMatches(scoped)
          .map((m) => (int.parse(m.group(2)!), m.group(1)!))
          .toList();
    }

    test('the declared family name matches the one the styles ask for', () {
      expect(pubspec, contains('- family: $family'),
          reason: 'a family name typo renders as a silent fallback, not an error');
    });

    test('exactly the used weights are bundled — no gaps, no dead weight', () {
      expect(declaredFonts().map((f) => f.$1).toSet(), usedWeights,
          reason: 'a missing weight is synthesised silently; an extra one is bundle bloat');
    });

    test('every declared font file actually exists on disk', () {
      final declared = declaredFonts();
      expect(declared, hasLength(usedWeights.length));

      for (final (weight, path) in declared) {
        final file = File(path);
        expect(file.existsSync(), isTrue, reason: '$path (w$weight) is declared but absent');
        expect(file.lengthSync(), greaterThan(1000), reason: '$path is not a real font');
        // TrueType magic. Guards against a stub or an HTML error page saved as .ttf.
        expect(file.readAsBytesSync().sublist(0, 4), [0x00, 0x01, 0x00, 0x00],
            reason: '$path is not a TrueType file');
      }
    });

    test('the OFL licence ships with the fonts it covers', () {
      expect(pubspec, contains('- assets/fonts/OFL.txt'),
          reason: 'OFL 1.1 asks the licence to travel with the binary');
      final text = File('assets/fonts/OFL.txt').readAsStringSync();
      expect(text, contains('SIL OPEN FONT LICENSE'));
      expect(text, contains('IBM Corp.'));
    });
  });

  // -------------------------------------------------------------------------
  /// The checks above are about declarations. These load the real binaries and
  /// measure what the engine does with them, because a correct declaration and a
  /// font that actually shapes Arabic are different claims.
  group('the real font files shape text', () {
    setUpAll(() async {
      final loader = FontLoader(family);
      for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        final bytes = File('assets/fonts/IBMPlexSansArabic-$weight.ttf').readAsBytesSync();
        loader.addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
      }
      await loader.load();
    });

    /// Width of [text] laid out in [fontFamily], in logical pixels.
    double widthIn(String text, String? fontFamily, {FontWeight? weight}) {
      final painter = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(fontSize: 32, fontFamily: fontFamily, fontWeight: weight),
        ),
        textDirection: TextDirection.rtl,
      )..layout();
      return painter.width;
    }

    test('Arabic is shaped by the brand font, not by the test fallback', () {
      // The widget-test default font gives every glyph one fixed advance, so a real
      // font measuring the same as the fallback means the file never loaded.
      const arabic = 'الدرس يبدأ';
      expect(widthIn(arabic, family), isNot(widthIn(arabic, 'NoSuchFamily')),
          reason: 'identical metrics mean the engine fell back — the font did not load');
    });

    test('Arabic actually renders glyphs rather than collapsing', () {
      const arabic = 'ولي الأمر — تقرير الحصة';
      final w = widthIn(arabic, family);
      expect(w, greaterThan(0));
      // Arabic shapes with joining, so a 23-character string must be materially
      // narrower than 23 full advances, and never zero-width (tofu / no cmap).
      expect(w, lessThan(23 * 32.0));
    });

    test('mixed Arabic and Latin lay out together on one run', () {
      // §3.1: one family covering both scripts is the whole reason for this font.
      const mixed = 'الدرس يبدأ 3:00 PM';
      expect(widthIn(mixed, family), greaterThan(widthIn('الدرس يبدأ', family)),
          reason: 'the Latin half must contribute width, not be dropped');
    });

    test('the bundled weights are distinct faces, not one synthesised from another', () {
      const sample = 'الحصة Jawwid';
      final regular = widthIn(sample, family, weight: FontWeight.w400);
      final bold = widthIn(sample, family, weight: FontWeight.w700);
      expect(bold, isNot(regular),
          reason: 'identical metrics suggest only one weight is reaching the engine');
    });

    testWidgets('the declarations survive Flutter\'s own asset pipeline', (tester) async {
      // Reading through `rootBundle` rather than `File` is the point: this resolves the
      // asset the way the running app does, so it fails if `pubspec.yaml` declares a path
      // the bundler does not actually ship.
      final manifest = await rootBundle.loadString('FontManifest.json');
      expect(manifest, contains(family),
          reason: 'the family never reached the generated FontManifest');

      for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        final data =
            await rootBundle.load('assets/fonts/IBMPlexSansArabic-$weight.ttf');
        expect(data.lengthInBytes, greaterThan(100000), reason: '$weight is not bundled');
      }

      expect(await rootBundle.loadString('assets/fonts/OFL.txt'),
          contains('SIL OPEN FONT LICENSE'));
    });

    test('English is unaffected in the ways that matter — it still lays out LTR and sized', () {
      final painter = TextPainter(
        text: const TextSpan(
          text: 'Parent account',
          style: TextStyle(fontSize: 32, fontFamily: family),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      expect(painter.width, greaterThan(0));
      expect(painter.didExceedMaxLines, isFalse);
    });

    /// §3.2: "Text scaling up to 200% must not clip." A larger face with different
    /// metrics is exactly the kind of change that can start clipping text that used to
    /// fit, so the scale is exercised at the ceiling in both scripts.
    testWidgets('the whole scale survives 200% text scaling in both scripts',
        (tester) async {
      for (final (locale, isArabic, sample) in [
        (const Locale('en'), false, 'Parent account — lesson at 3:00 PM'),
        (const Locale('ar'), true, 'ولي الأمر — تبدأ الحصة ٣:٠٠ مساءً'),
      ]) {
        final theme = JawwidTheme.light(isArabic: isArabic);

        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
            theme: theme,
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
              child: Scaffold(
                // A narrow column is the hostile case: at 2x, text that is not allowed
                // to wrap or grow is what overflows.
                body: SizedBox(
                  width: 320,
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final style in [
                          theme.textTheme.displaySmall,
                          theme.textTheme.titleLarge,
                          theme.textTheme.titleMedium,
                          theme.textTheme.bodyLarge,
                          theme.textTheme.bodyMedium,
                          theme.textTheme.labelMedium,
                          theme.textTheme.labelSmall,
                        ])
                          Text(sample, style: style),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull,
            reason: 'the type scale clipped or overflowed at 200% in $locale');
        expect(find.text(sample), findsWidgets);
      }
    });
  });
}
