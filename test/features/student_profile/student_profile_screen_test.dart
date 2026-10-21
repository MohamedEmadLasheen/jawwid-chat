import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/group_children_section.dart';
import 'package:jawwid_chat/features/student_profile/presentation/student_profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/student_profile.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-17 on the client: a teacher's Student Profile, and the one way in -- their own
/// student's card in the group's info. The server's answers are stubbed; the client is
/// held to drawing exactly what it is given, and to offering the way in only to the
/// child's own teacher.
void main() {
  const full = StudentProfile(
    id: 'k1',
    name: 'سارة',
    age: 9,
    courseName: 'Tajweed',
    teacherName: 'خديجة',
    schedule: [
      StudentProfileSlot(weekday: 1, start: '16:30', durationMinutes: 30, timezone: 'Africa/Cairo'),
      StudentProfileSlot(weekday: 4, start: '17:00', durationMinutes: 45, timezone: 'Africa/Cairo'),
    ],
  );

  Widget app(
    Widget home, {
    required _Lessons lessons,
    Locale locale = const Locale('en'),
    UserRole role = UserRole.teacher,
    String? principal = 't1',
    Duration? Function(int, Object)? retry,
  }) {
    return ProviderScope(
      // The app's own policy: a refusal is terminal, so a 404 is asked exactly once.
      retry: retry ?? JawwidRetryPolicy.policy,
      overrides: [
        lessonRepositoryProvider.overrideWithValue(lessons),
        currentRoleProvider.overrideWithValue(role),
        principalIdProvider.overrideWithValue(principal),
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

  Finder inRow(String key, String text) =>
      find.descendant(of: find.byKey(ValueKey('student-profile-$key')), matching: find.text(text));

  group('the Student Profile screen', () {
    testWidgets('renders name, age, course, teacher and each weekly time (English)', (tester) async {
      final lessons = _Lessons()..profile = full;
      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k1'), lessons: lessons));
      await tester.pumpAndSettle();

      expect(lessons.asked, ['k1']);
      expect(find.text('Student profile'), findsOneWidget);
      expect(find.text('سارة'), findsOneWidget);
      expect(inRow('age', '9 years'), findsOneWidget);
      expect(inRow('course', 'Tajweed'), findsOneWidget);
      expect(find.text('Assigned teacher'), findsOneWidget);
      expect(inRow('teacher', 'خديجة'), findsOneWidget);
      expect(find.text('Class schedule'), findsOneWidget);
      expect(inRow('schedule', 'Monday · 16:30 · 30 min'), findsOneWidget);
      expect(inRow('schedule', 'Thursday · 17:00 · 45 min'), findsOneWidget);
      expect(inRow('schedule', 'Times in Africa/Cairo'), findsOneWidget);
    });

    testWidgets('renders the same in Arabic', (tester) async {
      final lessons = _Lessons()..profile = full;
      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k1'), lessons: lessons, locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(find.text('ملف الطالب'), findsOneWidget);
      expect(find.text('سارة'), findsOneWidget);
      expect(find.text('العمر'), findsOneWidget);
      expect(inRow('age', '9 سنوات'), findsOneWidget);
      expect(find.text('المعلّم المسؤول'), findsOneWidget);
      expect(inRow('teacher', 'خديجة'), findsOneWidget);
      expect(find.text('مواعيد الحصص'), findsOneWidget);
      expect(inRow('schedule', 'الاثنين · 16:30 · 30 دقيقة'), findsOneWidget);
      expect(inRow('schedule', 'المواعيد بتوقيت Africa/Cairo'), findsOneWidget);
    });

    testWidgets('a missing value says "Not set", never a blank (English and Arabic)', (tester) async {
      final lessons = _Lessons()..profile = const StudentProfile(id: 'k2', name: 'حسن');
      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k2'), lessons: lessons));
      await tester.pumpAndSettle();

      expect(inRow('age', 'Not set'), findsOneWidget);
      expect(inRow('course', 'Not set'), findsOneWidget);
      expect(inRow('teacher', 'Not set'), findsOneWidget);
      expect(inRow('schedule', 'No regular times yet'), findsOneWidget);

      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k2'), lessons: lessons, locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(inRow('age', 'غير محدد'), findsOneWidget);
      expect(inRow('course', 'غير محدد'), findsOneWidget);
      expect(inRow('teacher', 'غير محدد'), findsOneWidget);
      expect(inRow('schedule', 'لا توجد مواعيد ثابتة بعد'), findsOneWidget);
    });

    testWidgets("another teacher's student (404) is a calm refusal, with no retry", (tester) async {
      final lessons = _Lessons(); // no profile: answers 404 COMM.LESSON_NOT_FOUND
      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k9'), lessons: lessons));
      await tester.pumpAndSettle();

      expect(find.text("You can't open this student's profile"), findsOneWidget);
      expect(find.text("Only the student's own teacher can see it."), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsNothing);
      expect(lessons.asked, ['k9'], reason: 'asked once, never in a loop');

      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k9'), lessons: _Lessons(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('لا يمكنك فتح ملف هذا الطالب'), findsOneWidget);
    });

    testWidgets('a transient failure offers a retry', (tester) async {
      final lessons = _Lessons()..failWith = const AppError(AppErrorKind.network);
      // No automatic retries here: this is about the button.
      await tester.pumpWidget(app(const StudentProfileScreen(learnerId: 'k1'), lessons: lessons, retry: (_, _) => null));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.refresh), findsOneWidget);

      lessons
        ..failWith = null
        ..profile = full;
      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();
      expect(find.text('سارة'), findsOneWidget);
    });
  });

  group("the way in: a child's card in the group info", () {
    final children = [
      const GroupChild(id: 'k1', name: 'سارة', teacherId: 't1', teacherName: 'خديجة'),
      const GroupChild(id: 'k2', name: 'حسن', teacherId: 't2', teacherName: 'teacher_other'),
    ];
    Widget section() => const Scaffold(body: SingleChildScrollView(child: GroupChildrenSection(conversationId: 'c1')));
    Finder openable(String id) => find.byKey(ValueKey('group-child-open-$id'));

    testWidgets("is tappable for the child's own teacher only", (tester) async {
      final lessons = _Lessons()..children = children;
      await tester.pumpWidget(app(section(), lessons: lessons));
      await tester.pumpAndSettle();

      expect(openable('k1'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('group-child-k1')), matching: find.text('View profile')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('group-child-k1')), matching: find.byIcon(Icons.chevron_right)), findsOneWidget);
      // Same group, another teacher's child: no affordance at all.
      expect(openable('k2'), findsNothing);
      expect(find.descendant(of: find.byKey(const ValueKey('group-child-k2')), matching: find.byType(InkWell)), findsNothing);
    });

    testWidgets('is not tappable for a different teacher', (tester) async {
      final lessons = _Lessons()..children = children;
      await tester.pumpWidget(app(section(), lessons: lessons, principal: 't9'));
      await tester.pumpAndSettle();

      expect(openable('k1'), findsNothing);
      expect(openable('k2'), findsNothing);
      expect(find.text('View profile'), findsNothing);
    });

    testWidgets('is never tappable for a parent -- even one whose id happens to match', (tester) async {
      final lessons = _Lessons()..children = children;
      await tester.pumpWidget(app(section(), lessons: lessons, role: UserRole.parent, principal: 't1'));
      await tester.pumpAndSettle();

      expect(openable('k1'), findsNothing);
      expect(openable('k2'), findsNothing);
      expect(find.text('View profile'), findsNothing);
      expect(find.byIcon(Icons.chevron_right), findsNothing);
    });

    testWidgets('signed out (no principal), nothing is tappable', (tester) async {
      final lessons = _Lessons()..children = children;
      await tester.pumpWidget(app(section(), lessons: lessons, principal: null));
      await tester.pumpAndSettle();
      expect(openable('k1'), findsNothing);
    });

    testWidgets("tapping the teacher's own student opens their profile", (tester) async {
      final lessons = _Lessons()
        ..children = children
        ..profile = full;
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (context, state) => section()),
        GoRoute(
          path: '${Routes.studentsPrefix}/:learnerId',
          builder: (context, state) => StudentProfileScreen(learnerId: state.pathParameters['learnerId']!),
        ),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          lessonRepositoryProvider.overrideWithValue(lessons),
          currentRoleProvider.overrideWithValue(UserRole.teacher),
          principalIdProvider.overrideWithValue('t1'),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          locale: const Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(openable('k1'));
      await tester.pumpAndSettle();

      expect(Routes.studentProfile('k1'), '/students/k1');
      expect(router.state.uri.path, '/students/k1');
      expect(find.byType(StudentProfileScreen), findsOneWidget);
      expect(find.text('Student profile'), findsOneWidget);
      expect(lessons.asked, ['k1']);
    });
  });
}

/// Only the two calls these screens make; anything else would be a test bug.
class _Lessons implements LessonRepository {
  StudentProfile? profile;
  AppError? failWith;
  List<GroupChild> children = const [];
  final asked = <String>[];

  @override
  Future<StudentProfile> studentProfile(String learnerId) async {
    asked.add(learnerId);
    if (failWith != null) throw failWith!;
    return profile ?? (throw const AppError(AppErrorKind.notFound, code: 'COMM.LESSON_NOT_FOUND'));
  }

  @override
  Future<List<GroupChild>> groupChildren(String conversationId) async => children;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
