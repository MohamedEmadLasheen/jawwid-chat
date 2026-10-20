import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/domain/message_log.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Edited messages (#67): the server sends `editedAt` and the new wording; the
/// app shows "Edited" beside the time, and a `message.updated` re-read replaces
/// the old text.
void main() {
  Message message({DateTime? editedAt, bool deleted = false, String body = 'Lesson at 6'}) => Message(
        id: 'm1',
        clientMessageId: 'c-m1',
        conversationId: 'conv',
        sequence: 1,
        kind: MessageKind.text,
        body: body,
        createdAt: DateTime.utc(2026, 10, 20, 9),
        deliveryState: DeliveryState.delivered,
        editedAt: editedAt,
        isDeleted: deleted,
      );

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

  test('the server time maps onto the message; absent means never edited', () {
    final edited = WireMappers.message(
      {'id': 'x', 'type': 'text', 'body': 'Lesson at 6', 'createdAt': '2026-10-20T09:00:00Z', 'editedAt': '2026-10-20T09:05:00Z'},
      viewerActorId: 'me',
    );
    // Local time, like createdAt; the same instant the server sent.
    expect(edited.editedAt!.isAtSameMomentAs(DateTime.utc(2026, 10, 20, 9, 5)), isTrue);
    final plain = WireMappers.message({'id': 'y', 'type': 'text', 'createdAt': '2026-10-20T09:00:00Z'}, viewerActorId: 'me');
    expect(plain.editedAt, isNull);
    final cleared = WireMappers.message({'id': 'z', 'type': 'text', 'createdAt': '2026-10-20T09:00:00Z', 'editedAt': null}, viewerActorId: 'me');
    expect(cleared.editedAt, isNull);
  });

  test('copies keep the mark (a reaction or a re-key does not lose it)', () {
    final edited = message(editedAt: DateTime.utc(2026, 10, 20, 9, 5));
    expect(edited.copyWith(isStarred: true).editedAt, edited.editedAt);
    expect(edited.withClientMessageId('c-2').editedAt, edited.editedAt);
  });

  test("a re-read after message.updated replaces the old wording with the server's", () {
    final before = MessageLog.empty().merge([message(body: 'Lesson at 5')]);
    final after = before.merge([message(body: 'Lesson at 6', editedAt: DateTime.utc(2026, 10, 20, 9, 5))]);
    final m = after.byServerId('m1')!;
    expect(m.body, 'Lesson at 6');
    expect(m.editedAt, isNotNull);
  });

  testWidgets('an edited message says so beside its time', (tester) async {
    await tester.pumpWidget(app(MessageBubble(message: message(editedAt: DateTime.utc(2026, 10, 20, 9, 5)), showAuthor: false)));
    await tester.pumpAndSettle();
    expect(find.text('Edited'), findsOneWidget);
  });

  testWidgets('in Arabic too', (tester) async {
    await tester.pumpWidget(app(
      MessageBubble(message: message(editedAt: DateTime.utc(2026, 10, 20, 9, 5)), showAuthor: false),
      locale: const Locale('ar'),
    ));
    await tester.pumpAndSettle();
    expect(find.text(L10n.of(tester.element(find.byType(MessageBubble))).editedMark), findsOneWidget);
    expect(L10n.of(tester.element(find.byType(MessageBubble))).editedMark, isNot('Edited'));
  });

  testWidgets('a message never edited, or deleted, shows no mark', (tester) async {
    await tester.pumpWidget(app(Column(children: [
      MessageBubble(message: message(), showAuthor: false),
      MessageBubble(message: message(editedAt: DateTime.utc(2026, 10, 20, 9, 5), deleted: true), showAuthor: false),
    ])));
    await tester.pumpAndSettle();
    expect(find.text('Edited'), findsNothing);
  });
}
