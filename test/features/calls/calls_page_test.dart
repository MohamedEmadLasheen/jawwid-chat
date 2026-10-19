/// The PD-13 Calls page: four actions, Upcoming, Favourites and Recent.
///
/// The page decides nothing. These tests hold it to that: the call button is
/// absent where the server's capability says no, a parent's group Start call is
/// refused in words, the order of every section is the server's, and the only
/// people offered are the user's own conversations.
library;

import 'package:flutter/material.dart' hide Page;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/features/calls/presentation/calls_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'calls_page_fakes.dart';

void main() {
  late L10n l10n;
  setUpAll(() async => l10n = await L10n.delegate.load(const Locale('en')));

  final people = conv('d1', 'Mr. Ahmed', pinned: true);
  final staff = conv('d2', 'Jawwid Support');
  final group = conv(
    'g1',
    'Omar · Quran',
    kind: ConversationKind.studentGroup,
    pinned: true,
  );

  CallHistoryEntry entry({
    String id = 'call_1',
    String conversationId = 'd1',
    String title = 'Mr. Ahmed',
    CallOutcome outcome = CallOutcome.answered,
    CallHistoryDirection? direction,
    bool isGroup = false,
  }) => CallHistoryEntry(
    id: id,
    conversationId: conversationId,
    title: title,
    startedAt: DateTime.now().subtract(const Duration(hours: 1)),
    outcome: outcome,
    isGroup: isGroup,
    duration: const Duration(minutes: 2),
    direction: direction,
  );

  for (final role in UserRole.values) {
    testWidgets('${role.name}: the same four actions and three sections', (
      tester,
    ) async {
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          role: role,
          conversations: [people, group],
          calls: PerConversationCalls({}),
          scheduledCalls: RecordingScheduled(),
          history: StaticHistory([entry()]),
        ),
      );
      await tester.pumpAndSettle();

      for (final label in [
        l10n.callActionStart,
        l10n.callActionNewLink,
        l10n.callActionSelectMember,
        l10n.callActionSchedule,
        l10n.callsSectionUpcoming,
        l10n.callsSectionFavorites,
        l10n.callsSectionRecent,
      ]) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      // Voice only, and no dial pad of any kind.
      for (final icon in [
        Icons.videocam,
        Icons.videocam_outlined,
        Icons.dialpad,
      ]) {
        expect(find.byIcon(icon), findsNothing);
      }
      expect(find.text(l10n.callsUpcomingEmpty), findsOneWidget);
    });
  }

  testWidgets(
    'Upcoming shows Join only inside the window, and Cancel only for the creator',
    (tester) async {
      final now = DateTime.now();
      final repo = RecordingScheduled(
        items: [
          scheduled(
            id: 'open',
            conversationId: 'g1',
            title: 'Weekly review',
            startsAt: now.subtract(const Duration(minutes: 5)),
            state: ScheduledCallState.open,
            canCancel: true,
          ),
          scheduled(
            id: 'later',
            conversationId: 'd1',
            startsAt: now.add(const Duration(days: 2)),
          ),
        ],
      );
      final controller = RecordingCallController();

      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people, group],
          calls: PerConversationCalls({}),
          scheduledCalls: repo,
          history: StaticHistory(const []),
          controller: () => controller,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Weekly review'), findsOneWidget);
      expect(find.text(l10n.scheduledCallStateOpen), findsOneWidget);
      expect(find.text(l10n.scheduledCallStateUpcoming), findsOneWidget);
      // One Join (the open one); one menu (the creator's).
      expect(find.text(l10n.scheduledCallJoin), findsOneWidget);
      expect(find.byType(PopupMenuButton<String>), findsOneWidget);

      await tester.tap(find.text(l10n.scheduledCallJoin));
      await tester.pumpAndSettle();
      expect(controller.scheduledJoins.single.scheduledCallId, 'open');
      expect(controller.scheduledJoins.single.conversationId, 'g1');
      expect(controller.scheduledJoins.single.isGroup, isTrue);
      expect(controller.scheduledJoins.single.peerLabel, 'Omar · Quran');

      // Cancel asks first, then tells the server.
      await tester.tap(find.byType(PopupMenuButton<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text(l10n.scheduledCallCancel).last);
      await tester.pumpAndSettle();
      expect(find.text(l10n.scheduledCallCancelConfirmTitle), findsOneWidget);
      await tester.tap(find.text(l10n.scheduledCallCancel).last);
      await tester.pumpAndSettle();
      expect(repo.cancels, ['open']);
    },
  );

  testWidgets('a refused Join is a sentence, never a code', (tester) async {
    final controller = RecordingCallController()
      ..joinResult = ScheduledJoinResult.waitingForHost;
    await tester.pumpWidget(
      callsHarness(
        home: const CallsScreen(),
        conversations: [group],
        calls: PerConversationCalls({}),
        scheduledCalls: RecordingScheduled(
          items: [
            scheduled(
              conversationId: 'g1',
              startsAt: DateTime.now(),
              state: ScheduledCallState.open,
            ),
          ],
        ),
        history: StaticHistory(const []),
        controller: () => controller,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(l10n.scheduledCallJoin));
    await tester.pumpAndSettle();

    expect(find.text(l10n.scheduledJoinWaitingForHost), findsOneWidget);
    expect(find.textContaining('COMM.'), findsNothing);
  });

  testWidgets(
    'a scheduled-call build that is not wired hides Upcoming rather than calling it empty',
    (tester) async {
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people],
          calls: PerConversationCalls({}),
          history: StaticHistory(const []),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callsSectionUpcoming), findsNothing);
      expect(find.text(l10n.callsUpcomingEmpty), findsNothing);
    },
  );

  testWidgets(
    'Favourites are the pinned chats; the call button follows the capability',
    (tester) async {
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people, staff, group],
          calls: PerConversationCalls({
            'd1': const CallCapability(canCall: true),
            'g1': const CallCapability(
              canCall: false,
              code: ScheduledCallCodes.parentCannotStartGroupCall,
            ),
          }),
          scheduledCalls: RecordingScheduled(),
          history: StaticHistory(const []),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Mr. Ahmed'), findsOneWidget);
      expect(find.text('Omar · Quran'), findsOneWidget);
      // Not pinned, so not a favourite.
      expect(find.text('Jawwid Support'), findsNothing);
      // Exactly one call button: for the 1:1 the server said yes to.
      expect(find.byTooltip(l10n.callVoice), findsOneWidget);
    },
  );

  testWidgets(
    'Recent shows direction, status and a group named after its conversation',
    (tester) async {
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people, group],
          calls: PerConversationCalls({
            'd1': const CallCapability(canCall: true),
          }),
          scheduledCalls: RecordingScheduled(),
          history: StaticHistory([
            entry(id: 'a', direction: CallHistoryDirection.outgoing),
            entry(
              id: 'b',
              conversationId: 'g1',
              title: '',
              isGroup: true,
              outcome: CallOutcome.missed,
              direction: CallHistoryDirection.incoming,
            ),
          ]),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.call_made), findsOneWidget);
      expect(find.byIcon(Icons.call_missed), findsOneWidget);
      expect(find.textContaining(l10n.callOutcomeMissed), findsOneWidget);
      // The group call row carries the group's name, resolved from the chat list.
      expect(find.text('Omar · Quran'), findsWidgets);
      // The date and time are on the row.
      expect(find.textContaining(l10n.todayLabel), findsNWidgets(2));
      // Call back only where the server says the conversation may be called.
      expect(find.byTooltip(l10n.callBack), findsOneWidget);
    },
  );

  testWidgets('search narrows every section by name', (tester) async {
    await tester.pumpWidget(
      callsHarness(
        home: const CallsScreen(),
        conversations: [people, group],
        calls: PerConversationCalls({}),
        scheduledCalls: RecordingScheduled(
          items: [scheduled(conversationId: 'g1', title: 'Weekly review')],
        ),
        history: StaticHistory([entry()]),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'omar');
    await tester.pumpAndSettle();

    expect(find.text('Mr. Ahmed'), findsNothing);
    expect(find.text('Weekly review'), findsOneWidget);
    expect(find.text('Omar · Quran'), findsWidgets);

    await tester.enterText(find.byType(TextField), 'zzzz');
    await tester.pumpAndSettle();
    expect(find.text(l10n.callsSearchNoMatch), findsOneWidget);
  });

  testWidgets(
    'a parent picking a group for Start call is told why, and nothing is called',
    (tester) async {
      final controller = RecordingCallController();
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people, group],
          calls: PerConversationCalls({
            'g1': const CallCapability(
              canCall: false,
              code: ScheduledCallCodes.parentCannotStartGroupCall,
            ),
          }),
          scheduledCalls: RecordingScheduled(),
          history: StaticHistory(const []),
          controller: () => controller,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text(l10n.callActionStart));
      await tester.pumpAndSettle();
      await tester.tap(
        find
            .descendant(
              of: find.byType(ListTile),
              matching: find.text('Omar · Quran'),
            )
            .last,
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callRefusedParentGroup), findsOneWidget);
      expect(controller.starts, isEmpty);
    },
  );

  testWidgets(
    'Start call on a 1:1 the server allows starts it through the call controller',
    (tester) async {
      final controller = RecordingCallController();
      await tester.pumpWidget(
        callsHarness(
          home: const CallsScreen(),
          conversations: [people, group],
          calls: PerConversationCalls({
            'd1': const CallCapability(canCall: true),
          }),
          scheduledCalls: RecordingScheduled(),
          history: StaticHistory(const []),
          controller: () => controller,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text(l10n.callActionStart));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text('Mr. Ahmed'),
        ),
      );
      await tester.pumpAndSettle();

      expect(controller.starts.single.conversationId, 'd1');
      expect(controller.starts.single.isGroup, isFalse);
    },
  );

  testWidgets('New call link posts a link and offers Join now', (tester) async {
    final controller = RecordingCallController();
    final repo = RecordingScheduled();
    await tester.pumpWidget(
      callsHarness(
        home: const CallsScreen(),
        conversations: [people],
        calls: PerConversationCalls({
          'd1': const CallCapability(canCall: true),
        }),
        scheduledCalls: repo,
        history: StaticHistory(const []),
        controller: () => controller,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(l10n.callActionNewLink));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text('Mr. Ahmed'),
      ),
    );
    await tester.pumpAndSettle();

    expect(repo.creates.single.kind, ScheduledCallKind.link);
    expect(repo.creates.single.conversationId, 'd1');
    expect(find.text(l10n.callLinkPosted('Mr. Ahmed')), findsOneWidget);

    await tester.tap(find.text(l10n.callLinkJoinNow));
    await tester.pumpAndSettle();
    expect(controller.scheduledJoins.single.scheduledCallId, 'sc_1');
    expect(controller.scheduledJoins.single.conversationId, 'd1');
  });

  testWidgets('Select a member offers voice call, message and schedule', (
    tester,
  ) async {
    await tester.pumpWidget(
      callsHarness(
        home: const CallsScreen(),
        conversations: [people],
        calls: PerConversationCalls({}),
        scheduledCalls: RecordingScheduled(),
        history: StaticHistory(const []),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(l10n.callActionSelectMember));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text('Mr. Ahmed'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(l10n.callVoice), findsOneWidget);
    expect(find.text(l10n.callMessage), findsOneWidget);
    expect(find.text(l10n.callActionSchedule), findsWidgets);
  });

  testWidgets('Arabic lays the page out right-to-left', (tester) async {
    await tester.pumpWidget(
      callsHarness(
        home: const CallsScreen(),
        locale: const Locale('ar'),
        conversations: [people],
        calls: PerConversationCalls({}),
        scheduledCalls: RecordingScheduled(),
        history: StaticHistory([entry()]),
      ),
    );
    await tester.pumpAndSettle();
    final ar = await L10n.delegate.load(const Locale('ar'));

    expect(find.text(ar.callActionStart), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text(ar.callActionStart))),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });
}
