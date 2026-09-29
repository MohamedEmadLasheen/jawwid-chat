import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/system_event.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/utils/system_event_text.dart';

/// System lines, in both surfaces and both languages.
///
/// The defect these guard is specific and was visible to every parent with a
/// child in a group: the chat screen printed the backend's own payload,
/// `{"kind":"group.created","learner":"Adam QA"}`, as though it were a message.
/// So the assertions are mostly negative — nothing here may look like JSON —
/// alongside the positive one that a real sentence appears instead.
void main() {
  Widget host(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: child),
      );

  Message systemMessage(SystemEvent? event) => Message(
        id: 'm1',
        clientMessageId: 'm1',
        conversationId: 'c1',
        kind: MessageKind.system,
        createdAt: DateTime(2026, 9, 29, 10),
        deliveryState: DeliveryState.sent,
        authorRole: ParticipantRole.system,
        systemEvent: event,
      );

  /// Everything rendered on screen, for the "no JSON anywhere" assertions.
  List<String> renderedText(WidgetTester tester) => tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data ?? '')
      .where((s) => s.isNotEmpty)
      .toList();

  group('inside the conversation', () {
    testWidgets('renders a sentence, never the payload', (tester) async {
      await tester.pumpWidget(host(
        MessageBubble(
          message: systemMessage(
            const SystemEvent(kind: 'group.created', params: {'learner': 'Adam QA'}),
          ),
          showAuthor: false,
        ),
      ));

      expect(find.text('Jawwid opened this group for Adam QA.'), findsOneWidget);
      for (final text in renderedText(tester)) {
        expect(text, isNot(contains('"kind"')));
        expect(text, isNot(startsWith('{')));
      }
    });

    testWidgets('says something true for a kind it does not know', (tester) async {
      // An older client meeting a newer event must not render nothing (the
      // group appears to have changed for no reason) and must not render the
      // payload. A general, accurate sentence is the only honest third option.
      await tester.pumpWidget(host(
        MessageBubble(
          message: systemMessage(
            const SystemEvent(kind: 'group.renamed', params: {'title': 'x'}),
          ),
          showAuthor: false,
        ),
      ));

      expect(find.text('Jawwid updated this conversation.'), findsOneWidget);
    });

    testWidgets('renders nothing at all when the event could not be parsed',
        (tester) async {
      await tester.pumpWidget(host(
        MessageBubble(
          message: systemMessage(null),
          showAuthor: false,
        ),
      ));

      expect(renderedText(tester), isEmpty);
    });

    testWidgets('names the child in Arabic too', (tester) async {
      await tester.pumpWidget(host(
        MessageBubble(
          message: systemMessage(
            const SystemEvent(kind: 'group.created', params: {'learner': 'آدم'}),
          ),
          showAuthor: false,
        ),
        locale: const Locale('ar'),
      ));

      expect(find.textContaining('آدم'), findsOneWidget);
      for (final text in renderedText(tester)) {
        expect(text, isNot(contains('"kind"')));
      }
    });

    testWidgets('drops a learner name the payload did not carry', (tester) async {
      await tester.pumpWidget(host(
        MessageBubble(
          message: systemMessage(const SystemEvent(kind: 'group.created')),
          showAuthor: false,
        ),
      ));

      expect(find.text('Jawwid opened this group.'), findsOneWidget);
    });
  });

  group('on the chat list row', () {
    Conversation withPreview(MessagePreview preview) => Conversation(
          id: 'c1',
          kind: ConversationKind.studentGroup,
          title: 'Adam · Jawwid',
          updatedAt: DateTime(2026, 9, 29, 10),
          lastMessageAt: DateTime(2026, 9, 29, 10),
          lastMessage: preview,
        );

    testWidgets('shows the same sentence the conversation shows', (tester) async {
      // Two surfaces, one mapping. A row that described an event differently
      // from the line inside the conversation would be its own small lie.
      await tester.pumpWidget(host(
        ConversationTile(
          conversation: withPreview(
            MessagePreview(
              kind: MessageKind.system,
              at: DateTime(2026, 9, 29, 10),
              systemEvent: const SystemEvent(
                kind: 'group.created',
                params: {'learner': 'Adam QA'},
              ),
            ),
          ),
          now: DateTime(2026, 9, 29, 11),
        ),
      ));

      expect(find.text('Jawwid opened this group for Adam QA.'), findsOneWidget);
    });

    testWidgets('names a kind that has no text to quote', (tester) async {
      await tester.pumpWidget(host(
        ConversationTile(
          conversation: withPreview(
            MessagePreview(
              kind: MessageKind.voice,
              at: DateTime(2026, 9, 29, 10),
              authorName: 'Dina',
            ),
          ),
          now: DateTime(2026, 9, 29, 11),
        ),
      ));

      expect(find.text('Dina: Voice message'), findsOneWidget);
    });

    testWidgets('says "You" on the reader own last message', (tester) async {
      await tester.pumpWidget(host(
        ConversationTile(
          conversation: withPreview(
            MessagePreview(
              kind: MessageKind.text,
              at: DateTime(2026, 9, 29, 10),
              text: 'thanks',
              isMine: true,
            ),
          ),
          now: DateTime(2026, 9, 29, 11),
        ),
      ));

      expect(find.text('You: thanks'), findsOneWidget);
    });

    testWidgets('does not attribute a system line to anybody', (tester) async {
      await tester.pumpWidget(host(
        ConversationTile(
          conversation: withPreview(
            MessagePreview(
              kind: MessageKind.system,
              at: DateTime(2026, 9, 29, 10),
              authorName: 'Dina',
              systemEvent: const SystemEvent(kind: 'group.archived'),
            ),
          ),
          now: DateTime(2026, 9, 29, 11),
        ),
      ));

      expect(find.text('Jawwid closed this group.'), findsOneWidget);
      expect(find.textContaining('Dina:'), findsNothing);
    });
  });

  group('the mapping itself', () {
    testWidgets('covers every kind the backend emits today', (tester) async {
      late L10n l10n;
      await tester.pumpWidget(host(Builder(builder: (context) {
        l10n = L10n.of(context);
        return const SizedBox.shrink();
      })));

      final sentences = {
        for (final event in [
          const SystemEvent(kind: 'group.created', params: {'learner': 'Adam'}),
          const SystemEvent(kind: 'group.membership_changed', params: {'added': '2', 'removed': '0'}),
          const SystemEvent(kind: 'group.membership_changed', params: {'added': '0', 'removed': '1'}),
          const SystemEvent(kind: 'group.membership_changed', params: {'added': '1', 'removed': '1'}),
          const SystemEvent(kind: 'group.archived', params: {'reason': 'internal note'}),
        ])
          event.kind: SystemEventText.format(event, l10n),
      };

      for (final sentence in sentences.values) {
        expect(sentence, isNotEmpty);
        expect(sentence, isNot(contains('{')));
      }
      // The archive reason is written for staff and is never shown to a family.
      expect(sentences['group.archived'], isNot(contains('internal note')));
    });
  });
}
