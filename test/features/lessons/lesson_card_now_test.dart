// CHATSCHED-002 (PD-46 PR-3a): a lesson card is history and is never rewritten --
// but an old time card says where its lesson stands now: moved since, held at
// another time, cancelled, or missed. While the card is still right, it says nothing.
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

void main() {
  const shown = '2026-10-31T19:00:00.000Z'; // Sat 31 Oct, 21:00 in Cairo
  const later = '2026-10-31T20:00:00.000Z'; // Sat 31 Oct, 22:00 in Cairo

  setUp(() => AppClock.useZone('Africa/Cairo'));
  tearDown(() => AppClock.useZone(null));

  Widget app(MessageCard card, _Now lessons, {Locale locale = const Locale('en'), String? conversationId = 'c1'}) {
    return ProviderScope(
      overrides: [
        lessonRepositoryProvider.overrideWithValue(lessons),
        currentRoleProvider.overrideWithValue(UserRole.parent),
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
            child: Builder(builder: (context) => lessonCardView(context, card, Colors.black, conversationId: conversationId)!),
          ),
        ),
      ),
    );
  }

  String dayWhen(String iso, String lang) {
    final t = AppClock.parse(iso)!;
    final time = DateFormat.jm(lang).format(DateTime(2000, 1, 1, t.hour, t.minute)).replaceAll('\u202f', ' ');
    return '${DateFormat.yMMMEd(lang).format(t)} · $time';
  }

  MessageCard moved({String kind = 'lesson_moved'}) => MessageCard(kind: kind, lessonId: 'l2', payload: const {
        'lessonId': 'l2', 'learnerName': 'Yusuf', 'teacherName': 'Teacher Huda',
        'startsAt': shown, 'endsAt': '2026-10-31T19:30:00.000Z', 'previousStartsAt': '2026-10-31T18:00:00.000Z',
        'movedBy': 'staff',
      });
  LessonNow now(String startsAt, LessonNowStatus status) =>
      LessonNow(lessonId: 'l2', currentLessonId: 'l3', startsAt: AppClock.parse(startsAt)!, status: status);

  final footer = find.byKey(const ValueKey('lesson-now'));

  testWidgets('a lesson moved again: the old card says where it is now', (tester) async {
    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.pumpWidget(app(moved(), _Now({'l2': now(later, LessonNowStatus.upcoming)})));
    await tester.pumpAndSettle();
    expect(find.text(l10n.cardNowAt(dayWhen(later, 'en'))), findsOneWidget);
  });

  testWidgets('still right: no footer', (tester) async {
    await tester.pumpWidget(app(moved(), _Now({'l2': now(shown, LessonNowStatus.upcoming)})));
    await tester.pumpAndSettle();
    expect(footer, findsNothing);
  });

  testWidgets('cancelled since, in Arabic: says so, and nothing about why', (tester) async {
    final l10n = await L10n.delegate.load(const Locale('ar'));
    await tester.pumpWidget(app(moved(), _Now({'l2': now(shown, LessonNowStatus.cancelled)}), locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(find.text(l10n.cardNowCancelled), findsOneWidget);
  });

  testWidgets('a lesson_scheduled card has its own title, and held at another time reads "Held"', (tester) async {
    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.pumpWidget(app(moved(kind: 'lesson_scheduled'), _Now({'l2': now(later, LessonNowStatus.held)})));
    await tester.pumpAndSettle();
    expect(find.text(l10n.cardScheduledTitle), findsOneWidget);
    expect(find.text(l10n.cardNowHeldAt(dayWhen(later, 'en'))), findsOneWidget);
  });

  testWidgets('a card that is not a time card, or a failed read, shows no footer', (tester) async {
    const report = MessageCard(kind: 'lesson_report', lessonId: 'l2', payload: {'lessonId': 'l2', 'startsAt': shown, 'covered': 'Al-Fatiha'});
    await tester.pumpWidget(app(report, _Now({'l2': now(later, LessonNowStatus.cancelled)})));
    await tester.pumpAndSettle();
    expect(footer, findsNothing);

    await tester.pumpWidget(app(moved(), _Now(null)));
    await tester.pumpAndSettle();
    expect(footer, findsNothing);
  });
}

/// Answers lesson-now for 'c1' with [answer]; null throws, as a failed request does.
class _Now implements LessonRepository {
  _Now(this.answer);

  final Map<String, LessonNow>? answer;

  @override
  Future<Map<String, LessonNow>> lessonNow(String conversationId) async {
    final a = answer;
    if (a == null) throw StateError('offline');
    return conversationId == 'c1' ? a : const {};
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
