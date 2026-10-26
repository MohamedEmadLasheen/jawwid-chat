import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_report_sheet.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-30: "Lesson 2 of 24" -- the teacher's report form and the report card -- and the
/// Schedule's "Suspended — payment".
void main() {
  Widget app(Widget home, {LessonRepository? lessons, Locale locale = const Locale('en'), UserRole role = UserRole.teacher}) {
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
        home: Scaffold(body: home),
      ),
    );
  }

  LessonTicket ticket({int? total}) => LessonTicket(
        kind: LessonTicketKind.report,
        lessonId: 'l1',
        startsAt: DateTime(2026, 10, 26, 17),
        endsAt: DateTime(2026, 10, 26, 17, 30),
        learnerName: 'Adam',
        suggestedLessonNumber: 2,
        suggestedLessonTotal: total,
      );

  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  group('the report form', () {
    testWidgets('with a subscription: "Lesson 2 of 24", following the number typed', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(QuickReportForm(ticket: ticket(total: 24)), lessons: _Lessons()));
      await tester.pumpAndSettle();

      expect(find.text('Lesson 2 of 24'), findsOneWidget);

      // Past the last lesson it says so, as the server keeps it.
      await tester.enterText(find.byKey(const ValueKey('report-lesson-number')), '25');
      await tester.pump();
      expect(find.text('Lesson 25 of 24'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('report-lesson-number')), '');
      await tester.pump();
      expect(find.byKey(const ValueKey('report-lesson-of')), findsNothing);
    });

    testWidgets('without one: the lesson number alone, as before', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(QuickReportForm(ticket: ticket()), lessons: _Lessons()));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('report-lesson-of')), findsNothing);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('in Arabic: الحصة 2 من 24', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(QuickReportForm(ticket: ticket(total: 24)), lessons: _Lessons(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('الحصة 2 من 24'), findsOneWidget);
    });

    testWidgets('editing: the total the report kept', (tester) async {
      tall(tester);
      final lessons = _Lessons()..existing = const LessonReportDraft(lessonNumber: 7, lessonTotal: 24, coveredTopics: ['reading']);
      await tester.pumpWidget(app(const QuickReportForm(editLessonId: 'l1'), lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Lesson 7 of 24'), findsOneWidget);
    });

    test('the total is never sent: the server works it out', () {
      const draft = LessonReportDraft(lessonNumber: 2, lessonTotal: 24, coveredTopics: ['reading']);
      expect(draft.toJson().containsKey('lessonTotal'), isFalse);
      expect(draft.toJson()['lessonNumber'], 2);
    });
  });

  group('the report card', () {
    Map<String, Object?> wire(Map<String, Object?> payload) => {
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
          'createdAt': '2026-10-26T12:00:00.000Z',
          'attachments': <Object?>[],
          'reactions': <Object?>[],
          'receipts': <Object?>[],
          'card': {'kind': 'lesson_report', 'lessonId': 'l1', 'payload': payload},
        };

    testWidgets('"2 of 24" beside the lesson number', (tester) async {
      final m = WireMappers.message(wire({'learnerName': 'Adam', 'lessonNumber': 2, 'lessonTotal': 24, 'coveredTopics': ['reading']}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), role: UserRole.parent));
      await tester.pumpAndSettle();
      expect(find.text('2 of 24'), findsOneWidget);
    });

    testWidgets('no total: the number alone', (tester) async {
      final m = WireMappers.message(wire({'learnerName': 'Adam', 'lessonNumber': 2, 'coveredTopics': ['reading']}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), role: UserRole.parent));
      await tester.pumpAndSettle();
      expect(find.text('2'), findsOneWidget);
      expect(find.textContaining(' of '), findsNothing);
    });

    testWidgets('in Arabic: 2 من 24', (tester) async {
      final m = WireMappers.message(wire({'learnerName': 'Adam', 'lessonNumber': 2, 'lessonTotal': 24, 'coveredTopics': ['reading']}), viewerActorId: 'p1');
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), role: UserRole.parent, locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('2 من 24'), findsOneWidget);
    });
  });

  group('the Schedule', () {
    ScheduledLesson lesson({String? suspendedFor}) => ScheduledLesson(
          id: 'l1',
          learnerName: 'Adam',
          startsAt: DateTime(2026, 10, 27, 17),
          endsAt: DateTime(2026, 10, 27, 17, 30),
          kind: 'regular',
          phase: 'upcoming',
          outcome: 'suspended',
          suspendedFor: suspendedFor,
        );

    test('a lesson held for payment reads "Suspended — payment"; no amount, nothing asked', () async {
      final en = await L10n.delegate.load(const Locale('en'));
      final ar = await L10n.delegate.load(const Locale('ar'));
      expect(scheduleStatus(en, lesson(suspendedFor: 'payment')), ('Suspended — payment', false));
      expect(scheduleStatus(ar, lesson(suspendedFor: 'payment')), ('موقوفة — الدفع', false));
      expect(scheduleStatus(en, lesson()), ('Suspended', false));
    });
  });
}

/// Only what the report form asks for; anything else is a test that wandered.
class _Lessons implements LessonRepository {
  LessonReportDraft? existing;

  @override
  Future<LessonReportDraft?> reportFor(String lessonId) async => existing;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
