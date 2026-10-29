import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/system_message_text.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The backend writes a system message's body as `{ "kind": ..., ...facts }`.
/// It was shown raw (`{"kind":"group.created","learner":"..."}`); it must read
/// as words, in both languages, and never as JSON.
void main() {
  final en = lookupL10n(const Locale('en'));
  final ar = lookupL10n(const Locale('ar'));

  test('group.created names the learner', () {
    expect(
      systemMessageText('{"kind":"group.created","learner":"QA Learner A"}', en),
      'Student Group created for QA Learner A',
    );
    expect(
      systemMessageText('{"kind":"group.created","learner":"QA Learner A"}', ar),
      'أُنشئت مجموعة الطالب لـ QA Learner A',
    );
  });

  test('group.created without a learner still reads as words', () {
    expect(systemMessageText('{"kind":"group.created"}', en), 'Student Group created');
  });

  test('membership changes and archiving', () {
    expect(
      systemMessageText('{"kind":"group.membership_changed","added":2,"removed":1}', en),
      'Group members updated (+2 / −1)',
    );
    expect(systemMessageText('{"kind":"group.archived","reason":"x"}', en), 'Group archived');
  });

  test('PD-24: a supervisor change reads as words in the group and in the parent\'s 1:1', () {
    expect(
      systemMessageText('{"kind":"group.supervisor_changed","supervisor":"Salma Khalil"}', en),
      "Salma Khalil is now this group's supervisor",
    );
    expect(
      systemMessageText('{"kind":"group.supervisor_changed","supervisor":"Salma Khalil"}', ar),
      'أصبح Salma Khalil مشرف هذه المجموعة',
    );
    expect(systemMessageText('{"kind":"group.supervisor_changed"}', en), "This group's supervisor changed");
    expect(
      systemMessageText('{"kind":"direct.supervisor_changed","supervisor":"Salma Khalil"}', en),
      'Salma Khalil is now your supervisor; the chat history is kept',
    );
    expect(systemMessageText('{"kind":"group.learner_detached"}', en), 'A child of this group moved to another supervisor');
  });

  test('PD-42: a child added to the family joins its group', () {
    expect(systemMessageText('{"kind":"group.learner_added","learner":"QA Learner B"}', en), 'QA Learner B joined this group');
    expect(systemMessageText('{"kind":"group.learner_added","learner":"QA Learner B"}', ar), 'انضم QA Learner B إلى هذه المجموعة');
    expect(systemMessageText('{"kind":"group.learner_added"}', en), 'A child joined this group');
    expect(systemMessageText('{"kind":"group.learner_added"}', ar), 'انضم طفل إلى هذه المجموعة');
  });

  test('an unknown kind, non-object JSON or non-JSON reads as a generic update, never raw', () {
    for (final body in ['{"kind":"some.future.kind"}', '[1,2]', 'not json', '']) {
      final text = systemMessageText(body, en);
      expect(text, 'System update', reason: body);
      expect(text.contains('{'), isFalse, reason: body);
    }
  });

  testWidgets('the bubble shows the words, not the JSON body', (tester) async {
    final m = Message(
      id: 'srv_sys',
      clientMessageId: 'cmid_sys',
      conversationId: 'conv_1',
      sequence: 1,
      authorId: 'system',
      authorName: '',
      authorRole: ParticipantRole.system,
      kind: MessageKind.system,
      body: '{"kind":"group.created","learner":"QA Learner A"}',
      createdAt: DateTime.utc(2026, 10, 14, 12),
      deliveryState: DeliveryState.delivered,
      isMine: false,
    );
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
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
    await tester.pumpAndSettle();
    expect(find.text('Student Group created for QA Learner A'), findsOneWidget);
    expect(find.textContaining('"kind"'), findsNothing);
  });

  test('PD-35: a visible seat, taken and left, reads as words with the role', () {
    expect(
      systemMessageText('{"kind":"seat.joined","name":"Ola Mahmoud","role":"teacher_supervisor","reason":"supervision"}', en),
      'Ola Mahmoud (teacher supervisor) joined to support',
    );
    expect(
      systemMessageText('{"kind":"seat.joined","name":"Ola Mahmoud","role":"teacher_supervisor","reason":"supervision"}', ar),
      'انضم Ola Mahmoud (مشرف المعلمين) للمساندة',
    );
    expect(
      systemMessageText('{"kind":"seat.stepped_in","name":"Laila Mansour","role":"manager","reason":"mention"}', en),
      'Laila Mansour (manager) is following this chat',
    );
    expect(systemMessageText('{"kind":"seat.left","name":"Ola Mahmoud","ended":"left"}', en), 'Ola Mahmoud left');
    expect(systemMessageText('{"kind":"seat.left","name":"Ola Mahmoud","ended":"idle"}', en), 'Ola Mahmoud left (no activity)');
    // An unknown role word shows the name alone; a missing name never shows JSON.
    expect(systemMessageText('{"kind":"seat.joined","name":"Ola","role":"astronaut"}', en), 'Ola joined to support');
    expect(systemMessageText('{"kind":"seat.left"}', en), 'A team member left');
  });
}
