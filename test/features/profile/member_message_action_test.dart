import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Records what was asked of it and answers however the test wants.
class _RecordingConversations implements ConversationRepository {
  _RecordingConversations({this.failWith});

  final AppError? failWith;
  final List<String> opened = [];

  @override
  Future<Conversation> openDirect(String withActorId) async {
    opened.add(withActorId);
    if (failWith != null) throw failWith!;
    return Conversation(
      id: 'c_new',
      kind: ConversationKind.adminDirect,
      title: 'Jawwid',
      updatedAt: DateTime.utc(2026, 9, 30),
    );
  }

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async => const [];
  @override
  Future<Conversation> byId(String conversationId) => throw UnimplementedError();
  @override
  Future<void> setPinned(String conversationId, bool pinned) async {}
  @override
  Future<void> setMuted(String conversationId, bool muted) async {}
  @override
  Future<void> setArchived(String conversationId, bool archived) async {}
  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) async {}
  @override
  Future<List<Conversation>> search(String query) async => const [];
}

/// The member row's message action.
///
/// Two claims, and the second is the one that matters: the action appears for a
/// pairing this client can vouch for, and it is **absent** for every other one —
/// including teacher↔parent, which PD-6 permits only for an authorized
/// relationship the client cannot evaluate. Absent, not disabled: a greyed-out
/// button would tell a teacher that a private channel to this parent exists.
void main() {
  /// [parentCanOpenDirect] is the server's PD-6 advisory for the parent row.
  /// False is the wire default, so the fixture defaults to it too.
  ProfileView groupView({bool parentCanOpenDirect = false}) => ProfileView(
        audience: ProfileAudience.other,
        subject: const ProfilePerson(id: 'c_group', displayName: 'Yusuf · Jawwid'),
        isGroup: true,
        learner: const LearnerRef(id: 'l1', displayName: 'Yusuf'),
        members: [
          ProfilePerson(
            id: 'm_parent',
            displayName: 'Umm Yusuf',
            role: ParticipantRole.parent,
            canOpenDirect: parentCanOpenDirect,
          ),
          const ProfilePerson(
            id: 'm_admin',
            displayName: 'Jawwid Support',
            role: ParticipantRole.admin,
          ),
          const ProfilePerson(
            id: 'm_teacher',
            displayName: 'Ustadh Kareem',
            role: ParticipantRole.teacher,
          ),
        ],
      );

  /// A real router, because success navigates. A harness without one would make
  /// the happy path throw on the very line the test is about.
  Widget harness({
    required UserRole role,
    required ConversationRepository conversations,
    bool parentCanOpenDirect = false,
  }) {
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => Scaffold(
            body: ProfileBody(
              view: groupView(parentCanOpenDirect: parentCanOpenDirect),
            ),
          ),
        ),
        GoRoute(
          path: '/chats/:conversationId',
          builder: (context, state) => Scaffold(
            body: Text('chat:${state.pathParameters['conversationId']}'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        conversationRepositoryProvider.overrideWithValue(conversations),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    );
  }

  Finder messageButtons() => find.byIcon(Icons.chat_bubble_outline);

  testWidgets('a teacher is offered one channel: the Jawwid staff member',
      (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(role: UserRole.teacher, conversations: repo));
    await tester.pumpAndSettle();

    expect(messageButtons(), findsOneWidget);

    // And it is the admin's row. The tooltip names who, so a screen-reader user
    // can tell which row has focus.
    final button = tester.widget<IconButton>(
      find.ancestor(of: messageButtons(), matching: find.byType(IconButton)).first,
    );
    expect(button.tooltip, 'Message: Jawwid Support');
  });

  testWidgets(
      'PD-6 fail-closed: no advisory means the parent row offers nothing',
      (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(role: UserRole.teacher, conversations: repo));
    await tester.pumpAndSettle();

    // The parent is on screen — this is a real group and the teacher can see who
    // is in it — and with `canOpenDirect` false there is no way to message them.
    // Absent, not disabled: a greyed-out button would itself disclose that a
    // private channel to this parent exists.
    expect(find.text('Umm Yusuf'), findsOneWidget);
    expect(messageButtons(), findsOneWidget); // the admin's, and only that
    for (final tooltip
        in tester.widgetList<IconButton>(find.byType(IconButton)).map((b) => b.tooltip)) {
      expect(tooltip, isNot(contains('Umm Yusuf')));
    }
  });

  testWidgets(
      'PD-6 authorized: the server advisory makes the parent reachable',
      (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(
      role: UserRole.teacher,
      conversations: repo,
      parentCanOpenDirect: true,
    ));
    await tester.pumpAndSettle();

    // Now two: the admin's, and the parent's. This is the whole point of the
    // advisory — the channel PD-6 permits was unreachable from either client
    // while the decision was guessed from roles alone.
    expect(messageButtons(), findsNWidgets(2));

    // Found by tooltip, not by position: asserting on `.first`/`.last` would pass
    // for the wrong row the day the member order changes.
    final parentButton = find.byWidgetPredicate(
      (w) => w is IconButton && (w.tooltip ?? '').contains('Umm Yusuf'),
    );
    expect(parentButton, findsOneWidget);

    await tester.tap(parentButton);
    await tester.pumpAndSettle();

    // It opened the channel with the PARENT specifically.
    expect(repo.opened, ['m_parent']);
  });

  testWidgets('a parent is offered the staff member and not the teacher',
      (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(role: UserRole.parent, conversations: repo));
    await tester.pumpAndSettle();

    expect(messageButtons(), findsOneWidget);
    expect(find.text('Ustadh Kareem'), findsOneWidget);
  });

  testWidgets('tapping opens the channel with that actor, once', (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(role: UserRole.teacher, conversations: repo));
    await tester.pumpAndSettle();

    await tester.tap(messageButtons());
    await tester.pumpAndSettle();

    expect(repo.opened, ['m_admin']);
    // And it went there: the new conversation is on screen.
    expect(find.text('chat:c_new'), findsOneWidget);
  });

  testWidgets('a second tap while the first is in flight does not send again',
      (tester) async {
    final repo = _RecordingConversations();
    await tester.pumpWidget(harness(role: UserRole.teacher, conversations: repo));
    await tester.pumpAndSettle();

    // Two taps with no settle between them: the row has not changed yet, which
    // is exactly when a person taps twice on a slow connection.
    await tester.tap(messageButtons());
    await tester.pump();
    final second = messageButtons();
    if (second.evaluate().isNotEmpty) {
      await tester.tap(second);
    }
    await tester.pumpAndSettle();

    expect(repo.opened, ['m_admin']);
  });

  testWidgets('a refusal is shown and the screen stays put', (tester) async {
    final repo = _RecordingConversations(
      failWith: const AppError(
        AppErrorKind.forbidden,
        code: 'COMM.BR1_TEACHER_PARENT_DIRECT',
      ),
    );
    await tester.pumpWidget(harness(role: UserRole.teacher, conversations: repo));
    await tester.pumpAndSettle();

    await tester.tap(messageButtons());
    await tester.pumpAndSettle();

    expect(repo.opened, ['m_admin']);
    // Something was said about it, and it was not a stack trace.
    expect(find.byType(SnackBar), findsOneWidget);
    // Still on the profile: no chat screen was pushed for a conversation that
    // was never created.
    expect(find.byType(ProfileBody), findsOneWidget);
  });
}
