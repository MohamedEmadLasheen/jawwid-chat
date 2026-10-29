import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_card_view.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';

/// The owner's report: "the reason for the excuse and the make-up lesson date are not
/// displayed in the group chat". The cards are held to showing, in the reader's own
/// zone and language: the make-up's day, date and time and the lesson it replaces; an
/// excuse card's make-up once it is booked; the family's own reason; and -- to staff
/// and the teacher only, never a parent (PD-15) -- the internal reason, fetched from
/// the lesson itself because the card payload deliberately does not carry it.
void main() {
  const missed = '2026-10-27T14:00:00.000Z'; // Tue 27 Oct, 17:00 in Cairo (summer time ends 29 Oct)
  const makeup = '2026-10-31T16:30:00.000Z'; // Sat 31 Oct, 18:30 in Cairo

  setUp(() => AppClock.useZone('Africa/Cairo'));
  tearDown(() => AppClock.useZone(null));

  Widget app(MessageCard card, {required UserRole role, required _Notes lessons, Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        lessonRepositoryProvider.overrideWithValue(lessons),
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
        home: Scaffold(
          body: SingleChildScrollView(
            child: Builder(builder: (context) => lessonCardView(context, card, Colors.black)!),
          ),
        ),
      ),
    );
  }

  /// What the card must write for [iso]: the weekday, date and time in Cairo, in [lang].
  String dayWhen(String iso, String lang) {
    final t = AppClock.parse(iso)!;
    final time = DateFormat.jm(lang).format(DateTime(2000, 1, 1, t.hour, t.minute)).replaceAll(' ', ' ');
    return '${DateFormat.yMMMEd(lang).format(t)} · $time';
  }

  MessageCard makeupCard() => const MessageCard(kind: 'lesson_makeup_booked', lessonId: 'm1', payload: {
        'lessonId': 'm1', 'learnerName': 'Yusuf', 'teacherName': 'Teacher Huda',
        'startsAt': makeup, 'endsAt': '2026-10-31T17:00:00.000Z', 'durationMinutes': 30,
        'missedStartsAt': missed, 'makeupFor': 'l1', 'missedOutcome': 'student_apology',
      });

  MessageCard familyExcuse({bool booked = false}) => MessageCard(kind: 'lesson_apology', lessonId: 'l1', payload: {
        'lessonId': 'l1', 'learnerName': 'Yusuf', 'teacherName': 'Teacher Huda',
        'startsAt': missed, 'endsAt': '2026-10-27T14:30:00.000Z', 'durationMinutes': 30,
        'timing': 'before_start', 'reason': 'Yusuf has a fever today.', 'makeupOwed': true,
        if (booked) ...{'makeupStartsAt': makeup, 'makeupEndsAt': '2026-10-31T17:00:00.000Z', 'makeupLessonId': 'm1'},
      });

  const staffExcuse = MessageCard(kind: 'lesson_apology', lessonId: 'l2', payload: {
    'lessonId': 'l2', 'learnerName': 'Yusuf', 'teacherName': 'Teacher Huda',
    'startsAt': missed, 'endsAt': '2026-10-27T14:30:00.000Z', 'durationMinutes': 30,
    'timing': 'before_start', 'makeupOwed': true,
  });

  group('the make-up card', () {
    for (final lang in ['en', 'ar']) {
      testWidgets('shows the make-up\'s day, date and time and the lesson it replaces ($lang)', (tester) async {
        final lessons = _Notes();
        await tester.pumpWidget(app(makeupCard(), role: UserRole.parent, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));

        expect(find.text(l10n.cardMakeupBookedTitle), findsOneWidget);
        expect(find.text('Yusuf'), findsOneWidget, reason: 'the header names the child only');
        expect(find.text(l10n.cardMakeupLesson), findsOneWidget);
        expect(find.text(dayWhen(makeup, lang)), findsOneWidget);
        expect(find.text(l10n.cardMakeupInsteadOf), findsOneWidget);
        expect(find.text(dayWhen(missed, lang)), findsOneWidget);
        if (lang == 'en') {
          expect(find.text('Sat, Oct 31, 2026 · 6:30 PM'), findsOneWidget);
          expect(find.text('Tue, Oct 27, 2026 · 5:00 PM'), findsOneWidget);
        } else {
          expect(find.textContaining('السبت'), findsOneWidget);
          expect(find.textContaining('الثلاثاء'), findsOneWidget);
        }
        expect(lessons.asked, isEmpty);
      });
    }
  });

  group('an excuse card', () {
    for (final lang in ['en', 'ar']) {
      testWidgets('shows the family\'s reason and, once booked, its make-up instead of "will be arranged" ($lang)',
          (tester) async {
        final lessons = _Notes();
        await tester.pumpWidget(app(familyExcuse(), role: UserRole.parent, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));
        expect(find.text(l10n.cardReason), findsOneWidget);
        expect(find.text('Yusuf has a fever today.'), findsOneWidget);
        expect(find.text(l10n.cardMakeupOwed), findsOneWidget);
        expect(find.text(l10n.cardMakeupLesson), findsNothing);

        await tester.pumpWidget(app(familyExcuse(booked: true), role: UserRole.parent, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        expect(find.text('Yusuf has a fever today.'), findsOneWidget);
        expect(find.text(l10n.cardMakeupLesson), findsOneWidget);
        expect(find.text(dayWhen(makeup, lang)), findsOneWidget);
        expect(find.text(l10n.cardMakeupOwed), findsNothing, reason: 'the make-up is booked, not owed');
        expect(lessons.asked, isEmpty, reason: 'the reason is the family\'s own, already on the card');
      });
    }

    testWidgets('a parent never fetches nor sees the staff-only reason', (tester) async {
      final lessons = _Notes();
      for (final card in [
        staffExcuse,
        const MessageCard(kind: 'lesson_teacher_apology', lessonId: 'l3', payload: {'lessonId': 'l3', 'startsAt': missed, 'makeupOwed': true}),
        const MessageCard(kind: 'lesson_cancelled', lessonId: 'l4', payload: {'lessonId': 'l4', 'startsAt': missed, 'outcome': 'teacher_no_show', 'makeupOwed': true}),
      ]) {
        await tester.pumpWidget(app(card, role: UserRole.parent, lessons: lessons));
        await tester.pumpAndSettle();
        expect(find.text('Reason (staff and the teacher only)'), findsNothing);
        expect(find.textContaining('travelling'), findsNothing);
      }
      expect(lessons.asked, isEmpty);
    });

    for (final lang in ['en', 'ar']) {
      testWidgets('a teacher sees the staff-only reason, fetched from the lesson ($lang)', (tester) async {
        final lessons = _Notes();
        await tester.pumpWidget(app(staffExcuse, role: UserRole.teacher, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));
        expect(lessons.asked, ['l2']);
        expect(find.text(l10n.cardStaffReason), findsOneWidget);
        expect(find.text('The family called the office; the child is travelling.'), findsOneWidget);
        if (lang == 'ar') expect(find.text('السبب (للإدارة والمعلم فقط)'), findsOneWidget);
      });
    }

    testWidgets('staff read the teacher\'s own apology reason and a no-show\'s note', (tester) async {
      final lessons = _Notes();
      await tester.pumpWidget(app(
        const MessageCard(kind: 'lesson_teacher_apology', lessonId: 'l3', payload: {'lessonId': 'l3', 'startsAt': missed, 'makeupOwed': true}),
        role: UserRole.sales,
        lessons: lessons,
      ));
      await tester.pumpAndSettle();
      expect(find.text('Reason (staff and the teacher only)'), findsOneWidget);

      await tester.pumpWidget(app(
        const MessageCard(kind: 'lesson_cancelled', lessonId: 'l4', payload: {'lessonId': 'l4', 'startsAt': missed, 'outcome': 'teacher_no_show', 'makeupOwed': true}),
        role: UserRole.teacher,
        lessons: lessons,
      ));
      await tester.pumpAndSettle();
      expect(find.text('Reason (staff and the teacher only)'), findsOneWidget);
      expect(lessons.asked, ['l3', 'l4']);
    });

    testWidgets('a failed or empty fetch shows nothing', (tester) async {
      final lessons = _Notes(fail: true);
      await tester.pumpWidget(app(staffExcuse, role: UserRole.teacher, lessons: lessons));
      await tester.pumpAndSettle();
      expect(lessons.asked, ['l2']);
      expect(find.text('Reason (staff and the teacher only)'), findsNothing);
    });

    testWidgets('the family\'s own reason is not fetched again for staff', (tester) async {
      final lessons = _Notes();
      await tester.pumpWidget(app(familyExcuse(), role: UserRole.teacher, lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Yusuf has a fever today.'), findsOneWidget);
      expect(find.text('Reason (staff and the teacher only)'), findsNothing);
      expect(lessons.asked, isEmpty);
    });
  });
}

class _Notes implements LessonRepository {
  _Notes({this.fail = false});

  final bool fail;
  final asked = <String>[];

  @override
  Future<String?> outcomeNote(String lessonId) async {
    asked.add(lessonId);
    if (fail) throw StateError('404');
    return 'The family called the office; the child is travelling.';
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
