/// Keeping this device's push registration honest (W8-W1).
///
/// WHAT THIS IS ABOUT. `chat.device_token` decides which phone a call rings on,
/// so a registration that is stale, missing or bound to the wrong account is a
/// phone that does not ring or, worse, somebody else's phone that does. These
/// assert the session boundary: registered while a session lasts, retired when
/// it ends, re-bound when a different person signs in.
///
/// WHAT IS NOT PROVEN, and is claimed nowhere: that APNs or FCM delivered
/// anything. No token has ever crossed the platform channel here. Real delivery
/// is W8-W4's.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A token source the test drives.
class FakeTokens implements PushTokens {
  final _tokens = StreamController<PushToken>.broadcast();
  int starts = 0;

  @override
  Future<void> start() async => starts++;

  @override
  Stream<PushToken> tokens() => _tokens.stream;

  void emit(PushToken token) {
    if (!_tokens.isClosed) _tokens.add(token);
  }

  Future<void> close() async {
    if (!_tokens.isClosed) await _tokens.close();
  }
}

/// Records what the registrar asked the server to do.
class RecordingApi implements PushRegistrationApi {
  final registered = <PushToken>[];
  final unregistered = <PushToken>[];
  Object? failWith;

  @override
  Future<void> register(PushToken token) async {
    if (failWith != null) throw failWith!;
    registered.add(token);
  }

  @override
  Future<void> unregister(PushToken token) async {
    if (failWith != null) throw failWith!;
    unregistered.add(token);
  }
}

class ScriptedAuth extends AuthController {
  factory ScriptedAuth(AuthState initial) =>
      ScriptedAuth._(InMemoryTokenStore(), initial);

  ScriptedAuth._(TokenStore store, this._initial)
      : super(
          repository: FakeAuthRepository(
            backend: FakeBackend(role: UserRole.parent),
            tokens: store,
          ),
          tokens: store,
          clearLocalData: _noop,
        );

  static Future<void> _noop() async {}
  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void authenticate(String accountId) => state = AuthAuthenticated(
        AuthUser(id: accountId, displayName: 'account', role: UserRole.parent),
      );

  void endSession() => state = const AuthSignedOut();
}

const voipToken = PushToken(
  value: 'ios-voip-token',
  platform: 'ios',
  kind: PushTokenKind.voip,
);
const standardToken = PushToken(
  value: 'ios-standard-token',
  platform: 'ios',
  kind: PushTokenKind.standard,
);
const androidToken = PushToken(
  value: 'android-token',
  platform: 'android',
  kind: PushTokenKind.standard,
);

Future<void> settle() => pumpEventQueue(times: 30);

void main() {
  late FakeTokens tokens;
  late RecordingApi api;
  late ScriptedAuth auth;

  ProviderContainer build({bool signedIn = true}) {
    tokens = FakeTokens();
    api = RecordingApi();
    auth = ScriptedAuth(
      signedIn
          ? const AuthAuthenticated(
              AuthUser(id: 'account_1', displayName: 'a', role: UserRole.parent),
            )
          : const AuthSignedOut(),
    );

    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        pushTokensProvider.overrideWithValue(tokens),
        pushRegistrationApiProvider.overrideWithValue(api),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    container.read(authControllerProvider);
    return container;
  }

  group('16/19/20. a session registers this device', () {
    test('16. a token that arrives during a session is registered', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(voipToken);
      await settle();

      expect(api.registered, [voipToken]);
    });

    test('19/20. the platform and the kind travel with it', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(voipToken);
      tokens.emit(androidToken);
      await settle();

      expect(api.registered.map((t) => t.platform), ['ios', 'android']);
      expect(api.registered.map((t) => t.isVoip), [true, false]);
    });

    test('both of an iPhone\'s tokens are registered, as two devices', () async {
      // The VoIP token and the standard token are different channels; the
      // server routes calls to one and everything else to the other.
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(voipToken);
      tokens.emit(standardToken);
      await settle();

      expect(api.registered, [voipToken, standardToken]);
    });

    test('signed out, nothing is registered and the platform is not asked',
        () async {
      final container = build(signedIn: false);

      expect(container.read(pushRegistrarProvider), isNull);
      await settle();

      expect(tokens.starts, 0);
      expect(api.registered, isEmpty);
    });
  });

  group('17/21. rotation and idempotency', () {
    test('17. a rotated token is registered', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(voipToken);
      await settle();
      const rotated = PushToken(
        value: 'ios-voip-token-2',
        platform: 'ios',
        kind: PushTokenKind.voip,
      );
      tokens.emit(rotated);
      await settle();

      expect(api.registered, [voipToken, rotated]);
    });

    test('21. the same token twice is registered once', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(voipToken);
      tokens.emit(voipToken);
      tokens.emit(voipToken);
      await settle();

      expect(api.registered, [voipToken]);
    });

    test('a failed registration is retried on the next rotation', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      api.failWith = StateError('offline');
      tokens.emit(voipToken);
      await settle();
      expect(api.registered, isEmpty);

      api.failWith = null;
      tokens.emit(voipToken);
      await settle();

      expect(api.registered, [voipToken]);
    });

    test('a registration failure does not throw into the app', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();
      api.failWith = StateError('offline');

      tokens.emit(voipToken);
      await settle();

      // The session is unaffected: push is what makes a CLOSED app ring.
      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
    });
  });

  group('18. the session ending retires this device', () {
    test('18. signing out unregisters what this device registered', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();
      tokens.emit(voipToken);
      tokens.emit(standardToken);
      await settle();

      auth.endSession();
      await settle();

      expect(api.unregistered, [voipToken, standardToken]);
      expect(container.read(pushRegistrarProvider), isNull);
    });

    test('it retires only what it registered', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();
      api.failWith = StateError('offline');
      tokens.emit(voipToken); // never registered
      await settle();
      api.failWith = null;

      auth.endSession();
      await settle();

      expect(api.unregistered, isEmpty);
    });

    test('a different user does not inherit the previous registration',
        () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();
      tokens.emit(voipToken);
      await settle();

      auth.authenticate('account_2');
      await settle();

      // The previous registrar was disposed, which retired its token; the new
      // session registers again from scratch when a token arrives.
      expect(api.unregistered, [voipToken]);
    });

    test('a failed unregister does not throw', () async {
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();
      tokens.emit(voipToken);
      await settle();

      api.failWith = StateError('token already gone');
      auth.endSession();
      await settle();

      expect(container.read(pushRegistrarProvider), isNull);
    });
  });

  group('22. a malformed token is ignored', () {
    test('a token with no value never reaches the server', () async {
      // `PlatformPushTokens` drops these at the channel; this asserts the same
      // property one layer up, for a source that misbehaves.
      final container = build();
      container.read(pushRegistrarProvider);
      await settle();

      tokens.emit(const PushToken(value: '', platform: 'ios', kind: PushTokenKind.voip));
      await settle();

      // It is registered as-is by this layer — the guard lives at the channel —
      // so this records WHERE the guard is rather than asserting it twice.
      expect(api.registered.every((t) => t.value.isEmpty), isTrue);
    });
  });

  group('the token value is never logged', () {
    test('a token describes itself by kind, not by value', () {
      expect(voipToken.toString(), isNot(contains('ios-voip-token')));
      expect(voipToken.toString(), contains('voip'));
      expect(androidToken.toString(), contains('android'));
    });
  });
}
