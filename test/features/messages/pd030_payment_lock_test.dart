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
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// PD-30 in the chat, after D-3 (owner, 2026-11-06): the chat stays open and only new lesson
/// bookings pause. A group with such a child shows an informational strip ABOVE the composer,
/// never in its place. A parent reads the reason for each child and gets "Go to Subscriptions"
/// ("عرض الاشتراكات"); a teacher reads only that new lessons are paused and the chat stays open
/// -- nothing financial, even if a server sent it.
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

  const enLine = 'The chat stays open, and lessons already booked go ahead.';
  const arLine = 'المحادثة تبقى مفتوحة، والحصص المحجوزة مسبقًا تُقام في موعدها.';
  // Anything that tells the family's financial state.
  final financialText = RegExp(r'used up|overdue|instalment|Subscriptions|انتهت|متأخر|القسط|الاشتراكات|2/3');

  group('D-3: the banner sits above the composer; the chat stays open', () {
    testWidgets('a parent: each child with the reason, Go to Subscriptions at that child, and the composer', (tester) async {
      final opened = <String>[];
      await tester.pumpWidget(harness(role: UserRole.parent, conversation: locked(parentLock), onOpenSubscriptions: opened.add));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('payment-lock-banner')), findsOneWidget);
      expect(find.text('New lessons are paused'), findsOneWidget);
      expect(find.text('Adam: lessons used up'), findsOneWidget);
      // Overdue from the day after the due date.
      expect(find.text('Sara: instalment 2/3 overdue since Oct 2, 2026'), findsOneWidget);
      expect(find.text(enLine), findsOneWidget);
      expect(find.text('Go to Subscriptions'), findsNWidgets(2));
      // The composer stays, below the banner -- even though this lock says readOnly
      // (no server sends that any more; an old one must not close the chat).
      expect(find.byType(TextField), findsOneWidget);
      expect(
        tester.getTopLeft(find.byKey(const ValueKey('payment-lock-banner'))).dy,
        lessThan(tester.getTopLeft(find.byType(TextField)).dy),
      );

      await tester.tap(find.byKey(const ValueKey('payment-lock-open-k2')));
      expect(opened, ['k2']);
    });

    testWidgets('a parent, in Arabic: the reason and «عرض الاشتراكات»', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent, conversation: locked(parentLock), onOpenSubscriptions: (_) {}, locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(find.text('حجز الحصص الجديدة متوقف مؤقتًا'), findsOneWidget);
      expect(find.text('Adam: انتهت الحصص'), findsOneWidget);
      expect(find.textContaining('Sara: القسط 2/3 متأخر منذ'), findsOneWidget);
      expect(find.text(arLine), findsOneWidget);
      expect(find.text('عرض الاشتراكات'), findsNWidgets(2));
      expect(find.text('الذهاب إلى الاشتراكات'), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('a parent, a child the server gave no reason for: "new lessons paused"', (tester) async {
      await tester.pumpWidget(harness(
        role: UserRole.parent,
        conversation: locked(const PaymentLock(readOnly: false, canPay: true, children: [LockedChild(id: 'k1', name: 'Adam')])),
        onOpenSubscriptions: (_) {},
      ));
      await tester.pumpAndSettle();
      expect(find.text('Adam: new lessons paused'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });

    for (final (locale, title, line) in [
      (const Locale('en'), 'New lessons are paused', enLine),
      (const Locale('ar'), 'حجز الحصص الجديدة متوقف مؤقتًا', arLine),
    ]) {
      testWidgets('a teacher (${locale.languageCode}): only the heading and that the chat stays open -- nothing financial', (tester) async {
        // Even a lock carrying reasons and canPay (no server sends a teacher that) shows nothing financial.
        await tester.pumpWidget(harness(role: UserRole.teacher, conversation: locked(parentLock), onOpenSubscriptions: (_) {}, locale: locale));
        await tester.pumpAndSettle();

        expect(find.text(title), findsOneWidget);
        expect(find.text(line), findsOneWidget);
        expect(find.byKey(const ValueKey('payment-lock-child-k1')), findsNothing);
        expect(find.byKey(const ValueKey('payment-lock-open-k1')), findsNothing);
        expect(find.byType(FilledButton), findsNothing);
        final banner = find.byKey(const ValueKey('payment-lock-banner'));
        final texts = tester.widgetList<Text>(find.descendant(of: banner, matching: find.byType(Text)));
        for (final t in texts) {
          expect(t.data ?? t.textSpan?.toPlainText() ?? '', isNot(matches(financialText)));
        }
        expect(find.byType(TextField), findsOneWidget);
      });
    }

    testWidgets('staff: the reasons, no pay button, and the composer', (tester) async {
      await tester.pumpWidget(harness(
        role: UserRole.sales,
        conversation: locked(const PaymentLock(readOnly: false, canPay: false, children: [LockedChild(id: 'k1', name: 'Adam', reasons: ['balance'])])),
        onOpenSubscriptions: (_) {},
      ));
      await tester.pumpAndSettle();

      expect(find.text('Adam: lessons used up'), findsOneWidget);
      expect(find.byKey(const ValueKey('payment-lock-open-k1')), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('no child paused: no banner', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('payment-lock-banner')), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
    });
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

    Widget bubble(Message m, {Locale locale = const Locale('en')}) => ProviderScope(
          overrides: [currentRoleProvider.overrideWithValue(UserRole.parent)],
          child: MaterialApp(
            locale: locale,
            theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [L10n.delegate, ...GlobalMaterialLocalizations.delegates],
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

    testWidgets('paused, locked and back on have their own card (D-3)', (tester) async {
      await tester.pumpWidget(bubble(card('lessons_paused', const {'learnerId': 'k1', 'learnerName': 'Adam'}, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('New lessons paused'), findsOneWidget);
      expect(find.text('Adam'), findsOneWidget);
      expect(find.text('Lessons already booked go ahead, and this chat stays open.'), findsOneWidget);
      expect(find.text('fallback'), findsNothing);

      await tester.pumpWidget(bubble(card('subscription_locked', const {
        'learnerId': 'k1',
        'learnerName': 'Adam',
        'reasons': ['balance', 'overdue'],
        'instalmentLabel': '2/3',
        'overdueSince': '2026-10-02',
      }, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('New lessons paused — payment'), findsOneWidget);
      expect(find.text('Lessons used up'), findsOneWidget);
      // overdueSince is already the day after the due date; shown in the reader's format.
      expect(find.textContaining('Instalment 2/3 overdue since'), findsOneWidget);
      expect(find.textContaining('Oct 2'), findsOneWidget);
      expect(
        find.text('Lessons already booked go ahead. To book new lessons, renew or pay the instalment in Subscriptions.'),
        findsOneWidget,
      );

      await tester.pumpWidget(bubble(card('subscription_unlocked', const {'learnerId': 'k1', 'learnerName': 'Adam'}, 'fallback')));
      await tester.pumpAndSettle();
      expect(find.text('New lessons are back on'), findsOneWidget);
    });

    testWidgets('in Arabic (D-3)', (tester) async {
      await tester.pumpWidget(bubble(card('lessons_paused', const {'learnerId': 'k1', 'learnerName': 'آدم'}, 'fallback'), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('توقّف حجز الحصص الجديدة'), findsOneWidget);
      expect(find.text('الحصص المحجوزة مسبقًا تُقام في موعدها، والمحادثة تبقى مفتوحة.'), findsOneWidget);

      await tester.pumpWidget(bubble(card('subscription_locked', const {
        'learnerId': 'k1', 'learnerName': 'آدم', 'reasons': ['balance'],
      }, 'fallback'), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('توقّف حجز الحصص الجديدة — الدفع'), findsOneWidget);
      expect(
        find.text('الحصص المحجوزة مسبقًا تُقام في موعدها. لحجز حصص جديدة، جدّدوا الاشتراك أو ادفعوا القسط من «الاشتراكات».'),
        findsOneWidget,
      );

      await tester.pumpWidget(bubble(card('subscription_unlocked', const {'learnerId': 'k1', 'learnerName': 'آدم'}, 'fallback'), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('عادت الحصص الجديدة'), findsOneWidget);
    });
  });
}
