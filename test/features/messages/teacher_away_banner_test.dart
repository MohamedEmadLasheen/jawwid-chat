import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/teacher_away_banner.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';

/// PD-26: a teacher on leave is SHOWN as such in the chat; messaging is not blocked.
/// The server marks the member (`away: { kind, until }`); the client only words it,
/// and says nothing when it is told nothing.
class _Groups implements GroupRepository {
  _Groups(this.members, {this.fails = false});

  List<GroupMember> members;
  final bool fails;
  int reads = 0;

  @override
  Future<StudentGroup> group(String conversationId) async {
    reads++;
    if (fails) throw StateError('offline');
    return StudentGroup(
      conversationId: conversationId,
      learner: const LearnerRef(id: 'l1', displayName: 'learner_l'),
      members: members,
    );
  }
}

void main() {
  Widget app(GroupRepository groups, {Locale locale = const Locale('en'), DateTime Function()? now}) => ProviderScope(
        overrides: [
          groupRepositoryProvider.overrideWithValue(groups),
          if (now != null) awayClockProvider.overrideWithValue(now),
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
          home: const Scaffold(body: TeacherAwayBanner(conversationId: 'c1')),
        ),
      );

  GroupMember teacher(Map<String, Object?>? away) =>
      WireMappers.groupMember({'actorId': 't1', 'displayName': 'teacher_c', 'memberRole': 'teacher', 'away': away});

  test('the wire: leave stays leave; every other kind reads as away; anything malformed is not away', () {
    expect(teacher({'kind': 'leave', 'until': '2026-11-03'}).away?.kind, MemberAwayKind.leave);
    expect(teacher({'kind': 'leave', 'until': '2026-11-03'}).away?.until, DateTime.utc(2026, 11, 3));
    expect(teacher({'kind': 'suspended', 'until': '2026-11-03'}).away?.kind, MemberAwayKind.away);
    expect(teacher({'kind': 'away', 'until': '2026-11-03'}).away?.kind, MemberAwayKind.away);
    expect(teacher({'kind': 'leave', 'until': 'soon'}).away, isNull);
    expect(teacher(null).away, isNull);
    expect(WireMappers.groupMember({'actorId': 't1', 'memberRole': 'teacher'}).away, isNull);
  });

  testWidgets('a teacher on leave: the family reads until when, and that messages still reach them', (tester) async {
    await tester.pumpWidget(app(_Groups([teacher({'kind': 'leave', 'until': '2026-11-03'})])));
    await tester.pumpAndSettle();
    // MaterialLocalizations' medium date: "Tue, Nov 3".
    expect(find.text('teacher_c is on leave until Tue, Nov 3. Messages still reach them.'), findsOneWidget);
  });

  testWidgets('away (a suspension, to a family) is worded as away, in Arabic too', (tester) async {
    await tester.pumpWidget(app(_Groups([teacher({'kind': 'away', 'until': '2026-11-03'})]), locale: const Locale('ar')));
    await tester.pumpAndSettle();
    expect(find.textContaining('teacher_c غير متاح حتى'), findsOneWidget);
    expect(find.textContaining('إجازة'), findsNothing);
  });

  testWidgets('nobody away, or the member list unavailable: no notice at all', (tester) async {
    await tester.pumpWidget(app(_Groups([teacher(null)])));
    await tester.pumpAndSettle();
    expect(find.byType(Text), findsNothing);
    await tester.pumpWidget(app(_Groups(const [], fails: true)));
    await tester.pumpAndSettle();
    expect(find.byType(Text), findsNothing);
  });

  testWidgets('PD-26: coming back to the app re-reads it (the leave was approved meanwhile)', (tester) async {
    final groups = _Groups([teacher(null)]);
    await tester.pumpWidget(app(groups));
    await tester.pumpAndSettle();
    expect(find.byType(Text), findsNothing);

    groups.members = [teacher({'kind': 'leave', 'until': '2026-11-03'})];
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.textContaining('teacher_c is on leave until'), findsOneWidget);
  });

  // The leave's end is the midnight after its last day, in the ACCOUNT's zone (AppClock).
  // "Now" and the zone are pinned, so the result does not depend on when or where the
  // test runs. Europe/Berlin: clocks go back on 2026-10-25 (a 25-hour day) and forward
  // on 2026-03-29 (a 23-hour day).
  group('PD-26: the notice clears itself when the leave it shows is over -- one timer, not polling', () {
    setUp(() => AppClock.useZone('Europe/Berlin'));
    tearDown(() => AppClock.useZone(null));

    for (final (name, until, now, untilOver) in [
      ('at 23:30 on its last day', '2026-10-20', (2026, 10, 20, 23, 30), const Duration(minutes: 30)),
      ('at 00:30 on its last day', '2026-10-20', (2026, 10, 20, 0, 30), const Duration(hours: 23, minutes: 30)),
      ('across the night clocks go back (25-hour day)', '2026-10-25', (2026, 10, 25, 0, 30), const Duration(hours: 24, minutes: 30)),
      ('across the night clocks go forward (23-hour day)', '2026-03-29', (2026, 3, 29, 0, 30), const Duration(hours: 22, minutes: 30)),
    ]) {
      testWidgets(name, (tester) async {
        final pinned = AppClock.wallClock(now.$1, now.$2, now.$3, now.$4, now.$5);
        final groups = _Groups([teacher({'kind': 'leave', 'until': until})]);
        await tester.pumpWidget(app(groups, now: () => pinned));
        await tester.pumpAndSettle();
        expect(find.textContaining('is on leave until'), findsOneWidget);
        final readsWhileShown = groups.reads;

        // Nothing re-reads until the leave's last day is over...
        await tester.pump(untilOver - const Duration(minutes: 1));
        expect(groups.reads, readsWhileShown);

        // ...then the server is asked once more (and says: back).
        groups.members = [teacher(null)];
        await tester.pump(const Duration(minutes: 2));
        await tester.pumpAndSettle();
        expect(groups.reads, readsWhileShown + 1);
        expect(find.byType(Text), findsNothing);
      });
    }
  });
}
