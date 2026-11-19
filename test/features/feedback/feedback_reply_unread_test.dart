import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/http/http_feedback_repository.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/state_views.dart';
import 'package:jawwid_chat/features/feedback/presentation/teacher_feedback_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/teacher_feedback.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-32 amendment (owner, 2026-11-03): a reply the parent has not opened yet carries an
/// unread dot -- per item, per account -- that goes only when that reply is opened.
void main() {
  const child = FeedbackChild(learnerId: 'l1', name: 'Ahmad', teacherName: 'Ustadh Yusuf');

  FeedbackItem item(String id, {String? response, bool unread = false}) => FeedbackItem(
        id: id,
        learnerId: 'l1',
        childName: 'Ahmad',
        teacherName: 'Ustadh Yusuf',
        category: FeedbackCategory.complaint,
        body: 'Body of $id',
        status: FeedbackStatus.inReview,
        response: response,
        respondedAt: response == null ? null : DateTime.utc(2026, 10, 25),
        replyUnread: unread,
        createdAt: DateTime.utc(2026, 10, 24),
      );

  Widget app(FakeFeedbackRepository repo, Widget home, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        feedbackRepositoryProvider.overrideWithValue(repo),
        currentRoleProvider.overrideWithValue(UserRole.parent),
        principalIdProvider.overrideWithValue('parent_1'),
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

  const list = TeacherFeedbackScreen(learnerId: 'l1', childName: 'Ahmad');

  group('wire', () {
    test('replyUnread is read from the server, and only ever with a reply to read', () {
      Map<String, Object?> row({Object? response, Object? unread}) => {
            'id': 'f1',
            'learnerId': 'l1',
            'category': 'praise',
            'body': 'b',
            'status': 'resolved',
            'createdAt': '2026-10-24T10:00:00Z',
            'response': response,
            'replyUnread': unread,
          };
      expect(parseFeedbackItem(row(response: 'Thanks', unread: true))!.replyUnread, isTrue);
      expect(parseFeedbackItem(row(response: 'Thanks', unread: false))!.replyUnread, isFalse);
      // An older server sends no flag: nothing is unread.
      expect(parseFeedbackItem(row(response: 'Thanks'))!.replyUnread, isFalse);
      // A stray flag over no reply never shows a dot over nothing.
      expect(parseFeedbackItem(row(unread: true))!.replyUnread, isFalse);
    });
  });

  testWidgets('an unread reply is held behind a dot; opening it shows the reply, tells the server once, and the dot goes -- for that item only',
      (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [child],
      items: [
        item('f2', response: 'We spoke with the teacher.', unread: true),
        item('f1', response: 'Thank you for telling us.', unread: true),
        item('f0', response: 'An old reply, already read.'),
      ],
    );
    await tester.pumpWidget(app(repo, list));
    await tester.pumpAndSettle();

    // Two unread, each behind its own dot; the read one is shown as before.
    expect(find.byKey(const ValueKey('feedback-unread-f2')), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-unread-f1')), findsOneWidget);
    expect(find.text('We spoke with the teacher.'), findsNothing);
    expect(find.text('An old reply, already read.'), findsOneWidget);
    expect(find.text('New reply from the administration'), findsNWidgets(2));
    // Seeing the list is not opening a reply.
    expect(repo.seenReplies, isEmpty);

    await tester.tap(find.byKey(const ValueKey('feedback-open-reply-f2')));
    await tester.pumpAndSettle();

    expect(find.text('We spoke with the teacher.'), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-unread-f2')), findsNothing);
    expect(repo.seenReplies, ['f2']);
    // The other item keeps its dot until it is opened itself.
    expect(find.byKey(const ValueKey('feedback-unread-f1')), findsOneWidget);
    expect(find.text('Thank you for telling us.'), findsNothing);
  });

  testWidgets('the dot stays gone after the list is read again from the server', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], items: [item('f1', response: 'Thanks.', unread: true)]);
    await tester.pumpWidget(app(repo, list));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('feedback-open-reply-f1')));
    await tester.pumpAndSettle();

    // A fresh screen reads the list again: the server says it was seen.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(app(repo, list));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('feedback-unread-f1')), findsNothing);
    expect(find.text('Thanks.'), findsOneWidget);
  });

  testWidgets('a notification opens the one item: its reply shown at once, and counted as opened', (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [child],
      items: [
        item('f2', response: 'Another reply.', unread: true),
        item('f1', response: 'We spoke with the teacher.', unread: true),
      ],
    );
    await tester.pumpWidget(app(repo, const FeedbackItemScreen(feedbackId: 'f1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('feedback-f1')), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-f2')), findsNothing);
    expect(find.text('We spoke with the teacher.'), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-unread-f1')), findsNothing);
    expect(repo.seenReplies, ['f1']);
  });

  testWidgets('an item already read, or with no reply yet, is never reported as opened', (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [child],
      items: [item('f1', response: 'Old reply.'), item('f0')],
    );
    await tester.pumpWidget(app(repo, const FeedbackItemScreen(feedbackId: 'f1')));
    await tester.pumpAndSettle();
    await tester.pumpWidget(app(repo, const FeedbackItemScreen(feedbackId: 'f0')));
    await tester.pumpAndSettle();
    expect(repo.seenReplies, isEmpty);
  });

  testWidgets('opening a reply keeps the list on screen: no spinner while it is read again', (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [child],
      items: [item('f2', response: 'Reply two.', unread: true), item('f1', response: 'Reply one.', unread: true)],
      latency: const Duration(milliseconds: 200),
    );
    await tester.pumpWidget(app(repo, list));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('feedback-open-reply-f2')));
    // Across the whole re-read (200 ms), frame by frame.
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      expect(find.byType(JawwidLoadingView), findsNothing);
      expect(find.byKey(const ValueKey('feedback-f1')), findsOneWidget);
    }
    await tester.pumpAndSettle();
    expect(find.text('Reply two.'), findsOneWidget);
  });

  testWidgets('a notification opened over an older copy of the list reads it again, and opens the new reply', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], items: [item('f1')]);
    await tester.pumpWidget(app(repo, list));
    await tester.pumpAndSettle();
    // The reply arrives while the history screen keeps the earlier list alive.
    repo.staffReplies('f1', 'Arrived later.');
    final nav = tester.state<NavigatorState>(find.byType(Navigator));
    nav.push(MaterialPageRoute<void>(builder: (_) => const FeedbackItemScreen(feedbackId: 'f1')));
    await tester.pumpAndSettle();

    expect(find.text('Arrived later.'), findsWidgets);
    expect(repo.seenReplies, ['f1']);
  });

  testWidgets('an item the family no longer has says so', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], items: [item('f1')]);
    await tester.pumpWidget(app(repo, const FeedbackItemScreen(feedbackId: 'gone')));
    await tester.pumpAndSettle();
    expect(find.text('This feedback is no longer available.'), findsOneWidget);
  });

  testWidgets('in Arabic, the new-reply row reads in Arabic', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], items: [item('f1', response: 'شكرًا لك.', unread: true)]);
    await tester.pumpWidget(app(repo, list, locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(find.text('ردّ جديد من الإدارة'), findsOneWidget);
    expect(find.text('اضغط لقراءته'), findsOneWidget);
  });
}
