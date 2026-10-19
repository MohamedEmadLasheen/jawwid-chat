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
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/features/trials/presentation/trial_report_sheet.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/trial.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-11 T4 part 2 on the client: the trial group's name, its cards, and the teacher's
/// trial report under "+". The server's answers are stubbed; the client is held to
/// drawing what it is given and sending exactly what was entered.
void main() {
  Widget app(Widget home, {TrialRepository? repo, Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [if (repo != null) trialRepositoryProvider.overrideWithValue(repo)],
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
        'authorKind': 'staff',
        'authorId': 's1',
        'type': 'card',
        'body': 'plain-text fallback',
        'visibility': 'customer',
        'moderation': 'published',
        'createdAt': '2026-10-19T12:00:00.000Z',
        'attachments': <Object?>[],
        'reactions': <Object?>[],
        'receipts': <Object?>[],
        'card': {'kind': kind, 'lessonId': null, 'payload': payload},
      };

  final ticket = TrialTicket(trialId: 'tr1', prospectName: 'prospect_q', startsAt: DateTime.utc(2026, 10, 19, 10), durationMinutes: 30);

  group('the trial group', () {
    Conversation mapped(String type) => WireMappers.conversation(
          {'id': 'c1', 'type': type, 'title': 'teacher_c', 'lastActivityAt': '2026-10-19T12:00:00.000Z'},
          viewerRole: UserRole.teacher,
          viewerActorId: 't1',
        );

    test('is known by its server type and read under its own name, never the staff-side title', () {
      final c = mapped('trial_group');
      expect(c.isTrialGroup, isTrue);
      expect(c.isTeacherSupervision, isFalse);
      expect(c.kind, ConversationKind.adminDirect);
      expect(c.displayTitle('Supervision', trialGroupLabel: 'Trial lessons'), 'Trial lessons');
      expect(mapped('direct').isTrialGroup, isFalse);
      expect(mapped('direct').displayTitle('Supervision', trialGroupLabel: 'Trial lessons'), 'teacher_c');
    });
  });

  group('the cards', () {
    testWidgets('a report shows what was covered and the rating, not the plain text', (tester) async {
      final m = WireMappers.message(
        wireCard('trial_report', {
          'trialId': 'tr1', 'prospectName': 'prospect_q', 'startsAt': '2026-10-19T10:00:00.000Z',
          'covered': 'letters 1-5', 'rating': 4,
        }),
        viewerActorId: 't1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('Trial report'), findsOneWidget);
      expect(find.text('letters 1-5'), findsOneWidget);
      expect(find.text('4/5'), findsOneWidget);
      expect(find.text('plain-text fallback'), findsNothing);
    });

    testWidgets('a subscription reads as awaiting Core, in Arabic too', (tester) async {
      final m = WireMappers.message(
        wireCard('trial_decision', {'trialId': 'tr1', 'prospectName': 'prospect_q', 'result': 'subscribed'}),
        viewerActorId: 't1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('اشترك'), findsOneWidget);
      expect(find.text('تُحتسب بعد أن يؤكد Core الاشتراك.'), findsOneWidget);
    });
  });

  group('the + menu in a trial group', () {
    testWidgets('offers one report per trial, named by prospect; picking one returns it', (tester) async {
      ComposerChoice? picked;
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(
          onPressed: () async => picked = await showComposerMenu(context, trialTickets: [ticket]),
          child: const Text('+'),
        ),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      expect(find.text('Trials'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('trial-ticket-tr1')));
      await tester.pumpAndSettle();
      expect((picked! as TrialChoice).ticket.trialId, 'tr1');
    });
  });

  group('the trial report', () {
    testWidgets('attended needs what was covered; sends exactly what was entered', (tester) async {
      final repo = _RecordingTrials();
      await tester.pumpWidget(app(TrialReportForm(ticket: ticket), repo: repo));
      final submit = find.byKey(const ValueKey('trial-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      await tester.enterText(find.byKey(const ValueKey('trial-covered')), ' letters 1-5 ');
      await tester.tap(find.byKey(const ValueKey('trial-rating-4')));
      await tester.pump();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      final (id, draft) = repo.sent.single;
      expect(id, 'tr1');
      expect(draft.attended, isTrue);
      expect(draft.covered, 'letters 1-5');
      expect(draft.rating, 4);
      expect(draft.note, isNull);
    });

    testWidgets('did not attend sends no report; a trial closed elsewhere says so and keeps the form', (tester) async {
      final repo = _RecordingTrials(refuseWith: 'COMM.LESSON_STATE');
      await tester.pumpWidget(app(TrialReportForm(ticket: ticket), repo: repo));
      await tester.tap(find.text('Did not attend'));
      await tester.pump();
      expect(find.byKey(const ValueKey('trial-covered')), findsNothing);
      final submit = find.byKey(const ValueKey('trial-submit'));
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(repo.sent.single.$2.attended, isFalse);
      expect(repo.sent.single.$2.covered, isNull);
      expect(find.byType(TrialReportForm), findsOneWidget);
      expect(find.textContaining('no longer'), findsWidgets);
    });
  });
}

class _RecordingTrials implements TrialRepository {
  _RecordingTrials({this.refuseWith});

  final String? refuseWith;
  final sent = <(String, TrialAttendanceDraft)>[];

  @override
  Future<List<TrialTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft) async {
    sent.add((trialId, draft));
    if (refuseWith != null) throw AppError(AppErrorKind.validation, code: refuseWith);
  }
}
