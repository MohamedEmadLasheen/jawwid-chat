/// The member picker and the schedule sheet (PD-13).
///
/// The picker offers the user's own conversations only, split into People and
/// Groups, searchable by name with Arabic folding. The schedule sheet refuses a
/// time in the past and otherwise posts exactly what was chosen.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/features/calls/presentation/call_member_picker.dart';
import 'package:jawwid_chat/features/calls/presentation/schedule_call_sheet.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';

import 'calls_page_fakes.dart';

void main() {
  late L10n l10n;
  setUpAll(() async => l10n = await L10n.delegate.load(const Locale('en')));

  final conversations = [
    conv('d1', 'أحمد علي'),
    conv('d2', 'Jawwid Support'),
    conv('g1', 'Omar · Quran', kind: ConversationKind.studentGroup),
    conv('g2', 'Sara · Tajweed', kind: ConversationKind.studentGroup),
    // Nothing can be started in these, so they are never offered.
    conv('ro', 'Old chat', readOnly: true),
    conv('tp', 'PD-6 chat', kind: ConversationKind.teacherParentDirect),
  ];

  group('member picker', () {
    Future<void> pumpPicker(WidgetTester tester) async {
      await tester.pumpWidget(
        callsHarness(
          home: const Scaffold(
            body: CallMemberPicker(mode: CallPickerMode.call),
          ),
          conversations: conversations,
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('People and Groups, from the user\'s own chats only', (
      tester,
    ) async {
      await pumpPicker(tester);

      expect(find.text(l10n.callPickerPeople), findsOneWidget);
      expect(find.text(l10n.callPickerGroups), findsOneWidget);
      expect(find.byType(ListTile), findsNWidgets(4));
      expect(find.text('Old chat'), findsNothing);
      expect(find.text('PD-6 chat'), findsNothing);

      final peopleY = tester.getTopLeft(find.text(l10n.callPickerPeople)).dy;
      final groupsY = tester.getTopLeft(find.text(l10n.callPickerGroups)).dy;
      expect(
        tester.getTopLeft(find.text('Jawwid Support')).dy,
        inExclusiveRange(peopleY, groupsY),
      );
      expect(
        tester.getTopLeft(find.text('Omar · Quran')).dy,
        greaterThan(groupsY),
      );
    });

    testWidgets('search is by name, with Arabic folding', (tester) async {
      await pumpPicker(tester);

      // Typed without the hamza; stored with it.
      await tester.enterText(find.byType(TextField), 'احمد');
      await tester.pumpAndSettle();
      expect(find.byType(ListTile), findsOneWidget);
      expect(find.text('أحمد علي'), findsOneWidget);
      expect(find.text(l10n.callPickerGroups), findsNothing);

      await tester.enterText(find.byType(TextField), 'tajweed');
      await tester.pumpAndSettle();
      expect(find.byType(ListTile), findsOneWidget);
      expect(find.text(l10n.callPickerPeople), findsNothing);

      await tester.enterText(find.byType(TextField), 'nobody');
      await tester.pumpAndSettle();
      expect(find.text(l10n.callPickerNoMatch), findsOneWidget);
    });

    testWidgets('picking returns the conversation', (tester) async {
      Conversation? picked;
      await tester.pumpWidget(
        callsHarness(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async => picked = await showCallMemberPicker(
                  context,
                  mode: CallPickerMode.schedule,
                ),
                child: const Text('open'),
              ),
            ),
          ),
          conversations: conversations,
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text(l10n.callActionSchedule), findsOneWidget);

      await tester.tap(find.text('Omar · Quran'));
      await tester.pumpAndSettle();
      expect(picked?.id, 'g1');
    });
  });

  group('schedule sheet', () {
    final now = DateTime(2026, 10, 19, 12);
    final group = conv(
      'g1',
      'Omar · Quran',
      kind: ConversationKind.studentGroup,
    );

    Future<RecordingScheduled> pumpSheet(
      WidgetTester tester,
      DateTime initial,
    ) async {
      final repo = RecordingScheduled();
      await tester.pumpWidget(
        callsHarness(
          home: Scaffold(
            body: ScheduleCallSheet(
              conversation: group,
              initialStart: initial,
              clock: () => now,
            ),
          ),
          scheduledCalls: repo,
        ),
      );
      await tester.pumpAndSettle();
      return repo;
    }

    testWidgets('shows the picked chat, a date, a time and an optional title', (
      tester,
    ) async {
      await pumpSheet(tester, now.add(const Duration(days: 1)));

      expect(find.text('Omar · Quran'), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule-date')), findsOneWidget);
      expect(find.byKey(const ValueKey('schedule-time')), findsOneWidget);
      expect(find.text(l10n.callScheduleTitleLabel), findsOneWidget);
    });

    testWidgets('a time in the past is refused before anything is sent', (
      tester,
    ) async {
      final repo = await pumpSheet(
        tester,
        now.subtract(const Duration(hours: 1)),
      );

      await tester.tap(find.text(l10n.saveAction));
      await tester.pumpAndSettle();

      expect(find.text(l10n.callScheduleInPast), findsOneWidget);
      expect(repo.creates, isEmpty);
    });

    testWidgets('a future time posts kind scheduled with the start and title', (
      tester,
    ) async {
      final at = DateTime(2026, 10, 21, 17, 30);
      final repo = await pumpSheet(tester, at);

      await tester.enterText(find.byType(TextField), '  Monthly progress  ');
      await tester.tap(find.text(l10n.saveAction));
      await tester.pumpAndSettle();

      final sent = repo.creates.single;
      expect(sent.conversationId, 'g1');
      expect(sent.kind, ScheduledCallKind.scheduled);
      expect(sent.startsAt, at);
      expect(sent.title?.trim(), 'Monthly progress');
    });

    testWidgets('the title is capped at the server\'s limit', (tester) async {
      await pumpSheet(tester, now.add(const Duration(days: 1)));
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.maxLength, scheduledCallTitleMax);
      expect(scheduledCallTitleMax, 120);
    });

    testWidgets('a server refusal is shown in words on the sheet', (
      tester,
    ) async {
      final repo = RecordingScheduled()
        ..createError = const AppError(
          AppErrorKind.forbidden,
          code: ScheduledCallCodes.parentCannotStartGroupCall,
        );
      await tester.pumpWidget(
        callsHarness(
          home: Scaffold(
            body: ScheduleCallSheet(
              conversation: group,
              initialStart: now.add(const Duration(days: 1)),
              clock: () => now,
            ),
          ),
          scheduledCalls: repo,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text(l10n.saveAction));
      await tester.pumpAndSettle();

      expect(find.text(l10n.callRefusedParentGroup), findsOneWidget);
      expect(find.textContaining('COMM.'), findsNothing);
    });
  });
}
