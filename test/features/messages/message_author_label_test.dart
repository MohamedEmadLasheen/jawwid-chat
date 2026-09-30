import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// What a group message says about who sent it (gap O3, author half).
///
/// Before the server resolved author names, the bubble always fell back to the
/// ROLE — so two messages from two different parents in the same Student Group
/// both read "Parent". The name now arrives on `MessageDto.authorDisplayName`.
///
/// **The role label stays, and stays a fallback.** It is presentation, chosen when
/// the server states no name (a system message, or an author whose actor no longer
/// resolves). It is NOT an identity mechanism: this client never resolves a name
/// itself, and it never asks an endpoint for one.
void main() {
  Message message({
    String authorName = '',
    ParticipantRole authorRole = ParticipantRole.parent,
    bool isMine = false,
    String body = 'hello',
  }) {
    return Message(
      id: 'srv_1',
      clientMessageId: 'cmid_1',
      conversationId: 'conv_1',
      sequence: 1,
      authorId: isMine ? 'me' : 'them',
      authorName: authorName,
      authorRole: authorRole,
      kind: MessageKind.text,
      body: body,
      createdAt: DateTime.utc(2026, 9, 30, 12),
      deliveryState: DeliveryState.delivered,
      isMine: isMine,
    );
  }

  Widget harness(Message m, {Locale locale = const Locale('en')}) {
    return ProviderScope(
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
        // showAuthor: true — this is a group, where who sent it is the question.
        home: Scaffold(body: MessageBubble(message: m, showAuthor: true)),
      ),
    );
  }

  testWidgets('renders the name the server stated', (tester) async {
    await tester.pumpWidget(harness(message(authorName: 'Umm Yusuf')));
    await tester.pumpAndSettle();

    expect(find.text('Umm Yusuf'), findsOneWidget);
    // And NOT the role. A name present means the role label is not shown at all.
    expect(find.text('Parent'), findsNothing);
  });

  testWidgets('two parents in one group are distinguishable', (tester) async {
    // The precise bug: same role, different people.
    await tester.pumpWidget(harness(message(authorName: 'Umm Yusuf')));
    await tester.pumpAndSettle();
    expect(find.text('Umm Yusuf'), findsOneWidget);

    await tester.pumpWidget(harness(message(authorName: 'Abu Yusuf')));
    await tester.pumpAndSettle();
    expect(find.text('Abu Yusuf'), findsOneWidget);
    expect(find.text('Umm Yusuf'), findsNothing);
  });

  testWidgets('falls back to the role label only when no name was stated',
      (tester) async {
    await tester.pumpWidget(harness(message(authorName: '')));
    await tester.pumpAndSettle();

    // Defensive presentation, not identity resolution — and never the actor id.
    expect(find.text('Parent'), findsOneWidget);
    expect(find.text('them'), findsNothing);
  });

  testWidgets('an unresolved role falls back to a neutral word, never an id',
      (tester) async {
    await tester.pumpWidget(
      harness(message(authorName: '', authorRole: ParticipantRole.unknown)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Member'), findsOneWidget);
    expect(find.text('them'), findsNothing);
  });

  testWidgets('the name renders in Arabic too, unchanged', (tester) async {
    // A display name is content, not a localised string: it is never translated
    // and never replaced by a role because the locale changed.
    await tester.pumpWidget(
      harness(message(authorName: 'أم يوسف'), locale: const Locale('ar')),
    );
    await tester.pumpAndSettle();

    expect(find.text('أم يوسف'), findsOneWidget);
  });

  testWidgets('own messages are unchanged: no author label at all', (tester) async {
    // The sender knows who they are. This is existing behaviour and the additive
    // field must not have disturbed it.
    await tester.pumpWidget(harness(message(authorName: 'Me', isMine: true)));
    await tester.pumpAndSettle();

    expect(find.text('Me'), findsNothing);
    expect(find.text('Parent'), findsNothing);
  });
}
