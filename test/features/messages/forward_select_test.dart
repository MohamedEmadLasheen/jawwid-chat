import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/forward_sheet.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Forward and select (group B, owner decisions 2026-10-19).
void main() {
  Message message({ApprovalState approval = ApprovalState.notRequired, bool forwarded = false, MessageCard? card}) => Message(
        id: 'm1',
        clientMessageId: 'c-m1',
        conversationId: 'conv',
        sequence: 1,
        kind: MessageKind.text,
        body: 'hello',
        createdAt: DateTime.utc(2026, 10, 19, 12),
        deliveryState: DeliveryState.delivered,
        approvalState: approval,
        isForwarded: forwarded,
        card: card,
      );

  Widget app(Widget child, {List overrides = const []}) => ProviderScope(
        overrides: [...overrides],
        child: MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: Scaffold(body: child),
        ),
      );

  group('actions', () {
    test('Forward and Select are offered with the marks routes; not otherwise', () {
      expect(actionsFor(message()), isNot(contains(MessageAction.forward)));
      expect(actionsFor(message(), withMarks: true), containsAll([MessageAction.forward, MessageAction.select]));
    });

    test('what may not leave is not offered: a held message, a ticket card', () {
      expect(actionsFor(message(approval: ApprovalState.pending), withMarks: true), isNot(contains(MessageAction.forward)));
      const card = MessageCard(kind: 'lesson_report', payload: const {});
      expect(actionsFor(message(card: card), withMarks: true), isNot(contains(MessageAction.forward)));
    });
  });

  test('the server flag maps onto the message', () {
    final m = WireMappers.message({'id': 'x', 'type': 'text', 'createdAt': '2026-10-19T10:00:00Z', 'forwarded': true}, viewerActorId: 'me');
    expect(m.isForwarded, isTrue);
  });

  testWidgets('a forwarded copy says so', (tester) async {
    await tester.pumpWidget(app(MessageBubble(message: message(forwarded: true), showAuthor: false)));
    await tester.pumpAndSettle();
    expect(find.text('Forwarded'), findsOneWidget);
  });

  testWidgets('the forward sheet returns the chosen chats and stops at ten', (tester) async {
    final chats = [for (var i = 0; i < 12; i++) Conversation(id: 'c$i', kind: ConversationKind.studentGroup, title: 'Chat $i', updatedAt: DateTime.utc(2026))];
    List<String>? picked;
    await tester.pumpWidget(app(
      Builder(builder: (context) => TextButton(onPressed: () async => picked = await showForwardSheet(context), child: const Text('open'))),
      overrides: [conversationRepositoryProvider.overrideWithValue(_Chats(chats))],
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    for (var i = 0; i < 11; i++) {
      final tile = find.widgetWithText(CheckboxListTile, 'Chat $i');
      await tester.scrollUntilVisible(tile, 80, scrollable: find.byType(Scrollable).last);
      await tester.tap(tile);
      await tester.pumpAndSettle();
    }
    expect(find.text('You can choose at most 10 chats.'), findsOneWidget);
    await tester.tap(find.text('Send to 10'));
    await tester.pumpAndSettle();
    expect(picked, [for (var i = 0; i < 10; i++) 'c$i']);
  });
}

class _Chats extends Fake implements ConversationRepository {
  _Chats(this.items);
  final List<Conversation> items;
  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async => items;
}
