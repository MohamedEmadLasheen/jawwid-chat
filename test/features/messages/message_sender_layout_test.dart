import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// WhatsApp's group layout: someone else's run of messages carries their
/// picture beside the first bubble and their name, in their colour, inside it;
/// the later bubbles of the run keep the picture's column so they line up.
/// The viewer's own messages carry neither.
void main() {
  Message message({required String authorId, String name = 'Hala Admin', bool isMine = false}) {
    return Message(
      id: 'srv_$authorId',
      clientMessageId: 'cmid_$authorId',
      conversationId: 'conv_1',
      sequence: 1,
      authorId: authorId,
      authorName: name,
      authorRole: ParticipantRole.admin,
      kind: MessageKind.text,
      body: 'hello',
      createdAt: DateTime.utc(2026, 10, 19, 12),
      deliveryState: DeliveryState.delivered,
      isMine: isMine,
    );
  }

  Widget harness(Widget child) => ProviderScope(
        child: MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(body: child),
        ),
      );

  testWidgets('the first bubble of a run: picture beside it, name in the sender colour', (tester) async {
    await tester.pumpWidget(harness(MessageBubble(
      message: message(authorId: 'staff-hala'),
      showAuthor: true,
      reserveSenderColumn: true,
    )));
    await tester.pumpAndSettle();

    final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar));
    expect(avatar.displayName, 'Hala Admin');
    expect(avatar.size, senderAvatarSize);
    final name = tester.widget<Text>(find.text('Hala Admin'));
    expect(name.style?.color, senderColor('staff-hala', Brightness.light));
    expect(name.style?.fontWeight, FontWeight.w700);
    // The picture is on the reading-start side of the bubble.
    expect(
      tester.getTopLeft(find.byType(JawwidAvatar)).dx,
      lessThan(tester.getTopLeft(find.text('hello')).dx),
    );
  });

  testWidgets('a later bubble of the run keeps the column but shows no picture or name', (tester) async {
    await tester.pumpWidget(harness(Column(children: [
      MessageBubble(message: message(authorId: 'a'), showAuthor: true, reserveSenderColumn: true),
      MessageBubble(message: message(authorId: 'a'), showAuthor: false, reserveSenderColumn: true),
    ])));
    await tester.pumpAndSettle();

    expect(find.byType(JawwidAvatar), findsOneWidget);
    expect(find.text('Hala Admin'), findsOneWidget);
    // Both bodies start at the same x: the second is aligned under the first.
    final bodies = find.text('hello');
    expect(tester.getTopLeft(bodies.at(0)).dx, tester.getTopLeft(bodies.at(1)).dx);
  });

  testWidgets("the viewer's own message never carries a picture or name", (tester) async {
    await tester.pumpWidget(harness(MessageBubble(
      message: message(authorId: 'me', isMine: true),
      showAuthor: true,
      reserveSenderColumn: true,
    )));
    await tester.pumpAndSettle();
    expect(find.byType(JawwidAvatar), findsNothing);
    expect(find.text('Hala Admin'), findsNothing);
  });

  test('a sender keeps one colour, and different senders spread over the palette', () {
    expect(senderColor('x', Brightness.light), senderColor('x', Brightness.light));
    final seen = {for (var i = 0; i < 40; i++) senderColor('person-$i', Brightness.light)};
    expect(seen.length, greaterThan(4));
    expect(SenderNameColors.light, contains(senderColor('x', Brightness.light)));
    expect(SenderNameColors.dark, contains(senderColor('x', Brightness.dark)));
  });
}
