import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// PD-30 in the chat: a group locked for payment shows a banner where the composer was --
/// naming each child, with the reason and the way to Subscriptions for a parent, and only
/// "lessons are paused" for a teacher. A send the server refuses as locked shows the same
/// banner rather than a failure to retry.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
  });

  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  String id() => backend.listConversations().first.id;

  Conversation locked(PaymentLock lock) => Conversation(
        id: id(),
        kind: ConversationKind.studentGroup,
        title: 'Adam',
        updatedAt: DateTime(2026, 10, 26),
        paymentLock: lock,
      );

  Widget harness({
    required UserRole role,
    Conversation? conversation,
    ValueChanged<String>? onOpenSubscriptions,
    MessageRepository? messages,
    ConversationRepository? conversations,
    Locale locale = const Locale('en'),
  }) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        conversationRepositoryProvider.overrideWithValue(conversations ?? FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(messages ?? FakeMessageRepository(backend)),
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
          conversationId: id(),
          title: 'Adam',
          kind: ConversationKind.studentGroup,
          conversation: conversation,
          onOpenSubscriptions: onOpenSubscriptions,
        ),
      ),
    );
  }

  final parentLock = PaymentLock(
    readOnly: true,
    canPay: true,
    children: [
      const LockedChild(id: 'k1', name: 'Adam', reasons: ['balance']),
      LockedChild(id: 'k2', name: 'Sara', reasons: const ['overdue'], overdueLabel: '2/3', overdueDueDate: DateTime(2026, 10, 1)),
    ],
  );

  group('GET /conversations/:id -> paymentLock', () {
    test('read as sent, and absent reads as not locked', () {
      final c = WireMappers.conversation({
        'id': 'c1',
        'type': 'student_group',
        'paymentLock': {
          'readOnly': true,
          'canPay': true,
          'children': [
            {'id': 'k1', 'name': 'Adam', 'reasons': ['balance', 'overdue'], 'overdue': {'label': '2/3', 'dueDate': '2026-10-01'}},
            {'name': 'no id'},
          ],
        },
      }, viewerRole: UserRole.parent);
      final lock = c.paymentLock!;
      expect(lock.readOnly, isTrue);
      expect(lock.canPay, isTrue);
      expect(lock.children.single.name, 'Adam');
      expect(lock.children.single.reasons, ['balance', 'overdue']);
      expect(lock.children.single.overdueLabel, '2/3');
      expect(lock.children.single.overdueDueDate, DateTime(2026, 10, 1));

      expect(WireMappers.conversation({'id': 'c1', 'type': 'student_group'}, viewerRole: UserRole.parent).paymentLock, isNull);
      expect(
        WireMappers.conversation({'id': 'c1', 'type': 'student_group', 'paymentLock': null}, viewerRole: UserRole.parent).paymentLock,
        isNull,
      );
    });
  });

  group('the locked banner replaces the composer', () {
    testWidgets('a parent: each child with the reason, and Go to Subscriptions at that child', (tester) async {
      final opened = <String>[];
      await tester.pumpWidget(harness(role: UserRole.parent, conversation: locked(parentLock), onOpenSubscriptions: opened.add));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('payment-lock-banner')), findsOneWidget);
      expect(find.text('Lessons are paused'), findsOneWidget);
      expect(find.text('Adam: lessons used up'), findsOneWidget);
      // Overdue from the day after the due date.
      expect(find.text('Sara: instalment 2/3 overdue since Oct 2, 2026'), findsOneWidget);
      // No composer: no text field, no send, no attach.
      expect(find.byType(TextField), findsNothing);
      expect(find.byIcon(Icons.send), findsNothing);

      await tester.tap(find.byKey(const ValueKey('payment-lock-open-k2')));
      expect(opened, ['k2']);
    });

    testWidgets('a teacher: only that the lessons are paused -- no reason, no button', (tester) async {
      const teacherLock = PaymentLock(readOnly: true, canPay: false, children: [LockedChild(id: 'k1', name: 'Adam')]);
      await tester.pumpWidget(harness(role: UserRole.teacher, conversation: locked(teacherLock), onOpenSubscriptions: (_) {}));
      await tester.pumpAndSettle();

      expect(find.text("Adam's lessons are paused"), findsOneWidget);
      expect(find.textContaining('used up'), findsNothing);
      expect(find.textContaining('overdue'), findsNothing);
      expect(find.byKey(const ValueKey('payment-lock-open-k1')), findsNothing);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('staff (readOnly false): the composer stays', (tester) async {
      await tester.pumpWidget(harness(
        role: UserRole.sales,
        conversation: locked(const PaymentLock(readOnly: false, canPay: false, children: [LockedChild(id: 'k1', name: 'Adam', reasons: ['balance'])])),
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('payment-lock-banner')), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('in Arabic', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent, conversation: locked(parentLock), onOpenSubscriptions: (_) {}, locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(find.text('الحصص متوقفة مؤقتًا'), findsOneWidget);
      expect(find.text('Adam: انتهت الحصص'), findsOneWidget);
      expect(find.text('الذهاب إلى الاشتراكات'), findsNWidgets(2));
    });
  });

  testWidgets('a send refused as COMM.SUBSCRIPTION_LOCKED shows the banner, not an error', (tester) async {
    final conversations = _LockedOnRead(backend, parentLock);
    await tester.pumpWidget(harness(
      role: UserRole.parent,
      messages: _RefusesLocked(backend),
      conversations: conversations,
      onOpenSubscriptions: (_) {},
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('payment-lock-banner')), findsNothing);

    await tester.enterText(find.byType(TextField), 'Hello');
    // The send button replaces the microphone only once the field has text.
    await tester.pump();
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    expect(conversations.reads, 1);
    expect(find.byKey(const ValueKey('payment-lock-banner')), findsOneWidget);
    expect(find.text('Adam: lessons used up'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });

  group('PD-30 cards in the thread', () {
    Message card(String kind, Map<String, Object?> payload, String body) => WireMappers.message({
          'id': 'm-$kind',
          'conversationId': 'c1',
          'seq': '7',
          'authorKind': 'staff',
          'authorId': 's1',
          'type': 'card',
          'body': body,
          'visibility': 'customer',
          'moderation': 'published',
          'createdAt': '2026-10-26T09:00:00.000Z',
          'attachments': <Object?>[],
          'reactions': <Object?>[],
          'receipts': <Object?>[],
          'card': {'kind': kind, 'lessonId': null, 'payload': payload},
        }, viewerActorId: 'p1');

    Widget bubble(Message m) => ProviderScope(
          overrides: [currentRoleProvider.overrideWithValue(UserRole.parent)],
          child: MaterialApp(
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
            home: Scaffold(body: MessageBubble(message: m, showAuthor: true)),
          ),
        );

    testWidgets("kinds this build does not style keep the server's text", (tester) async {
      for (final kind in ['subscription_grace', 'subscription_renewal_requested', 'some_future_kind']) {
        await tester.pumpWidget(bubble(card(kind, const {'learnerName': 'Adam', 'graceLeft': 2}, 'plain-text fallback $kind')));
        await tester.pumpAndSettle();
        expect(find.text('plain-text fallback $kind'), findsOneWidget, reason: kind);
      }
    });

    testWidgets('paused, locked and back on have their own card', (tester) async {
      await tester.pumpWidget(bubble(card('lessons_paused', const {'learnerId': 'k1', 'learnerName': 'Adam'}, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('Lessons paused'), findsOneWidget);
      expect(find.text('Adam'), findsOneWidget);
      expect(find.text('fallback'), findsNothing);

      await tester.pumpWidget(bubble(card('subscription_locked', const {
        'learnerId': 'k1',
        'learnerName': 'Adam',
        'reasons': ['balance', 'overdue'],
        'instalmentLabel': '2/3',
        'overdueSince': '2026-10-02',
      }, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('Lessons paused — payment'), findsOneWidget);
      expect(find.text('Lessons used up'), findsOneWidget);
      // overdueSince is already the day after the due date; shown in the reader's format.
      expect(find.textContaining('Instalment 2/3 overdue since'), findsOneWidget);
      expect(find.textContaining('Oct 2'), findsOneWidget);
      expect(find.text('Renew or pay in Subscriptions.'), findsOneWidget);

      await tester.pumpWidget(bubble(card('subscription_unlocked', const {'learnerId': 'k1', 'learnerName': 'Adam'}, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('Lessons are back on'), findsOneWidget);
    });
  });
}

/// Every send is refused: the group locked after the screen opened.
class _RefusesLocked extends FakeMessageRepository {
  _RefusesLocked(super.backend);

  @override
  Future<Message> send(OutgoingMessage message) async =>
      throw const AppError(AppErrorKind.forbidden, code: BillingErrors.subscriptionLocked);
}

/// The conversation, read again after the refusal, says which child and why.
class _LockedOnRead extends FakeConversationRepository {
  _LockedOnRead(super.backend, this.lock);

  final PaymentLock lock;
  int reads = 0;

  @override
  Future<Conversation> byId(String conversationId) async {
    reads++;
    final c = await super.byId(conversationId);
    return Conversation(id: c.id, kind: c.kind, title: c.title, updatedAt: c.updatedAt, paymentLock: lock);
  }
}
