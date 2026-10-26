import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/data/mention_repository.dart';
import 'package:jawwid_chat/features/messages/domain/mentions.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/features/messages/presentation/system_message_text.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/l10n/app_localizations_en.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-36 @mentions in the app: the text helpers (UTF-16 offsets, the same as the server and
/// Admin Web), the wire mapping, the chip in a bubble (isolated, so an Arabic name in English
/// text keeps its direction), the @ list in the composer and the step-in system lines.
void main() {
  Widget app(Widget child, {Locale locale = const Locale('en')}) => ProviderScope(
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
          home: Scaffold(body: child),
        ),
      );

  group('text helpers', () {
    test('finds the @query before the caret, only at a word start', () {
      expect(activeMentionQuery('hi @La', 6), const MentionQuery(3, 'La'));
      expect(activeMentionQuery('mail a@b.com', 12), isNull);
      expect(activeMentionQuery('hi @La ila', 10), isNull);
      expect(activeMentionQuery('مرحبا @لي', 9), const MentionQuery(6, 'لي'));
    });

    test('inserts "@label " in place of the query', () {
      final next = insertMention('hi @La there', 6, 3, 'Laila Mansour');
      expect(next.text, 'hi @Laila Mansour  there');
      expect(next.caret, 18);
    });

    test('finds each pick in the final text; longer labels first; a retyped one mentions nobody', () {
      final spans = spansFor('@Laila Mansour and @Laila', const [
        PickedMention.person('Laila', 'a'),
        PickedMention.person('Laila Mansour', 'b'),
        PickedMention.person('Gone', 'c'),
      ]);
      expect(spans, const [
        MessageMention(start: 0, length: 14, actorId: 'b'),
        MessageMention(start: 19, length: 6, actorId: 'a'),
      ]);
    });

    test("a parent's role mention is sent as a role", () {
      expect(spansFor('@admin help', const [PickedMention.role('admin', 'admin')]), const [
        MessageMention(start: 0, length: 6, role: 'admin'),
      ]);
      expect(const MessageMention(start: 0, length: 6, role: 'admin').toWire(), {'start': 0, 'length': 6, 'role': 'admin'});
    });

    test('measures Arabic in the UTF-16 units the server stores', () {
      expect(spansFor('شكرا @ليلى', const [PickedMention.person('ليلى', 'x')]), const [
        MessageMention(start: 5, length: 5, actorId: 'x'),
      ]);
    });

    test('cuts a body into text and chips; a span that does not fit is plain text', () {
      final segs = mentionSegments('hi @Laila ok', const [MessageMention(start: 3, length: 6, actorId: 'a')]);
      expect(segs.map((s) => s.text).toList(), ['hi ', '@Laila', ' ok']);
      expect(segs[1].mention, isNotNull);
      expect(mentionSegments('hi', const [MessageMention(start: 0, length: 9, actorId: 'a')]).single.text, 'hi');
    });
  });

  group('wire', () {
    test('a message carries its chips and whether it mentions the viewer', () {
      final m = WireMappers.message({
        'id': 'm1',
        'type': 'text',
        'body': 'hi @Laila',
        'createdAt': '2026-10-26T08:00:00Z',
        'mentions': [
          {'start': 3, 'length': 6, 'actorId': 'staff-1', 'role': null},
          {'start': 'x'},
        ],
        'mentionsViewer': true,
      }, viewerActorId: 'me');
      expect(m.mentions, const [MessageMention(start: 3, length: 6, actorId: 'staff-1')]);
      expect(m.mentionsMe, isTrue);
      expect(m.copyWith(isStarred: true).mentions, m.mentions);
      expect(m.withClientMessageId('c').mentionsMe, isTrue);
    });

    test('a conversation is "mentioned" while the viewer has not opened it since', () {
      Map<String, Object?> row(Object? mention) => {
            'id': 'c1',
            'type': 'student_group',
            'lastSeq': '1',
            'lastActivityAt': '2026-10-26T08:00:00Z',
            'viewerState': {'pinned': false, 'archived': false, 'mutedUntil': null, 'mention': mention},
          };
      expect(WireMappers.conversation(row({'kind': 'member', 'seen': false}), viewerRole: UserRole.parent).isMentioned, isTrue);
      expect(WireMappers.conversation(row({'kind': 'member', 'seen': true}), viewerRole: UserRole.parent).isMentioned, isFalse);
      expect(WireMappers.conversation(row(null), viewerRole: UserRole.parent).isMentioned, isFalse);
    });
  });

  group('drawing', () {
    Message message({List<MessageMention> mentions = const [], bool me = false}) => Message(
          id: 'm1',
          clientMessageId: 'c-m1',
          conversationId: 'conv',
          sequence: 1,
          kind: MessageKind.text,
          body: 'hi @ليلى look',
          createdAt: DateTime.utc(2026, 10, 26, 8),
          deliveryState: DeliveryState.delivered,
          mentions: mentions,
          mentionsMe: me,
        );

    testWidgets('a mention is a chip, isolated so its direction cannot reorder the line', (tester) async {
      await tester.pumpWidget(app(MessageBubble(
        message: message(mentions: const [MessageMention(start: 3, length: 5, actorId: 'x')], me: true),
        showAuthor: false,
      )));
      await tester.pumpAndSettle();
      final rich = find.byWidgetPredicate(
        (w) => w is RichText && w.text.toPlainText().contains('\u2068@ليلى\u2069'),
      );
      expect(rich, findsOneWidget);
    });

    testWidgets('no mentions: the body is drawn as before', (tester) async {
      await tester.pumpWidget(app(MessageBubble(message: message(), showAuthor: false)));
      await tester.pumpAndSettle();
      expect(find.text('hi @ليلى look'), findsOneWidget);
    });

    test('a step-in reads as a line, with a name or without', () {
      final l10n = L10nEn();
      expect(systemMessageText('{"kind":"mention.stepped_in","name":"Laila Mansour","role":"manager"}', l10n), 'Laila Mansour stepped in');
      expect(systemMessageText('{"kind":"mention.stepped_out","reason":"idle"}', l10n), 'Jawwid stepped out');
    });
  });

  group('the @ list', () {
    testWidgets('offers who the server offers, inserts the name, and sends the span', (tester) async {
      final queries = <String>[];
      final sent = <(String, List<MessageMention>)>[];
      await tester.pumpWidget(app(MessageComposer(
        onSend: (_) => fail('the mention-aware send is used'),
        mentionCandidates: (q) async {
          queries.add(q);
          return const MentionCandidates(people: [
            MentionCandidate(actorId: 'staff-9', actorKind: 'staff', displayName: 'Laila Mansour', staffRole: 'manager', isMember: false),
          ]);
        },
        onSendWithMentions: (body, mentions) => sent.add((body, mentions)),
      )));
      await tester.enterText(find.byType(TextField), 'hi @La');
      await tester.pumpAndSettle();
      expect(queries.last, 'La');
      expect(find.text('Asked to join'), findsOneWidget);
      await tester.tap(find.text('@Laila Mansour'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'hi @Laila Mansour ');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();
      expect(sent.single.$1, 'hi @Laila Mansour');
      expect(sent.single.$2, const [MessageMention(start: 3, length: 14, actorId: 'staff-9')]);
    });

    testWidgets('without a source there is no @ list, and the plain send is used', (tester) async {
      final sent = <String>[];
      await tester.pumpWidget(app(MessageComposer(onSend: sent.add)));
      await tester.enterText(find.byType(TextField), 'hi @La');
      await tester.pumpAndSettle();
      expect(find.byType(ListTile), findsNothing);
      await tester.tap(find.byIcon(Icons.send));
      expect(sent, ['hi @La']);
    });
  });
}
