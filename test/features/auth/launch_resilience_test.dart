import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Every way a launch can fail, and the one property they share: the auth state SETTLES.
///
/// The router holds the app on the splash for as long as the state is [AuthUnknown]. A
/// `restore()` that throws instead of settling therefore does not show an error -- it shows
/// a spinner until the app is killed. Same for a sign-in that throws: the button spins
/// forever at [AuthSigningIn]. These are the ordinary platform failures that produced that.

/// A keychain that can refuse each operation, as the Android keystore does after a backup is
/// restored onto a device that never held its key.
class _FlakyStore implements TokenStore {
  final _inner = InMemoryTokenStore();
  bool readThrows = false;
  bool writeThrows = false;
  bool clearThrows = false;
  int clears = 0;

  PlatformException get _refusal => PlatformException(code: 'keystore', message: 'refused');

  @override
  Future<AuthSession?> read() async {
    if (readThrows) throw _refusal;
    return _inner.read();
  }

  @override
  Future<void> write(AuthSession session) async {
    if (writeThrows) throw _refusal;
    await _inner.write(session);
  }

  @override
  Future<void> clear() async {
    clears++;
    if (clearThrows) throw _refusal;
    await _inner.clear();
  }
}

class _Repository implements AuthRepository {
  Object? currentUserThrows;
  Object? signOutThrows;
  int currentUserCalls = 0;
  Completer<void>? gate;

  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();

  @override
  Future<AuthSession> signIn({required String username, required String password}) async =>
      AuthSession(
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: DateTime.utc(2030),
      );

  @override
  Future<AuthUser> currentUser() async {
    currentUserCalls++;
    await gate?.future;
    final thrown = currentUserThrows;
    if (thrown != null) throw thrown;
    return const AuthUser(id: 'u1', displayName: 'parent', role: UserRole.parent);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) => throw UnimplementedError();

  @override
  Future<void> signOut() async {
    final thrown = signOutThrows;
    if (thrown != null) throw thrown;
  }

  @override
  Future<List<DeviceSession>> devices() async => const [];

  @override
  Future<void> revokeDevice(String deviceId) async {}
}

void main() {
  late _FlakyStore store;
  late _Repository repository;
  late ProviderContainer container;
  late NotifierProvider<AuthController, AuthState> provider;
  late int localDataClears;
  late int principalClears;

  setUp(() {
    store = _FlakyStore();
    repository = _Repository();
    localDataClears = 0;
    principalClears = 0;
    provider = NotifierProvider<AuthController, AuthState>(
      () => AuthController(
        repository: repository,
        tokens: store,
        clearLocalData: () async => localDataClears++,
        onSessionCleared: () async => principalClears++,
      ),
    );
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  AuthController controller() => container.read(provider.notifier);
  AuthState state() => container.read(provider);

  Future<void> storeSession() => store.write(AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.utc(2030),
      ));

  group('restore always settles', () {
    test('an unreadable keychain: signed out, never stuck on the splash', () async {
      store.readThrows = true;

      await controller().restore();

      expect(state(), isA<AuthSignedOut>());
      expect(store.clears, greaterThan(0), reason: 'what cannot be read cannot be kept');
    });

    test('an unreadable keychain that also refuses the delete still settles', () async {
      store
        ..readThrows = true
        ..clearThrows = true;

      await controller().restore();

      expect(state(), isA<AuthSignedOut>());
    });

    test('a /me that throws something other than an AppError still settles', () async {
      await storeSession();
      repository.currentUserThrows = const FormatException('unexpected shape');

      await controller().restore();

      expect(state(), isA<AuthSignedOut>());
      expect(state().isAuthenticated, isFalse);
    });

    for (final kind in [AppErrorKind.network, AppErrorKind.timeout, AppErrorKind.server]) {
      test('a transient ${kind.name} keeps the session and offers a retry', () async {
        await storeSession();
        repository.currentUserThrows = AppError(kind);

        await controller().restore();

        expect(state(), isA<AuthUnreachable>());
        expect((state() as AuthUnreachable).error?.kind, kind);
        expect(await store.read(), isNotNull);
        expect(localDataClears, 0);
      });
    }
  });

  group('retrying from unreachable', () {
    setUp(() async {
      await storeSession();
      repository.currentUserThrows = const AppError(AppErrorKind.network);
      await controller().restore();
      expect(state(), isA<AuthUnreachable>());
    });

    test('shows progress while it runs, and signs in when the server answers', () async {
      repository
        ..currentUserThrows = null
        ..gate = Completer<void>();

      final retry = controller().restore();
      await pumpEventQueue();
      expect(state(), isA<AuthUnreachable>());
      expect((state() as AuthUnreachable).retrying, isTrue);

      repository.gate!.complete();
      await retry;
      expect(state(), isA<AuthAuthenticated>());
    });

    test('a refusal on retry ends the session properly: tokens cleared, reason shown',
        () async {
      repository.currentUserThrows = const AppError(AppErrorKind.sessionRevoked);

      await controller().restore();

      expect(state(), isA<AuthSignedOut>());
      expect((state() as AuthSignedOut).reason, SignedOutReason.sessionRevoked);
      expect(await store.read(), isNull);
      expect(localDataClears, 1);
    });

    test('still offline: unreachable again, not retrying', () async {
      await controller().restore();

      expect(state(), isA<AuthUnreachable>());
      expect((state() as AuthUnreachable).retrying, isFalse);
    });

    test('two taps make one attempt', () async {
      repository
        ..currentUserThrows = null
        ..gate = Completer<void>();
      final before = repository.currentUserCalls;

      final first = controller().restore();
      final second = controller().restore();
      repository.gate!.complete();
      await Future.wait([first, second]);

      expect(repository.currentUserCalls - before, 1);
      expect(state(), isA<AuthAuthenticated>());
    });
  });

  group('sign-in always settles', () {
    test('a keychain that refuses the write: signed out with an error, not spinning',
        () async {
      store.writeThrows = true;

      await controller().signIn(username: 'u', password: 'p');

      expect(state(), isA<AuthSignedOut>());
      expect((state() as AuthSignedOut).error, isNotNull);
    });

    test('a /me that throws something other than an AppError', () async {
      repository.currentUserThrows = StateError('bad mapper');

      await controller().signIn(username: 'u', password: 'p');

      expect(state(), isA<AuthSignedOut>());
      expect(await store.read(), isNull, reason: 'the half-made session is not kept');
    });
  });

  group('ending a session cannot be stopped by one failing step', () {
    setUp(() async {
      await controller().signIn(username: 'u', password: 'p');
      expect(state(), isA<AuthAuthenticated>());
    });

    test('a keychain that refuses the delete: still signed out, and the rest still runs',
        () async {
      store.clearThrows = true;

      await controller().signOut();

      expect(state(), isA<AuthSignedOut>());
      expect(localDataClears, 1);
      expect(principalClears, 1);
    });

    test('a sign-out call that throws something other than an AppError', () async {
      repository.signOutThrows = StateError('boom');

      await controller().signOut();

      expect(state(), isA<AuthSignedOut>());
      expect(await store.read(), isNull);
    });
  });
}
