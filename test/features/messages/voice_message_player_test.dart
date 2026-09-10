import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/messages/presentation/voice_message_player.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/utils/duration_format.dart';

import 'fake_voice_devices.dart';

/// The player as the recipient sees it, in both reading directions.
void main() {
  const conversationId = 'conv_1';

  const attachment = Attachment(
    id: 'att_1',
    kind: MessageKind.voice,
    url: 'https://signed.invalid/conversations/conv_1/voice_1',
    mimeType: 'audio/ogg',
    byteSize: 20480,
    durationMs: 18000,
  );

  late FakeVoicePlayer player;

  setUp(() => player = FakeVoicePlayer());
  tearDown(() => player.dispose());

  Widget harness({Locale locale = const Locale('ar'), Attachment note = attachment}) {
    return ProviderScope(
      overrides: [voicePlayerProvider.overrideWithValue(player)],
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(
          body: VoiceMessagePlayer(
            conversationId: conversationId,
            attachment: note,
            foreground: JawwidTokens.light.colorTextPrimary,
          ),
        ),
      ),
    );
  }

  group('what a voice message shows before it is touched', () {
    testWidgets('renders the stored duration without loading any audio', (tester) async {
      await tester.pumpWidget(harness());

      expect(find.text('0:18'), findsOneWidget);
      // Nothing was fetched: a screenful of voice notes must render without
      // decoding one (handoff §9).
      expect(player.loaded, isEmpty);
    });

    testWidgets('says it is a voice message in words, not by icon alone', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('en')));

      expect(find.text('Voice message'), findsOneWidget);
      expect(find.byIcon(Icons.mic), findsOneWidget);
    });

    testWidgets('is announced with its kind and length', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(harness(locale: const Locale('en')));

      expect(find.bySemanticsLabel('Voice message, 0:18'), findsOneWidget);
      handle.dispose();
    });
  });

  group('playback', () {
    testWidgets('play loads the signed URL and starts', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('en')));

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();

      expect(player.loaded, [attachment.url]);
      expect(player.playCount, 1);
      expect(find.byIcon(Icons.pause), findsOneWidget);
    });

    testWidgets('pressing again pauses rather than restarting', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('en')));

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.pause));
      await tester.pumpAndSettle();

      expect(player.pauseCount, 1);
      // Loaded once: pausing must not re-fetch, or resuming would start over.
      expect(player.loaded, hasLength(1));
      expect(find.byIcon(Icons.play_arrow), findsOneWidget);
    });

    testWidgets('resuming continues from where it was paused', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('en')));

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();
      player.advanceTo(const Duration(seconds: 7), duration: const Duration(seconds: 18));
      await tester.pumpAndSettle();
      expect(find.text('0:07 / 0:18'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.pause));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();

      // The position survived the pause, and no reload reset it.
      expect(find.text('0:07 / 0:18'), findsOneWidget);
      expect(player.loaded, hasLength(1));
      expect(player.playCount, 2);
    });

    testWidgets('the transport button carries an accessible label', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(harness(locale: const Locale('en')));

      expect(find.bySemanticsLabel('Play'), findsWidgets);

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();

      // The state changed in words as well as in colour and glyph.
      expect(find.bySemanticsLabel('Pause'), findsWidgets);
      handle.dispose();
    });
  });

  group('failure', () {
    testWidgets('an unplayable note says so instead of looking idle', (tester) async {
      player.failOnLoad = true;
      await tester.pumpWidget(harness(locale: const Locale('en')));

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pumpAndSettle();

      expect(find.text('This voice message could not be played.'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    testWidgets('a note with no URL yet cannot be played', (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          note: const Attachment(id: 'att_2', kind: MessageKind.voice, durationMs: 5000),
        ),
      );

      final button = tester.widget<IconButton>(
        find.ancestor(of: find.byIcon(Icons.play_arrow), matching: find.byType(IconButton)),
      );
      expect(button.onPressed, isNull);
      expect(find.text('0:05'), findsOneWidget);
    });
  });

  group('RTL', () {
    testWidgets('the progress track does not mirror in Arabic', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      // The page is RTL...
      expect(Directionality.of(tester.element(find.byType(VoiceMessagePlayer))),
          TextDirection.rtl);

      // ...but the seek bar is not. A waveform is a timeline of physical sound,
      // and flipping it would make the recording appear to run backwards
      // (cross-platform.md §4).
      expect(Directionality.of(tester.element(find.byType(Slider))), TextDirection.ltr);
    });

    testWidgets('the duration reads left-to-right in Arabic', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      final durationText = find.text('0:18');
      expect(durationText, findsOneWidget);
      expect(Directionality.of(tester.element(durationText)), TextDirection.ltr);
    });

    testWidgets('renders in Arabic without overflowing', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('duration formatting', () {
    test('pads seconds and drops an empty hour', () {
      expect(DurationFormat.clock(const Duration(seconds: 8)), '0:08');
      expect(DurationFormat.clock(const Duration(seconds: 78)), '1:18');
      expect(DurationFormat.clock(const Duration(minutes: 61)), '1:01:00');
    });

    test('never renders a negative duration', () {
      expect(DurationFormat.clock(const Duration(seconds: -5)), '0:00');
    });
  });
}
