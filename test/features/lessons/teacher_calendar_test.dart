import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_calendar.dart';
import 'package:jawwid_chat/features/lessons/presentation/teacher_schedule_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/my_calendar.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';

/// PD-38 P2: the teacher's own calendar in the Schedule tab. The page's side of the
/// contract: the right days asked for in each view, the server's intervals drawn
/// (the shift, the empty shift time in red, the lessons in their slots), a lesson
/// opening the same actions as the list, and the figures as the server counted them.
/// What the server sends a teacher (own lessons only, nothing financial) is proven in
/// apps/api/test/integration/pd038-schedule-calendar.spec.ts. Synthetic names only.
void main() {
  setUp(() => AppClock.useZone('Africa/Cairo'));
  tearDown(() => AppClock.useZone(null));

  String at(String day, String hhmm) {
    final d = DateTime.parse('${day}T00:00:00Z');
    final (h, m) = (int.parse(hhmm.substring(0, 2)), int.parse(hhmm.substring(3)));
    return AppClock.wallClock(d.year, d.month, d.day, h, m).toUtc().toIso8601String();
  }

  /// The server's answer for [from]..[to]: on [from], a 12:00-19:00 shift, three lessons
  /// (active, trial, paused) and the four stretches of the shift they leave empty.
  Map<String, Object?> body(String from, String to) => {
    'zone': 'Africa/Cairo',
    'from': from,
    'to': to,
    'category': 'full_shift',
    'utilization': 0.214,
    'totals': {'shiftMinutes': 420, 'emptyMinutes': 270, 'outsideMinutes': 0, 'inShiftLeaveMinutes': 0},
    'teaching': {'lessons': 2, 'bookedMinutes': 90, 'heldMinutes': 60},
    'students': {'distinct': 2, 'trial': 1},
    'days': [
      {
        'day': from,
        'shift': [[at(from, '12:00'), at(from, '19:00')]],
        'work': <Object?>[],
        'leave': <Object?>[],
        'empty': [
          [at(from, '12:00'), at(from, '13:00')],
          [at(from, '14:00'), at(from, '15:00')],
          [at(from, '15:30'), at(from, '17:00')],
          [at(from, '18:00'), at(from, '19:00')],
        ],
        'free': <Object?>[],
      },
    ],
    'lessons': [
      {'id': 'l1', 'startsAt': at(from, '13:00'), 'endsAt': at(from, '14:00'), 'kind': 'regular', 'status': 'active', 'learner': {'id': 'k1', 'name': 'learner_a'}},
      {'id': 'l2', 'startsAt': at(from, '15:00'), 'endsAt': at(from, '15:30'), 'kind': 'trial', 'status': 'trial', 'prospect': {'name': 'prospect_p'}},
      {'id': 'l3', 'startsAt': at(from, '17:00'), 'endsAt': at(from, '18:00'), 'kind': 'regular', 'status': 'paused', 'outcome': 'suspended', 'learner': {'id': 'k2', 'name': 'learner_b'}},
    ],
  };

  Future<_Calendar> pump(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final repo = _Calendar(body);
    await tester.pumpWidget(ProviderScope(
      overrides: [lessonRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const TeacherScheduleScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    return repo;
  }

  testWidgets('the list stays the default; Day asks for today and draws the shift, the empty time and the lessons', (tester) async {
    final repo = await pump(tester);
    expect(repo.asked, isEmpty);
    await tester.tap(find.text('Day'));
    await tester.pumpAndSettle();

    final today = dayKey(calendarToday());
    expect(repo.asked.last, (today, dayKey(calendarToday().add(const Duration(days: 1)))));
    expect(find.byKey(ValueKey('calendar-day-$today')), findsOneWidget);
    expect(find.byKey(const ValueKey('calendar-empty')), findsNWidgets(4));
    expect(find.bySemanticsLabel(RegExp(r'^learner_a · .* · Active$')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^prospect_p · .* · Trial$')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^learner_b · .* · Temporarily paused$')), findsOneWidget);
    // The figures, as the server counted them.
    expect(find.text('1.5 h of lessons'), findsOneWidget);
    expect(find.textContaining('2 students'), findsOneWidget);
    expect(find.textContaining('+1 trial student'), findsOneWidget);
    expect(find.text('21% of your shift booked'), findsOneWidget);
    expect(find.byKey(const ValueKey('calendar-empty-hours')), findsOneWidget);
    expect(find.text('Available time without a student'), findsOneWidget);
  });

  testWidgets('a lesson opens the same actions as the list', (tester) async {
    final repo = await pump(tester);
    await tester.tap(find.text('Day'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('calendar-lesson-l1')));
    await tester.pumpAndSettle();
    expect(repo.ticketsAskedFor, ['l1']);
    expect(find.text('Nothing to do for this lesson now.'), findsOneWidget);
    expect(find.text('learner_a'), findsWidgets);
  });

  testWidgets('Week asks for Saturday to Friday and opens a day; Month asks for the month', (tester) async {
    final repo = await pump(tester);
    await tester.tap(find.text('Week'));
    await tester.pumpAndSettle();
    final sat = weekStart(calendarToday());
    expect(repo.asked.last, (dayKey(sat), dayKey(sat.add(const Duration(days: 7)))));
    for (var i = 0; i < 7; i++) {
      expect(find.byKey(ValueKey('calendar-week-${dayKey(sat.add(Duration(days: i)))}')), findsOneWidget);
    }
    await tester.tap(find.byKey(ValueKey('calendar-week-${dayKey(sat)}')));
    await tester.pumpAndSettle();
    expect(repo.asked.last.$1, dayKey(sat));
    expect(find.byKey(ValueKey('calendar-day-${dayKey(sat)}')), findsOneWidget);

    await tester.tap(find.text('Month'));
    await tester.pumpAndSettle();
    final first = DateTime.utc(sat.year, sat.month, 1);
    expect(repo.asked.last, (dayKey(first), dayKey(DateTime.utc(sat.year, sat.month + 1, 1))));
    // The first day carries the fixture: three lessons and red empty hours.
    final cell = find.byKey(ValueKey('calendar-month-${dayKey(first)}'));
    expect(cell, findsOneWidget);
    expect(tester.getSemantics(cell).label, contains('3 lessons'));
    await tester.tap(cell);
    await tester.pumpAndSettle();
    expect(repo.asked.last.$1, dayKey(first));
  });

  testWidgets('previous and next step by the view', (tester) async {
    final repo = await pump(tester);
    await tester.tap(find.text('Week'));
    await tester.pumpAndSettle();
    final sat = weekStart(calendarToday());
    await tester.tap(find.byKey(const ValueKey('calendar-next')));
    await tester.pumpAndSettle();
    expect(repo.asked.last.$1, dayKey(sat.add(const Duration(days: 7))));
    await tester.tap(find.byKey(const ValueKey('calendar-today')));
    await tester.pumpAndSettle();
    expect(repo.asked.last.$1, dayKey(sat));
  });

  testWidgets('in Arabic the calendar reads right to left, with the owner\'s legend', (tester) async {
    await pump(tester, locale: const Locale('ar'));
    await tester.tap(find.text('يوم'));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byType(TeacherCalendar))), TextDirection.rtl);
    expect(find.text('وقت متاح بدون طالب'), findsOneWidget);
    expect(find.text('خارج الشيفت'), findsOneWidget);
    expect(find.text('متوقف مؤقتاً'), findsOneWidget);
  });

  testWidgets('every view fits a phone (360 wide), in both languages', (tester) async {
    for (final (loc, segs) in [('en', ['Day', 'Week', 'Month']), ('ar', ['يوم', 'أسبوع', 'شهر'])]) {
      tester.view.physicalSize = const Size(360, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ProviderScope(
        overrides: [lessonRepositoryProvider.overrideWithValue(_Calendar(body))],
        child: MaterialApp(
          locale: Locale(loc),
          theme: JawwidTheme.light(isArabic: loc == 'ar'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: const TeacherScheduleScreen(),
        ),
      ));
      await tester.pumpAndSettle();
      for (final seg in segs) {
        await tester.tap(find.text(seg));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$loc $seg');
      }
    }
  });

  test('the wire body maps to the model; a malformed one is refused', () {
    final c = MyCalendar.fromJson(body('2026-10-26', '2026-10-27'))!;
    expect(c.category, 'full_shift');
    expect(c.hasShift, isTrue);
    expect(c.days.single.empty, hasLength(4));
    expect(c.days.single.emptyMinutes, 270);
    expect(c.lessons.map((l) => (l.title, l.status)), [
      ('learner_a', CalendarLessonStatus.active),
      ('prospect_p', CalendarLessonStatus.trial),
      ('learner_b', CalendarLessonStatus.paused),
    ]);
    expect(c.lessons.first.startsAt.hour, 13); // Cairo wall clock
    expect((c.bookedMinutes, c.students, c.trialStudents, c.utilization), (90, 2, 1, 0.214));
    expect(MyCalendar.fromJson({'zone': 'Africa/Cairo'}), isNull);
    expect(MyCalendar.fromJson('nope'), isNull);
  });
}

class _Calendar implements LessonRepository {
  _Calendar(this.body);

  final Map<String, Object?> Function(String from, String to) body;
  final asked = <(String, String)>[];
  final ticketsAskedFor = <String>[];

  @override
  Future<MyCalendar> myCalendar(String from, String to) async {
    asked.add((from, to));
    return MyCalendar.fromJson(body(from, to))!;
  }

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => const [];

  @override
  Future<List<LessonTicket>> lessonTickets(String lessonId) async {
    ticketsAskedFor.add(lessonId);
    return const [];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}
