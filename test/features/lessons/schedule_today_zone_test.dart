import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';

/// PD-22: the Schedule tab's "today" is the ACCOUNT's day, never the device's.
///
/// The account is pinned to Kiritimati (UTC+14), far ahead of any device zone, so a
/// lesson at 00:30 of the account's today is still "yesterday" on the device's own
/// clock. Read with the device's midnight it fell into "Still owed a report"; it
/// belongs under today's date.
void main() {
  setUp(() => AppClock.useZone('Pacific/Kiritimati'));
  tearDown(() => AppClock.useZone(null));

  testWidgets('a lesson early in the account\'s today is listed under today, not as owed', (tester) async {
    final now = AppClock.now();
    final early = AppClock.view(AppClock.wallClock(now.year, now.month, now.day, 0, 30));
    final lesson = ScheduledLesson(
      id: 'l1', learnerName: 'learner_k', startsAt: early, endsAt: early.add(const Duration(minutes: 30)),
      kind: 'regular', phase: 'closed', outcome: 'held',
    );
    // The control: on the device's own clock that instant is before the device's
    // midnight of the same calendar date -- the old reading.
    expect(early.isBefore(DateTime(now.year, now.month, now.day)), isTrue);

    await tester.pumpWidget(ProviderScope(
      overrides: [lessonRepositoryProvider.overrideWithValue(_Lessons([lesson]))],
      child: MaterialApp(
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const TeacherScheduleScreen(),
      ),
    ));
    await tester.pumpAndSettle();

    final m = MaterialLocalizations.of(tester.element(find.byType(TeacherScheduleScreen)));
    expect(find.text('Still owed a report'), findsNothing);
    final todayHeader = find.text(m.formatFullDate(DateTime(now.year, now.month, now.day)));
    expect(todayHeader, findsOneWidget);
    expect(find.text('learner_k'), findsOneWidget);
    expect(tester.getTopLeft(find.text('learner_k')).dy, greaterThan(tester.getTopLeft(todayHeader).dy));
  });
}

class _Lessons implements LessonRepository {
  _Lessons(this.lessons);

  final List<ScheduledLesson> lessons;

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => lessons;

  @override
  Future<TeacherWorkload> myWorkload() async => const TeacherWorkload(heldLessons: 1, heldMinutes: 30, unreported: 0);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
