import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository({this.role = UserRole.parent});

  final UserRole role;

  AppError? signInError;
  AppError? currentUserError;
  bool signOutThrows = false;

  int signInCalls = 0;
  int signOutCalls = 0;

  final _revoked = StreamController<void>.broadcast();

  void revoke() => _revoked.add(null);
  Future<void> dispose() => _revoked.close();

  @override
  Stream<void> get sessionRevoked => _revoked.stream;

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    signInCalls++;
    final error = signInError;
    if (error != null) throw error;

    return AuthSession(
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresAt: DateTime.utc(2030),
    );
  }

  @override
  Future<AuthUser> currentUser() async {
    final error = currentUserError;
    if (error != null) throw error;
    return AuthUser(id: 'u1', displayName: 'ولي أمر', role: role);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async =>
      throw UnimplementedError();

  @override
  Future<void> signOut() async {
    signOutCalls++;
    if (signOutThrows) throw const AppError(AppErrorKind.network);
  }

  @override
  Future<List<DeviceSession>> devices() async => const [];

  @override
  Future<void> revokeDevice(String deviceId) async {}
}

void main() {
  late _FakeAuthRepository repository;
  late InMemoryTokenStore tokens;
  late int clearCalls;
  late ProviderContainer container;
  late NotifierProvider<AuthController, AuthState> provider;

  setUp(() {
    repository = _FakeAuthRepository();
    tokens = InMemoryTokenStore();
    clearCalls = 0;

    provider = NotifierProvider<AuthController, AuthState>(
      () => AuthController(
        repository: repository,
        tokens: tokens,
        clearLocalData: () async => clearCalls++,
      ),
    );
    container = ProviderContainer();
  });

  tearDown(() async {
    container.dispose();
    await repository.dispose();
  });

  AuthController controller() => container.read(provider.notifier);

  group('sign in', () {
    test('a successful sign-in stores tokens and exposes the server role', () async {
      await controller().signIn(username: 'parent', password: 'secret');

      final state = container.read(provider);
      expect(state, isA<AuthAuthenticated>());
      expect(state.user?.role, UserRole.parent);
      expect(await tokens.read(), isNotNull);
    });

    test('bad credentials leave no stored session', () async {
      repository.signInError = const AppError(AppErrorKind.unauthenticated);

      await controller().signIn(username: 'parent', password: 'wrong');

      final state = container.read(provider);
      expect(state, isA<AuthSignedOut>());
      expect(
        await tokens.read(),
        isNull,
        reason: 'a failed sign-in must not leave credentials behind',
      );
    });

    test('a disabled account is reported distinctly from bad credentials', () async {
      repository.signInError = const AppError(
        AppErrorKind.accountDisabled,
        code: 'account_disabled',
      );

      await controller().signIn(username: 'parent', password: 'secret');

      final state = container.read(provider) as AuthSignedOut;
      expect(state.reason, SignedOutReason.accountDisabled);
    });
  });

  group('restore on launch', () {
    test('starts in an undecided state so login does not flash', () {
      expect(container.read(provider), isA<AuthUnknown>());
    });

    test('with no stored session, restores to signed out', () async {
      await controller().restore();
      expect(container.read(provider), isA<AuthSignedOut>());
    });

    test('a stored token is verified against the backend, not trusted', () async {
      await tokens.write(
        AuthSession(
          accessToken: 'stale',
          refreshToken: 'stale',
          accessTokenExpiresAt: DateTime.utc(2030),
        ),
      );
      repository.currentUserError = const AppError(AppErrorKind.sessionRevoked);

      await controller().restore();

      final state = container.read(provider) as AuthSignedOut;
      expect(state.reason, SignedOutReason.sessionRevoked);
      expect(await tokens.read(), isNull);
      expect(clearCalls, 1, reason: 'cached data must be dropped with the session');
    });

    test('a network failure at launch does not destroy the stored session', () async {
      await tokens.write(
        AuthSession(
          accessToken: 'good',
          refreshToken: 'good',
          accessTokenExpiresAt: DateTime.utc(2030),
        ),
      );
      repository.currentUserError = const AppError(AppErrorKind.network);

      await controller().restore();

      expect(container.read(provider), isA<AuthSignedOut>());
      expect(
        await tokens.read(),
        isNotNull,
        reason: 'offline at launch is not a sign-out',
      );
      expect(clearCalls, 0);
    });
  });

  group('ending a session', () {
    test('sign-out clears tokens and cached data', () async {
      await controller().signIn(username: 'parent', password: 'secret');
      await controller().signOut();

      expect(container.read(provider), isA<AuthSignedOut>());
      expect(await tokens.read(), isNull);
      expect(clearCalls, 1);
    });

    test('a failed sign-out call still signs the user out locally', () async {
      await controller().signIn(username: 'parent', password: 'secret');
      repository.signOutThrows = true;

      await controller().signOut();

      expect(container.read(provider), isA<AuthSignedOut>());
      expect(await tokens.read(), isNull);
    });

    test('backend revocation ends the session without user action', () async {
      await controller().signIn(username: 'parent', password: 'secret');
      expect(container.read(provider), isA<AuthAuthenticated>());

      repository.revoke();
      await Future<void>.delayed(Duration.zero);

      final state = container.read(provider) as AuthSignedOut;
      expect(state.reason, SignedOutReason.sessionRevoked);
      expect(await tokens.read(), isNull);
      expect(clearCalls, 1);
    });

    test('a terminal error routed from the network layer ends the session', () async {
      await controller().signIn(username: 'parent', password: 'secret');

      await controller().onSessionEnded(
        const AppError(AppErrorKind.accountDisabled),
      );

      final state = container.read(provider) as AuthSignedOut;
      expect(state.reason, SignedOutReason.accountDisabled);
      expect(clearCalls, 1);
    });
  });
}
