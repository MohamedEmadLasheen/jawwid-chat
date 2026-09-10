import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/audio/voice_recorder.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// The composer flow end to end, on the real chat screen.
void main() {
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;
  late FakeBackend backend;

  setUp(() {
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
    backend = FakeBackend(role: UserRole.parent);
  });

  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  Widget harness({Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
      ],
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
        home: ChatScreen(
          conversationId: backend.listConversations().first.id,
          title: 'Jawwid',
        ),
      ),
    );
  }


  /// Press the microphone and let the asynchronous start settle.
  ///
  /// [WidgetTester.pumpAndSettle] must not be used here: a running recording
  /// schedules a frame every 100 ms for its timer and pulses its indicator, so
  /// the tree never goes quiet — by design.
  Future<void> startRecording(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.mic));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> stopRecording(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.stop));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('the composer offers recording without changing the chat screen', () {
    testWidgets('the microphone shows while the field is empty', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.mic), findsOneWidget);
      // The send button is still the text affordance, appearing only once there
      // is something to send. Recording did not take it over.
      expect(find.byIcon(Icons.send), findsNothing);
    });

    testWidgets('typing swaps the microphone for send, as before', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'hello');
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.send), findsOneWidget);
      expect(find.byIcon(Icons.mic), findsNothing);
    });
  });

  group('record → review → send', () {
    testWidgets('pressing the microphone starts a visible recording', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);

      // Said in words, not signalled only by a red dot.
      expect(find.text('Recording a voice message'), findsOneWidget);
      expect(find.byIcon(Icons.stop), findsOneWidget);
      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
      // The text field yields the row, so there is no ambiguity about what
      // pressing send would send.
      expect(find.byType(TextField), findsNothing);
      expect(recorder.startCount, 1);
    });

    testWidgets('stopping shows a preview the sender can play', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);

      expect(find.text('Review your voice message'), findsOneWidget);
      expect(find.byIcon(Icons.play_arrow), findsWidgets);
      expect(find.byIcon(Icons.send), findsOneWidget);
      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
    });

    testWidgets('the preview plays the local recording, not a remote URL', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);
      await tester.tap(find.byIcon(Icons.play_arrow).first);
      await tester.pumpAndSettle();

      expect(player.loaded.single, endsWith('.ogg'));
      expect(player.loaded.single, isNot(startsWith('http')));
    });

    testWidgets('sending posts the note and returns the composer to text', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      // Back to the ordinary composer.
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Review your voice message'), findsNothing);
      // And the note is in the thread.
      expect(find.text('Voice message'), findsWidgets);
    });

    testWidgets('deleting the draft sends nothing', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);
      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Voice message'), findsNothing);
    });
  });

  group('failures are explained in the composer', () {
    testWidgets('a denied microphone says what to do about it', (tester) async {
      recorder.permitted = false;
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);

      expect(
        find.text(
          'Allow microphone access in your device settings to record a voice message.',
        ),
        findsOneWidget,
      );
      // The composer is still usable for text.
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('an unsupported device says so', (tester) async {
      recorder.supported = false;
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);

      expect(find.text('This device cannot record voice messages.'), findsOneWidget);
    });

    testWidgets('a mis-tap too short to be a message is explained', (tester) async {
      recorder.stopFailure = VoiceRecorderFailure.tooShort;
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);

      expect(find.text('Hold longer to record a voice message.'), findsOneWidget);
      expect(find.text('Review your voice message'), findsNothing);
    });

    testWidgets('the notice can be dismissed', (tester) async {
      recorder.permitted = false;
      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();

      await startRecording(tester);
      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.mic_off_outlined), findsNothing);
    });
  });

  group('Arabic', () {
    testWidgets('the recording bar renders RTL without overflowing', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('ar')));
      await tester.pumpAndSettle();

      await startRecording(tester);

      expect(find.text('جارٍ تسجيل رسالة صوتية'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the review and send flow works in Arabic', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('ar')));
      await tester.pumpAndSettle();

      await startRecording(tester);
      await stopRecording(tester);

      expect(find.text('راجعي رسالتك الصوتية'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      expect(find.text('رسالة صوتية'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });

  group('a small screen still fits', () {
    testWidgets('the recording bar survives a 320px viewport', (tester) async {
      // The low-end Android target from handoff §9.
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness());
      await tester.pumpAndSettle();
      await startRecording(tester);

      expect(tester.takeException(), isNull);
    });
  });
}
