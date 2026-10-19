import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/child_progress_card.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_ticket_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/makeup_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/schedule_change_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// PD-11 on the client: the card a ticket posts, the "+" menu that offers tickets,
/// and the form that sends one. Nothing here decides who may do what -- the server's
/// answers are stubbed, and the client is held to drawing exactly what it is given.
void main() {
  Widget app(Widget home, {LessonRepository? lessons, Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        if (lessons != null) lessonRepositoryProvider.overrideWithValue(lessons),
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
        home: Scaffold(body: home),
      ),
    );
  }

  Map<String, Object?> wireCard(String kind, Map<String, Object?> payload) => {
        'id': 'm1',
        'conversationId': 'c1',
        'seq': '7',
        'authorKind': 'teacher',
        'authorId': 't1',
        'authorDisplayName': 'teacher_c',
        'type': 'card',
        'body': 'plain-text fallback',
        'visibility': 'customer',
        'moderation': 'published',
        'createdAt': '2026-10-18T12:00:00.000Z',
        'attachments': <Object?>[],
        'reactions': <Object?>[],
        'receipts': <Object?>[],
        'card': {'kind': kind, 'lessonId': 'l1', 'payload': payload},
      };

  group('the wire', () {
    test('a card message keeps its structure; a malformed card falls back to the body', () {
      final m = WireMappers.message(
        wireCard('lesson_report', {'covered': 'Al-Mulk 1-15', 'rating': 4}),
        viewerActorId: 'p1',
      );
      expect(m.kind, MessageKind.card);
      expect(m.card?.kind, 'lesson_report');
      expect(m.card?.text('covered'), 'Al-Mulk 1-15');
      expect(m.card?.integer('rating'), 4);

      final broken = wireCard('lesson_report', {})..['card'] = {'kind': 7};
      final fallback = WireMappers.message(broken, viewerActorId: 'p1');
      expect(fallback.card, isNull);
      expect(fallback.body, 'plain-text fallback');
    });
  });

  group('the card in a bubble', () {
    testWidgets('a report shows what was covered and the rating, not the plain-text body', (tester) async {
      final m = WireMappers.message(
        wireCard('lesson_report', {
          'learnerName': 'learner_l',
          'startsAt': '2026-10-18T11:00:00.000Z',
          'covered': 'Al-Mulk 1-15',
          'homework': 'revise 1-5',
          'rating': 4,
        }),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('Lesson report'), findsOneWidget);
      expect(find.text('Al-Mulk 1-15'), findsOneWidget);
      expect(find.text('revise 1-5'), findsOneWidget);
      expect(find.byIcon(Icons.star), findsNWidgets(4));
      expect(find.text('plain-text fallback'), findsNothing);
    });

    testWidgets('a card kind this build does not know shows the plain-text body', (tester) async {
      final m = WireMappers.message(wireCard('lesson_from_the_future', {'x': 1}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('plain-text fallback'), findsOneWidget);
    });

    testWidgets('a late apology says it is under review, in Arabic too', (tester) async {
      final m = WireMappers.message(
        wireCard('lesson_late_apology', {'reason': 'مستشفى'}),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('اعتذار متأخر'), findsOneWidget);
      expect(find.text('قيد المراجعة من الإدارة'), findsOneWidget);
      expect(find.text('مستشفى'), findsOneWidget);
    });
  });

  group('the + menu', () {
    final report = LessonTicket(
      kind: LessonTicketKind.report,
      lessonId: 'l1',
      startsAt: DateTime(2026, 10, 18, 17),
      endsAt: DateTime(2026, 10, 18, 17, 30),
    );

    testWidgets('with no ticket offered it is the same three entries as before', (tester) async {
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(onPressed: () => showComposerMenu(context), child: const Text('+')),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      expect(find.text('Camera'), findsOneWidget);
      expect(find.text('Lesson'), findsNothing);
    });

    testWidgets('an offered ticket is listed under "Lesson" and picking it returns it', (tester) async {
      ComposerChoice? picked;
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(
          onPressed: () async => picked = await showComposerMenu(context, tickets: [report]),
          child: const Text('+'),
        ),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      expect(find.text('Lesson'), findsOneWidget);
      await tester.tap(find.text('Lesson report'));
      await tester.pumpAndSettle();
      expect(picked, isA<TicketChoice>());
      expect((picked as TicketChoice).ticket.lessonId, 'l1');
    });
  });

  group('the ticket form', () {
    final report = LessonTicket(
      kind: LessonTicketKind.report,
      lessonId: 'l1',
      startsAt: DateTime(2026, 10, 18, 17),
      endsAt: DateTime(2026, 10, 18, 17, 30),
    );

    testWidgets('a report cannot be sent without what was covered, and sends the rest as typed', (tester) async {
      final repo = _RecordingLessons();
      await tester.pumpWidget(app(LessonTicketForm(ticket: report), lessons: repo));
      final submit = find.byKey(const ValueKey('lesson-ticket-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);

      await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), '  Al-Mulk 1-15  ');
      await tester.tap(find.byKey(const ValueKey('lesson-ticket-star-5')));
      await tester.pump();
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(repo.reports, hasLength(1));
      expect(repo.reports.single.covered, 'Al-Mulk 1-15');
      expect(repo.reports.single.rating, 5);
      expect(repo.reports.single.homework, isNull);
    });

    testWidgets('a ticket the server no longer allows says so, and keeps what was typed', (tester) async {
      final repo = _RecordingLessons(refuseWith: 'COMM.LESSON_STATE');
      final apology = LessonTicket(
        kind: LessonTicketKind.apology,
        lessonId: 'l2',
        startsAt: DateTime(2026, 10, 19, 17),
        endsAt: DateTime(2026, 10, 19, 17, 30),
      );
      await tester.pumpWidget(app(LessonTicketForm(ticket: apology), lessons: repo));
      await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), 'fever');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('lesson-ticket-submit')));
      await tester.pumpAndSettle();
      expect(find.text('This lesson can no longer be updated this way.'), findsOneWidget);
      expect(find.text('fever'), findsOneWidget);
    });
  });
  group('T2: make-ups, regular times and the Schedule', () {
    testWidgets('a make-up is picked day first, then time, in the reader\'s clock, and booked as offered', (tester) async {
      final day1 = DateTime(2026, 10, 20, 17);
      final day2 = DateTime(2026, 10, 21, 9);
      final repo = _RecordingLessons()
        ..offer = MakeupOffer(durationMinutes: 30, slots: [day1, day1.add(const Duration(minutes: 30)), day2]);
      const ticket = LessonTicket(kind: LessonTicketKind.bookMakeup, lessonId: 'l9', learnerName: 'learner_l');
      await tester.pumpWidget(app(const MakeupSheet(ticket: ticket), lessons: repo));
      await tester.pumpAndSettle();
      // The first day is chosen: its two times show, the other day's does not.
      expect(find.byKey(ValueKey('makeup-time-${day1.toUtc().toIso8601String()}')), findsOneWidget);
      expect(find.byKey(ValueKey('makeup-time-${day2.toUtc().toIso8601String()}')), findsNothing);
      final book = find.byKey(const ValueKey('makeup-book'));
      expect(tester.widget<FilledButton>(book).onPressed, isNull);

      await tester.tap(find.byKey(ValueKey('makeup-day-${DateTime(2026, 10, 21).toIso8601String()}')));
      await tester.pump();
      await tester.tap(find.byKey(ValueKey('makeup-time-${day2.toUtc().toIso8601String()}')));
      await tester.pump();
      await tester.tap(book);
      await tester.pumpAndSettle();
      expect(repo.booked, [day2]);
    });

    testWidgets('no free time says the supervision team will arrange it', (tester) async {
      const ticket = LessonTicket(kind: LessonTicketKind.bookMakeup, lessonId: 'l9');
      await tester.pumpWidget(app(const MakeupSheet(ticket: ticket), lessons: _RecordingLessons()));
      await tester.pumpAndSettle();
      expect(find.textContaining('supervision team will arrange'), findsOneWidget);
    });

    testWidgets('a regular-time change sends exactly the times picked', (tester) async {
      final mon = WeeklyOption(weekday: 1, start: '17:00', nextStartsAt: DateTime(2026, 10, 19, 17));
      final wed = WeeklyOption(weekday: 3, start: '18:30', nextStartsAt: DateTime(2026, 10, 21, 18, 30));
      final repo = _RecordingLessons()..options = [mon, wed];
      const ticket = LessonTicket(kind: LessonTicketKind.requestScheduleChange, learnerId: 'k1', learnerName: 'learner_l');
      await tester.pumpWidget(app(const ScheduleChangeSheet(ticket: ticket), lessons: repo));
      await tester.pumpAndSettle();
      expect(find.text('Monday 5:00 PM'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('weekly-3-18:30')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('schedule-change-send')));
      await tester.pumpAndSettle();
      expect(repo.requested.single.map((o) => '${o.weekday} ${o.start}'), ['3 18:30']);
    });

    testWidgets('the teacher\'s Schedule groups by day and flags a lesson that needs its report', (tester) async {
      final repo = _RecordingLessons()
        ..mine = [
          ScheduledLesson(id: 'a', learnerName: 'learner_l', startsAt: DateTime(2026, 10, 18, 9), endsAt: DateTime(2026, 10, 18, 9, 30), kind: 'regular', phase: 'awaiting_close'),
          ScheduledLesson(id: 'b', learnerName: 'learner_m', startsAt: DateTime(2026, 10, 19, 10), endsAt: DateTime(2026, 10, 19, 10, 30), kind: 'makeup', phase: 'upcoming'),
          ScheduledLesson(id: 'c', learnerName: 'learner_n', startsAt: DateTime(2026, 10, 18, 8), endsAt: DateTime(2026, 10, 18, 8, 30), kind: 'regular', phase: 'closed', outcome: 'held'),
        ];
      await tester.pumpWidget(ProviderScope(
        overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          locale: Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: TeacherScheduleScreen(),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Needs report'), findsOneWidget);
      expect(find.text('Held'), findsOneWidget);
      expect(find.text('Upcoming'), findsOneWidget);
      expect(find.textContaining('Make-up'), findsOneWidget);
      // Two days, earliest lesson first.
      final rows = tester.widgetList<ListTile>(find.byType(ListTile)).map((t) => (t.key as ValueKey).value).toList();
      expect(rows, ['schedule-c', 'schedule-a', 'schedule-b']);
    });

    testWidgets('a supervisor\'s make-up decision reads as what was done', (tester) async {
      final m = WireMappers.message(wireCard('lesson_makeup_resolved', {'learnerName': 'learner_l', 'action': 'family_credit'}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('A credit to the family'), findsOneWidget);
    });
  });
  group('T3: transfers, pauses and bonuses as cards', () {
    testWidgets('a family reads who teaches now -- and never why', (tester) async {
      final m = WireMappers.message(wireCard('learner_transferred', {'learnerName': 'learner_l', 'teacherName': 'teacher_d'}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('New teacher'), findsOneWidget);
      expect(find.text('teacher_d will teach from now on.'), findsOneWidget);
    });

    testWidgets('the new teacher reads the handover', (tester) async {
      final m = WireMappers.message(
        wireCard('learner_handover', {'learnerName': 'learner_l', 'fromTeacherName': 'teacher_b', 'handoverNote': 'continue from Al-Mulk 16'}),
        viewerActorId: 't2',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('A new student'), findsOneWidget);
      expect(find.text('teacher_b'), findsOneWidget);
      expect(find.text('continue from Al-Mulk 16'), findsOneWidget);
    });

    testWidgets('a pause names its return date; a stop names none', (tester) async {
      final paused = WireMappers.message(
        wireCard('learner_suspended', {'learnerName': 'learner_l', 'kind': 'temporary', 'returnOn': '2026-11-01'}),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: paused, showAuthor: true)));
      expect(find.text('Lessons paused'), findsOneWidget);
      expect(find.textContaining(RegExp(r'^Until .*Nov 1')), findsOneWidget);

      final stopped = WireMappers.message(wireCard('learner_suspended', {'learnerName': 'learner_l', 'kind': 'permanent'}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: stopped, showAuthor: true)));
      expect(find.text('Lessons stopped'), findsOneWidget);
      expect(find.textContaining('Until'), findsNothing);
    });

    testWidgets('a bonus says why, in Arabic too', (tester) async {
      final m = WireMappers.message(wireCard('teacher_bonus', {'reason': 'كل التقارير في موعدها'}), viewerActorId: 't1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('مكافأة لك'), findsOneWidget);
      expect(find.text('كل التقارير في موعدها'), findsOneWidget);
    });
  });
  group('T5: progress and workload', () {
    testWidgets('a child\'s month leads with the streak; absences are counted, not headlined', (tester) async {
      final repo = _RecordingLessons()
        ..childProgress = ChildProgress(
          attended: 11, apologised: 1, absent: 1, attendedAllTime: 64, streak: 5, makeupsOwed: 1,
          nextLessonAt: DateTime(2026, 10, 21, 17), lastCovered: 'Al-Mulk 1-15',
        );
      await tester.pumpWidget(app(const ChildProgressCard(learnerId: 'k1'), lessons: repo));
      await tester.pumpAndSettle();
      expect(find.text('5 lessons in a row'), findsOneWidget);
      expect(find.text('11'), findsOneWidget);
      expect(find.text('64 lessons attended in total'), findsOneWidget);
      expect(find.text('1 make-up lesson owed'), findsOneWidget);
      expect(find.text('Last lesson: Al-Mulk 1-15'), findsOneWidget);
      expect(find.text('Certificates will appear here.'), findsOneWidget);
    });

    testWidgets('a build with no lesson server shows no progress at all', (tester) async {
      await tester.pumpWidget(app(const ChildProgressCard(learnerId: 'k1')));
      await tester.pumpAndSettle();
      expect(find.text('This month'), findsNothing);
    });

    testWidgets('the Schedule tab opens with the teacher\'s month', (tester) async {
      final repo = _RecordingLessons()
        ..workload = const TeacherWorkload(heldLessons: 42, heldMinutes: 1890, unreported: 2, reportsOnTimeRate: 0.9)
        ..mine = [
          ScheduledLesson(id: 'a', learnerName: 'learner_l', startsAt: DateTime(2026, 10, 19, 9), endsAt: DateTime(2026, 10, 19, 9, 30), kind: 'regular', phase: 'upcoming'),
        ];
      await tester.pumpWidget(ProviderScope(
        overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          locale: Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: TeacherScheduleScreen(),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('42 lessons · 31.5 h'), findsOneWidget);
      expect(find.text('2 need a report'), findsOneWidget);
      expect(find.text('90% reports on time'), findsOneWidget);
    });
  });
}

class _RecordingLessons implements LessonRepository {
  _RecordingLessons({this.refuseWith});

  final String? refuseWith;
  final reports = <LessonReportDraft>[];

  void _maybeRefuse() {
    if (refuseWith != null) throw AppError(AppErrorKind.forbidden, code: refuseWith);
  }

  @override
  Future<List<LessonTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> report(String lessonId, LessonReportDraft draft) async {
    _maybeRefuse();
    reports.add(draft);
  }

  @override
  Future<void> absence(String lessonId, {String? note}) async => _maybeRefuse();

  @override
  Future<void> apologise(String lessonId, LessonTicketKind kind, String reason) async => _maybeRefuse();

  /// What makeupSlots answers; and what was booked / requested.
  MakeupOffer offer = const MakeupOffer(durationMinutes: 30, slots: []);
  List<WeeklyOption> options = const [];
  final booked = <DateTime>[];
  final requested = <List<WeeklyOption>>[];
  List<ScheduledLesson> mine = const [];

  @override
  Future<MakeupOffer> makeupSlots(String lessonId) async => offer;

  @override
  Future<void> bookMakeup(String lessonId, DateTime startsAt) async {
    _maybeRefuse();
    booked.add(startsAt);
  }

  @override
  Future<List<WeeklyOption>> scheduleOptions(String learnerId) async => options;

  @override
  Future<void> requestScheduleChange(String learnerId, List<WeeklyOption> slots, {String? note}) async {
    _maybeRefuse();
    requested.add(slots);
  }

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => mine;

  ChildProgress? childProgress;
  TeacherWorkload? workload;

  @override
  Future<ChildProgress> progress(String learnerId) async => childProgress!;

  @override
  Future<TeacherWorkload> myWorkload() async => workload ?? (throw UnsupportedError('none'));
}
