import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/voice_message_player.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/utils/text_direction.dart';

import 'fake_voice_devices.dart';

/// The bubble renders a voice note AND keeps `ContentText` for the body.
///
/// These two live in the same block of `MessageBubble`, and they arrived from
/// two different branches: `ContentText` is a deliberate RTL fix (passing
/// `textDirection: null` inherits the ambient direction rather than detecting
/// the content's, so an Arabic message in an English UI put its full stop on
/// the left), and `VoiceMessagePlayer` is this feature. Reconciling them was a
/// semantic merge conflict, and the failure mode is silent: the bubble still
/// renders, it just quietly loses one of the two behaviours. These tests fail
/// if either is dropped.
void main() {
  late FakeVoicePlayer player;

  setUp(() => player = FakeVoicePlayer());
  tearDown(() => player.dispose());

  const voiceAttachment = Attachment(
    id: 'att_1',
    kind: MessageKind.voice,
    url: 'https://signed.invalid/voice',
    mimeType: 'audio/mp4',
    durationMs: 12000,
  );

  Message message({
    MessageKind kind = MessageKind.text,
    String body = '',
    List<Attachment> attachments = const [],
  }) {
    return Message(
      id: 'srv_1',
      clientMessageId: 'cmid_1',
      conversationId: 'conv_1',
      sequence: 1,
      kind: kind,
      body: body,
      attachments: attachments,
      createdAt: DateTime.utc(2026, 9, 5, 12),
      deliveryState: DeliveryState.delivered,
    );
  }

  Widget harness(Message m, {Locale locale = const Locale('en')}) {
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
        home: Scaffold(body: MessageBubble(message: m, showAuthor: false)),
      ),
    );
  }

  group('a text message', () {
    testWidgets('renders its body through ContentText, never a bare Text', (tester) async {
      await tester.pumpWidget(harness(message(body: 'Hello')));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(ContentText, 'Hello'), findsOneWidget);
      expect(find.byType(VoiceMessagePlayer), findsNothing);
    });

    testWidgets('an Arabic body resolves its own direction, not the ambient one', (tester) async {
      // The bug ContentText fixed: in an English (LTR) app, an Arabic body must
      // still lay out RTL rather than inheriting the page direction.
      await tester.pumpWidget(harness(message(body: 'مرحبًا بك.')));
      await tester.pumpAndSettle();

      final text = tester.widget<Text>(
        find.descendant(of: find.byType(ContentText), matching: find.byType(Text)),
      );
      expect(text.textDirection, TextDirection.rtl);
    });
  });

  group('a voice message', () {
    testWidgets('renders the player', (tester) async {
      await tester.pumpWidget(
        harness(message(kind: MessageKind.voice, attachments: const [voiceAttachment])),
      );
      await tester.pumpAndSettle();

      expect(find.byType(VoiceMessagePlayer), findsOneWidget);
      expect(find.text('0:12'), findsOneWidget);
    });

    testWidgets('adds no empty body line under the player', (tester) async {
      await tester.pumpWidget(
        harness(message(kind: MessageKind.voice, attachments: const [voiceAttachment])),
      );
      await tester.pumpAndSettle();

      // A voice note carries no body; rendering one would leave a blank line.
      final bodies = tester
          .widgetList<ContentText>(find.byType(ContentText))
          .where((c) => c.data.isEmpty);
      expect(bodies, isEmpty);
    });
  });

  group('a voice message with a caption', () {
    testWidgets('renders both the player and the body', (tester) async {
      await tester.pumpWidget(
        harness(
          message(
            kind: MessageKind.voice,
            body: 'Listen to this please',
            attachments: const [voiceAttachment],
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(VoiceMessagePlayer), findsOneWidget);
      expect(find.widgetWithText(ContentText, 'Listen to this please'), findsOneWidget);
    });

    testWidgets('an Arabic caption beside a voice note still resolves RTL', (tester) async {
      await tester.pumpWidget(
        harness(
          message(
            kind: MessageKind.voice,
            body: 'استمعي إلى هذا.',
            attachments: const [voiceAttachment],
          ),
        ),
      );
      await tester.pumpAndSettle();

      final caption = tester.widget<Text>(
        find.descendant(
          of: find.widgetWithText(ContentText, 'استمعي إلى هذا.'),
          matching: find.byType(Text),
        ),
      );
      expect(caption.textDirection, TextDirection.rtl);
      expect(find.byType(VoiceMessagePlayer), findsOneWidget);
    });
  });

  group('a deleted message', () {
    testWidgets('shows the tombstone and no player', (tester) async {
      final deleted = Message(
        id: 'srv_2',
        clientMessageId: 'cmid_2',
        conversationId: 'conv_1',
        sequence: 2,
        kind: MessageKind.voice,
        createdAt: DateTime.utc(2026, 9, 5, 12),
        deliveryState: DeliveryState.delivered,
        isDeleted: true,
        attachments: const [voiceAttachment],
      );
      await tester.pumpWidget(harness(deleted));
      await tester.pumpAndSettle();

      expect(find.byType(VoiceMessagePlayer), findsNothing);
      expect(find.text('This message was deleted'), findsOneWidget);
    });
  });
}
