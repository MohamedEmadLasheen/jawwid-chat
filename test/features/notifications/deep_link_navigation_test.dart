import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/push/push_registrar.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_connection.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import '../../support/auth_harness.dart';

/// FOLLOWING A TAP, FROM EVERY STATE THE APP CAN BE IN.
///
/// `PushRegistrar` decides WHERE a tap should go; this is the half that
/// actually goes there. It is the piece with the awkward cases, because a tap
/// does not wait for the app to be ready:
///
///   RUNNING       the link arrives on a stream and is followed at once.
///   TERMINATED    the OS started the process BECAUSE of the tap, so the route
///                 was read before the router existed and is held.
///   SIGNED OUT    following it would land on a screen the redirect instantly
///                 replaces, losing the link -- so it is kept until there is a
///                 session, and followed after signing in.
///
/// The rule underneath all three: a tap is never silently dropped, and never
/// followed twice.
void main() {
  /// The app's real router, with the real navigator in it, over fakes.
  ({
    Widget app,
    PushRegistrar registrar,
    InertPushTokens tokens,
    TestAuthController auth,
    ProviderContainer container,
  }) harness({required bool signedIn, PushPayload? launchPayload}) {
    final repository = FakeNotificationRepository();
    addTearDown(repository.dispose);
    final realtime = InertRealtimeClient();
    addTearDown(realtime.dispose);
    final tokens = InertPushTokens(availableToken: 'device-token')
      ..permission = PushPermission.granted
      ..launchPayload = launchPayload;
    addTearDown(tokens.dispose);

    final auth = TestAuthController(
      initial: signedIn ? signedInParent : const AuthSignedOut(),
    );

    // The router is built first and handed to the container, because the
    // navigator reads it from `routerProvider` rather than from the context --
    // see the comment on PushDeepLinkNavigator for why it cannot use the
    // context.
    final router = GoRouter(
      initialLocation: Routes.chats,
      routes: [
        GoRoute(path: Routes.chats, builder: (_, _) => const _Screen('chats')),
        GoRoute(path: Routes.signIn, builder: (_, _) => const _Screen('sign-in')),
        GoRoute(
          path: '${Routes.chats}/:id',
          builder: (_, state) => _Screen('thread:${state.pathParameters['id']}'),
        ),
        GoRoute(
          path: Routes.notifications,
          builder: (_, _) => const _Screen('centre'),
        ),
        GoRoute(
          path: '/announcements/:id',
          builder: (_, state) => _Screen('announcement:${state.pathParameters['id']}'),
        ),
      ],
    );

    final container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        notificationRepositoryProvider.overrideWithValue(repository),
        realtimeClientProvider.overrideWithValue(realtime),
        pushTokensProvider.overrideWithValue(tokens),
        authControllerProvider.overrideWith(() => auth),
        routerProvider.overrideWithValue(router),
      ],
    );
    addTearDown(container.dispose);

    final registrar = container.read(pushRegistrarProvider);

    final app = UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        // Mounted exactly where the app mounts it: inside MaterialApp.router's
        // builder, which is under the router's context -- so a tap that started
        // a terminated app has somewhere to navigate to on the first frame.
        builder: (context, child) => PushDeepLinkNavigator(
          child: child ?? const SizedBox.shrink(),
        ),
        locale: const Locale('ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    );

    return (
      app: app,
      registrar: registrar,
      tokens: tokens,
      auth: auth,
      container: container,
    );
  }

  /// A tap, driven through the real seam: the OS hands the payload to
  /// PushTokens, the registrar resolves a route from it, and the navigator
  /// follows. Nothing here reaches past the registrar to push a route directly.
  PushPayload tap(String conversationId) =>
      PushPayload(data: {'notificationId': 'n-$conversationId', 'conversationId': conversationId});

  Finder screen(String name) => find.byKey(ValueKey('screen:$name'));

  group('the app is RUNNING', () {
    testWidgets('a tap navigates, with no interaction from the parent', (tester) async {
      final h = harness(signedIn: true);
      await h.registrar.start();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();
      expect(screen('chats'), findsOneWidget);

      h.tokens.tap(tap('c7'));
      await tester.pumpAndSettle();

      expect(screen('thread:c7'), findsOneWidget);
    });

    testWidgets('two taps in a row go to two places, not one', (tester) async {
      final h = harness(signedIn: true);
      await h.registrar.start();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.tokens.tap(tap('c1'));
      await tester.pumpAndSettle();
      h.tokens.tap(const PushPayload(
        data: {'notificationId': 'n2', 'announcementId': 'a9'},
      ));
      await tester.pumpAndSettle();

      expect(screen('announcement:a9'), findsOneWidget);
    });

    testWidgets('a tap is not followed twice', (tester) async {
      final h = harness(signedIn: true);
      await h.registrar.start();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      // The registrar holds it AND streams it, which is what the terminated
      // case needs. The running case must not then follow it a second time
      // when something else drains the hold.
      h.tokens.tap(tap('c3'));
      await tester.pumpAndSettle();

      expect(screen('thread:c3'), findsOneWidget);
      // Taken by the stream handler, so nothing is left for a later drain to
      // push on top of it.
      expect(h.registrar.pendingDeepLink, isNull);
    });
  });

  group('the app was TERMINATED and the tap started it', () {
    testWidgets('the held route is followed on the first frame', (tester) async {
      // The launch payload IS the case: the OS started this process because of
      // the tap, so the route is read by the registrar before there is a router
      // to give it to.
      final h = harness(
        signedIn: true,
        launchPayload: const PushPayload(
          data: {'notificationId': 'n9', 'conversationId': 'c42'},
        ),
      );
      await h.registrar.start();

      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      expect(screen('thread:c42'), findsOneWidget);
      expect(h.registrar.pendingDeepLink, isNull);
    });

    testWidgets('an ordinary launch goes nowhere in particular', (tester) async {
      final h = harness(signedIn: true);
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      expect(screen('chats'), findsOneWidget);
    });
  });

  group('the app is SIGNED OUT', () {
    testWidgets('the link is kept rather than followed', (tester) async {
      final h = harness(signedIn: false);
      await h.registrar.start();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.tokens.tap(tap('c5'));
      await tester.pumpAndSettle();

      // Not navigated: the thread would be replaced by the sign-in redirect and
      // the link would be gone. Held instead.
      expect(screen('thread:c5'), findsNothing);
      expect(h.registrar.pendingDeepLink, isNotNull);
    });

    testWidgets('and is followed once they sign in', (tester) async {
      final h = harness(signedIn: false);
      await h.registrar.start();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.tokens.tap(tap('c5'));
      await tester.pumpAndSettle();

      // They sign in. The parent arrives where the notification was taking
      // them, rather than on the chat list wondering what buzzed.
      h.container.read(authControllerProvider);
      h.auth.set(signedInParent);
      await tester.pumpAndSettle();

      expect(screen('thread:c5'), findsOneWidget);
      expect(h.registrar.pendingDeepLink, isNull);
    });

    testWidgets('signing in with nothing held goes nowhere in particular',
        (tester) async {
      final h = harness(signedIn: false);
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.container.read(authControllerProvider);
      h.auth.set(signedInParent);
      await tester.pumpAndSettle();

      expect(screen('chats'), findsOneWidget);
    });
  });
}

class _Screen extends StatelessWidget {
  const _Screen(this.name);

  final String name;

  @override
  Widget build(BuildContext context) => Scaffold(
        key: ValueKey('screen:$name'),
        body: Center(child: Text(name)),
      );
}
