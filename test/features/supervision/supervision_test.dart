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
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/features/supervision/presentation/my_leave_screen.dart';
import 'package:jawwid_chat/features/supervision/presentation/supervision_ticket_sheet.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/supervision.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-12 S1 on the client: the supervision conversation's name and its "+" requests,
/// the certificate and leave cards, the two forms and the teacher's own leave screen.
/// Nothing here decides who may do what -- the server's answers are stubbed, and the
/// client is held to drawing exactly what it is given and sending exactly what was typed.
void main() {
  Widget app(Widget home, {SupervisionRepository? repo, LessonRepository? lessons, Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        if (repo != null) supervisionRepositoryProvider.overrideWithValue(repo),
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

  Map<String, Object?> wireCard(String kind, Map<String, Object?> payload, {List<Object?> attachments = const []}) => {
        'id': 'm1',
        'conversationId': 'c1',
        'seq': '7',
        'authorKind': 'system',
        'authorId': null,
        'type': 'card',
        'body': 'plain-text fallback',
        'visibility': 'customer',
        'moderation': 'published',
        'createdAt': '2026-10-18T12:00:00.000Z',
        'attachments': attachments,
        'reactions': <Object?>[],
        'receipts': <Object?>[],
        'card': {'kind': kind, 'lessonId': null, 'payload': payload},
      };

  group('the supervision conversation', () {
    Conversation mapped(String type) => WireMappers.conversation(
          {'id': 'c1', 'type': type, 'title': 'teacher_c', 'lastActivityAt': '2026-10-18T12:00:00.000Z'},
          viewerRole: UserRole.teacher,
          viewerActorId: 't1',
        );

    test('is known by its server type, behaves like a 1:1 with Jawwid, and has its own name', () {
      final c = mapped('teacher_supervision');
      expect(c.isTeacherSupervision, isTrue);
      expect(c.kind, ConversationKind.adminDirect);
      expect(c.displayTitle('Supervision'), 'Supervision');
    });

    test('nothing else is ever taken for one -- not even a conversation titled like one', () {
      final group = mapped('student_group');
      expect(group.isTeacherSupervision, isFalse);
      expect(group.displayTitle('Supervision'), 'teacher_c');
    });
  });

  group('the cards', () {
    testWidgets('an issued certificate shows its file and what it certifies, not the plain text', (tester) async {
      final m = WireMappers.message(
        wireCard(
          'certificate_issued',
          {'learnerName': 'learner_l', 'title': 'Juz Amma', 'achievement': 'Memorized with tajweed', 'grade': 'Excellent'},
          attachments: [
            {
              'id': 'a1',
              'kind': 'file',
              'mimeType': 'application/pdf',
              'byteSize': 2048,
              'originalName': 'certificate.pdf',
              'url': 'https://api.test/media/a1',
            },
          ],
        ),
        viewerActorId: 'p1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('Certificate'), findsWidgets);
      expect(find.text('Juz Amma'), findsOneWidget);
      expect(find.text('Excellent'), findsOneWidget);
      expect(find.text('certificate.pdf'), findsOneWidget);
      expect(find.text('Congratulations! The certificate is attached.'), findsOneWidget);
      expect(find.text('plain-text fallback'), findsNothing);
    });

    testWidgets('an approved leave shows its calendar days and the balance, in Arabic too', (tester) async {
      final m = WireMappers.message(
        wireCard('leave_approved', {'firstDay': '2027-03-10', 'lastDay': '2027-03-12', 'days': 3, 'balance': 18}),
        viewerActorId: 't1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('تمت الموافقة على الإجازة'), findsOneWidget);
      expect(find.text('18'), findsOneWidget);
      expect(find.text('plain-text fallback'), findsNothing);
    });
  });

  group('discipline cards (PD-12 S2)', () {
    testWidgets('a deduction names the step and the violation, and says the amount is payroll\'s', (tester) async {
      final m = WireMappers.message(
        wireCard('discipline_deduction', {
          'violationKind': 'late',
          'lateMinutes': 15,
          'learnerName': 'learner_l',
          'lessonDay': '2026-10-15',
          'step': 1,
          'note': 'third late start',
        }),
        viewerActorId: 't1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.text('First deduction'), findsOneWidget);
      expect(find.textContaining('15 minutes late'), findsOneWidget);
      expect(find.textContaining('learner_l'), findsOneWidget);
      expect(find.text('The amount is set in payroll.'), findsOneWidget);
      expect(find.text('plain-text fallback'), findsNothing);
    });

    testWidgets('a temporary suspension shows its calendar days, in Arabic too', (tester) async {
      final m = WireMappers.message(
        wireCard('discipline_suspension', {
          'violationKind': 'teacher_no_show',
          'kind': 'temporary',
          'startsOn': '2026-10-20',
          'endsOn': '2026-10-26',
          'step': 4,
        }),
        viewerActorId: 't1',
      );
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('إيقاف مؤقت'), findsOneWidget);
      expect(find.textContaining('غياب عن الحصة'), findsOneWidget);
    });
  });

  group('the + menu in a supervision conversation', () {
    testWidgets('offers the requests under their own heading; picking one returns it', (tester) async {
      ComposerChoice? picked;
      await tester.pumpWidget(app(Builder(
        builder: (context) => TextButton(
          onPressed: () async => picked = await showComposerMenu(
            context,
            supervisionTickets: const [SupervisionTicketKind.certificate, SupervisionTicketKind.leave],
          ),
          child: const Text('+'),
        ),
      )));
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      expect(find.text('Requests'), findsOneWidget);
      expect(find.text('Lesson'), findsNothing);
      await tester.tap(find.text('Request leave'));
      await tester.pumpAndSettle();
      expect((picked! as SupervisionChoice).kind, SupervisionTicketKind.leave);
    });
  });

  group('the certificate form', () {
    testWidgets('cannot be sent until complete; pre-fills the printed name; sends what was typed', (tester) async {
      final repo = _RecordingSupervision();
      await tester.pumpWidget(app(
        const CertificateRequestForm(learners: [SupervisionLearner(id: 'l1', name: 'learner_l')]),
        repo: repo,
      ));
      final submit = find.byKey(const ValueKey('certificate-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      // One learner: chosen for the teacher, and their name proposed for printing.
      expect(find.text('learner_l'), findsWidgets);

      await tester.enterText(find.byKey(const ValueKey('certificate-title')), ' Juz Amma ');
      await tester.enterText(find.byKey(const ValueKey('certificate-achievement')), 'Memorized with tajweed');
      await tester.tap(find.byKey(const ValueKey('certificate-date')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(repo.certificates, hasLength(1));
      final sent = repo.certificates.single;
      expect(sent.learnerId, 'l1');
      expect(sent.title, 'Juz Amma');
      expect(sent.printedName, 'learner_l');
      expect(sent.grade, isNull);
      expect(calendarDay(sent.achievedOn), calendarDay(DateTime.now()));
    });
  });

  group('the leave form', () {
    testWidgets('sends calendar days and the reason; a refusal says why and keeps the form', (tester) async {
      final repo = _RecordingSupervision(refuseLeaveWith: 'COMM.LEAVE_STATE');
      await tester.pumpWidget(app(const LeaveRequestForm(), repo: repo));
      final submit = find.byKey(const ValueKey('leave-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);

      await tester.tap(find.byKey(const ValueKey('leave-first-day')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.text('1 day'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('leave-reason')), 'family wedding');
      await tester.pump();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(repo.leaveRequests.single, (calendarDay(DateTime.now()), calendarDay(DateTime.now()), 'family wedding'));
      expect(find.text("These dates can't be requested: they overlap another request or have already passed."), findsOneWidget);
      expect(find.text('family wedding'), findsOneWidget);
    });
  });

  group('a child\'s progress', () {
    testWidgets('lists the issued certificates instead of the placeholder', (tester) async {
      final lessons = _ProgressOnly(ChildProgress(
        attended: 3,
        apologised: 0,
        absent: 0,
        attendedAllTime: 12,
        streak: 3,
        makeupsOwed: 0,
        certificates: [ProgressCertificate(id: 'c1', title: 'Juz Amma', achievedOn: DateTime.utc(2026, 10, 1), grade: 'Excellent', conversationId: 'g1')],
      ));
      await tester.pumpWidget(app(const ChildProgressCard(learnerId: 'l1'), lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Certificates'), findsOneWidget);
      expect(find.text('Juz Amma'), findsOneWidget);
      expect(find.textContaining('Excellent'), findsOneWidget);
      expect(find.text('Certificates will appear here.'), findsNothing);
    });

    testWidgets('keeps the honest placeholder while none is issued', (tester) async {
      final lessons = _ProgressOnly(const ChildProgress(attended: 0, apologised: 0, absent: 0, attendedAllTime: 0, streak: 0, makeupsOwed: 0));
      await tester.pumpWidget(app(const ChildProgressCard(learnerId: 'l1'), lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Certificates will appear here.'), findsOneWidget);
    });
  });

  group('my leave', () {
    testWidgets('shows the server\'s numbers, and withdraws an undecided request after asking', (tester) async {
      final repo = _RecordingSupervision(summary: LeaveSummary(
        year: 2027,
        allowance: 21,
        used: 4,
        balance: 17,
        requests: [
          LeaveRequest(
            id: 'r1',
            firstDay: DateTime.utc(2027, 3, 10),
            lastDay: DateTime.utc(2027, 3, 12),
            days: 3,
            reason: 'family wedding',
            state: LeaveState.requested,
          ),
          LeaveRequest(
            id: 'r2',
            firstDay: DateTime.utc(2027, 1, 5),
            lastDay: DateTime.utc(2027, 1, 8),
            days: 4,
            reason: 'travel',
            state: LeaveState.approved,
          ),
        ],
      ));
      await tester.pumpWidget(app(const MyLeaveScreen(), repo: repo));
      await tester.pumpAndSettle();
      expect(find.text('Allowance 2027'), findsOneWidget);
      expect(find.text('17'), findsOneWidget);
      expect(find.text('Waiting'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
      // Only the undecided request can be withdrawn.
      expect(find.byKey(const ValueKey('withdraw-r2')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('withdraw-r1')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Withdraw'));
      await tester.pumpAndSettle();
      expect(repo.withdrawn, ['r1']);
    });

    testWidgets('says "not set yet" instead of a zero while there is no allowance', (tester) async {
      final repo = _RecordingSupervision(summary: const LeaveSummary(year: 2027, used: 0));
      await tester.pumpWidget(app(const MyLeaveScreen(), repo: repo));
      await tester.pumpAndSettle();
      expect(find.text('Not set yet'), findsNWidgets(2));
      expect(find.text('No leave requests this year.'), findsOneWidget);
    });
  });
}

/// Only `progress` is asked for here; anything else would be a test bug.
class _ProgressOnly implements LessonRepository {
  _ProgressOnly(this.value);

  final ChildProgress value;

  @override
  Future<ChildProgress> progress(String learnerId) async => value;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class _RecordingSupervision implements SupervisionRepository {
  _RecordingSupervision({this.refuseLeaveWith, this.summary = const LeaveSummary(year: 2027, used: 0)});

  final String? refuseLeaveWith;
  final LeaveSummary summary;
  final certificates = <CertificateDraft>[];
  final leaveRequests = <(String, String, String)>[];
  final withdrawn = <String>[];

  @override
  Future<SupervisionTickets> tickets(String conversationId) async => SupervisionTickets.none;

  @override
  Future<void> requestCertificate(CertificateDraft draft) async => certificates.add(draft);

  @override
  Future<void> requestLeave({required DateTime firstDay, required DateTime lastDay, required String reason}) async {
    leaveRequests.add((calendarDay(firstDay), calendarDay(lastDay), reason));
    if (refuseLeaveWith != null) throw AppError(AppErrorKind.validation, code: refuseLeaveWith);
  }

  @override
  Future<void> withdrawLeave(String requestId) async => withdrawn.add(requestId);

  @override
  Future<LeaveSummary> myLeave({int? year}) async => summary;

  @override
  Future<String> openOwnConversation() async => 'c1';
}
