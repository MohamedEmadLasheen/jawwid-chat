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
import 'package:jawwid_chat/features/lessons/presentation/lesson_ticket_sheet.dart';
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
}
