import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/notifications/push_messaging.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Notifications are WIRED, not merely written (F-2).
///
/// The closure audit found `NotificationNavigator` and `PushPayload` correct,
/// tested, and instantiated by nothing but their own test — so tapping a
/// notification did what it did before any of it existed: opened the app
/// wherever it happened to be. Every unit test passed throughout, because every
/// unit worked and nothing connected them.
///
/// These tests therefore drive the REAL `startNotifications` and assert that a
/// tap reaches a ROUTER. That has already been undone once in this repository —
/// a concurrent agent deleted the wiring while unwinding an accidental sweep of
/// it — so this file exists to make the next such removal fail loudly.
///
/// WHAT IS AND IS NOT UNDER TEST. The wiring: messaging → navigator → router,
/// token → repository, sign-out → retirement. NOT the destination screen, which
/// is why the router here carries stub routes rather than the app's real ones:
/// mounting `ChatScreenRoute` would drag in the realtime client, the outbox and
/// an indefinite progress indicator, and the test would then be about whether a
/// chat screen settles. The real router's own redirect rules are covered by
/// `startup_routing_test.dart`, and the navigator's authentication gate by
/// `deep_link_test.dart`.
class _ScriptedMessaging implements PushMessaging {
  _ScriptedMessaging({this.launchTap});

  final Map<String, Object?>? launchTap;
  final _taps = StreamController<Map<String, Object?>>.broadcast();
  final _tokens = StreamController<String>.broadcast();
  bool started = false;

  void tap(Map<String, Object?> data) => _taps.add(data);
  void emitToken(String token) => _tokens.add(token);

  @override
  Future<void> start() async => started = true;

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<Map<String, Object?>> get taps => _taps.stream;

  @override
  Stream<Map<String, Object?>> get foregroundMessages => const Stream.empty();

  @override
  Future<Map<String, Object?>?> initialTap() async => launchTap;

  @override
  Future<void> stop() async {
    await _taps.close();
    await _tokens.close();
  }
}

class _RecordingNotifications implements NotificationRepository {
  final registered = <String>[];
  final unregistered = <String>[];

  @override
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip = false,
    String? locale,
  }) async =>
      registered.add(token);

  @override
  Future<void> unregisterDevice(String token) async => unregistered.add(token);
}

/// A router with the app's real PATHS and trivial screens.
///
/// The paths come from [Routes], so a change to the URL shape breaks this test
/// rather than silently sending taps somewhere that no longer exists.
GoRouter _stubRouter() => GoRouter(
      initialLocation: Routes.splash,
      routes: [
        GoRoute(path: Routes.splash, builder: (_, _) => const SizedBox()),
        GoRoute(path: Routes.signIn, builder: (_, _) => const SizedBox()),
        GoRoute(path: Routes.home, builder: (_, _) => const SizedBox()),
        GoRoute(
          path: '${Routes.chats}/:conversationId',
          builder: (_, _) => const SizedBox(),
        ),
      ],
    );

void main() {
  late FakeBackend backend;
  late InMemoryTokenStore tokens;
  late _RecordingNotifications notifications;
  late GoRouter router;

  ProviderContainer containerWith(PushMessaging messaging) {
    backend = FakeBackend(role: UserRole.parent);
    tokens = InMemoryTokenStore();
    notifications = _RecordingNotifications();
    router = _stubRouter();
    final auth = FakeAuthRepository(backend: backend, tokens: tokens);

    return ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        notificationRepositoryProvider.overrideWithValue(notifications),
        pushMessagingProvider.overrideWithValue(messaging),
        routerProvider.overrideWithValue(router),
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

  String location() => router.routerDelegate.currentConfiguration.uri.path;

  /// A minimal mount, so the router actually has a location.
  ///
  /// GoRouter's delegate reports nothing until a Router widget drives it. The
  /// screens are `SizedBox`es on purpose: mounting the app's real ones would
  /// drag in the realtime client, the outbox and an indefinite progress
  /// indicator, and the test would become about whether a chat screen settles.
  Future<void> mount(WidgetTester tester, ProviderContainer container) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump();
  }

  Future<void> signIn(ProviderContainer container) =>
      container.read(authControllerProvider.notifier).signIn(
            username: 'parent@example.test',
            password: 'a-long-enough-password',
          );

  /// Let the stream subscriptions and the router's own microtasks run.
  Future<void> settle(WidgetTester tester) async {
    await tester.pump(const Duration(milliseconds: 10));
    await tester.pump();
  }

  tearDown(() => backend.dispose());

  testWidgets('a WARM tap reaches the router', (tester) async {
    final messaging = _ScriptedMessaging();
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await signIn(container);
    await mount(tester, container);
    await startNotifications(container);

    messaging.tap({'eventType': 'message_published', 'conversationId': 'c-42'});
    await settle(tester);

    expect(
      location(),
      '/chats/c-42',
      reason: 'the tap must reach the ROUTER, not merely the navigator',
    );
    await messaging.stop();
  });

  testWidgets('a COLD-START tap is held, then honoured once the session resolves', (tester) async {
    // The notification that launched the process: there is no navigator, no
    // session and no router when the platform hands this over.
    final messaging = _ScriptedMessaging(
      launchTap: {'eventType': 'message_published', 'conversationId': 'c-7'},
    );
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await mount(tester, container);
    await startNotifications(container);
    await settle(tester);

    // Signed out: the destination is HELD, not opened and not discarded.
    expect(location(), isNot('/chats/c-7'));

    await signIn(container);
    await settle(tester);

    expect(location(), '/chats/c-7');
    await messaging.stop();
  });

  testWidgets('a call notification routes to its conversation, not to a message screen',
      (tester) async {
    final messaging = _ScriptedMessaging();
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await signIn(container);
    await mount(tester, container);
    await startNotifications(container);

    messaging.tap({
      'eventType': 'call_started',
      'conversationId': 'c-9',
      'callId': 'call-1',
    });
    await settle(tester);

    // There is no call screen yet, so a call opens the conversation it belongs
    // to. Named in one place (PushDestination.OpenIncomingCall) so it is
    // visible rather than lost.
    expect(location(), '/chats/c-9');
    await messaging.stop();
  });

  testWidgets('a payload with no destination navigates nowhere', (tester) async {
    final messaging = _ScriptedMessaging();
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await signIn(container);
    await mount(tester, container);
    await startNotifications(container);
    final before = location();

    // A payment reminder is a real notification with no in-app screen. Tapping
    // it opens the app, which is what the user asked for — it is not an error.
    messaging.tap({'eventType': 'payment_due'});
    await settle(tester);

    expect(location(), before);
    await messaging.stop();
  });

  testWidgets('the device token is registered through the real activation path', (tester) async {
    final messaging = _ScriptedMessaging();
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await signIn(container);
    await mount(tester, container);
    await startNotifications(container);

    messaging.emitToken('tok-abc');
    await settle(tester);

    expect(notifications.registered, ['tok-abc']);
    await messaging.stop();
  });

  // No router mount: this asserts the ACTIVATION wired sign-out to token
  // retirement, and nothing about navigation. Mounting one here made the test
  // hang on the sign-out redirect, which would have been a test about GoRouter.
  test('signing out retires the token', () async {
    final messaging = _ScriptedMessaging();
    final container = containerWith(messaging);
    addTearDown(container.dispose);

    await signIn(container);
    await startNotifications(container);
    messaging.emitToken('tok-abc');
    await Future<void>.delayed(const Duration(milliseconds: 10));

    await container.read(authControllerProvider.notifier).signOut();
    await Future<void>.delayed(const Duration(milliseconds: 10));

    // The next person to sign in on this handset must not receive the previous
    // account's notifications.
    expect(notifications.unregistered, ['tok-abc']);
    await messaging.stop();
  });

  testWidgets('a build with push disabled activates without error', (tester) async {
    final container = containerWith(const DisabledPushMessaging());
    addTearDown(container.dispose);

    await signIn(container);
    await mount(tester, container);

    // No Firebase, no token, no taps — and no crash. A build without push is
    // degraded, not broken.
    await expectLater(startNotifications(container), completes);
    expect(notifications.registered, isEmpty);
  });
}
