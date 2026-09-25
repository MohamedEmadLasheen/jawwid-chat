/// Who owns the realtime connection, and what happens when the session changes.
///
/// The security property this file exists for: a signed-out user's realtime
/// client must be gone, and the next user must not inherit it. Everything else
/// here is the lifecycle that makes that true.
///
/// No socket is opened — [SpySocket] stands in at the W2 seam.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/calls/application/call_session.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A seam that records what the client did to it.
class SpySocket implements RealtimeSocket {
  SpySocket(this.label);

  final String label;
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

  final connectedWith = <String>[];
  int disposeCalls = 0;
  bool get isDisposed => disposeCalls > 0;

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async => connectedWith.add(token);

  @override
  Future<SubscriptionResult> subscribe(String conversationId) async =>
      const SubscriptionResult(ok: true);

  @override
  Future<void> unsubscribe(String conversationId) async {}

  @override
  Future<void> dispose() async => disposeCalls++;

  void emit(String event, Object? payload) {
    if (!_frames.isClosed) _frames.add(RealtimeFrame(event, payload));
  }

  Future<void> close() async {
    if (!_frames.isClosed) await _frames.close();
    if (!_states.isClosed) await _states.close();
  }
}

class FixedTokens implements TokenProvider {
  FixedTokens(this.token);
  final String? token;
  int accessCalls = 0;

  @override
  Future<String?> accessToken() async {
    accessCalls++;
    return token;
  }

  @override
  Future<String?> refresh() async => token;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The REAL AuthController, with a state a test can move.
///
/// Subclassed rather than replaced so the provider still holds the type the
/// application holds: what is under test is how the realtime client reacts to
/// an authentication state, and substituting a different notifier would prove
/// that reaction against something the app never uses.
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

  /// A session beginning, for [accountId].
  void authenticate(String accountId, {UserRole role = UserRole.parent}) {
    state = AuthAuthenticated(
      AuthUser(
        id: accountId,
        displayName: 'account_$accountId',
        role: role,
      ),
    );
  }

  /// A session ending: sign-out, revocation, expiry — they land here alike.
  void endSession() => state = const AuthSignedOut();
}

Map<String, Object?> acceptedPayload(String callId) => {
      'callId': callId,
      'conversationId': 'conv_1',
      'actorId': 'actor_1',
    };

void main() {
  late SpySocket socket;
  late FixedTokens tokens;
  late ScriptedAuth auth;

  ProviderContainer build({AuthState initial = const AuthSignedOut()}) {
    socket = SpySocket('one');
    tokens = FixedTokens('token-A');
    auth = ScriptedAuth(initial);
    final container = ProviderContainer(
      overrides: [
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(tokens),
        authControllerProvider.overrideWith(() => auth),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(socket.close);
    // A Notifier is not built until it is first read, and driving one before
    // that throws. Reading it here is the harness standing in for the app,
    // which reads it through the router on the first frame.
    container.read(authControllerProvider);
    return container;
  }

  // -----------------------------------------------------------------------
  group('C1/C2/C3. one client, and only when there is a session', () {
    test('C3. signed out holds no client and opens no socket', () async {
      final container = build();

      expect(container.read(callRealtimeClientProvider), isNull);
      await pumpEventQueue();
      expect(socket.connectedWith, isEmpty);
    });

    test('C3b. an unknown session — still deciding — holds no client either',
        () async {
      // Launch, while the stored session is being read. Connecting here would
      // open a socket for a user who may turn out not to be signed in.
      final container = build(initial: const AuthUnknown());

      expect(container.read(callRealtimeClientProvider), isNull);
      await pumpEventQueue();
      expect(socket.connectedWith, isEmpty);
    });

    test('C1. an authenticated session holds exactly one, connected', () async {
      final container = build();
      auth.authenticate('user-A');

      final client = container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      expect(client, isNotNull);
      expect(socket.connectedWith, ['token-A']);
    });

    test('C2. reading it repeatedly does not create a second client', () async {
      final container = build();
      auth.authenticate('user-A');

      final first = container.read(callRealtimeClientProvider);
      final second = container.read(callRealtimeClientProvider);
      final third = container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      expect(identical(first, second), isTrue);
      expect(identical(second, third), isTrue);
      // One connect, not three. Each extra would be a second live socket for
      // one user.
      expect(socket.connectedWith, hasLength(1));
    });

    test('C2b. an unrelated auth change does not churn the socket', () async {
      final container = build();
      auth.authenticate('user-A');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      // Same principal, new state object. Watching the whole auth state rather
      // than the identity would tear down and rebuild the connection here.
      auth.authenticate('user-A');
      await pumpEventQueue();

      expect(socket.connectedWith, hasLength(1));
      expect(socket.disposeCalls, 0);
    });
  });

  // -----------------------------------------------------------------------
  group('C4/C5. the session ending takes the connection with it', () {
    test('C4. signing out disposes the client', () async {
      final container = build();
      auth.authenticate('user-A');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      auth.endSession();
      expect(container.read(callRealtimeClientProvider), isNull);
      await pumpEventQueue();

      expect(socket.isDisposed, isTrue);
    });

    test('C5. events stop after the session ends', () async {
      final container = build();
      auth.authenticate('user-A');
      final seen = <CallEvent>[];
      final sub = container.read(callRealtimeClientProvider)!.events.listen(seen.add);
      addTearDown(sub.cancel);
      await pumpEventQueue();

      socket.emit(CallEventNames.accepted, acceptedPayload('before'));
      await pumpEventQueue();
      expect(seen, hasLength(1));

      auth.endSession();
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      socket.emit(CallEventNames.accepted, acceptedPayload('after'));
      await pumpEventQueue();

      // Nothing new. The listener was dropped with the client.
      expect(seen.map((e) => (e as CallAccepted).callId).toList(), ['before']);
    });

    test('C5b. the event stream is empty while signed out', () async {
      final container = build();
      final events = container.read(callEventsProvider);

      // No session is not an error — there is simply nothing to hear.
      expect(events.hasError, isFalse);
    });
  });

  // -----------------------------------------------------------------------
  group('C6/C7/C8. a new user does not inherit the previous one', () {
    test('C6/C7. the old client is disposed before the new one exists',
        () async {
      final container = build();
      auth.authenticate('user-A');
      final clientA = container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      // B signs in without an intervening signed-out state — the harsher case,
      // because nothing invites a teardown except the identity changing.
      auth.authenticate('user-B');
      final clientB = container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      expect(clientA, isNotNull);
      expect(clientB, isNotNull);
      expect(identical(clientA, clientB), isFalse);
      expect(socket.isDisposed, isTrue);
    });

    test('C7. A receives nothing after B has signed in', () async {
      final container = build();
      auth.authenticate('user-A');
      final clientA = container.read(callRealtimeClientProvider)!;
      final seenByA = <CallEvent>[];
      final sub = clientA.events.listen(seenByA.add);
      addTearDown(sub.cancel);
      await pumpEventQueue();

      auth.authenticate('user-B');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      socket.emit(CallEventNames.accepted, acceptedPayload('for-B'));
      await pumpEventQueue();

      // The security boundary. A's listener is gone, so a frame arriving after
      // the transition reaches nobody who belongs to A.
      expect(seenByA, isEmpty);
    });

    test('C8. B connects with B’s credential, never A’s', () async {
      socket = SpySocket('shared');
      final tokenByAccount = <String, String>{
        'user-A': 'token-A',
        'user-B': 'token-B',
      };
      var current = 'user-A';
      final tokensFor = _SwitchableTokens(() => tokenByAccount[current]);
      auth = ScriptedAuth(const AuthSignedOut());

      final container = ProviderContainer(
        overrides: [
          realtimeSocketProvider.overrideWithValue(socket),
          realtimeTokenProvider.overrideWithValue(tokensFor),
          authControllerProvider.overrideWith(() => auth),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(socket.close);
      container.read(authControllerProvider);

      auth.authenticate('user-A');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      current = 'user-B';
      auth.authenticate('user-B');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      expect(socket.connectedWith, ['token-A', 'token-B']);
      // Said plainly: B's connection did not carry A's credential.
      expect(socket.connectedWith.last, isNot('token-A'));
    });
  });

  // -----------------------------------------------------------------------
  group('C9/C10. what the wiring must not contain', () {
    test('C9. the client is given a token provider and no identity', () async {
      final container = build();
      auth.authenticate('user-A');
      container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      // The account id decides WHEN to hold a client. It is never sent: the
      // seam takes a token, and what arrived is the token.
      expect(socket.connectedWith.single, 'token-A');
      expect(socket.connectedWith.single, isNot(contains('user-A')));
    });

    test('C9b. no session means no connection, not an anonymous one', () async {
      socket = SpySocket('none');
      auth = ScriptedAuth(const AuthSignedOut());
      final container = ProviderContainer(
        overrides: [
          realtimeSocketProvider.overrideWithValue(socket),
          realtimeTokenProvider.overrideWithValue(FixedTokens(null)),
          authControllerProvider.overrideWith(() => auth),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(socket.close);
      container.read(authControllerProvider);

      auth.authenticate('user-A');
      final client = container.read(callRealtimeClientProvider);
      await pumpEventQueue();

      // A session exists, so a client is held — but with no credential to
      // present it opens nothing and says why.
      expect(client, isNotNull);
      expect(socket.connectedWith, isEmpty);
      expect(client!.state, CallRealtimeState.unauthorized);
    });

    test('C10. no widget owns a realtime client', () {
      // Structural, against the source: the client is constructed in exactly
      // one place, and that place is not a widget.
      final sources = <String, String>{
        for (final path in [
          'lib/features/calls/application/call_session.dart',
          'lib/app/bootstrap.dart',
          'lib/app/providers.dart',
        ])
          path: File(path).readAsStringSync(),
      };

      final constructing = sources.entries
          .where((e) => e.value.contains('CallRealtimeClient('))
          .map((e) => e.key)
          .toList();
      expect(constructing, ['lib/features/calls/application/call_session.dart']);

      // And nothing under presentation/ reaches for it at all.
      for (final file in Directory('lib/features')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.contains('/presentation/'))) {
        final source = file.readAsStringSync();
        expect(source, isNot(contains('CallRealtimeClient')), reason: file.path);
        expect(source, isNot(contains('RealtimeSocket')), reason: file.path);
      }
    });
  });
}

class _SwitchableTokens implements TokenProvider {
  _SwitchableTokens(this._token);
  final String? Function() _token;

  @override
  Future<String?> accessToken() async => _token();

  @override
  Future<String?> refresh() async => _token();

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
