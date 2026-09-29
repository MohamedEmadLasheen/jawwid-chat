import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/application/session_termination.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _Repo implements AuthRepository {
  @override
  Future<AuthSession> signIn({required String username, required String password}) async =>
      AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.utc(2030),
      );

  @override
  Future<AuthUser> currentUser() async =>
      const AuthUser(id: 'u1', displayName: 'Mona', role: UserRole.parent);

  @override
  Future<AuthSession> refresh(String refreshToken) async => throw UnimplementedError();

  @override
  Future<void> signOut() async {}

  @override
  Future<List<DeviceSession>> devices() async => const [];

  @override
  Future<void> revokeDevice(String deviceId) async {}

  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();
}

/// The wire itself, at the edges of its lifetime.
///
/// [SessionTermination] exists to survive an ordering problem — the transport is built before
/// the container the controller lives in — so the ways it can be wrong are all about *when*
/// it is connected, not what it carries.
void main() {
  group('binding', () {
    test('a terminal event before anything is bound is dropped, not thrown', () async {
      // The startup window. Nothing can issue a request inside it today, but an error path
      // that throws would turn a future mistake into a crash rather than a missed signal.
      final wire = SessionTermination();
      expect(wire.isBound, isFalse);
      await expectLater(
        wire.end(const AppError(AppErrorKind.sessionRevoked)),
        completes,
      );
    });

    test('unbind actually unbinds', () async {
      // It did not. `identical(o.m, o.m)` is false for tear-offs, so the identity check this
      // guard used never matched: a disposed controller stayed on the wire, and the next
      // terminal refusal would have been handed to a notifier that no longer exists.
      final seen = <AppError>[];
      Future<void> handler(AppError error) async => seen.add(error);

      final wire = SessionTermination()..bind(handler);
      await wire.end(const AppError(AppErrorKind.sessionRevoked));
      expect(seen, hasLength(1));

      wire.unbind(handler);

      expect(wire.isBound, isFalse);
      await wire.end(const AppError(AppErrorKind.accountDisabled));
      expect(seen, hasLength(1), reason: 'nothing may arrive after unbind');
    });

    test('a superseded holder cannot disconnect the live one', () async {
      // Dispose order is not something this class should depend on: whether the old
      // controller releases before or after the new one binds, the wire must end up pointing
      // at the live one.
      final oldSeen = <AppError>[];
      final newSeen = <AppError>[];
      Future<void> oldHandler(AppError e) async => oldSeen.add(e);
      Future<void> newHandler(AppError e) async => newSeen.add(e);

      final wire = SessionTermination()..bind(oldHandler);
      wire.bind(newHandler);
      wire.unbind(oldHandler); // the superseded controller's late dispose

      expect(wire.isBound, isTrue);
      await wire.end(const AppError(AppErrorKind.sessionRevoked));

      expect(newSeen, hasLength(1));
      expect(oldSeen, isEmpty);
    });
  });

  group('the controller on the wire', () {
    test('binds on build and releases on dispose', () async {
      final wire = SessionTermination();
      final provider = NotifierProvider<AuthController, AuthState>(
        () => AuthController(
          repository: _Repo(),
          tokens: InMemoryTokenStore(),
          clearLocalData: () async {},
          termination: wire,
        ),
      );

      final container = ProviderContainer();
      expect(wire.isBound, isFalse, reason: 'providers are lazy; nothing is built yet');

      container.read(provider.notifier);
      expect(wire.isBound, isTrue);

      container.dispose();
      expect(
        wire.isBound,
        isFalse,
        reason: 'a disposed controller must not stay reachable from the transport',
      );
    });

    test('a terminal event after disposal does not throw', () async {
      // The consequence of the bug above: the wire kept a dead notifier, and an in-flight
      // request completing afterwards would have set state on it.
      final wire = SessionTermination();
      final provider = NotifierProvider<AuthController, AuthState>(
        () => AuthController(
          repository: _Repo(),
          tokens: InMemoryTokenStore(),
          clearLocalData: () async {},
          termination: wire,
        ),
      );

      final container = ProviderContainer();
      container.read(provider.notifier);
      container.dispose();

      await expectLater(
        wire.end(const AppError(AppErrorKind.sessionRevoked)),
        completes,
      );
    });

    test('while alive, the wire ends the session through the controller', () async {
      final wire = SessionTermination();
      final tokens = InMemoryTokenStore();
      final provider = NotifierProvider<AuthController, AuthState>(
        () => AuthController(
          repository: _Repo(),
          tokens: tokens,
          clearLocalData: () async {},
          termination: wire,
        ),
      );

      final container = ProviderContainer();
      addTearDown(container.dispose);

      await container.read(provider.notifier).signIn(username: 'm', password: 'p');
      expect(container.read(provider), isA<AuthAuthenticated>());

      await wire.end(const AppError(AppErrorKind.sessionRevoked));

      final state = container.read(provider);
      expect(state, isA<AuthSignedOut>());
      expect((state as AuthSignedOut).reason, SignedOutReason.sessionRevoked);
      expect(await tokens.read(), isNull);
    });
  });
}
