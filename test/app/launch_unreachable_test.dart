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
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The launch where the phone has no signal and a session is stored.
///
/// Before AuthUnreachable this landed on the sign-in screen looking exactly like a sign-out,
/// and the only way forward was the password. Real router, real controller, as in
/// startup_routing_test.dart.
void main() {
  late FakeBackend backend;
  late InMemoryTokenStore tokens;
  late ProviderContainer container;
  late _Unreachable auth;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    tokens = InMemoryTokenStore();

    auth = _Unreachable(FakeAuthRepository(backend: backend, tokens: tokens));

    container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        // The signed-in shell holds the session's realtime client (live chat),
        // so the fixture world needs a transport too: one that opens nothing.
        realtimeSocketProvider.overrideWithValue(SilentRealtimeSocket()),
        realtimeTokenProvider.overrideWithValue(_NoTokens()),
        // Routing only: live chat (and its periodic safety resync timer) has
        // its own suites, and a periodic timer would outlive the widget tree.
        chatRealtimeProvider.overrideWithValue(null),
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


  group('a launch that cannot reach the server', () {
    testWidgets('lands on sign-in with the session kept and a retry on offer', (tester) async {
      await tokens.write(AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.utc(2030),
      ));
      auth.offline = true;

      await pumpApp(tester);
      await controller().restore();
      await settle(tester);

      expect(currentLocation(), Routes.signIn, reason: 'nothing protected renders unconfirmed');
      expect(container.read(authControllerProvider), isA<AuthUnreachable>());
      expect(find.textContaining("You're still signed in"), findsOneWidget);
      expect(await tokens.read(), isNotNull);
    });

    testWidgets('"Try again" with the network back goes straight to Chats -- no password',
        (tester) async {
      await tokens.write(AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.utc(2030),
      ));
      auth.offline = true;
      await pumpApp(tester);
      await controller().restore();
      await settle(tester);

      auth.offline = false;
      await tester.tap(find.widgetWithText(TextButton, 'Try again'));
      await settle(tester);
      await settle(tester);

      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
      expect(currentLocation(), Routes.chats);
      expect(auth.signIns, 0);
    });

    testWidgets('no stored session and no network: the ordinary sign-in, no notice',
        (tester) async {
      auth.offline = true;
      await pumpApp(tester);
      await controller().restore();
      await settle(tester);

      expect(currentLocation(), Routes.signIn);
      expect(find.textContaining("You're still signed in"), findsNothing);
    });
  });
}

/// The fixture backend, with the network switched off for `/me`.
class _Unreachable implements AuthRepository {
  _Unreachable(this._inner);

  final AuthRepository _inner;
  bool offline = false;
  int signIns = 0;

  @override
  Stream<void> get sessionRevoked => _inner.sessionRevoked;

  @override
  Future<AuthSession> signIn({required String username, required String password}) {
    signIns++;
    return _inner.signIn(username: username, password: password);
  }

  @override
  Future<AuthUser> currentUser() async {
    if (offline) throw const AppError(AppErrorKind.network, code: AppError.connectFailed);
    return _inner.currentUser();
  }

  @override
  Future<AuthSession> refresh(String refreshToken) => _inner.refresh(refreshToken);

  @override
  Future<void> signOut() => _inner.signOut();

  @override
  Future<List<DeviceSession>> devices() => _inner.devices();

  @override
  Future<void> revokeDevice(String deviceId) => _inner.revokeDevice(deviceId);
}

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
