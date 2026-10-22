import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/domain/chat_feed.dart';
import 'package:jawwid_chat/features/conversations/domain/conversation_list.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen_route.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/trials/presentation/trial_group_join_banner.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/trial.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-20 in Chats: Sales sees every teacher's trial group, as a GROUP; staff-only
/// messages are labelled in the thread; and a Sales seat joins a trial group before
/// taking part. The teacher's view of their own trial group is held to the same kind.
void main() {
  Map<String, Object?> wire(String type, {String title = 'teacher_c'}) =>
      {'id': 'c1', 'type': type, 'title': title, 'lastActivityAt': '2026-10-19T12:00:00.000Z'};

  group('a trial group is a group', () {
    for (final role in [UserRole.teacher, UserRole.sales]) {
      test('for ${role.name}: kind, list section and Groups filter', () {
        final trial = WireMappers.conversation(wire('trial_group'), viewerRole: role, viewerActorId: 'me');
        final direct = WireMappers.conversation(
          {...wire('direct', title: 'admin_d'), 'id': 'c2'},
          viewerRole: role,
          viewerActorId: 'me',
        );

        expect(trial.kind, ConversationKind.studentGroup);
        expect(trial.isTrialGroup, isTrue);
        expect(trial.kind.isDirect, isFalse);
        expect(direct.kind.isDirect, isTrue);

        final sections = ConversationListBuilder.build(role: role, conversations: [trial, direct]);
        expect(sections.map((s) => s.key), ['primary', 'staff']);
        expect(sections.first.conversations.single.id, 'c1');
        expect(ChatFeed.count(sections: sections, filter: ChatFilter.groups), 1);
      });
    }

    test('the teacher reads it as "Trial lessons"; Sales by the server\'s title (the teacher)', () {
      final forTeacher = WireMappers.conversation(wire('trial_group'), viewerRole: UserRole.teacher);
      final forSales = WireMappers.conversation(wire('trial_group'), viewerRole: UserRole.sales);
      expect(forTeacher.displayTitle('Supervision', trialGroupLabel: 'Trial lessons'), 'Trial lessons');
      expect(forSales.displayTitle('Supervision', trialGroupLabel: 'Trial lessons'), 'teacher_c');
    });

    test('a parent\'s student group is untouched', () {
      final group = WireMappers.conversation(wire('student_group', title: 'سارة · جَوِّد'), viewerRole: UserRole.parent);
      expect(group.kind, ConversationKind.studentGroup);
      expect(group.isTrialGroup, isFalse);
      expect(group.displayTitle('Supervision', trialGroupLabel: 'Trial lessons'), 'سارة · جَوِّد');
    });
  });

  Widget app(Widget home, {List<Override> overrides = const [], Locale locale = const Locale('en')}) {
    return ProviderScope(
      retry: JawwidRetryPolicy.policy,
      overrides: overrides,
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
        home: Scaffold(body: home),
      ),
    );
  }

  testWidgets("Sales' Groups filter lists every trial group under its teacher's name", (tester) async {
    final backend = FakeBackend(role: UserRole.sales);
    addTearDown(backend.dispose);
    await tester.pumpWidget(app(
      const ChatsScreen(initialFilter: ChatFilter.groups),
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.sales),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
      ],
    ));
    await tester.pumpAndSettle();

    expect(find.text('خديجة'), findsWidgets);
    expect(find.text('حسن'), findsWidgets);
    expect(find.text('إدارة جَوِّد'), findsNothing, reason: 'a 1:1 is not a group');
    expect(find.textContaining('Internal note'), findsNothing);
  });

  group('an internal message is labelled in the thread', () {
    Map<String, Object?> message({String visibility = 'customer'}) => {
          'id': 'm1',
          'conversationId': 'c1',
          'seq': '7',
          'authorKind': 'staff',
          'authorId': 's1',
          'authorDisplayName': 'sales_s',
          'type': 'text',
          'body': 'call the family back tomorrow',
          'visibility': visibility,
          'moderation': 'published',
          'createdAt': '2026-10-19T12:00:00.000Z',
          'attachments': <Object?>[],
          'reactions': <Object?>[],
          'receipts': <Object?>[],
        };

    testWidgets('"Internal note" on a staff-only message, in English and Arabic', (tester) async {
      final m = WireMappers.message(message(visibility: 'internal'), viewerActorId: 'me');
      expect(m.isInternal, isTrue);

      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.byKey(const ValueKey('message-internal-label')), findsOneWidget);
      expect(find.text('Internal note'), findsOneWidget);
      expect(find.text('call the family back tomorrow'), findsOneWidget);

      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true), locale: const Locale('ar')));
      expect(find.text('ملاحظة داخلية'), findsOneWidget);
    });

    testWidgets('nothing on a customer-visible message', (tester) async {
      final m = WireMappers.message(message(), viewerActorId: 'me');
      expect(m.isInternal, isFalse);
      await tester.pumpWidget(app(MessageBubble(message: m, showAuthor: true)));
      expect(find.byKey(const ValueKey('message-internal-label')), findsNothing);
      expect(find.text('Internal note'), findsNothing);
    });
  });

  group('Join this group', () {
    late FakeBackend backend;
    late _RecordingTrials trials;

    Future<void> pump(WidgetTester tester, String conversationId, {UserRole role = UserRole.sales}) async {
      backend = FakeBackend(role: UserRole.sales);
      addTearDown(backend.dispose);
      trials = _RecordingTrials(backend);
      await tester.pumpWidget(app(
        TrialGroupJoinBanner(conversationId: conversationId, onJoined: () => trials.refreshed++),
        overrides: [
          currentRoleProvider.overrideWithValue(role),
          principalIdProvider.overrideWithValue(backend.user.id),
          groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
          trialRepositoryProvider.overrideWithValue(trials),
        ],
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('is offered to a Sales seat that is not a member; joining calls the route and refreshes', (tester) async {
      await pump(tester, 'c_trial_2');
      expect(find.text('Join this group'), findsOneWidget);

      await tester.tap(find.text('Join this group'));
      await tester.pumpAndSettle();

      expect(trials.joined, ['c_trial_2']);
      expect(trials.refreshed, 1, reason: 'the conversation is asked for again');
      expect(find.text('Join this group'), findsNothing, reason: 'now a member: the server membership says so');
    });

    testWidgets('is absent for a member', (tester) async {
      await pump(tester, 'c_trial_1');
      expect(find.byKey(const ValueKey('trial-group-join')), findsNothing);
    });

    for (final role in [UserRole.teacher, UserRole.parent]) {
      testWidgets('is absent for a ${role.name}', (tester) async {
        await pump(tester, 'c_trial_2', role: role);
        expect(find.byKey(const ValueKey('trial-group-join')), findsNothing);
      });
    }

    testWidgets("sits above the thread of a trial group, and of nothing else", (tester) async {
      backend = FakeBackend(role: UserRole.sales);
      addTearDown(backend.dispose);
      trials = _RecordingTrials(backend);
      Widget route(String id) => app(
            ChatScreenRoute(conversationId: id),
            overrides: [
              currentRoleProvider.overrideWithValue(UserRole.sales),
              principalIdProvider.overrideWithValue(backend.user.id),
              conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
              messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
              groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
              callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
              trialRepositoryProvider.overrideWithValue(trials),
            ],
          );

      await tester.pumpWidget(route('c_trial_2'));
      await tester.pumpAndSettle();
      expect(find.text('خديجة'), findsNothing);
      expect(find.text('حسن'), findsWidgets, reason: "the server's title: the teacher's name");
      expect(find.text('Join this group'), findsOneWidget);

      await tester.tap(find.text('Join this group'));
      await tester.pumpAndSettle();
      expect(trials.joined, ['c_trial_2']);
      expect(find.text('Join this group'), findsNothing);

      await tester.pumpWidget(route('c_admin'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('trial-group-join')), findsNothing);
    });

    testWidgets('in Arabic', (tester) async {
      backend = FakeBackend(role: UserRole.sales);
      addTearDown(backend.dispose);
      await tester.pumpWidget(app(
        const TrialGroupJoinBanner(conversationId: 'c_trial_2'),
        locale: const Locale('ar'),
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.sales),
          principalIdProvider.overrideWithValue(backend.user.id),
          groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        ],
      ));
      await tester.pumpAndSettle();
      expect(find.text('انضم إلى هذه المجموعة'), findsOneWidget);
    });
  });
}

/// Records each join and applies it to the fixture, the way the server would.
class _RecordingTrials implements TrialRepository {
  _RecordingTrials(this.backend);

  final FakeBackend backend;
  final joined = <String>[];
  int refreshed = 0;

  @override
  Future<void> joinGroup(String conversationId) async {
    joined.add(conversationId);
    backend.joinTrialGroup(conversationId);
  }

  @override
  Future<List<TrialTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft) async {}
}
