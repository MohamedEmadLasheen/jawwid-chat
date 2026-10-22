import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// PD-20: a message an administrator sent in a support session, acting as a parent or
/// teacher, is labelled "Sent by support" -- to every reader, the person themself included.
/// The server says so (`MessageDto.sentBySupport`); the client must never drop it.
void main() {
  Map<String, Object?> json({Object? sentBySupport}) => {
        'id': 'srv_1',
        'conversationId': 'c1',
        'seq': '5',
        'authorId': 'parent-1',
        'authorKind': 'contact',
        'authorDisplayName': 'Parent Alpha',
        'type': 'text',
        'body': 'Lesson moved to Thursday',
        'moderation': 'published',
        'createdAt': '2026-10-22T12:00:00.000Z',
        'receipts': const [],
        'reactions': const [],
        'attachments': const [],
        'sentBySupport': ?sentBySupport,
      };

  test('the wire flag is read, and absent means not', () {
    expect(WireMappers.message(json(sentBySupport: true), viewerActorId: 'me').isSentBySupport, isTrue);
    expect(WireMappers.message(json(sentBySupport: false), viewerActorId: 'me').isSentBySupport, isFalse);
    expect(WireMappers.message(json(), viewerActorId: 'me').isSentBySupport, isFalse);
  });

  test('the flag survives the copies the chat makes of a message', () {
    final m = WireMappers.message(json(sentBySupport: true), viewerActorId: 'me');
    expect(m.copyWith(isStarred: true).isSentBySupport, isTrue);
    expect(m.withClientMessageId('cmid').isSentBySupport, isTrue);
  });

  for (final locale in const [Locale('en'), Locale('ar')]) {
    testWidgets('the bubble says "Sent by support" (${locale.languageCode}), and an ordinary one does not', (tester) async {
      Future<void> show(Message m) => tester.pumpWidget(ProviderScope(
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
              home: Scaffold(body: MessageBubble(message: m, showAuthor: true)),
            ),
          ));
      final label = lookupL10n(locale).sentBySupportLabel;

      await show(WireMappers.message(json(sentBySupport: true), viewerActorId: 'me'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('message-sent-by-support')), findsOneWidget);
      expect(find.text(label), findsOneWidget);

      await show(WireMappers.message(json(), viewerActorId: 'me'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('message-sent-by-support')), findsNothing);
    });
  }
}
