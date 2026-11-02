import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/http/http_feedback_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/feedback/presentation/teacher_feedback_screen.dart';
import 'package:jawwid_chat/features/profile/presentation/my_profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/teacher_feedback.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-32: a parent's feedback about their child's teacher -- the earlier items with their
/// status and the administration's reply, and a form that sends a new one.
void main() {
  const child = FeedbackChild(learnerId: 'l1', name: 'Ahmad', teacherName: 'Ustadh Yusuf');

  FeedbackItem item({
    required String id,
    FeedbackStatus status = FeedbackStatus.received,
    String? response,
    String learnerId = 'l1',
  }) =>
      FeedbackItem(
        id: id,
        learnerId: learnerId,
        childName: 'Ahmad',
        teacherName: 'Ustadh Yusuf',
        category: FeedbackCategory.suggestion,
        body: 'Body of $id',
        status: status,
        response: response,
        respondedAt: response == null ? null : DateTime.utc(2026, 10, 25),
        createdAt: DateTime.utc(2026, 10, 24),
      );

  Widget app(FakeFeedbackRepository repo, {Locale locale = const Locale('en')}) {
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
        home: const TeacherFeedbackScreen(learnerId: 'l1', childName: 'Ahmad'),
      ),
    );
  }

  Future<void> fillAndSend(WidgetTester tester, {String category = 'praise', String body = '  Very patient with Ahmad.  '}) async {
    await tester.tap(find.byKey(const ValueKey('feedback-new')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey('feedback-category-$category')));
    await tester.enterText(find.byKey(const ValueKey('feedback-body')), body);
    await tester.tap(find.byKey(const ValueKey('feedback-submit')));
    await tester.pumpAndSettle();
  }

  testWidgets('earlier feedback shows its status and the reply from the administration', (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [child],
      items: [
        item(id: 'f3', status: FeedbackStatus.resolved, response: 'We spoke with the teacher. Thank you.'),
        item(id: 'f2', status: FeedbackStatus.inReview),
        item(id: 'f1'),
        // Another child's item is not on this child's screen.
        item(id: 'other', learnerId: 'l2'),
      ],
    );
    await tester.pumpWidget(app(repo));
    await tester.pumpAndSettle();

    expect(find.text('Teacher: Ustadh Yusuf'), findsOneWidget);
    expect(find.text('Resolved'), findsOneWidget);
    expect(find.text('In review'), findsOneWidget);
    expect(find.text('Received'), findsOneWidget);
    expect(find.text('Reply from the administration'), findsOneWidget);
    expect(find.text('We spoke with the teacher. Thank you.'), findsOneWidget);
    expect(find.text('Body of other'), findsNothing);
  });

  testWidgets('a new piece of feedback is sent trimmed, with its kind, and appears in the list', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child]);
    await tester.pumpWidget(app(repo));
    await tester.pumpAndSettle();
    expect(find.text('No feedback sent yet'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('feedback-new')));
    await tester.pumpAndSettle();
    // Said once, in the form.
    expect(
      find.text('The administration reviews every message. The teacher does not see who wrote it.'),
      findsOneWidget,
    );

    // Nothing is sent without a kind and words.
    await tester.tap(find.byKey(const ValueKey('feedback-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Choose the kind of feedback.'), findsOneWidget);
    expect(find.text('Write your feedback first.'), findsOneWidget);
    expect(repo.submitted, isEmpty);

    await tester.tap(find.byKey(const ValueKey('feedback-category-praise')));
    await tester.enterText(find.byKey(const ValueKey('feedback-body')), '  Very patient with Ahmad.  ');
    await tester.tap(find.byKey(const ValueKey('feedback-submit')));
    await tester.pumpAndSettle();

    expect(repo.submitted, hasLength(1));
    expect(repo.submitted.single.learnerId, 'l1');
    expect(repo.submitted.single.category, FeedbackCategory.praise);
    expect(repo.submitted.single.body, 'Very patient with Ahmad.');

    // Back on the list, which reloaded.
    expect(find.text('Thank you. Your feedback has reached the administration.'), findsOneWidget);
    expect(find.text('Very patient with Ahmad.'), findsOneWidget);
    expect(find.text('Received'), findsOneWidget);
  });

  testWidgets('too many today: says so plainly and keeps what was written', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], refuseWith: FeedbackErrors.limit);
    await tester.pumpWidget(app(repo));
    await tester.pumpAndSettle();

    await fillAndSend(tester, category: 'complaint', body: 'Lessons start late.');

    expect(find.byKey(const ValueKey('feedback-error')), findsOneWidget);
    expect(find.text('You have sent a lot of feedback today. Please try again tomorrow.'), findsOneWidget);
    expect(find.text('Lessons start late.'), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-submit')), findsOneWidget);
  });

  testWidgets('in Arabic, the limit and the privacy note read in Arabic', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], refuseWith: FeedbackErrors.limit);
    await tester.pumpWidget(app(repo, locale: const Locale('ar')));
    await tester.pumpAndSettle();

    await fillAndSend(tester);

    expect(find.text('أرسلت ملاحظات كثيرة اليوم. حاول مرة أخرى غدًا.'), findsOneWidget);
    expect(find.text('تراجع الإدارة كل ملاحظة، ولا يرى المعلّم اسم كاتبها.'), findsOneWidget);
  });

  testWidgets('a child with no teacher: the screen says so and offers no form', (tester) async {
    final repo = FakeFeedbackRepository(children: const [FeedbackChild(learnerId: 'l1', name: 'Ahmad')]);
    await tester.pumpWidget(app(repo));
    await tester.pumpAndSettle();

    expect(find.text('No teacher is assigned to this child yet.'), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-new')), findsNothing);
  });

  testWidgets('the server refusing the child reads as "no teacher right now"', (tester) async {
    final repo = FakeFeedbackRepository(children: const [child], refuseWith: FeedbackErrors.notFound);
    await tester.pumpWidget(app(repo));
    await tester.pumpAndSettle();

    await fillAndSend(tester);

    expect(find.text('This child has no teacher to give feedback about right now.'), findsOneWidget);
  });

  testWidgets('each child card on the parent\'s profile has the entry; the parent\'s own card does not', (tester) async {
    final repo = FakeFeedbackRepository(
      children: const [FeedbackChild(learnerId: 'learner-1', name: 'أحمد', teacherName: 'أ. يوسف')],
    );
    await tester.pumpWidget(ProviderScope(
      overrides: [
        feedbackRepositoryProvider.overrideWithValue(repo),
        profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
        currentRoleProvider.overrideWithValue(UserRole.parent),
        principalIdProvider.overrideWithValue('parent_1'),
      ],
      child: MaterialApp(
        locale: const Locale('ar'),
        theme: JawwidTheme.light(isArabic: true),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const MyProfileScreen(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('feedback-entry-learner-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('feedback-entry-learner-2')), findsOneWidget);
    expect(find.text('ملاحظات عن المعلّم'), findsNWidgets(2));

    final entry = find.byKey(const ValueKey('feedback-entry-learner-1'));
    await tester.ensureVisible(entry);
    await tester.pumpAndSettle();
    await tester.tap(entry);
    await tester.pumpAndSettle();
    expect(find.byType(TeacherFeedbackScreen), findsOneWidget);
    expect(find.text('المعلّم: أ. يوسف'), findsOneWidget);
  });

  /// The parent's own profile, a child's card with the feedback entry and its shortcuts.
  Widget profile(FakeFeedbackRepository repo, {Locale locale = const Locale('en')}) => ProviderScope(
        overrides: [
          feedbackRepositoryProvider.overrideWithValue(repo),
          profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
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
          home: const MyProfileScreen(),
        ),
      );

  ChoiceChip chip(WidgetTester tester, String category) =>
      tester.widget<ChoiceChip>(find.byKey(ValueKey('feedback-category-$category')));

  for (final (key, kind) in const [('praise', FeedbackCategory.praise), ('problem', FeedbackCategory.complaint)]) {
    testWidgets('PD-52: the "$key" shortcut on a child\'s card opens the one form on its kind, and sends it', (tester) async {
      final repo = FakeFeedbackRepository(children: const [FeedbackChild(learnerId: 'learner-1', name: 'Ahmad', teacherName: 'Ustadh Yusuf')]);
      await tester.pumpWidget(profile(repo));
      await tester.pumpAndSettle();

      final shortcut = find.byKey(ValueKey('feedback-$key-learner-1'));
      await tester.ensureVisible(shortcut);
      await tester.pumpAndSettle();
      await tester.tap(shortcut);
      await tester.pumpAndSettle();

      // The form, its kind already chosen -- and only that one.
      expect(chip(tester, kind.name).selected, isTrue);
      for (final other in FeedbackCategory.values.where((c) => c != kind)) {
        expect(chip(tester, other.name).selected, isFalse);
      }
      await tester.enterText(find.byKey(const ValueKey('feedback-body')), 'Words for the school.');
      await tester.tap(find.byKey(const ValueKey('feedback-submit')));
      await tester.pumpAndSettle();
      expect(repo.submitted.single.category, kind);
      expect(repo.submitted.single.learnerId, 'learner-1');
      expect(find.text('Thank you. Your feedback has reached the administration.'), findsOneWidget);
    });
  }

  testWidgets('PD-52: a shortcut only preselects -- the parent may still choose another kind', (tester) async {
    final repo = FakeFeedbackRepository(children: const [FeedbackChild(learnerId: 'learner-1', name: 'Ahmad', teacherName: 'Ustadh Yusuf')]);
    await tester.pumpWidget(profile(repo));
    await tester.pumpAndSettle();
    final shortcut = find.byKey(const ValueKey('feedback-problem-learner-1'));
    await tester.ensureVisible(shortcut);
    await tester.pumpAndSettle();
    await tester.tap(shortcut);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('feedback-category-suggestion')));
    await tester.enterText(find.byKey(const ValueKey('feedback-body')), 'A thought.');
    await tester.tap(find.byKey(const ValueKey('feedback-submit')));
    await tester.pumpAndSettle();
    expect(repo.submitted.single.category, FeedbackCategory.suggestion);
  });

  testWidgets('PD-52: the shortcuts read in Arabic', (tester) async {
    final repo = FakeFeedbackRepository(children: const [FeedbackChild(learnerId: 'learner-1', name: 'أحمد', teacherName: 'أ. يوسف')]);
    await tester.pumpWidget(profile(repo, locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(find.text('الثناء على المعلّم'), findsWidgets);
    expect(find.text('الإبلاغ عن مشكلة'), findsWidgets);
  });

  test('the wire Item parses, and a row missing what the screen needs is dropped', () {
    final parsed = parseFeedbackItem({
      'id': 'f1',
      'learnerId': 'l1',
      'childName': 'Ahmad',
      'teacherName': 'Ustadh Yusuf',
      'category': 'complaint',
      'body': 'Late again',
      'status': 'in_review',
      'response': null,
      'respondedAt': null,
      'createdAt': '2026-10-26T08:00:00Z',
    });
    expect(parsed, isNotNull);
    expect(parsed!.category, FeedbackCategory.complaint);
    expect(parsed.status, FeedbackStatus.inReview);
    expect(parsed.response, isNull);

    expect(parseFeedbackItem({'id': 'f2', 'learnerId': 'l1', 'category': 'rant', 'createdAt': '2026-10-26T08:00:00Z'}), isNull);
    expect(FeedbackStatus.fromWire('resolved'), FeedbackStatus.resolved);
  });
}
