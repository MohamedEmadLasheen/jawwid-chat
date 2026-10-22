import 'dart:async';

import 'package:flutter/material.dart' hide Page;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/presentation/stories_rail.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/story.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// SESSION ISOLATION: one person's data must not survive into the next person's session.
///
/// ## The bug these exist to keep closed
///
/// Signing out and back in as somebody else on the same device used to leave every
/// session-scoped provider holding the previous principal's answers, because nothing in the
/// app invalidated them when the principal changed. Reproduced on a device against the real
/// API: a story published to `all_families` ONLY was shown to a signed-in **teacher**, whose
/// own feed from the server contained two stories and not that one. The conversation list
/// leaked the same way.
///
/// The server was never the problem and is not what these test. `/stories/feed` returned the
/// correct two rows for the teacher throughout; the leak was entirely client-side cache. So
/// the fakes here answer **by principal**, and the assertions are about what the client holds
/// and renders — which is the only layer that was ever wrong.
///
/// ## Why identity and not role
///
/// `currentRoleProvider` is not a session boundary: Parent A -> Parent B is a change of
/// person with no change of role at all. Both same-role permutations are covered below for
/// exactly that reason — they are the cases a role-keyed fix would silently fail.
void main() {
  // --------------------------------------------------------------------------
  // Fakes that answer by principal, the way the server does
  // --------------------------------------------------------------------------

  /// Who is signed in right now, as the fakes see it. Set by the auth fake on sign-in and
  /// cleared on sign-out, standing in for the bearer token the real stack would send.
  late _Session session;

  /// What each principal's server would return. Deliberately disjoint, so any cross-over is
  /// unambiguous rather than a coincidence of shared fixtures.
  const feeds = <String, List<String>>{
    'parentA': ['parentA-story'],
    'parentB': ['parentB-story'],
    'teacherA': ['teacherA-story'],
    'teacherB': ['teacherB-story'],
  };

  const roles = <String, UserRole>{
    'parentA': UserRole.parent,
    'parentB': UserRole.parent,
    'teacherA': UserRole.teacher,
    'teacherB': UserRole.teacher,
  };

  ProviderContainer containerFor() {
    session = _Session();
    final auth = _SwitchableAuthRepository(session: session, roles: roles);
    addTearDown(auth.dispose);
    final tokens = InMemoryTokenStore();

    return ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        storyRepositoryProvider
            .overrideWithValue(_PrincipalStoryRepository(session, feeds)),
        conversationRepositoryProvider
            .overrideWithValue(_PrincipalConversationRepository(session, feeds)),
        authControllerProvider.overrideWith(
          () => AuthController(
            repository: auth,
            tokens: tokens,
            clearLocalData: () async {},
          ),
        ),
      ],
    );
  }

  Future<void> signIn(ProviderContainer c, String who) async {
    await c.read(authControllerProvider.notifier).signIn(
          username: who,
          password: 'irrelevant',
        );
    expect(
      c.read(authControllerProvider),
      isA<AuthAuthenticated>(),
      reason: '$who should be signed in before anything is asserted about them',
    );
  }

  Future<void> signOut(ProviderContainer c) =>
      c.read(authControllerProvider.notifier).signOut();

  List<String> storyIds(ProviderContainer c) =>
      c.read(storiesControllerProvider).value?.map((s) => s.id).toList() ??
      const [];

  List<String> conversationIds(ProviderContainer c) => c
      .read(conversationsControllerProvider)
      .value
      ?.expand((section) => section.conversations)
      .map((conversation) => conversation.id)
      .toList() ??
      const [];

  /// The whole acceptance criterion, as one reusable sequence: sign in as [first], load both
  /// feeds, sign out, sign in as [second], and inspect WITHOUT a refresh, a restart, or any
  /// navigation. [second]'s data, or nothing at all — never [first]'s.
  Future<void> expectNoLeak(String first, String second) async {
    final c = containerFor();
    addTearDown(c.dispose);

    await signIn(c, first);
    await c.read(storiesControllerProvider.future);
    await c.read(conversationsControllerProvider.future);
    expect(storyIds(c), ['$first-story']);
    expect(conversationIds(c), ['$first-chat']);

    await signOut(c);
    await signIn(c, second);

    // IMMEDIATELY, before awaiting anything: the moment the principal changed, the previous
    // person's answers must already be gone from what a widget would read. This is the exact
    // assertion the shipped bug failed — the rail rendered the previous account's stories
    // until somebody pulled to refresh.
    expect(
      storyIds(c),
      isNot(contains('$first-story')),
      reason: "$second must never see $first's stories, not even for one frame",
    );
    expect(
      conversationIds(c),
      isNot(contains('$first-chat')),
      reason: "$second must never see $first's conversations",
    );

    // And once the new answers land they are the right person's.
    await c.read(storiesControllerProvider.future);
    await c.read(conversationsControllerProvider.future);
    expect(storyIds(c), ['$second-story']);
    expect(conversationIds(c), ['$second-chat']);
  }

  group('a principal change takes the previous principal’s state with it', () {
    test('Parent -> Teacher', () => expectNoLeak('parentA', 'teacherA'));
    test('Teacher -> Parent', () => expectNoLeak('teacherA', 'parentA'));

    // The two a role-keyed fix would miss.
    test('Parent A -> Parent B', () => expectNoLeak('parentA', 'parentB'));
    test('Teacher A -> Teacher B', () => expectNoLeak('teacherA', 'teacherB'));
  });

  test('the new session LOADS, without anyone pulling to refresh', () async {
    // The leak test above proves the old data goes. This proves the new data arrives on its
    // own — which is a different failure, and one that got shipped: with a widget watching,
    // the chat list settled on an empty list and a signed-in teacher saw "no conversations
    // yet" until they pulled to refresh. The cause was `_sectioned()` reading the role that
    // `build()` never declared a dependency on, so the rebuild for the new principal ran a
    // beat before the role was readable and sectioned against null.
    //
    // The active listeners are the point: they are what a mounted screen does, and the bug
    // did not reproduce without them.
    final c = containerFor();
    addTearDown(c.dispose);
    final stories = c.listen(storiesControllerProvider, (_, _) {});
    final conversations = c.listen(conversationsControllerProvider, (_, _) {});
    addTearDown(stories.close);
    addTearDown(conversations.close);

    await signIn(c, 'parentA');
    await c.read(storiesControllerProvider.future);
    await c.read(conversationsControllerProvider.future);

    await signOut(c);
    await signIn(c, 'teacherA');

    // Settle by draining the event loop, NOT by calling refresh(): a fix that needs a manual
    // refresh is the bug.
    for (var i = 0; i < 10; i++) {
      await Future<void>.delayed(Duration.zero);
    }

    expect(storyIds(c), ['teacherA-story']);
    expect(
      conversationIds(c),
      ['teacherA-chat'],
      reason: 'the incoming session must load on its own, with no pull-to-refresh',
    );
  });

  test('the chat list reloads when the role becomes readable', () async {
    // The role arrives a beat after the principal on a real device, and `_sectioned()` needs
    // it: with a null role it sections to nothing. That made the rebuild for the incoming
    // session settle on an empty list, so a signed-in teacher saw "no conversations yet"
    // until they pulled to refresh — the previous person's data was gone, which was the
    // point, but the new person's never arrived.
    //
    // The window is a race on a device, so it is forced here instead: the role is driven
    // independently of the principal, and the controller must notice it changing.
    final role = _RoleHolder();
    final session = _Session()..principal = 'parentA';

    final c = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        conversationRepositoryProvider
            .overrideWithValue(_PrincipalConversationRepository(session, feeds)),
        currentRoleProvider.overrideWith((ref) => ref.watch(role.provider)),
      ],
    );
    addTearDown(c.dispose);
    final sub = c.listen(conversationsControllerProvider, (_, _) {});
    addTearDown(sub.close);

    // Role not readable yet: the list is correctly empty, because nothing can be sectioned.
    await c.read(conversationsControllerProvider.future);
    expect(conversationIds(c), isEmpty);

    // The role lands. Nothing else happens — no refresh, no second sign-in.
    c.read(role.provider.notifier).set(UserRole.parent);
    for (var i = 0; i < 10; i++) {
      await Future<void>.delayed(Duration.zero);
    }

    expect(
      conversationIds(c),
      ['parentA-chat'],
      reason: 'the role is an input to the sections, so it must be a declared dependency',
    );
  });

  test('a shared conversation does not hand the next principal the previous log', () async {
    // The subtlest of these, and the one that is NOT fixed by scoping the chat LIST.
    // A student group holds the parent and the teacher, so the same conversation id is
    // reachable by both in turn on one device. `messagesControllerProvider` is a family
    // keyed by that id and is not autoDispose, so the second principal used to be handed
    // the first one's loaded page with no refetch at all — and the two do not necessarily
    // see the same messages, because a message can be hidden for one member or still be
    // awaiting approval.
    final who = NotifierProvider<_PrincipalHolder, String?>(_PrincipalHolder.new);
    final messages = _PrincipalMessages();

    final c = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        messageRepositoryProvider.overrideWithValue(messages),
        principalIdProvider.overrideWith((ref) => ref.watch(who)),
      ],
    );
    addTearDown(c.dispose);

    c.read(who.notifier).set('parentA');
    messages.bodies = ['only-parentA-may-read-this'];

    final sub = c.listen(messagesControllerProvider('shared-group'), (_, _) {});
    addTearDown(sub.close);
    await _drain();
    expect(
      c.read(messagesControllerProvider('shared-group')).log.messages.single.body,
      'only-parentA-may-read-this',
    );

    // The teacher signs in. Same conversation, different reader.
    messages.bodies = ['what-the-teacher-may-read'];
    c.read(who.notifier).set('teacherA');
    await _drain();

    expect(
      c.read(messagesControllerProvider('shared-group')).log.messages.single.body,
      'what-the-teacher-may-read',
      reason: 'the incoming principal must get their own page, not the outgoing one\'s',
    );
    expect(
      messages.historyCalls,
      2,
      reason: 'the page must be refetched for the new principal, not served from cache',
    );
  });

  test('signing out alone drops the feed, before anyone else signs in', () async {
    final c = containerFor();
    addTearDown(c.dispose);

    await signIn(c, 'parentA');
    await c.read(storiesControllerProvider.future);
    expect(storyIds(c), ['parentA-story']);

    await signOut(c);

    // A device left at the login screen must not still be holding the last reader's feed.
    expect(storyIds(c), isNot(contains('parentA-story')));
  });

  test('the unread watermark does not cross accounts', () async {
    // ConversationsController keeps private bookkeeping that Riverpod does NOT reset: the
    // notifier instance is reused across rebuilds, so `build()` clears it by hand. Without
    // that, a watermark recorded for one account suppresses badges for the next one.
    final c = containerFor();
    addTearDown(c.dispose);

    await signIn(c, 'parentA');
    await c.read(conversationsControllerProvider.future);
    await c
        .read(conversationsControllerProvider.notifier)
        .markRead('parentA-chat', throughSequence: 99);

    await signOut(c);
    await signIn(c, 'parentB');
    await c.read(conversationsControllerProvider.future);

    final controller = c.read(conversationsControllerProvider.notifier);
    expect(
      controller.includeArchived,
      isFalse,
      reason: 'every field the controller owns is reset for the new principal',
    );
    expect(conversationIds(c), ['parentB-chat']);
  });

  testWidgets(
      'on screen: a teacher signing in after a parent sees no trace of the parent',
      (tester) async {
    // The reported bug, at the layer it was reported from. No refresh, no restart, no
    // navigating away and back — just sign out, sign in, and look.
    final c = containerFor();
    addTearDown(c.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const ChatsScreen(),
        ),
      ),
    );

    // Explicit pumps rather than pumpAndSettle: the chat list keeps a RefreshIndicator and a
    // periodic rebuild alive, so "settled" never arrives and the test would simply time out.
    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    // runAsync, because sign-in is REAL async (token store, then `/me`) and the widget
    // tester's fake-async zone will not complete those futures on its own.
    await tester.runAsync(() => signIn(c, 'parentA'));
    await settle();
    // A ring is found by its story, not by words under it: a story has no title since
    // 2026-10-17, so every ring carries the academy's name.
    expect(find.byKey(const ValueKey('story-ring-parentA-story')), findsOneWidget);
    expect(tester.getSize(find.byType(StoriesRail)).height,
        StoriesRail.railHeight);

    await tester.runAsync(() async {
      await signOut(c);
      await signIn(c, 'teacherA');
    });
    await settle();

    expect(find.byKey(const ValueKey('story-ring-parentA-story')), findsNothing,
        reason: "the parent's story must not be on a teacher's screen");
    expect(find.byKey(const ValueKey('story-ring-teacherA-story')), findsOneWidget);
  });
}

/// Lets a test drive the authenticated principal directly, without a whole auth stack.
class _PrincipalHolder extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? value) => state = value;
}

/// A message repository whose answer changes with the reader, the way the server's does.
class _PrincipalMessages implements MessageRepository {
  List<String> bodies = const [];
  int historyCalls = 0;

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async {
    historyCalls++;
    return Page(
      items: [
        for (final b in bodies)
          Message(
            clientMessageId: b,
            conversationId: conversationId,
            kind: MessageKind.text,
            createdAt: DateTime.utc(2026),
            deliveryState: DeliveryState.sent,
            body: b,
          ),
      ],
      hasMore: false,
    );
  }

  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

/// Let pending microtasks settle without calling any refresh: a fix that needs one is a bug.
Future<void> _drain() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// A role that can be driven independently of the principal, so the window between the two
/// can be forced open rather than waited for.
class _RoleHolder {
  final provider = NotifierProvider<_RoleNotifier, UserRole?>(_RoleNotifier.new);
}

class _RoleNotifier extends Notifier<UserRole?> {
  @override
  UserRole? build() => null;

  void set(UserRole? value) => state = value;
}

/// The signed-in principal, as the fake repositories see it.
class _Session {
  String? principal;
}

class _SwitchableAuthRepository implements AuthRepository {
  _SwitchableAuthRepository({required this.session, required this.roles});

  final _Session session;
  final Map<String, UserRole> roles;
  final _revoked = StreamController<void>.broadcast();

  Future<void> dispose() => _revoked.close();

  @override
  Stream<void> get sessionRevoked => _revoked.stream;

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    session.principal = username;
    return AuthSession(
      accessToken: 'access-$username',
      refreshToken: 'refresh-$username',
      accessTokenExpiresAt: DateTime.utc(2030),
    );
  }

  @override
  Future<AuthUser> currentUser() async {
    final who = session.principal;
    if (who == null) throw const AppError(AppErrorKind.unauthenticated);
    return AuthUser(id: who, displayName: who, role: roles[who]!);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async =>
      throw UnimplementedError();

  @override
  Future<void> signOut() async => session.principal = null;
}

/// Answers only for whoever is signed in, and refuses when nobody is — which is what the real
/// transport does once the token has been cleared.
class _PrincipalStoryRepository implements StoryRepository {
  _PrincipalStoryRepository(this.session, this.feeds);

  final _Session session;
  final Map<String, List<String>> feeds;

  @override
  Future<List<Story>> feed() async {
    final who = session.principal;
    if (who == null) throw const AppError(AppErrorKind.unauthenticated);
    return [
      for (final id in feeds[who]!)
        Story(
          id: id,
          body: id.replaceAll('-', ' '),
          publishedAt: DateTime.utc(2026, 10, 8),
          isViewed: false,
        ),
    ];
  }

  @override
  Future<void> markViewed(String storyId) async {}

  @override
  Future<StoryCtaTap> tapCta(String storyId) async => throw UnimplementedError();
}

class _PrincipalConversationRepository implements ConversationRepository {
  _PrincipalConversationRepository(this.session, this.feeds);

  final _Session session;
  final Map<String, List<String>> feeds;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async {
    final who = session.principal;
    if (who == null) throw const AppError(AppErrorKind.unauthenticated);
    return [
      Conversation(
        id: '$who-chat',
        kind: ConversationKind.adminDirect,
        title: '$who chat',
        updatedAt: DateTime.utc(2026, 10, 8),
      ),
    ];
  }

  @override
  Future<Conversation> byId(String conversationId) async =>
      throw UnimplementedError();

  @override
  Future<void> setPinned(String conversationId, bool pinned) async {}

  @override
  Future<void> setMuted(String conversationId, bool muted) async {}

  @override
  Future<void> setArchived(String conversationId, bool archived) async {}

  @override
  Future<void> markRead(String conversationId,
      {required int throughSequence}) async {}

  @override
  Future<List<Conversation>> search(String query) async => const [];

  @override
  Future<Conversation> openDirect(String withActorId) async =>
      throw UnimplementedError();
}
