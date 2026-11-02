// PARENT-021 (P2): "View payments" on a payment notification crashed the parent
// app (`!keyReservation.contains(key)`; a grey screen in release). The
// Notification Center is pushed over the tab shell, and it PUSHED its target:
// /settings/payments forwards to the Subscriptions tab, so a second page with
// the tab's key landed on the stack. A tab is now gone to; a page that is not a
// tab (a conversation, a child's schedule) is still pushed, with a Back.
//
// The real app router, signed in as a parent, from Chats -> the bell -> each
// kind of notification button.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/realtime_keeper.dart';
import 'package:jawwid_chat/features/notifications/data/notifications_repository.dart';
import 'package:jawwid_chat/features/notifications/domain/inbox.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

InboxEntry _entry(String id, InboxAction action) => InboxEntry(
      id: id,
      category: 'payment',
      title: 'Entry $id',
      body: 'body',
      at: DateTime(2026, 11, 1, 9),
      read: false,
      action: action,
    );

void main() {
  late FakeBackend backend;
  late ProviderContainer container;

  setUp(() async {
    backend = FakeBackend(role: UserRole.parent);
    final tokens = InMemoryTokenStore();
    final auth = FakeAuthRepository(backend: backend, tokens: tokens);
    container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        realtimeSocketProvider.overrideWithValue(SilentRealtimeSocket()),
        realtimeTokenProvider.overrideWithValue(_NoTokens()),
        chatRealtimeProvider.overrideWithValue(null),
        realtimeKeeperProvider.overrideWithValue(null),
        notificationsRepositoryProvider.overrideWithValue(FakeNotificationsRepository(
          entries: [
            _entry('pay', const InboxAction(InboxActionKind.viewPayments)),
            _entry('calls', const InboxAction(InboxActionKind.openCalls)),
            _entry('stories', const InboxAction(InboxActionKind.openStories)),
            _entry('lesson', const InboxAction(InboxActionKind.viewLesson, lessonId: 'l1', learnerId: 'child-1')),
          ],
          tabs: const [InboxTab.all],
        )),
        authControllerProvider.overrideWith(
          () => AuthController(repository: auth, tokens: tokens, clearLocalData: () async {}),
        ),
      ],
    );
    await container.read(authControllerProvider.notifier).signIn(username: 'parent', password: 'secret');
  });

  tearDown(() {
    container.dispose();
    backend.dispose();
  });

  GoRouter router() => container.read(routerProvider);
  /// The page on TOP: after a push, the configuration's uri is still the page beneath.
  String location() => router().routerDelegate.currentConfiguration.last.matchedLocation;

  /// No pumpAndSettle: the shell keeps progress indicators running.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
  }

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          routerConfig: router(),
          locale: const Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
        ),
      ),
    );
    await settle(tester);
  }

  /// Chats, then the bell (the Center is pushed over the shell), then [id]'s button.
  Future<void> openFrom(WidgetTester tester, String id) async {
    router().go(Routes.chats);
    await settle(tester);
    unawaited(router().push(Routes.notifications));
    await settle(tester);
    expect(location(), Routes.notifications);
    await tester.tap(find.byKey(ValueKey('notification-action-$id')));
    await settle(tester);
  }

  testWidgets('"View payments" lands on Subscriptions, with no duplicate page', (tester) async {
    await pumpApp(tester);
    await openFrom(tester, 'pay');
    expect(tester.takeException(), isNull);
    expect(location(), Routes.subscriptions);
  });

  testWidgets('every tab a notification opens is gone to, never pushed over the shell', (tester) async {
    await pumpApp(tester);
    for (final (id, tab) in [('calls', Routes.calls), ('stories', Routes.chats), ('pay', Routes.subscriptions)]) {
      await openFrom(tester, id);
      expect(tester.takeException(), isNull, reason: id);
      expect(location(), tab, reason: id);
    }
  });

  testWidgets('a page that is not a tab is still pushed, with a Back to the Center', (tester) async {
    await pumpApp(tester);
    await openFrom(tester, 'lesson');
    expect(tester.takeException(), isNull);
    expect(location(), Routes.childSchedule('child-1'));
    expect(router().canPop(), isTrue);
  });

  test('the tab list matches the shell: every page directly in the ShellRoute is a tab', () {
    final shell = router().configuration.routes.whereType<ShellRoute>().single;
    final paths = {for (final r in shell.routes.whereType<GoRoute>()) r.path};
    expect(paths.difference(shellTabPaths), isEmpty, reason: 'a new tab must be added to shellTabPaths');
    expect(shellTabPaths.difference(paths), {Routes.myPayments}, reason: 'only the forwarding address is not in the shell itself');
  });

  test('routeFor targets are classified: tabs gone to, details pushed', () {
    expect(isShellTab(Routes.myPayments), isTrue);
    expect(isShellTab('${Routes.subscriptions}?child=c1'), isTrue);
    expect(isShellTab(Routes.conversation('c1')), isFalse);
    expect(isShellTab(Routes.childSchedule('c1')), isFalse);
    expect(isShellTab(Routes.schedule), isTrue);
    expect(isShellTab(Routes.salesPayments), isTrue);
  });
}
