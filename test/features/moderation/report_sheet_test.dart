import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/moderation/data/moderation_repository.dart';
import 'package:jawwid_chat/features/moderation/presentation/my_reports_screen.dart';
import 'package:jawwid_chat/features/moderation/presentation/report_sheet.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../messages/fake_voice_devices.dart';
import '../stories/fake_story_video_player.dart';

/// PD-57 (WP-1B): the Report sheet, its two entry points, the note rule, the calm answers to
/// the contract's error codes, and My reports -- each in English and in Arabic (RTL).
void main() {
  /// The strings the tests look for, per locale. Taken from the real l10n so a change to a
  /// label cannot leave a test asserting stale words.
  Future<L10n> l10nFor(Locale locale) => L10n.delegate.load(locale);

  Widget wrap(Widget home, {required Locale locale, List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        principalIdProvider.overrideWithValue('me'),
        ...overrides,
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
        home: home,
      ),
    );
  }

  /// A page whose one button opens the sheet for [target].
  Widget sheetHost(FakeModerationRepository repo, ReportTarget target, Locale locale) {
    return wrap(
      Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              key: const ValueKey('open'),
              onPressed: () => showReportSheet(context, target: target),
              child: const Text('open'),
            ),
          ),
        ),
      ),
      locale: locale,
      overrides: [moderationRepositoryProvider.overrideWithValue(repo)],
    );
  }

  Future<void> openSheet(WidgetTester tester, FakeModerationRepository repo, ReportTarget target, Locale locale) async {
    await tester.pumpWidget(sheetHost(repo, target, locale));
    await tester.tap(find.byKey(const ValueKey('open')));
    await tester.pumpAndSettle();
  }

  Future<void> pick(WidgetTester tester, ReportReason reason) async {
    await tester.tap(find.byKey(ValueKey('report-reason-${reason.wire}')));
    await tester.pumpAndSettle();
  }

  Future<void> send(WidgetTester tester) async {
    final button = find.byKey(const ValueKey('report-submit'));
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  for (final locale in const [Locale('en'), Locale('ar')]) {
    final tag = locale.languageCode;

    group('the sheet [$tag]', () {
      testWidgets('offers exactly the five reasons as a plain list, never a dropdown', (tester) async {
        final l10n = await l10nFor(locale);
        await openSheet(tester, FakeModerationRepository(), const MessageReportTarget('m1'), locale);

        for (final r in ReportReason.values) {
          expect(find.byKey(ValueKey('report-reason-${r.wire}')), findsOneWidget);
          expect(find.text(reportReasonLabel(r, l10n)), findsOneWidget);
        }
        expect(find.byType(DropdownButton<ReportReason>), findsNothing);
        expect(find.byType(DropdownMenu<ReportReason>), findsNothing);
        expect(Directionality.of(tester.element(find.byType(ReportSheet))), locale.languageCode == 'ar' ? TextDirection.rtl : TextDirection.ltr);
      });

      testWidgets('nothing can be sent before a reason is chosen', (tester) async {
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);

        final button = tester.widget<FilledButton>(find.byKey(const ValueKey('report-submit')));
        expect(button.onPressed, isNull);
        expect(repo.submitted, isEmpty);
      });

      testWidgets('"something else" requires a note: no request without one, the note field says so', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);

        await pick(tester, ReportReason.other);
        await send(tester);

        expect(repo.submitted, isEmpty, reason: 'nothing leaves the device without the note');
        expect(find.text(l10n.reportNoteRequired), findsOneWidget);

        await tester.enterText(find.byKey(const ValueKey('report-note')), '  Keeps insulting my son.  ');
        await send(tester);

        expect(repo.bodies.single, {
          'targetKind': 'message',
          'messageId': 'm1',
          'reason': 'other',
          'note': 'Keeps insulting my son.',
        });
        expect(find.byKey(const ValueKey('report-confirmation')), findsOneWidget);
      });

      testWidgets('a whitespace-only note is no note', (tester) async {
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);
        await pick(tester, ReportReason.other);
        await tester.enterText(find.byKey(const ValueKey('report-note')), '     ');
        await send(tester);
        expect(repo.submitted, isEmpty);
      });

      testWidgets('the note is capped at 500 characters', (tester) async {
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);
        await pick(tester, ReportReason.other);
        await tester.enterText(find.byKey(const ValueKey('report-note')), 'x' * 600);
        await send(tester);

        expect((repo.bodies.single['note']! as String).length, ModerationErrors.noteMaxLength);
      });

      testWidgets('a message report sends the exact body, with no note for a reason that needs none', (tester) async {
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const MessageReportTarget('m7'), locale);
        await pick(tester, ReportReason.spam);
        await send(tester);

        expect(repo.bodies.single, {'targetKind': 'message', 'messageId': 'm7', 'reason': 'spam'});
      });

      testWidgets('a person report sends the subject {kind, id}', (tester) async {
        final repo = FakeModerationRepository();
        await openSheet(tester, repo, const PersonReportTarget(kind: 'teacher', id: 'a9'), locale);
        await pick(tester, ReportReason.childSafety);
        await tester.enterText(find.byKey(const ValueKey('report-note')), 'Asked my child for photos.');
        await send(tester);

        expect(repo.bodies.single, {
          'targetKind': 'person',
          'subject': {'kind': 'teacher', 'id': 'a9'},
          'reason': 'child_safety',
          'note': 'Asked my child for photos.',
        });
      });

      testWidgets('a calm confirmation follows, and Done closes the sheet', (tester) async {
        final l10n = await l10nFor(locale);
        await openSheet(tester, FakeModerationRepository(), const MessageReportTarget('m1'), locale);
        await pick(tester, ReportReason.harassment);
        await send(tester);

        expect(find.text(l10n.reportSentTitle), findsOneWidget);
        expect(find.text(l10n.reportSentBody), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('report-done')));
        await tester.pumpAndSettle();
        expect(find.byType(ReportSheet), findsNothing);
      });

      testWidgets('reporting the same thing twice says it is already being looked at (the 200)', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeModerationRepository();
        await repo.submit(const ReportDraft(target: MessageReportTarget('m1'), reason: ReportReason.spam));
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);
        await pick(tester, ReportReason.spam);
        await send(tester);

        expect(find.text(l10n.reportAlreadyBody), findsOneWidget);
      });
    });

    group('errors are calm [$tag]', () {
      Future<void> failWith(WidgetTester tester, String code, String Function(L10n) expected, {AppError? thrown, ReportTarget target = const MessageReportTarget('m1')}) async {
        final l10n = await l10nFor(locale);
        final repo = FakeModerationRepository(refuseWith: code);
        await openSheet(tester, repo, target, locale);
        await pick(tester, ReportReason.spam);
        await send(tester);

        expect(find.byKey(const ValueKey('report-error')), findsOneWidget);
        expect(find.text(expected(l10n)), findsOneWidget);
        // The sheet stays open, the send button works again, and nothing technical shows.
        expect(find.byKey(const ValueKey('report-confirmation')), findsNothing);
        expect(tester.widget<FilledButton>(find.byKey(const ValueKey('report-submit'))).onPressed, isNotNull);
        expect(find.textContaining('COMM.'), findsNothing);
        expect(find.textContaining('COMMON.'), findsNothing);
        expect(find.textContaining('Exception'), findsNothing);
      }

      testWidgets('429 rate limited', (tester) => failWith(tester, ModerationErrors.rateLimited, (l) => l.reportErrorRateLimited));
      testWidgets('404 not visible', (tester) => failWith(tester, ModerationErrors.targetNotVisible, (l) => l.reportErrorNotVisible));
      testWidgets('400 self', (tester) => failWith(tester, ModerationErrors.self, (l) => l.reportErrorSelf));
      testWidgets('400 not reportable', (tester) => failWith(tester, ModerationErrors.notReportable, (l) => l.reportErrorNotReportable));
      // LR-25: a PERSON (official account, manager, Super Admin) is not "a kind of message".
      testWidgets(
        '400 not reportable, person target, points to support',
        (tester) => failWith(
          tester,
          ModerationErrors.notReportable,
          (l) => l.reportErrorNotReportablePerson,
          target: const PersonReportTarget(kind: 'staff', id: 'p1'),
        ),
      );
      test('person refusal text is honest', () async {
        final l10n = await l10nFor(locale);
        expect(l10n.reportErrorNotReportablePerson, isNot(l10n.reportErrorNotReportable));
        expect(l10n.reportErrorNotReportablePerson, contains(l10n.supportContactAction));
        expect(l10n.blockErrorNotAllowed, contains(l10n.supportContactAction));
      });
      testWidgets('403 terms not accepted', (tester) => failWith(tester, ModerationErrors.termsNotAccepted, (l) => l.reportErrorTerms));
      testWidgets('anything else', (tester) => failWith(tester, 'COMMON.SOMETHING_NEW', (l) => l.reportErrorGeneric));

      testWidgets('400 note required, from the server, points at the note field', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeModerationRepository(refuseWith: ModerationErrors.noteRequired);
        await openSheet(tester, repo, const MessageReportTarget('m1'), locale);
        await pick(tester, ReportReason.spam);
        await send(tester);
        expect(find.text(l10n.reportNoteRequired), findsOneWidget);
      });
    });

    group('entry points [$tag]', () {
      late FakeBackend backend;
      late FakeModerationRepository repo;

      setUp(() {
        backend = FakeBackend(role: UserRole.parent);
        repo = FakeModerationRepository();
      });
      tearDown(() => backend.dispose());

      Widget chat() {
        final recorder = FakeVoiceRecorder();
        final player = FakeVoicePlayer();
        addTearDown(recorder.dispose);
        addTearDown(player.dispose);
        return wrap(
          ChatScreen(conversationId: backend.listConversations().first.id, title: 'Jawwid'),
          locale: locale,
          overrides: [
            moderationRepositoryProvider.overrideWithValue(repo),
            voiceRecorderProvider.overrideWithValue(recorder),
            voicePlayerProvider.overrideWithValue(player),
            storyVideoPlayerFactoryProvider.overrideWithValue(() => FakeStoryVideoPlayer()),
            conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
            messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          ],
        );
      }

      testWidgets('long-pressing someone else\'s message offers Report, which opens the sheet', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(chat());
        await tester.pumpAndSettle();

        await tester.longPress(find.byType(MessageBubble).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text(l10n.reportAction));
        await tester.pumpAndSettle();

        expect(find.byType(ReportSheet), findsOneWidget);
        expect(find.text(l10n.reportSheetMessageIntro), findsOneWidget);

        await pick(tester, ReportReason.inappropriate);
        await send(tester);
        final body = repo.bodies.single;
        expect(body['targetKind'], 'message');
        expect(body['messageId'], isA<String>());
        expect(body['reason'], 'inappropriate');
        expect(body.keys.toSet(), {'targetKind', 'messageId', 'reason'});
      });

      testWidgets('there is no Report on your own message', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(chat());
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), 'my own words');
        await tester.pump();
        await tester.tap(find.byIcon(Icons.send));
        await tester.pumpAndSettle();

        await tester.longPress(find.text('my own words'));
        await tester.pumpAndSettle();

        expect(find.text(l10n.replyAction), findsOneWidget, reason: 'the actions sheet is open on the sender\'s own bubble');
        expect(find.text(l10n.reportAction), findsNothing);
      });

      testWidgets('a person in a group can be reported from the profile, and yourself cannot', (tester) async {
        final l10n = await l10nFor(locale);
        const view = ProfileView(
          audience: ProfileAudience.other,
          subject: ProfilePerson(id: 'c_group', displayName: 'Yusuf'),
          isGroup: true,
          members: [
            ProfilePerson(id: 'me', displayName: 'Me', role: ParticipantRole.parent, actorKind: 'contact'),
            // PD-57: the server's actorKind decides the kind; a teacher may carry memberRole admin.
            ProfilePerson(id: 'm_teacher', displayName: 'Ustadh Kareem', role: ParticipantRole.admin, actorKind: 'teacher'),
            ProfilePerson(id: 'm_system', displayName: 'Jawwid', role: ParticipantRole.system),
            // No actorKind from the server: no Report, never a guess from the role.
            ProfilePerson(id: 'm_unknown', displayName: 'Someone', role: ParticipantRole.teacher),
          ],
        );
        await tester.pumpWidget(wrap(
          const Scaffold(body: ProfileBody(view: view)),
          locale: locale,
          overrides: [moderationRepositoryProvider.overrideWithValue(repo)],
        ));
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('member-report-me')), findsNothing);
        expect(find.byKey(const ValueKey('member-report-m_system')), findsNothing);
        expect(find.byKey(const ValueKey('member-report-m_unknown')), findsNothing);
        await tester.tap(find.byKey(const ValueKey('member-report-m_teacher')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.reportSheetPersonIntro), findsOneWidget);

        await pick(tester, ReportReason.harassment);
        await send(tester);
        expect(repo.bodies.single, {
          'targetKind': 'person',
          'subject': {'kind': 'teacher', 'id': 'm_teacher'},
          'reason': 'harassment',
        });
      });

      testWidgets('a one-to-one profile offers Report this person, and not for yourself', (tester) async {
        final l10n = await l10nFor(locale);
        Widget tile(String id) => wrap(
              Scaffold(body: ReportPersonTile(person: ProfilePerson(id: id, displayName: 'Jawwid Support', role: ParticipantRole.admin, actorKind: 'staff'))),
              locale: locale,
              overrides: [moderationRepositoryProvider.overrideWithValue(repo)],
            );

        await tester.pumpWidget(tile('me'));
        expect(find.byKey(const ValueKey('profile-report-person')), findsNothing);

        await tester.pumpWidget(tile('staff_1'));
        await tester.tap(find.byKey(const ValueKey('profile-report-person')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.reportSheetPersonIntro), findsOneWidget);
        await pick(tester, ReportReason.spam);
        await send(tester);
        expect(repo.bodies.single['subject'], {'kind': 'staff', 'id': 'staff_1'});
      });

      testWidgets('a build without the report route offers no entry at all', (tester) async {
        await tester.pumpWidget(wrap(
          const Scaffold(body: ReportPersonTile(person: ProfilePerson(id: 'staff_1', displayName: 'S', role: ParticipantRole.admin, actorKind: 'staff'))),
          locale: locale,
        ));
        expect(find.byKey(const ValueKey('profile-report-person')), findsNothing);
      });
    });

    group('My reports [$tag]', () {
      Widget screen(ModerationRepository repo) =>
          wrap(const MyReportsScreen(), locale: locale, overrides: [moderationRepositoryProvider.overrideWithValue(repo)]);

      testWidgets('shows each report with its status and the answer, and nothing about evidence or a reviewer', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeModerationRepository(reports: [
          MyReport(
            id: 'r1',
            targetKind: 'message',
            reason: ReportReason.spam,
            status: ReportStatus.actioned,
            createdAt: DateTime.utc(2026, 11, 1, 12),
            answer: ReportAnswer(text: 'We removed the message.', at: DateTime.utc(2026, 11, 2, 12)),
          ),
          MyReport(id: 'r2', targetKind: 'person', reason: null, status: ReportStatus.inReview, createdAt: DateTime.utc(2026, 11, 3, 12)),
          MyReport(id: 'r3', targetKind: 'person', reason: ReportReason.other, status: ReportStatus.dismissed, createdAt: DateTime.utc(2026, 11, 4, 12)),
          MyReport(id: 'r4', targetKind: 'message', reason: ReportReason.harassment, status: ReportStatus.open, createdAt: DateTime.utc(2026, 11, 5, 12)),
        ]);
        await tester.pumpWidget(screen(repo));
        await tester.pumpAndSettle();

        expect(find.text(l10n.myReportsTitle), findsOneWidget);
        expect(find.text(reportReasonLabel(ReportReason.spam, l10n)), findsOneWidget);
        expect(find.text(l10n.myReportsReasonUnknown), findsOneWidget);
        expect(tester.widget<Text>(find.byKey(const ValueKey('my-report-status-r1'))).data, l10n.myReportsStatusActioned);
        expect(find.text(l10n.myReportsStatusInReview), findsOneWidget);
        expect(find.text(l10n.myReportsStatusDismissed), findsOneWidget);
        expect(find.text(l10n.myReportsStatusOpen), findsOneWidget);
        expect(find.text('We removed the message.'), findsOneWidget);
        expect(find.byKey(const ValueKey('my-report-answer-r2')), findsNothing);
        expect(find.text(l10n.myReportsAnswerLabel), findsOneWidget);
      });

      testWidgets('an empty list says so calmly', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(screen(FakeModerationRepository()));
        await tester.pumpAndSettle();
        expect(find.text(l10n.myReportsEmptyTitle), findsOneWidget);
      });
    });
  }

  group('which messages can be reported', () {
    Message message({
      bool isMine = false,
      MessageKind kind = MessageKind.text,
      String? id = 'm1',
      bool isDeleted = false,
      ApprovalState approval = ApprovalState.notRequired,
    }) =>
        Message(
          id: id,
          clientMessageId: 'c',
          conversationId: 'conv',
          sequence: 1,
          kind: kind,
          body: 'hello',
          createdAt: DateTime.utc(2026, 11, 1),
          deliveryState: DeliveryState.delivered,
          approvalState: approval,
          isMine: isMine,
          isDeleted: isDeleted,
        );

    test('someone else\'s text, voice, photo, video and file messages', () {
      for (final kind in [MessageKind.text, MessageKind.voice, MessageKind.image, MessageKind.video, MessageKind.file]) {
        expect(actionsFor(message(kind: kind), withReport: true), contains(MessageAction.report), reason: '$kind');
      }
    });

    test('never your own, a system message or a card', () {
      expect(actionsFor(message(isMine: true), withReport: true), isNot(contains(MessageAction.report)));
      expect(actionsFor(message(kind: MessageKind.system), withReport: true), isNot(contains(MessageAction.report)));
      expect(actionsFor(message(kind: MessageKind.card), withReport: true), isNot(contains(MessageAction.report)));
    });

    test('not one still awaiting approval, and not in a build without the route', () {
      expect(actionsFor(message(approval: ApprovalState.pending), withReport: true), isNot(contains(MessageAction.report)));
      expect(actionsFor(message()), isNot(contains(MessageAction.report)));
    });
  });
}
