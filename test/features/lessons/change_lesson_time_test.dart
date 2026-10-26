import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/change_lesson_time_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/child_schedule_screen.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_card_view.dart';
import 'package:jawwid_chat/features/lessons/presentation/slot_chip_picker.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-31 on the client: the shared slot picker, "Change lesson time" (this lesson only
/// / every week), the child's schedule, the `lesson_moved` card and the teacher's
/// "Lessons moved". The server's answers are stubbed; the client is held to drawing
/// them and sending back exactly what was picked.
void main() {
  Widget app(Widget home, {LessonRepository? lessons, Locale locale = const Locale('en'), UserRole role = UserRole.parent}) {
    return ProviderScope(
      overrides: [
        if (lessons != null) lessonRepositoryProvider.overrideWithValue(lessons),
        currentRoleProvider.overrideWithValue(role),
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
        home: Scaffold(body: SingleChildScrollView(child: home)),
      ),
    );
  }

  String timeKey(String prefix, DateTime t) => '$prefix-time-${t.toUtc().toIso8601String()}';
  ChoiceChip chip(WidgetTester tester, String key) => tester.widget<ChoiceChip>(find.byKey(ValueKey(key)));

  group('SlotChipPicker', () {
    final mon9 = DateTime(2026, 10, 26, 9);
    final mon13 = DateTime(2026, 10, 26, 13);
    final mon18 = DateTime(2026, 10, 26, 18, 30);
    final tue17 = DateTime(2026, 10, 27, 17);

    testWidgets('day chips count the free times; a day\'s times are grouped by period', (tester) async {
      DateTime? picked;
      await tester.pumpWidget(app(StatefulBuilder(
        builder: (context, setState) => SlotChipPicker(
          slots: [tue17, mon18, mon9, mon13],
          selected: picked,
          onSelected: (t) => setState(() => picked = t),
        ),
      )));
      await tester.pumpAndSettle();

      expect(find.text('Mon 26 · 3'), findsOneWidget);
      expect(find.text('Tue 27 · 1'), findsOneWidget);
      // The first day is shown: 09:00 is morning, 13:00 afternoon, 18:30 evening.
      for (final p in ['Morning', 'Afternoon', 'Evening']) {
        expect(find.text(p), findsOneWidget);
      }
      expect(find.byKey(ValueKey(timeKey('slot', tue17))), findsNothing);
      final morning = tester.getTopLeft(find.text('Morning')).dy;
      final afternoon = tester.getTopLeft(find.text('Afternoon')).dy;
      final evening = tester.getTopLeft(find.text('Evening')).dy;
      expect(morning < afternoon && afternoon < evening, isTrue);
      expect(tester.getTopLeft(find.byKey(ValueKey(timeKey('slot', mon13)))).dy, greaterThan(afternoon));
      expect(tester.getTopLeft(find.byKey(ValueKey(timeKey('slot', mon13)))).dy, lessThan(evening));

      // One tap selects, and only that chip is highlighted.
      await tester.tap(find.byKey(ValueKey(timeKey('slot', mon13))));
      await tester.pump();
      expect(picked, mon13);
      expect(chip(tester, timeKey('slot', mon13)).selected, isTrue);
      expect(chip(tester, timeKey('slot', mon9)).selected, isFalse);

      // Another day: only its period is shown.
      await tester.tap(find.byKey(ValueKey('slot-day-${DateTime(2026, 10, 27).toIso8601String()}')));
      await tester.pump();
      expect(find.byKey(ValueKey(timeKey('slot', tue17))), findsOneWidget);
      expect(find.text('Morning'), findsNothing);
      expect(find.text('Evening'), findsOneWidget);
    });

    testWidgets('the selected chip uses the theme\'s AA selected colours', (tester) async {
      await tester.pumpWidget(app(SlotChipPicker(slots: [mon9], selected: mon9, onSelected: (_) {})));
      await tester.pumpAndSettle();
      final context = tester.element(find.byKey(ValueKey(timeKey('slot', mon9))));
      final scheme = Theme.of(context).colorScheme;
      final label = tester.widget<RichText>(
        find.descendant(of: find.byKey(ValueKey(timeKey('slot', mon9))), matching: find.byType(RichText)).first,
      );
      expect(label.text.style?.color, scheme.onSecondaryContainer);
    });

    testWidgets('locked lessons show "Lessons paused — payment" instead of chips', (tester) async {
      await tester.pumpWidget(app(SlotChipPicker(slots: [mon9], selected: null, onSelected: (_) {}, locked: true)));
      await tester.pumpAndSettle();
      expect(find.text('Lessons paused — payment'), findsOneWidget);
      expect(find.byType(ChoiceChip), findsNothing);
    });

    testWidgets('weekly: weekday chips with counts; a busy week shows "except"', (tester) async {
      final tue = WeeklyOption(weekday: 2, start: '18:00', nextStartsAt: DateTime(2026, 10, 27, 18), except: [DateTime(2026, 11, 3, 18)]);
      final tueEarly = WeeklyOption(weekday: 2, start: '10:00', nextStartsAt: DateTime(2026, 10, 27, 10));
      final thu = WeeklyOption(weekday: 4, start: '17:00', nextStartsAt: DateTime(2026, 10, 29, 17));
      WeeklyKey? picked;
      await tester.pumpWidget(app(StatefulBuilder(
        builder: (context, setState) => WeeklySlotChipPicker(
          options: [thu, tue, tueEarly],
          selected: picked,
          onSelected: (o) => setState(() => picked = o.key),
        ),
      )));
      await tester.pumpAndSettle();
      expect(find.text('Tue · 2'), findsOneWidget);
      expect(find.text('Thu · 1'), findsOneWidget);
      expect(find.text('except Nov 3'), findsOneWidget);
      expect(find.text('Morning'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('weekly-2-18:00')));
      await tester.pump();
      expect(picked, (weekday: 2, start: '18:00'));
      expect(chip(tester, 'weekly-2-18:00').selected, isTrue);
    });

    testWidgets('Arabic: the periods read naturally and the strip mirrors', (tester) async {
      await tester.pumpWidget(app(SlotChipPicker(slots: [mon9, mon18], selected: null, onSelected: (_) {}), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('الصباح'), findsOneWidget);
      expect(find.text('المساء'), findsOneWidget);
      expect(Directionality.of(tester.element(find.text('الصباح'))), TextDirection.rtl);
    });
  });

  group('Change lesson time: this lesson only', () {
    const ticket = LessonTicket(kind: LessonTicketKind.changeLessonTime, learnerId: 'k1', learnerName: 'learner_k');
    final now = DateTime.now();
    final lessonAt = DateTime(now.year, now.month, now.day + 2, 17);
    final slot = DateTime(now.year, now.month, now.day + 4, 18, 30);
    final other = DateTime(now.year, now.month, now.day + 4, 19);
    ScheduledLesson lesson(String id, DateTime at, {String? outcome}) => ScheduledLesson(
          id: id, learnerId: 'k1', learnerName: 'learner_k', startsAt: at, endsAt: at.add(const Duration(minutes: 30)),
          kind: 'regular', phase: 'upcoming', outcome: outcome,
        );

    testWidgets('both scopes are offered first', (tester) async {
      await tester.pumpWidget(app(const ChangeLessonTimeSheet(ticket: ticket), lessons: _Lessons()));
      await tester.pumpAndSettle();
      expect(find.text('Change lesson time'), findsOneWidget);
      expect(find.text('This lesson only'), findsOneWidget);
      expect(find.text('Every week'), findsOneWidget);
    });

    testWidgets('pick a lesson, then a free time; the summary reads before -> after; the move is sent as offered', (tester) async {
      final repo = _Lessons()
        ..lessons = [lesson('l1', lessonAt), lesson('gone', lessonAt.add(const Duration(days: 1)), outcome: 'student_apology')]
        ..offers = [MoveOffer(lessonId: 'l1', startsAt: lessonAt, durationMinutes: 30, slots: [slot, other], familyMovesLeft: 3)];
      bool? result;
      await tester.pumpWidget(app(
        Builder(builder: (context) => TextButton(onPressed: () async => result = await showChangeLessonTimeSheet(context, ticket), child: const Text('open'))),
        lessons: repo,
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('change-scope-once')));
      await tester.pumpAndSettle();
      expect(repo.lessonWindows.single.$1, 'k1');
      // A lesson already closed (apologised for) is not offered.
      expect(find.byKey(const ValueKey('move-lesson-gone')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('move-lesson-l1')));
      await tester.pumpAndSettle();
      expect(find.text('3 moves left this month'), findsOneWidget);
      final confirm = find.byKey(const ValueKey('move-confirm'));
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);

      await tester.tap(find.byKey(ValueKey(timeKey('move', slot))));
      await tester.pump();
      expect(find.textContaining('→'), findsOneWidget);
      await tester.ensureVisible(confirm);
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(repo.moved, [('l1', slot)]);
      expect(result, isTrue);
    });

    testWidgets('a refusal is said before anything is picked', (tester) async {
      final cases = {
        'family_monthly_limit': 'This month\'s limit of moves for this child has been reached.',
        'family_already_moved': 'This lesson has already been moved once.',
        'too_late': 'It\'s too close to the start to move this lesson.',
        'started': 'This lesson has already started.',
      };
      for (final MapEntry(key: refusal, value: text) in cases.entries) {
        final repo = _Lessons()
          ..lessons = [lesson('l1', lessonAt)]
          ..offers = [MoveOffer(lessonId: 'l1', startsAt: lessonAt, durationMinutes: 30, refusal: refusal, familyMovesLeft: 0)];
        await tester.pumpWidget(app(ChangeLessonTimeSheet(key: ValueKey(refusal), ticket: ticket), lessons: repo));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('change-scope-once')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('move-lesson-l1')));
        await tester.pumpAndSettle();
        expect(find.text(text), findsOneWidget, reason: refusal);
        expect(find.byType(ChoiceChip), findsNothing);
        expect(tester.widget<FilledButton>(find.byKey(const ValueKey('move-confirm'))).onPressed, isNull);
      }
    });

    testWidgets('a time taken meanwhile: the free times reload and the sheet says so', (tester) async {
      final repo = _Lessons()
        ..lessons = [lesson('l1', lessonAt)]
        ..offers = [
          MoveOffer(lessonId: 'l1', startsAt: lessonAt, durationMinutes: 30, slots: [slot, other]),
          MoveOffer(lessonId: 'l1', startsAt: lessonAt, durationMinutes: 30, slots: [other]),
        ]
        ..moveFails = const AppError(AppErrorKind.forbidden, code: 'COMM.LESSON_STATE');
      await tester.pumpWidget(app(const ChangeLessonTimeSheet(ticket: ticket), lessons: repo));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('change-scope-once')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('move-lesson-l1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ValueKey(timeKey('move', slot))));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const ValueKey('move-confirm')));
      await tester.tap(find.byKey(const ValueKey('move-confirm')));
      await tester.pumpAndSettle();
      expect(repo.offerReads, 2);
      expect(find.text('That time was just taken. Please choose another.'), findsOneWidget);
      expect(find.byKey(ValueKey(timeKey('move', slot))), findsNothing);
      expect(find.byKey(ValueKey(timeKey('move', other))), findsOneWidget);
    });

    testWidgets('locked lessons: no chip, "Lessons paused — payment"', (tester) async {
      final repo = _Lessons()
        ..lessons = [lesson('l1', lessonAt)]
        ..offers = [MoveOffer(lessonId: 'l1', startsAt: lessonAt, durationMinutes: 30, locked: 'overdue')];
      await tester.pumpWidget(app(const ChangeLessonTimeSheet(ticket: ticket), lessons: repo));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('change-scope-once')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('move-lesson-l1')));
      await tester.pumpAndSettle();
      expect(find.text('Lessons paused — payment'), findsOneWidget);
    });
  });

  group('Change lesson time: every week', () {
    const ticket = LessonTicket(kind: LessonTicketKind.changeLessonTime, learnerId: 'k1', learnerName: 'learner_k');
    // Monday 26 Oct 2026; the child has Monday 17:00 and Thursday 17:00.
    final mon = GroupChildSlot(weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: DateTime(2026, 11, 2, 17));
    final thu = GroupChildSlot(weekday: 4, start: '17:00', durationMinutes: 30, nextStartsAt: DateTime(2026, 10, 29, 17));
    final tue = WeeklyOption(weekday: 2, start: '18:00', nextStartsAt: DateTime(2026, 10, 27, 18), except: [DateTime(2026, 11, 10, 18)]);
    final wed = WeeklyOption(weekday: 3, start: '16:00', nextStartsAt: DateTime(2026, 10, 28, 16));
    ScheduleOptions options() => ScheduleOptions(
          durationMinutes: 30,
          current: [mon, thu],
          options: [
            WeeklyOption(weekday: 1, start: '17:00', nextStartsAt: mon.nextStartsAt!),
            WeeklyOption(weekday: 4, start: '17:00', nextStartsAt: thu.nextStartsAt!),
            tue,
            wed,
          ],
        );

    Future<void> openWeekly(WidgetTester tester, _Lessons repo) async {
      await tester.pumpWidget(app(const ChangeLessonTimeSheet(ticket: ticket), lessons: repo));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('change-scope-weekly')));
      await tester.pumpAndSettle();
    }

    testWidgets('replace one time: the summary says what changes, from when, what stays and which week is skipped', (tester) async {
      final repo = _Lessons()..weekly = options();
      await openWeekly(tester, repo);
      expect(find.text('Monday 5:00 PM'), findsOneWidget);
      expect(find.text('Thursday 5:00 PM'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('weekly-change-1-17:00')));
      await tester.pumpAndSettle();
      expect(find.text('New time instead of Monday 5:00 PM'), findsOneWidget);
      // The child's own times are not offered again.
      expect(find.byKey(const ValueKey('weekly-1-17:00')), findsNothing);
      expect(find.byKey(const ValueKey('weekly-4-17:00')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('weekly-2-18:00')));
      await tester.pumpAndSettle();

      final summary = find.byKey(const ValueKey('weekly-summary'));
      String lines() => tester.widgetList<Text>(find.descendant(of: summary, matching: find.byType(Text))).map((t) => t.data).join('\n');
      expect(lines(), [
        'Monday 5:00 PM → Tuesday 6:00 PM',
        'From Mon, Nov 2',
        'Thursday 5:00 PM unchanged',
        'Tue, Nov 10 will be skipped',
      ].join('\n'));

      // A later start: the skipped week before it is no longer mentioned.
      await tester.ensureVisible(find.byKey(const ValueKey('weekly-from-2')));
      await tester.tap(find.byKey(const ValueKey('weekly-from-2')));
      await tester.pumpAndSettle();
      expect(lines(), contains('From Mon, Nov 16'));
      expect(lines(), isNot(contains('skipped')));

      await tester.tap(find.byKey(const ValueKey('weekly-from-0')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey('weekly-send')));
      await tester.tap(find.byKey(const ValueKey('weekly-send')));
      await tester.pumpAndSettle();
      // The FULL new set, and the first affected lesson's date.
      expect(repo.requested.single.$1, [(weekday: 2, start: '18:00'), (weekday: 4, start: '17:00')]);
      expect(repo.requested.single.$2, '2026-11-02');
    });

    testWidgets('add and remove: the set sent is current minus removed plus added', (tester) async {
      final repo = _Lessons()..weekly = options();
      await openWeekly(tester, repo);
      await tester.tap(find.byKey(const ValueKey('weekly-remove-4-17:00')));
      await tester.pumpAndSettle();
      expect(find.text('Will stop'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('weekly-add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('weekly-day-3')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('weekly-3-16:00')));
      await tester.pumpAndSettle();
      final summary = find.byKey(const ValueKey('weekly-summary'));
      expect(find.descendant(of: summary, matching: find.text('Stop Thursday 5:00 PM')), findsOneWidget);
      expect(find.descendant(of: summary, matching: find.text('Add Wednesday 4:00 PM')), findsOneWidget);
      expect(find.descendant(of: summary, matching: find.text('Monday 5:00 PM unchanged')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('weekly-send')));
      await tester.tap(find.byKey(const ValueKey('weekly-send')));
      await tester.pumpAndSettle();
      expect(repo.requested.single.$1, [(weekday: 1, start: '17:00'), (weekday: 3, start: '16:00')]);
      // From the removed Thursday's next lesson.
      expect(repo.requested.single.$2, '2026-10-29');
    });

    testWidgets('nothing changed: nothing to send', (tester) async {
      final repo = _Lessons()..weekly = options();
      await openWeekly(tester, repo);
      expect(find.byKey(const ValueKey('weekly-send')), findsNothing);
      expect(find.byKey(const ValueKey('weekly-summary')), findsNothing);
    });

    test('effectiveFrom is the date in the TEACHER\'s zone', () {
      final lateMonday = DateTime.utc(2026, 11, 2, 22, 30);
      expect(teacherDate(lateMonday, 'Asia/Riyadh'), '2026-11-03');
      expect(teacherDate(lateMonday, 'America/New_York'), '2026-11-02');
    });
  });

  group('the child\'s schedule', () {
    final now = DateTime.now();
    DateTime at(int days, int hour) => DateTime(now.year, now.month, now.day + days, hour);
    ScheduledLesson lesson(String id, DateTime start, {String? outcome, String kind = 'regular', DateTime? movedTo}) => ScheduledLesson(
          id: id, learnerName: 'learner_k', teacherName: 'teacher_t', startsAt: start,
          endsAt: start.add(const Duration(minutes: 30)), kind: kind, phase: 'upcoming', outcome: outcome, movedTo: movedTo,
        );

    testWidgets('weekly times, then each lesson with its status; one "Change lesson time" button', (tester) async {
      final movedTo = at(3, 18);
      final repo = _Lessons()
        ..schedule = ChildSchedule(slots: [GroupChildSlot(weekday: 1, start: '17:00', durationMinutes: 30, nextStartsAt: DateTime(2026, 11, 2, 17))])
        ..lessons = [
          lesson('held', at(0, 0), outcome: 'held'),
          lesson('next', at(1, 17)),
          lesson('moved', at(2, 17), outcome: 'rescheduled', movedTo: movedTo),
          lesson('makeup', at(4, 17), kind: 'makeup'),
          lesson('excused', at(5, 17), outcome: 'student_apology'),
          lesson('cancelled', at(6, 17), outcome: 'teacher_apology'),
        ];
      await tester.pumpWidget(ProviderScope(
        overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: const ChildScheduleScreen(learnerId: 'k1', childName: 'learner_k'),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Every Monday 5:00 PM'), findsOneWidget);
      final context = tester.element(find.byType(ChildScheduleScreen));
      final m = MaterialLocalizations.of(context);
      String status(String id) => tester
          .widget<Text>(find.descendant(of: find.byKey(ValueKey('child-lesson-status-$id')), matching: find.byType(Text)))
          .data!;
      expect(status('held'), 'Held');
      expect(status('next'), 'Upcoming');
      expect(status('moved'), 'Moved to ${m.formatMediumDate(movedTo)} · ${m.formatTimeOfDay(TimeOfDay.fromDateTime(movedTo))}');
      expect(status('makeup'), 'Make-up');
      expect(status('excused'), 'Excused');
      expect(status('cancelled'), 'Cancelled');
      expect(find.text('teacher_t · 30 minutes'), findsNWidgets(6));
      expect(repo.lessonWindows.single.$1, 'k1');
      expect(repo.lessonWindows.single.$3.difference(repo.lessonWindows.single.$2).inDays, 28);

      await tester.scrollUntilVisible(find.byKey(const ValueKey('child-schedule-change')), 200);
      await tester.tap(find.byKey(const ValueKey('child-schedule-change')));
      await tester.pumpAndSettle();
      expect(find.text('This lesson only'), findsOneWidget);
      expect(find.text('Every week'), findsOneWidget);
    });

    testWidgets('the entry on a child\'s card is offered only with a lesson server', (tester) async {
      await tester.pumpWidget(app(const ChildScheduleEntry(learnerId: 'k1', childName: 'learner_k'), lessons: _Lessons()));
      expect(find.byKey(const ValueKey('schedule-entry-k1')), findsOneWidget);
      expect(find.text('Schedule'), findsOneWidget);
      await tester.pumpWidget(app(const ChildScheduleEntry(learnerId: 'k1'), lessons: const NoLessonRepository()));
      expect(find.byKey(const ValueKey('schedule-entry-k1')), findsNothing);
    });
  });

  group('the lesson_moved card', () {
    testWidgets('reads "previous -> new" in the reader\'s clock and says who moved it', (tester) async {
      const previous = '2026-10-27T14:00:00.000Z';
      const next = '2026-10-29T15:30:00.000Z';
      const card = MessageCard(kind: 'lesson_moved', lessonId: 'l2', payload: {
        'lessonId': 'l2', 'learnerName': 'learner_k', 'teacherName': 'teacher_t',
        'startsAt': next, 'endsAt': '2026-10-29T16:00:00.000Z', 'durationMinutes': 30,
        'previousStartsAt': previous, 'movedBy': 'family',
      });
      await tester.pumpWidget(app(Builder(builder: (context) => lessonCardView(context, card, Colors.black)!)));
      await tester.pumpAndSettle();
      final m = MaterialLocalizations.of(tester.element(find.byType(Builder).first));
      String when(String iso) {
        final t = DateTime.parse(iso).toLocal();
        return '${m.formatMediumDate(t)} · ${m.formatTimeOfDay(TimeOfDay.fromDateTime(t))}';
      }

      expect(find.text('Lesson moved'), findsOneWidget);
      expect(find.text('${when(previous)} → ${when(next)}'), findsOneWidget);
      expect(find.text('Moved by the family'), findsOneWidget);
    });
  });

  group('the teacher\'s month', () {
    testWidgets('"Lessons moved: N" is a neutral line, not a warning', (tester) async {
      final repo = _Lessons()..workload = const TeacherWorkload(heldLessons: 10, heldMinutes: 300, unreported: 0, movesByTeacher: 2);
      await tester.pumpWidget(ProviderScope(
        overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: const TeacherScheduleScreen(),
        ),
      ));
      await tester.pumpAndSettle();
      final line = find.byKey(const ValueKey('workload-moved'));
      expect(tester.widget<Text>(line).data, 'Lessons moved: 2');
      final scheme = Theme.of(tester.element(line)).colorScheme;
      expect(tester.widget<Text>(line).style?.color, isNot(scheme.error));
    });

    test('Arabic counts agree with their noun', () async {
      final ar = await L10n.delegate.load(const Locale('ar'));
      expect(ar.workloadMoved(1), 'نُقلت حصة واحدة');
      expect(ar.workloadMoved(2), 'نُقلت حصتان');
      expect(ar.workloadMoved(3), 'نُقلت 3 حصص');
      expect(ar.changeTimeMovesLeft(2), 'تبقّى تغييران هذا الشهر');
    });
  });
}

/// The PD-31 calls, answered from fields; anything else would be a test bug.
class _Lessons implements LessonRepository {
  List<ScheduledLesson> lessons = const [];
  final lessonWindows = <(String, DateTime, DateTime)>[];

  /// What move-slots answers, one per read (the last repeats).
  List<MoveOffer> offers = const [];
  int offerReads = 0;
  AppError? moveFails;
  final moved = <(String, DateTime)>[];

  ScheduleOptions weekly = const ScheduleOptions();
  final requested = <(List<WeeklyKey>, String?)>[];
  ChildSchedule schedule = const ChildSchedule();
  TeacherWorkload? workload;

  @override
  Future<List<ScheduledLesson>> learnerLessons(String learnerId, DateTime from, DateTime to) async {
    lessonWindows.add((learnerId, from, to));
    return lessons;
  }

  @override
  Future<MoveOffer> moveSlots(String lessonId) async => offers[(offerReads++).clamp(0, offers.length - 1)];

  @override
  Future<void> moveLesson(String lessonId, DateTime startsAt) async {
    if (moveFails != null) throw moveFails!;
    moved.add((lessonId, startsAt));
  }

  @override
  Future<ScheduleOptions> scheduleOptions(String learnerId) async => weekly;

  @override
  Future<void> requestScheduleChange(String learnerId, List<WeeklyKey> slots, {String? effectiveFrom, String? note}) async {
    requested.add((slots, effectiveFrom));
  }

  @override
  Future<ChildSchedule> childSchedule(String learnerId) async => schedule;

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => const [];

  @override
  Future<TeacherWorkload> myWorkload() async => workload ?? (throw UnsupportedError('none'));

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
