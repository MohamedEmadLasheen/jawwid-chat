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

/// PD-26: a teacher on leave is SHOWN as such in the chat; messaging is not blocked.
/// The server marks the member (`away: { kind, until }`); the client only words it,
/// and says nothing when it is told nothing.
class _Groups implements GroupRepository {
  _Groups(this.members, {this.fails = false});

  final List<GroupMember> members;
  final bool fails;

  @override
  Future<StudentGroup> group(String conversationId) async {
    if (fails) throw StateError('offline');
    return StudentGroup(
      conversationId: conversationId,
      learner: const LearnerRef(id: 'l1', displayName: 'learner_l'),
      members: members,
    );
  }
}

void main() {
  Widget app(GroupRepository groups, {Locale locale = const Locale('en')}) => ProviderScope(
        overrides: [groupRepositoryProvider.overrideWithValue(groups)],
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
}
