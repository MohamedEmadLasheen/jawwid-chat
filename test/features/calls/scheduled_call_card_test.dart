/// PD-13 chat cards: `call_scheduled`, `call_link`, `call_schedule_cancelled`.
///
/// The Join button is enabled inside `[joinableFrom, joinableUntil]` by the
/// device's clock and re-checked at the tap; the server's answer is final.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/features/calls/presentation/scheduled_call_card_view.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import 'calls_page_fakes.dart';

void main() {
  late L10n l10n;
  setUpAll(() async => l10n = await L10n.delegate.load(const Locale('en')));

  final start = DateTime(2026, 10, 20, 18);

  MessageCard card(String kind, {String? title = 'Weekly review'}) =>
      MessageCard(
        kind: kind,
        payload: {
          'scheduledCallId': 'sc_9',
          'kind': kind == ScheduledCallCards.link ? 'link' : 'scheduled',
          'title': ?title,
          'startsAt': start.toUtc().toIso8601String(),
          'joinableFrom': start
              .subtract(const Duration(minutes: 10))
              .toUtc()
              .toIso8601String(),
          'joinableUntil': start
              .add(const Duration(hours: 2))
              .toUtc()
              .toIso8601String(),
          'when': 'Tue 20 Oct, 18:00',
          'byName': 'Ms. Dina',
        },
      );

  Future<RecordingCallController> pump(
    WidgetTester tester,
    MessageCard c, {
    required DateTime Function() clock,
  }) async {
    final controller = RecordingCallController();
    await tester.pumpWidget(
      callsHarness(
        home: Scaffold(
          body: ScheduledCallCard(
            card: c,
            foreground: const ColorScheme.light().onSurface,
            conversationId: 'g1',
            clock: clock,
          ),
        ),
        conversations: [
          conv('g1', 'Omar · Quran', kind: ConversationKind.studentGroup),
        ],
        calls: PerConversationCalls({}),
        scheduledCalls: RecordingScheduled(),
        controller: () => controller,
      ),
    );
    await tester.pumpAndSettle();
    return controller;
  }

  FilledButton joinButton(WidgetTester tester) => tester.widget<FilledButton>(
    find.byKey(const ValueKey('scheduled-call-join')),
  );

  testWidgets(
    'before the window the card says when, by whom, and Join is disabled',
    (tester) async {
      await pump(
        tester,
        card(ScheduledCallCards.scheduled),
        clock: () => start.subtract(const Duration(hours: 1)),
      );

      expect(find.text(l10n.scheduledCallDefaultTitle), findsOneWidget);
      expect(find.text('Weekly review'), findsOneWidget);
      // PD-22: the reader's own clock, from `startsAt` -- not the server's `when`, which is
      // written in the academy's zone for everyone in the conversation.
      const material = DefaultMaterialLocalizations();
      expect(
        find.text(
          '${material.formatMediumDate(start)} · '
          '${material.formatTimeOfDay(TimeOfDay.fromDateTime(start))}',
        ),
        findsOneWidget,
      );
      expect(find.text('Tue 20 Oct, 18:00'), findsNothing);
      expect(find.text(l10n.scheduledCallBy('Ms. Dina')), findsOneWidget);
      expect(joinButton(tester).onPressed, isNull);
      expect(find.text(l10n.scheduledCallJoinHint), findsOneWidget);
    },
  );

  testWidgets(
    'inside the window Join is enabled and goes through joinScheduled',
    (tester) async {
      final controller = await pump(
        tester,
        card(ScheduledCallCards.scheduled),
        clock: () => start.subtract(const Duration(minutes: 5)),
      );

      expect(joinButton(tester).onPressed, isNotNull);
      await tester.tap(find.byKey(const ValueKey('scheduled-call-join')));
      await tester.pumpAndSettle();

      expect(controller.scheduledJoins.single.scheduledCallId, 'sc_9');
      expect(controller.scheduledJoins.single.conversationId, 'g1');
      expect(controller.scheduledJoins.single.peerLabel, 'Omar · Quran');
      expect(controller.scheduledJoins.single.isGroup, isTrue);
    },
  );

  testWidgets(
    'the window is re-checked at the tap, not trusted from the draw',
    (tester) async {
      var now = start.add(const Duration(hours: 1));
      final controller = await pump(
        tester,
        card(ScheduledCallCards.link),
        clock: () => now,
      );
      expect(joinButton(tester).onPressed, isNotNull);

      // The window closes while the button is on screen.
      now = start.add(const Duration(hours: 3));
      await tester.tap(find.byKey(const ValueKey('scheduled-call-join')));
      await tester.pumpAndSettle();

      expect(controller.scheduledJoins, isEmpty);
      expect(find.text(l10n.scheduledJoinNotJoinable), findsOneWidget);
      expect(joinButton(tester).onPressed, isNull);
    },
  );

  testWidgets('after the window Join is disabled', (tester) async {
    await pump(
      tester,
      card(ScheduledCallCards.link),
      clock: () => start.add(const Duration(hours: 2, minutes: 1)),
    );

    expect(find.text(l10n.scheduledCallLinkLabel), findsOneWidget);
    expect(joinButton(tester).onPressed, isNull);
  });

  testWidgets('a cancellation card is muted and has no button', (tester) async {
    await pump(tester, card(ScheduledCallCards.cancelled), clock: () => start);

    expect(find.text(l10n.scheduledCallCancelled), findsOneWidget);
    expect(find.byKey(const ValueKey('scheduled-call-join')), findsNothing);
    expect(find.text(l10n.scheduledCallJoin), findsNothing);
  });

  test('other card kinds are left to the rest of the chain', () {
    final view = scheduledCallCardView(
      _FakeContext(),
      const MessageCard(kind: 'lesson_report', payload: {}),
      const Color(0xFF000000),
      conversationId: 'g1',
    );
    expect(view, isNull);
  });

  testWidgets(
    'the message bubble draws the card instead of its plain-text body',
    (tester) async {
      await tester.pumpWidget(
        callsHarness(
          home: Scaffold(
            body: MessageBubble(
              message: Message(
                clientMessageId: 'm1',
                conversationId: 'g1',
                kind: MessageKind.card,
                createdAt: start,
                deliveryState: DeliveryState.sent,
                body: 'PLAIN TEXT FALLBACK',
                card: card(ScheduledCallCards.scheduled),
              ),
              showAuthor: false,
            ),
          ),
          conversations: [
            conv('g1', 'Omar · Quran', kind: ConversationKind.studentGroup),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(ScheduledCallCard), findsOneWidget);
      expect(find.text('PLAIN TEXT FALLBACK'), findsNothing);
    },
  );
}

class _FakeContext extends Fake implements BuildContext {}
