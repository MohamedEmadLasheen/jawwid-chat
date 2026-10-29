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

  /// PD-50: "Parents see a category." The card names the excuse's category to everyone;
  /// the free-text note stays with staff and the lesson's teacher.
  group('an excuse with a category', () {
    MessageCard categorised(String kind, {String lessonId = 'l5', Map<String, Object?> extra = const {}}) =>
        MessageCard(kind: kind, lessonId: lessonId, payload: {
          'lessonId': lessonId, 'learnerName': 'Yusuf', 'teacherName': 'Teacher Huda',
          'startsAt': missed, 'endsAt': '2026-10-27T14:30:00.000Z', 'durationMinutes': 30,
          'reasonCategory': 'illness', 'makeupOwed': true, ...extra,
        });

    for (final lang in ['en', 'ar']) {
      testWidgets('a parent sees the category under "Reason", and never fetches nor sees the note ($lang)', (tester) async {
        final lessons = _Notes();
        for (final card in [
          categorised('lesson_apology', extra: {'timing': 'before_start'}),
          categorised('lesson_late_apology'),
          categorised('lesson_ruling', extra: {'decision': 'excused'}),
        ]) {
          await tester.pumpWidget(app(card, role: UserRole.parent, lessons: lessons, locale: Locale(lang)));
          await tester.pumpAndSettle();
          final l10n = L10n.of(tester.element(find.byType(Builder).first));
          expect(find.text(l10n.cardReason), findsOneWidget, reason: card.kind);
          expect(find.text(l10n.excuseCategoryIllness), findsOneWidget, reason: card.kind);
          if (lang == 'ar') expect(find.text('مرض'), findsOneWidget);
          if (lang == 'en') expect(find.text('Illness'), findsOneWidget);
          expect(find.text(l10n.cardStaffNote), findsNothing);
          expect(find.text(l10n.cardFamilyDetails), findsNothing);
          expect(find.textContaining('travelling'), findsNothing);
          expect(find.textContaining('flight'), findsNothing);
        }
        expect(lessons.asked, isEmpty, reason: 'a parent never asks for the note');
      });

      testWidgets('a parent sees no category on a teacher apology, even from an old payload ($lang)', (tester) async {
        final lessons = _Notes(details: _teacherApologyDetails);
        for (final card in [
          const MessageCard(kind: 'lesson_teacher_apology', lessonId: 'l6', payload: {'lessonId': 'l6', 'startsAt': missed, 'makeupOwed': true}),
          categorised('lesson_teacher_apology', lessonId: 'l6'),
        ]) {
          await tester.pumpWidget(app(card, role: UserRole.parent, lessons: lessons, locale: Locale(lang)));
          await tester.pumpAndSettle();
          final l10n = L10n.of(tester.element(find.byType(Builder).first));
          expect(find.text(l10n.cardTeacherApologyTitle), findsOneWidget);
          expect(find.text(l10n.cardReason), findsNothing);
          expect(find.text(l10n.cardStaffReason), findsNothing);
          expect(find.text(l10n.cardStaffNote), findsNothing);
          expect(find.text(l10n.excuseCategoryIllness), findsNothing);
          expect(find.text(l10n.excuseCategoryEmergency), findsNothing);
        }
        expect(lessons.asked, isEmpty);
      });

      testWidgets('a teacher sees the category and its note on a teacher apology, both fetched ($lang)', (tester) async {
        final lessons = _Notes(details: _teacherApologyDetails);
        await tester.pumpWidget(app(
          const MessageCard(kind: 'lesson_teacher_apology', lessonId: 'l6', payload: {'lessonId': 'l6', 'startsAt': missed, 'makeupOwed': true}),
          role: UserRole.teacher,
          lessons: lessons,
          locale: Locale(lang),
        ));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));
        expect(lessons.asked, ['l6']);
        expect(find.text(l10n.cardReason), findsNothing, reason: 'not the family-visible "Reason"');
        expect(find.text(l10n.cardStaffReason), findsOneWidget);
        expect(find.text(l10n.excuseCategoryEmergency), findsOneWidget);
        expect(find.text(l10n.cardStaffNote), findsOneWidget);
        expect(find.text('A family emergency; back on Monday.'), findsOneWidget);
        if (lang == 'ar') {
          expect(find.text('السبب (للإدارة والمعلم فقط)'), findsOneWidget);
          expect(find.text('ظرف طارئ'), findsOneWidget);
          expect(find.text('ملاحظة (للإدارة والمعلم فقط)'), findsOneWidget);
        }
      });

      testWidgets('a late apology with a category shows the family\'s words to a teacher, fetched ($lang)', (tester) async {
        final lessons = _Notes(details: _lateApologyDetails);
        await tester.pumpWidget(app(categorised('lesson_late_apology', lessonId: 'l7'),
            role: UserRole.teacher, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));
        expect(lessons.asked, ['l7']);
        expect(find.text(l10n.cardReason), findsOneWidget);
        expect(find.text(l10n.excuseCategoryIllness), findsOneWidget);
        expect(find.text(l10n.cardFamilyDetails), findsOneWidget);
        expect(find.text('Our flight was delayed by six hours.'), findsOneWidget);
        expect(find.text('ruling note, not repeated'), findsNothing, reason: 'the outcome note is not the family\'s words');
        expect(find.text(l10n.cardStaffNote), findsNothing);
        if (lang == 'en') expect(find.text('Details from the family (staff and the teacher only)'), findsOneWidget);
        if (lang == 'ar') expect(find.text('تفاصيل من الأسرة (للإدارة والمعلم فقط)'), findsOneWidget);

        // A parent reading the same card, in a fresh session: the category only, nothing fetched.
        await tester.pumpWidget(const SizedBox());
        final parentLessons = _Notes(details: _lateApologyDetails);
        await tester.pumpWidget(app(categorised('lesson_late_apology', lessonId: 'l7'),
            role: UserRole.parent, lessons: parentLessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        expect(parentLessons.asked, isEmpty);
        expect(find.text(l10n.excuseCategoryIllness), findsOneWidget);
        expect(find.text(l10n.cardFamilyDetails), findsNothing);
        expect(find.text('Our flight was delayed by six hours.'), findsNothing);
      });

      testWidgets('an older late apology with the family\'s reason on the card shows it to everyone, no fetch ($lang)',
          (tester) async {
        for (final role in [UserRole.parent, UserRole.teacher, UserRole.sales]) {
          final lessons = _Notes(details: _lateApologyDetails);
          await tester.pumpWidget(app(
            const MessageCard(kind: 'lesson_late_apology', lessonId: 'l8', payload: {
              'lessonId': 'l8', 'learnerName': 'Yusuf', 'startsAt': missed, 'reason': 'Stuck in traffic.',
            }),
            role: role,
            lessons: lessons,
            locale: Locale(lang),
          ));
          await tester.pumpAndSettle();
          final l10n = L10n.of(tester.element(find.byType(Builder).first));
          expect(find.text(l10n.cardReason), findsOneWidget, reason: role.name);
          expect(find.text('Stuck in traffic.'), findsOneWidget, reason: role.name);
          expect(find.text(l10n.cardFamilyDetails), findsNothing, reason: role.name);
          expect(lessons.asked, isEmpty, reason: role.name);
        }
      });

      testWidgets('a teacher sees the category and the note, labelled "Note (staff and the teacher only)" ($lang)', (tester) async {
        final lessons = _Notes();
        await tester.pumpWidget(app(categorised('lesson_apology', extra: {'timing': 'before_start'}),
            role: UserRole.teacher, lessons: lessons, locale: Locale(lang)));
        await tester.pumpAndSettle();
        final l10n = L10n.of(tester.element(find.byType(Builder).first));
        expect(lessons.asked, ['l5'], reason: 'no reason on the card: the note is fetched');
        expect(find.text(l10n.excuseCategoryIllness), findsOneWidget);
        expect(find.text(l10n.cardStaffNote), findsOneWidget);
        expect(find.text(l10n.cardStaffReason), findsNothing);
        expect(find.text('The family called the office; the child is travelling.'), findsOneWidget);
        if (lang == 'en') expect(find.text('Note (staff and the teacher only)'), findsOneWidget);
        if (lang == 'ar') expect(find.text('ملاحظة (للإدارة والمعلم فقط)'), findsOneWidget);
      });
    }

    testWidgets('staff read a teacher apology\'s category and its note, both fetched', (tester) async {
      final lessons = _Notes(details: _teacherApologyDetails);
      await tester.pumpWidget(app(
        const MessageCard(kind: 'lesson_teacher_apology', lessonId: 'l6', payload: {'lessonId': 'l6', 'startsAt': missed, 'makeupOwed': true}),
        role: UserRole.sales,
        lessons: lessons,
      ));
      await tester.pumpAndSettle();
      expect(find.text('Reason (staff and the teacher only)'), findsOneWidget);
      expect(find.text('An emergency'), findsOneWidget);
      expect(find.text('Note (staff and the teacher only)'), findsOneWidget);
      expect(find.text('A family emergency; back on Monday.'), findsOneWidget);
      expect(find.text('Reason'), findsNothing);
      expect(lessons.asked, ['l6']);
    });

    testWidgets('an old teacher apology payload\'s category is ignored; the fetched one is shown', (tester) async {
      final lessons = _Notes(details: _teacherApologyDetails);
      await tester.pumpWidget(app(categorised('lesson_teacher_apology', lessonId: 'l6'), role: UserRole.teacher, lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Illness'), findsNothing, reason: 'the payload\'s category is not drawn');
      expect(find.text('An emergency'), findsOneWidget);
      expect(find.text('Reason'), findsNothing);
    });

    testWidgets('an older card without a category keeps the family\'s reason and fetches nothing', (tester) async {
      final lessons = _Notes();
      await tester.pumpWidget(app(familyExcuse(), role: UserRole.teacher, lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Yusuf has a fever today.'), findsOneWidget);
      expect(find.text('Illness'), findsNothing);
      expect(lessons.asked, isEmpty);
    });

    testWidgets('a category code this build does not know shows no row', (tester) async {
      final lessons = _Notes();
      await tester.pumpWidget(app(categorised('lesson_ruling', extra: {'decision': 'excused', 'reasonCategory': 'bereavement'}),
          role: UserRole.parent, lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Reason'), findsNothing);
      expect(find.text('bereavement'), findsNothing);
    });
  });
}

const _teacherApologyDetails = LessonStaffDetails(note: 'A family emergency; back on Monday.', category: 'emergency');
const _lateApologyDetails = LessonStaffDetails(
  note: 'ruling note, not repeated',
  category: 'illness',
  familyWords: 'Our flight was delayed by six hours.',
);

class _Notes implements LessonRepository {
  _Notes({this.fail = false, this.details = const LessonStaffDetails(note: 'The family called the office; the child is travelling.')});

  final bool fail;
  final LessonStaffDetails details;
  final asked = <String>[];

  @override
  Future<LessonStaffDetails> staffDetails(String lessonId) async {
    asked.add(lessonId);
    if (fail) throw StateError('404');
    return details;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
