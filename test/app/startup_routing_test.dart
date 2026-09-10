import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Regression for the defect that left the app on the splash spinner forever.
///
/// Two independent bugs produced one symptom, and neither was caught by the existing
/// suite because both live in the *startup wiring* rather than in any unit:
///
///  1. `AuthController.restore()` was written but never called, so the state machine never
///     left [AuthUnknown].
///  2. The router's redirect treated the splash as an acceptable destination for a
///     signed-out user, so even once `restore()` ran the app stayed put.
///
/// These tests drive the real router with the real controller, and assert the *location*
/// the app comes to rest at — which is the thing that was broken.
void main() {
  late FakeBackend backend;
  late InMemoryTokenStore tokens;
  late ProviderContainer container;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    tokens = InMemoryTokenStore();

    final auth = FakeAuthRepository(backend: backend, tokens: tokens);

    container = ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        authControllerProvider.overrideWith(
          () => AuthController(
            repository: auth,
            tokens: tokens,
            clearLocalData: () async {},
          ),
        ),
      ],
    );
  });

  tearDown(() {
    container.dispose();
    backend.dispose();
  });

  AuthController controller() => container.read(authControllerProvider.notifier);
  GoRouter router() => container.read(routerProvider);

  String currentLocation() =>
      router().routerDelegate.currentConfiguration.uri.path;

  /// Advance a few frames. `pumpAndSettle` cannot be used anywhere in this file: the
  /// splash screen holds an indefinite progress indicator, so the widget tree never
  /// reaches a quiescent state and `pumpAndSettle` times out by design.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  /// Mounts the real app against the real router so redirects actually run.
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

  group('the splash is a waiting state, never a destination', () {
    testWidgets('before restore runs, the app waits on the splash', (tester) async {
      await pumpApp(tester);

      expect(container.read(authControllerProvider), isA<AuthUnknown>());
      expect(currentLocation(), Routes.splash);
    });

    testWidgets(
      'with no stored session, restore moves the app off the splash to sign-in',
      (tester) async {
        await pumpApp(tester);
        expect(currentLocation(), Routes.splash);

        // This is the call that main() was missing.
        await controller().restore();
        await settle(tester);

        expect(container.read(authControllerProvider), isA<AuthSignedOut>());
        expect(
          currentLocation(),
          Routes.signIn,
          reason: 'the app must not come to rest on the splash screen',
        );
      },
    );

    testWidgets('AuthUnknown does not survive restore', (tester) async {
      await pumpApp(tester);

      await controller().restore();
      await settle(tester);

      expect(
        container.read(authControllerProvider),
        isNot(isA<AuthUnknown>()),
        reason: 'AuthUnknown is a transient startup state only',
      );
    });
  });

  group('signed-in path', () {
    testWidgets('signing in lands on Chats, not the splash', (tester) async {
      await pumpApp(tester);
      await controller().restore();
      await settle(tester);
      expect(currentLocation(), Routes.signIn);

      await controller().signIn(username: 'parent', password: 'secret');
      await settle(tester);

      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
      expect(
        currentLocation(),
        Routes.chats,
        reason: 'login goes straight to the conversations — there is no dashboard '
            'in between, and Chats is the only home this app has',
      );
    });

    testWidgets('a warm start with a stored session goes straight to Chats',
        (tester) async {
      // A session already in storage, as on a relaunch. restore() must verify it against
      // the backend and land on home without the user seeing sign-in.
      await tokens.write(
        AuthSession(
          accessToken: 'stored',
          refreshToken: 'stored',
          accessTokenExpiresAt: DateTime.utc(2030),
        ),
      );

      await pumpApp(tester);
      await controller().restore();
      await settle(tester);

      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
      expect(currentLocation(), Routes.chats);
    });

    testWidgets('the retired Home and Groups links forward into Chats',
        (tester) async {
      // Notifications, saved links and earlier installs still point at these. They must
      // land on the list that absorbed them rather than on an error page.
      await pumpApp(tester);
      await controller().restore();
      await controller().signIn(username: 'parent', password: 'secret');
      await settle(tester);

      for (final retired in [Routes.retiredHome, Routes.retiredGroups]) {
        router().go(retired);
        await settle(tester);
        expect(currentLocation(), Routes.chats, reason: '$retired must forward');
      }
      expect(tester.takeException(), isNull);
    });
  });

  group('signing out returns to sign-in', () {
    testWidgets('a signed-out user cannot come to rest anywhere protected',
        (tester) async {
      await pumpApp(tester);
      await controller().restore();
      await controller().signIn(username: 'parent', password: 'secret');
      await settle(tester);
      expect(currentLocation(), Routes.chats);

      // signOut() cancels the session-revocation subscription. Cancelling a
      // broadcast-stream subscription completes on the root zone, which the
      // widget test's fake-async zone never turns, so the await never returns
      // (a known FakeAsync limitation, not a product defect). runAsync moves
      // this one call onto the real event loop; the assertions stay identical.
      await tester.runAsync(() => controller().signOut());
      await settle(tester);

      expect(currentLocation(), Routes.signIn);
    });
  });

  group('redirect convergence', () {
    testWidgets('the redirect settles rather than looping', (tester) async {
      // A redirect that returned a location which itself redirects would blow the
      // redirect limit and throw. Reaching a stable location proves convergence.
      await pumpApp(tester);
      await controller().restore();
      await settle(tester);

      final first = currentLocation();
      await settle(tester);

      expect(currentLocation(), first);
      expect(tester.takeException(), isNull);
    });
  });
}
