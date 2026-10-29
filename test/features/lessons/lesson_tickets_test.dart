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
import 'package:jawwid_chat/features/lessons/presentation/group_children_section.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_report_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_ticket_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/makeup_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/student_profile.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-11 on the client: the card a ticket posts, the "+" menu that offers tickets,
/// and the form that sends one. Nothing here decides who may do what -- the server's
/// answers are stubbed, and the client is held to drawing exactly what it is given.
void main() {
  Widget app(Widget home, {LessonRepository? lessons, MaterialsRepository? materials, Locale locale = const Locale('en'), UserRole? role}) {
    return ProviderScope(
      overrides: [
        if (lessons != null) lessonRepositoryProvider.overrideWithValue(lessons),
        if (materials != null) materialsRepositoryProvider.overrideWithValue(materials),
        // The signed-in role (no session in these tests): a parent unless a test says otherwise.
        currentRoleProvider.overrideWithValue(role ?? UserRole.parent),
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

    testWidgets('PD-15: a quick report shows its number, topics, level and next steps -- and an edit only to the teacher', (tester) async {
      final m = WireMappers.message(
        wireCard('lesson_report', {
          'lessonId': 'l1',
          'learnerName': 'learner_l',
          'lessonNumber': 8,
          'coveredTopics': ['revision', 'tajweed'],
          'rating': 5,
          'nextTasks': ['revise_previous'],
        }),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), role: UserRole.parent));
      expect(find.text('8'), findsOneWidget);
      expect(find.text('Revision، Tajweed rules'), findsOneWidget);
      expect(find.text('Excellent'), findsOneWidget);
      expect(find.text('Revise previous lessons'), findsOneWidget);
      expect(find.text('Edit report'), findsNothing);
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), role: UserRole.teacher));
      expect(find.text('Edit report'), findsOneWidget);
    });

    testWidgets('PD-15: an excuse after the start and a correction read as what the lesson is now', (tester) async {
      final excused = WireMappers.message(wireCard('lesson_apology', {'learnerName': 'learner_l', 'timing': 'after_start'}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: excused, showAuthor: true)));
      expect(find.text('Excused after the lesson started'), findsOneWidget);
      final corrected = WireMappers.message(
        wireCard('lesson_corrected', {'learnerName': 'learner_l', 'outcome': 'student_apology', 'apologyTiming': 'before_start'}),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: corrected, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('تم تصحيح سجل الحصة'), findsOneWidget);
      expect(find.text('عذر للطالب قبل بداية الحصة'), findsOneWidget);
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
      await tester.tap(find.text('Write lesson report'));
      await tester.pumpAndSettle();
      expect(picked, isA<TicketChoice>());
      expect((picked as TicketChoice).ticket.lessonId, 'l1');
    });

    testWidgets('other lessons still owed a report are one link to the Schedule', (tester) async {
      ComposerChoice? picked;
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(
          onPressed: () async => picked = await showComposerMenu(context, tickets: [report], otherUnreportedLessons: 2),
          child: const Text('+'),
        ),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      expect(find.text('Other unreported lessons (2)'), findsOneWidget);
      await tester.tap(find.text('Other unreported lessons (2)'));
      await tester.pumpAndSettle();
      expect(picked, isA<UnreportedLessonsChoice>());
    });

    testWidgets('later lessons are one "Other lessons" entry, and each can still be picked', (tester) async {
      final later = LessonTicket(kind: LessonTicketKind.apology, lessonId: 'l9', learnerName: 'Adam', startsAt: DateTime(2026, 11, 3, 17));
      ComposerChoice? picked;
      LessonTicket? chosen;
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(
          onPressed: () async {
            picked = await showComposerMenu(context, tickets: [report], moreLessons: [later]);
            if (picked case MoreLessonsChoice(:final tickets) when context.mounted) {
              chosen = await showMoreLessonTickets(context, tickets);
            }
          },
          child: const Text('+'),
        ),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Other lessons (1)'));
      await tester.pumpAndSettle();
      expect(find.text('Apologise for the lesson'), findsOneWidget);
      await tester.tap(find.text('Apologise for the lesson'));
      await tester.pumpAndSettle();
      expect(chosen?.lessonId, 'l9');
    });
  });

  group('the ticket form', () {
    final report = LessonTicket(
      kind: LessonTicketKind.report,
      lessonId: 'l1',
      startsAt: DateTime(2026, 10, 18, 17),
      endsAt: DateTime(2026, 10, 18, 17, 30),
    );

    testWidgets('PD-15: the quick report -- taps, a suggested lesson number, nothing sent until something was covered', (tester) async {
      tester.view.physicalSize = const Size(1200, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final repo = _RecordingLessons();
      final ticket = LessonTicket(
        kind: LessonTicketKind.report,
        lessonId: 'l1',
        startsAt: DateTime(2026, 10, 18, 17),
        endsAt: DateTime(2026, 10, 18, 17, 30),
        suggestedLessonNumber: 8,
      );
      await tester.pumpWidget(app(QuickReportForm(ticket: ticket), lessons: repo));
      final submit = find.byKey(const ValueKey('report-submit'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(repo.reports, isEmpty);
      expect(find.text('Choose a topic or write a short line.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('report-topic-revision')));
      await tester.tap(find.byKey(const ValueKey('report-topic-tajweed')));
      await tester.ensureVisible(find.byKey(const ValueKey('report-level-5')));
      await tester.tap(find.byKey(const ValueKey('report-level-5')));
      await tester.ensureVisible(find.byKey(const ValueKey('report-task-revise_previous')));
      await tester.tap(find.byKey(const ValueKey('report-task-revise_previous')));
      await tester.pump();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();

      final sent = repo.reports.single;
      expect(sent.lessonNumber, 8);
      expect(sent.coveredTopics, ['revision', 'tajweed']);
      expect(sent.covered, isNull);
      expect(sent.rating, 5);
      expect(sent.nextTasks, ['revise_previous']);
      expect(sent.note, isNull);
    });

    testWidgets('PD-15: "Lesson report" asks what happened; "did not attend" records the absence', (tester) async {
      final repo = _RecordingLessons();
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(onPressed: () => openLessonTicket(context, report), child: const Text('open')),
      ), lessons: repo));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Student attended'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('report-not-attended')));
      await tester.pumpAndSettle();
      expect(find.textContaining('did not attend this lesson'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('lesson-ticket-submit')));
      await tester.pumpAndSettle();
      expect(repo.absences, ['l1']);
    });

    test('PD-15: the menu offers one entry per lesson -- its absence is inside "Lesson report"', () {
      final absence = LessonTicket(kind: LessonTicketKind.absence, lessonId: 'l1', startsAt: DateTime(2026, 10, 18, 17));
      final lone = LessonTicket(kind: LessonTicketKind.absence, lessonId: 'l2', startsAt: DateTime(2026, 10, 18, 18));
      expect(menuLessonTickets([report, absence, lone]).map((t) => '${t.kind.name}:${t.lessonId}'), ['report:l1', 'absence:l2']);
    });

    testWidgets('PD-15: a teacher edits their own report; the form opens with it', (tester) async {
      tester.view.physicalSize = const Size(1200, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final repo = _RecordingLessons()
        ..existing = const LessonReportDraft(lessonNumber: 7, coveredTopics: ['reading'], rating: 3, note: 'tired');
      await tester.pumpWidget(app(const QuickReportForm(editLessonId: 'l1'), lessons: repo));
      await tester.pumpAndSettle();
      expect(find.text('Edit report'), findsOneWidget);
      expect(find.text('tired'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('report-topic-writing')));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const ValueKey('report-submit')));
      await tester.tap(find.byKey(const ValueKey('report-submit')));
      await tester.pumpAndSettle();
      expect(repo.edits.single.coveredTopics, ['reading', 'writing']);
      expect(repo.edits.single.lessonNumber, 7);
      expect(repo.edits.single.note, 'tired');
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
      await tester.tap(find.byKey(const ValueKey('excuse-category-illness')));
      await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), 'fever');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('lesson-ticket-submit')));
      await tester.pumpAndSettle();
      expect(find.text('This lesson can no longer be updated this way.'), findsOneWidget);
      expect(find.text('fever'), findsOneWidget);
    });

    group('PD-50: every apology names a category the family sees', () {
      LessonTicket ticket(LessonTicketKind kind) => LessonTicket(
            kind: kind,
            lessonId: 'l2',
            startsAt: DateTime(2026, 10, 19, 17),
            endsAt: DateTime(2026, 10, 19, 17, 30),
          );
      bool canSend(WidgetTester tester) =>
          tester.widget<FilledButton>(find.byKey(const ValueKey('lesson-ticket-submit'))).onPressed != null;
      Future<void> send(WidgetTester tester) async {
        await tester.tap(find.byKey(const ValueKey('lesson-ticket-submit')));
        await tester.pumpAndSettle();
      }

      for (final lang in ['en', 'ar']) {
        testWidgets('a family before the start: a category alone is enough; the note is optional ($lang)', (tester) async {
          final repo = _RecordingLessons();
          await tester.pumpWidget(app(LessonTicketForm(ticket: ticket(LessonTicketKind.apology)), lessons: repo, locale: Locale(lang)));
          await tester.pumpAndSettle();
          final l10n = L10n.of(tester.element(find.byType(LessonTicketForm)));
          expect(find.text(l10n.ticketCategoryLabel), findsOneWidget, reason: 'the picker is labelled');
          for (final label in [
            l10n.excuseCategoryTravel, l10n.excuseCategoryIllness, l10n.excuseCategoryExams,
            l10n.excuseCategoryEmergency, l10n.excuseCategoryOther,
          ]) {
            expect(find.text(label), findsOneWidget);
          }
          expect(find.text(l10n.ticketFamilyNoteOptional), findsOneWidget);
          if (lang == 'ar') {
            expect(find.text('ظرف طارئ'), findsOneWidget);
            expect(find.text('ملاحظة للمعلم والإدارة (اختياري)'), findsOneWidget);
          }

          expect(canSend(tester), isFalse, reason: 'nothing picked yet');
          await send(tester);
          expect(repo.apologies, isEmpty);

          await tester.tap(find.byKey(const ValueKey('excuse-category-travel')));
          await tester.pump();
          expect(canSend(tester), isTrue, reason: 'a category, no text');
          await send(tester);
          expect(repo.apologies.single, (LessonTicketKind.apology, null, 'travel'));
        });
      }

      testWidgets('a family before the start may add a note, sent beside the category', (tester) async {
        final repo = _RecordingLessons();
        await tester.pumpWidget(app(LessonTicketForm(ticket: ticket(LessonTicketKind.apology)), lessons: repo));
        await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), 'A fever since last night');
        await tester.pump();
        expect(canSend(tester), isFalse, reason: 'text alone is not enough');
        await tester.tap(find.byKey(const ValueKey('excuse-category-illness')));
        await tester.pump();
        await send(tester);
        expect(repo.apologies.single, (LessonTicketKind.apology, 'A fever since last night', 'illness'));
      });

      for (final (kind, lang) in [
        (LessonTicketKind.lateApology, 'en'),
        (LessonTicketKind.lateApology, 'ar'),
        (LessonTicketKind.teacherApology, 'en'),
        (LessonTicketKind.teacherApology, 'ar'),
      ]) {
        testWidgets('${kind.name}: needs both a category and the note, and sends both ($lang)', (tester) async {
          final repo = _RecordingLessons();
          await tester.pumpWidget(app(LessonTicketForm(ticket: ticket(kind)), lessons: repo, locale: Locale(lang)));
          await tester.pumpAndSettle();
          final l10n = L10n.of(tester.element(find.byType(LessonTicketForm)));
          final noteLabel = kind == LessonTicketKind.teacherApology ? l10n.cardStaffNote : l10n.ticketFamilyDetails;
          expect(find.text(noteLabel), findsOneWidget, reason: 'the note says who reads it');
          if (lang == 'en' && kind == LessonTicketKind.teacherApology) {
            expect(find.text('Note (staff and the teacher only)'), findsOneWidget);
          }
          if (lang == 'ar' && kind == LessonTicketKind.teacherApology) {
            expect(find.text('ملاحظة (للإدارة والمعلم فقط)'), findsOneWidget);
          }

          await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), 'Out of town');
          await tester.pump();
          expect(canSend(tester), isFalse, reason: 'no category yet');
          await send(tester);
          expect(repo.apologies, isEmpty);

          await tester.tap(find.byKey(const ValueKey('excuse-category-emergency')));
          await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), '');
          await tester.pump();
          expect(canSend(tester), isFalse, reason: 'the note is still required here');

          await tester.enterText(find.byKey(const ValueKey('lesson-ticket-main')), 'Out of town');
          await tester.pump();
          expect(canSend(tester), isTrue);
          await send(tester);
          expect(repo.apologies.single, (kind, 'Out of town', 'emergency'));
        });
      }

      testWidgets('an absence has no category picker', (tester) async {
        await tester.pumpWidget(app(LessonTicketForm(ticket: ticket(LessonTicketKind.absence)), lessons: _RecordingLessons()));
        expect(find.byKey(const ValueKey('excuse-category-travel')), findsNothing);
      });
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

    testWidgets('PD-15: a teacher may record another agreed time; a parent only picks a free one', (tester) async {
      const ticket = LessonTicket(kind: LessonTicketKind.bookMakeup, lessonId: 'l9');
      await tester.pumpWidget(app(const MakeupSheet(ticket: ticket), lessons: _RecordingLessons(), role: UserRole.teacher));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('makeup-other-time')), findsOneWidget);
      expect(find.text('Book the make-up lesson'), findsOneWidget);
      await tester.pumpWidget(app(const MakeupSheet(ticket: ticket), lessons: _RecordingLessons(), role: UserRole.parent));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('makeup-other-time')), findsNothing);
    });

    testWidgets('no free time says the supervision team will arrange it', (tester) async {
      const ticket = LessonTicket(kind: LessonTicketKind.bookMakeup, lessonId: 'l9');
      await tester.pumpWidget(app(const MakeupSheet(ticket: ticket), lessons: _RecordingLessons()));
      await tester.pumpAndSettle();
      expect(find.textContaining('supervision team will arrange'), findsOneWidget);
    });

    Widget scheduleApp(_RecordingLessons repo) => ProviderScope(
          overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
          child: MaterialApp(
            locale: const Locale('en'),
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
            home: const TeacherScheduleScreen(),
          ),
        );
    final now = DateTime.now();
    DateTime day(int offset, int hour) => DateTime(now.year, now.month, now.day + offset, hour);
    ScheduledLesson scheduled(String id, DateTime at, {String phase = 'upcoming', String? outcome, String kind = 'regular'}) =>
        ScheduledLesson(id: id, learnerId: 'l_$id', learnerName: 'learner_$id', startsAt: at, endsAt: at.add(const Duration(minutes: 30)), kind: kind, phase: phase, outcome: outcome);
    List<String> rowKeys(WidgetTester tester) => tester
        .widgetList<ListTile>(find.byType(ListTile))
        .map((t) => t.key)
        .whereType<ValueKey<String>>()
        .map((k) => k.value)
        .toList();

    testWidgets('the teacher\'s Schedule groups by day and flags a lesson that needs its report', (tester) async {
      final repo = _RecordingLessons()
        ..mine = [
          scheduled('a', day(1, 9), phase: 'awaiting_close'),
          scheduled('b', day(2, 10), kind: 'makeup'),
          scheduled('c', day(1, 8), phase: 'closed', outcome: 'held'),
        ];
      await tester.pumpWidget(scheduleApp(repo));
      await tester.pumpAndSettle();
      expect(find.text('Needs report'), findsOneWidget);
      expect(find.text('Held'), findsOneWidget);
      expect(find.text('Upcoming'), findsOneWidget);
      expect(find.textContaining('Make-up'), findsOneWidget);
      // Two days, earliest lesson first.
      expect(rowKeys(tester), ['schedule-c', 'schedule-a', 'schedule-b']);
    });

    // Owner 2026-10-24: "2 need a report", and nowhere to write them. A lesson from an
    // earlier day that is still owed its report is listed on top; a closed one is not.
    testWidgets('earlier lessons still owed a report lead the Schedule, newest first; a filter shows only them', (tester) async {
      final repo = _RecordingLessons()
        ..mine = [
          scheduled('old', day(-4, 18), phase: 'overdue'),
          scheduled('recent', day(-2, 18), phase: 'overdue'),
          scheduled('next', day(1, 18)),
          scheduled('later', day(4, 18)),
        ];
      await tester.pumpWidget(scheduleApp(repo));
      await tester.pumpAndSettle();
      expect(find.text('Still owed a report'), findsOneWidget);
      expect(rowKeys(tester), ['schedule-recent', 'schedule-old', 'schedule-next', 'schedule-later']);

      await tester.tap(find.text('Needs a report (2)'));
      await tester.pumpAndSettle();
      expect(rowKeys(tester), ['schedule-recent', 'schedule-old']);
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(rowKeys(tester), hasLength(4));
    });

    testWidgets('tapping a lesson opens what may be done with it now', (tester) async {
      final owed = scheduled('owed', day(-3, 18), phase: 'overdue');
      final next = scheduled('next', day(1, 18));
      final held = scheduled('held', day(1, 8), phase: 'closed', outcome: 'held');
      LessonTicket ticket(ScheduledLesson l, LessonTicketKind kind) =>
          LessonTicket(kind: kind, lessonId: l.id, learnerId: l.learnerId, learnerName: l.learnerName, startsAt: l.startsAt, endsAt: l.endsAt);
      final repo = _RecordingLessons()
        ..mine = [owed, next, held]
        ..perLesson = {
          'owed': [ticket(owed, LessonTicketKind.report), ticket(owed, LessonTicketKind.absence)],
          'next': [ticket(next, LessonTicketKind.teacherApology)],
        };
      await tester.pumpWidget(scheduleApp(repo));
      await tester.pumpAndSettle();

      // An unreported lesson: straight into its report (attended / did not attend).
      await tester.tap(find.byKey(const ValueKey('schedule-owed')));
      await tester.pumpAndSettle();
      expect(repo.lessonReads, ['owed']);
      expect(find.byKey(const ValueKey('report-attended')), findsOneWidget);
      expect(find.byKey(const ValueKey('report-not-attended')), findsOneWidget);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      // An upcoming lesson: "I can't teach this lesson".
      await tester.tap(find.byKey(const ValueKey('schedule-next')));
      await tester.pumpAndSettle();
      expect(find.text("I can't teach this lesson"), findsOneWidget);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      // A held lesson: nothing to do, and it says what happened.
      await tester.tap(find.byKey(const ValueKey('schedule-held')));
      await tester.pumpAndSettle();
      expect(find.text('Nothing to do for this lesson now.'), findsOneWidget);
      expect(find.textContaining('Held'), findsWidgets);
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

    testWidgets('PD-15: a group shows each child apart -- age, course, times, package', (tester) async {
      final repo = _RecordingLessons()
        ..children = const [
          GroupChild(id: 'k1', name: 'learner_l', age: 9, courseName: 'Quran memorization', packageLessons: 12, teacherName: 'teacher_c',
              schedule: [GroupChildSlot(weekday: 1, start: '17:00', durationMinutes: 30)]),
          GroupChild(id: 'k2', name: 'learner_m', packageLessons: 8),
        ];
      await tester.pumpWidget(app(const SingleChildScrollView(child: GroupChildrenSection(conversationId: 'c1')), lessons: repo));
      await tester.pumpAndSettle();
      final first = find.byKey(const ValueKey('group-child-k1'));
      final second = find.byKey(const ValueKey('group-child-k2'));
      expect(find.descendant(of: first, matching: find.text('9 years')), findsOneWidget);
      expect(find.descendant(of: first, matching: find.text('Quran memorization')), findsOneWidget);
      expect(find.descendant(of: first, matching: find.text('Monday · 17:00 · 30 min')), findsOneWidget);
      expect(find.descendant(of: first, matching: find.text('12 lessons')), findsOneWidget);
      expect(find.descendant(of: second, matching: find.text('8 lessons')), findsOneWidget);
      expect(find.descendant(of: second, matching: find.text('No regular times yet')), findsOneWidget);
    });

    // A family group (PD-15) names NO single learner: its children come from
    // /conversations/:id/learners. Each child's progress and Materials must come with
    // that child's card, or nobody ever sees them from a family group.
    group('a family group\'s children each get their progress and Materials', () {
      const one = GroupChild(id: 'k1', name: 'learner_l');
      const two = GroupChild(id: 'k2', name: 'learner_m');
      const month = ChildProgress(attended: 3, apologised: 0, absent: 0, attendedAllTime: 3, streak: 3, makeupsOwed: 0);
      Widget section({required bool entries}) =>
          SingleChildScrollView(child: GroupChildrenSection(conversationId: 'c1', withChildEntries: entries));

      testWidgets('one child: one Materials entry, under that child', (tester) async {
        final repo = _RecordingLessons()
          ..children = const [one]
          ..childProgress = month;
        await tester.pumpWidget(app(section(entries: true), lessons: repo, materials: _SomeMaterials()));
        await tester.pumpAndSettle();
        final block = find.byKey(const ValueKey('group-child-block-k1'));
        expect(find.descendant(of: block, matching: find.byKey(const ValueKey('materials-entry-k1'))), findsOneWidget);
        expect(find.descendant(of: block, matching: find.text('This month')), findsOneWidget);
      });

      testWidgets('two children: two entries, each under its own child', (tester) async {
        final repo = _RecordingLessons()
          ..children = const [one, two]
          ..childProgress = month;
        await tester.pumpWidget(app(section(entries: true), lessons: repo, materials: _SomeMaterials()));
        await tester.pumpAndSettle();
        for (final id in ['k1', 'k2']) {
          final block = find.byKey(ValueKey('group-child-block-$id'));
          expect(find.descendant(of: block, matching: find.byKey(ValueKey('materials-entry-$id'))), findsOneWidget);
          expect(find.descendant(of: block, matching: find.text('This month')), findsOneWidget);
        }
        expect(find.text('Materials'), findsNWidgets(2));
      });

      testWidgets('a group about ONE learner shows them from its learner instead: none here, nothing twice', (tester) async {
        final repo = _RecordingLessons()..children = const [one];
        await tester.pumpWidget(app(section(entries: false), lessons: repo, materials: _SomeMaterials()));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('group-child-k1')), findsOneWidget);
        expect(find.byKey(const ValueKey('materials-entry-k1')), findsNothing);
        expect(find.text('This month'), findsNothing);
      });

      testWidgets('a build with no materials server offers no Materials entry', (tester) async {
        final repo = _RecordingLessons()..children = const [one, two];
        await tester.pumpWidget(app(section(entries: true), lessons: repo));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('materials-entry-k1')), findsNothing);
        expect(find.byKey(const ValueKey('materials-entry-k2')), findsNothing);
      });
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

/// A materials server is there; the entry asks nothing of it until it is opened.
class _SomeMaterials implements MaterialsRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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

  final absences = <String>[];
  final edits = <LessonReportDraft>[];
  LessonReportDraft? existing;
  List<GroupChild> children = const [];

  @override
  Future<void> absence(String lessonId, {String? note}) async {
    _maybeRefuse();
    absences.add(lessonId);
  }

  @override
  Future<LessonReportDraft?> reportFor(String lessonId) async => existing;

  @override
  Future<void> editReport(String lessonId, LessonReportDraft draft) async {
    _maybeRefuse();
    edits.add(draft);
  }

  @override
  Future<List<GroupChild>> groupChildren(String conversationId) async => children;

  /// PD-50: what each apology sent -- (kind, reason, category).
  final apologies = <(LessonTicketKind, String?, String?)>[];

  @override
  Future<void> apologise(String lessonId, LessonTicketKind kind, {String? reason, String? category}) async {
    _maybeRefuse();
    apologies.add((kind, reason, category));
  }

  /// What makeupSlots answers; and what was booked / requested.
  MakeupOffer offer = const MakeupOffer(durationMinutes: 30, slots: []);
  final booked = <DateTime>[];
  List<ScheduledLesson> mine = const [];

  @override
  Future<MakeupOffer> makeupSlots(String lessonId) async => offer;

  @override
  Future<void> bookMakeup(String lessonId, DateTime startsAt) async {
    _maybeRefuse();
    booked.add(startsAt);
  }

  /// PD-31's weekly and move flows have their own fake (change_lesson_time_test.dart).
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => mine;

  /// What GET /lessons/:id offers per lesson, and how often it was asked.
  Map<String, List<LessonTicket>> perLesson = const {};
  final lessonReads = <String>[];

  @override
  Future<List<LessonTicket>> lessonTickets(String lessonId) async {
    lessonReads.add(lessonId);
    return perLesson[lessonId] ?? const [];
  }

  ChildProgress? childProgress;
  TeacherWorkload? workload;

  @override
  Future<ChildProgress> progress(String learnerId) async => childProgress!;

  @override
  Future<TeacherWorkload> myWorkload() async => workload ?? (throw UnsupportedError('none'));

  /// What studentProfile answers; null refuses as the server does a stranger (404).
  StudentProfile? profile;

  @override
  Future<StudentProfile> studentProfile(String learnerId) async =>
      profile ?? (throw const AppError(AppErrorKind.notFound, code: 'COMM.LESSON_NOT_FOUND'));
}
