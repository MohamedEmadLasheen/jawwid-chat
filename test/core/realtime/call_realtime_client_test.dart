/// The realtime client's lifecycle, listener discipline and security posture.
///
/// No socket is opened. [FakeRealtimeSocket] stands in at the seam, which is
/// what lets these tests assert things a real connection could not be made to
/// demonstrate deterministically -- that a reconnect does not double-deliver,
/// that dispose is idempotent, that a refused subscription is not retried.
///
/// What is NOT proven here is the wire: that socket.io's handshake reaches this
/// server, that `auth: { token }` is read, that a room join actually happens.
/// Those need a running gateway and are recorded as unverified.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';

const _conversationId = '22222222-2222-2222-2222-222222222222';

class FakeRealtimeSocket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

  final connectedWith = <String>[];
  final subscribed = <String>[];
  final unsubscribed = <String>[];
  int disposeCalls = 0;

  /// Conversations the "server" refuses, with the code it refuses them with.
  final refusals = <String, String>{};

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async => connectedWith.add(token);

  @override
  Future<SubscriptionResult> subscribe(String conversationId) async {
    subscribed.add(conversationId);
    final code = refusals[conversationId];
    return code == null
        ? const SubscriptionResult(ok: true)
        : SubscriptionResult(ok: false, code: code);
  }

  @override
  Future<void> unsubscribe(String conversationId) async =>
      unsubscribed.add(conversationId);

  @override
  Future<void> dispose() async => disposeCalls++;

  // Test drivers.
  void emit(String event, Object? payload) =>
      _frames.add(RealtimeFrame(event, payload));

  void moveTo(RealtimeSocketState state) => _states.add(state);

  Future<void> close() async {
    await _frames.close();
    await _states.close();
  }
}

class FakeTokens implements TokenProvider {
  FakeTokens(this._token, {String? renewsTo, this.renewable = true})
      : _renewed = renewsTo;

  String? _token;
  final String? _renewed;

  /// Whether the session can be renewed at all. False stands in for a refresh
  /// token the server has rejected.
  final bool renewable;

  int accessCalls = 0;
  int refreshCalls = 0;

  @override
  Future<String?> accessToken() async {
    accessCalls++;
    return _token;
  }

  @override
  Future<String?> refresh() async {
    refreshCalls++;
    if (!renewable) return null;
    // A real refresh replaces the access token, so a later connect uses it.
    if (_renewed != null) _token = _renewed;
    return _token;
  }

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// A refresh a test can hold open, to land a dispose in the middle of it.
class SlowTokens implements TokenProvider {
  SlowTokens(this._token, this._renewed);

  String? _token;
  final String _renewed;
  final _gate = Completer<void>();
  int refreshCalls = 0;

  void releaseRefresh() => _gate.complete();

  @override
  Future<String?> accessToken() async => _token;

  @override
  Future<String?> refresh() async {
    refreshCalls++;
    await _gate.future;
    _token = _renewed;
    return _token;
  }

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

Map<String, Object?> _accepted(String callId) => {
      'callId': callId,
      'conversationId': _conversationId,
      'actorId': '33333333-3333-3333-3333-333333333333',
    };

void main() {
  late FakeRealtimeSocket socket;
  late FakeTokens tokens;
  late CallRealtimeClient client;

  setUp(() {
    socket = FakeRealtimeSocket();
    tokens = FakeTokens('fake-access-token');
    client = CallRealtimeClient(socket: socket, tokens: tokens);
  });

  tearDown(() async {
    await client.dispose();
    await socket.close();
  });

  group('A. authentication', () {
    test('connects with the token from the existing session provider', () async {
      await client.connect();

      expect(tokens.accessCalls, 1);
      expect(socket.connectedWith, ['fake-access-token']);
    });

    test('without a session it does not connect at all', () async {
      final anonymous = CallRealtimeClient(
        socket: socket,
        tokens: FakeTokens(null),
      );
      addTearDown(anonymous.dispose);

      await anonymous.connect();

      // No anonymous downgrade: nothing was opened.
      expect(socket.connectedWith, isEmpty);
      expect(anonymous.state, CallRealtimeState.unauthorized);
    });

    test('an empty token is treated as no session', () async {
      final empty = CallRealtimeClient(socket: socket, tokens: FakeTokens(''));
      addTearDown(empty.dispose);

      await empty.connect();

      expect(socket.connectedWith, isEmpty);
      expect(empty.state, CallRealtimeState.unauthorized);
    });

    test('nothing but the token is sent — there is no actorId path', () async {
      await client.connect();

      // The seam takes a token and nothing else. The server reads identity from
      // that token alone (`realtime.gateway.ts` handshakeToken), and there is
      // no parameter here through which a client could name itself.
      expect(socket.connectedWith.single, 'fake-access-token');
    });
  });

  group('B/C. connection and listener lifecycle', () {
    test('a second connect while connected is a no-op, not a second socket',
        () async {
      await client.connect();
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      await client.connect();
      await client.connect();

      expect(socket.connectedWith, hasLength(1));
    });

    test('reconnecting after a drop does not deliver the same event twice',
        () async {
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      await client.connect();
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      // The drop, and the application reconnecting through it. This is the
      // path that actually re-enters connect(): the early return only covers
      // `connected` and `connecting`, so a disconnected client attaches its
      // listeners again -- and would keep the old ones too, without the
      // cancel that precedes the attach.
      socket.moveTo(RealtimeSocketState.disconnected);
      await pumpEventQueue();
      await client.connect();
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      socket.emit(CallEventNames.accepted, _accepted('call-1'));
      await pumpEventQueue();

      // One frame in, one event out. A second live listener makes this two.
      expect(seen, hasLength(1));
      expect(socket.connectedWith, hasLength(2), reason: 'it did reconnect');
    });

    test('repeated reconnects do not compound the duplication', () async {
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      for (var i = 0; i < 3; i++) {
        await client.connect();
        socket.moveTo(RealtimeSocketState.connected);
        await pumpEventQueue();
        socket.moveTo(RealtimeSocketState.disconnected);
        await pumpEventQueue();
      }
      await client.connect();
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      socket.emit(CallEventNames.accepted, _accepted('call-1'));
      await pumpEventQueue();

      expect(seen, hasLength(1));
    });

    test('state transitions reach the application', () async {
      await client.connect();
      final seen = <CallRealtimeState>[];
      client.states.listen(seen.add);

      socket.moveTo(RealtimeSocketState.connected);
      socket.moveTo(RealtimeSocketState.disconnected);
      await pumpEventQueue();

      expect(seen, contains(CallRealtimeState.connected));
      expect(seen, contains(CallRealtimeState.disconnected));
    });

    test('a server-initiated refusal is unauthorized, not a retryable drop',
        () async {
      // Updated when the bounded renewal landed. A refusal now spends ONE
      // refresh before giving up, so the terminal state is only observable on
      // a session that cannot be renewed -- which is the case this was always
      // about: the server said no and no amount of retrying changes it.
      final tokens = FakeTokens('stale-token', renewable: false);
      final refused = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(refused.dispose);

      await refused.connect();
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();

      expect(refused.state, CallRealtimeState.unauthorized);
      // And it stopped: one connection attempt, never a second.
      expect(socket.connectedWith, hasLength(1));
    });

    test('dispose stops delivery and is idempotent', () async {
      await client.connect();
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      await client.dispose();
      await client.dispose();
      await client.dispose();

      socket.emit(CallEventNames.accepted, _accepted('call-after-dispose'));
      await pumpEventQueue();

      expect(seen, isEmpty);
      expect(socket.disposeCalls, 1);
    });

    test('connect after dispose does not resurrect the client', () async {
      await client.connect();
      await client.dispose();

      await client.connect();

      expect(socket.connectedWith, hasLength(1));
    });
  });

  group('D/E. event routing', () {
    test('the four call events arrive as typed values', () async {
      await client.connect();
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      socket.emit(CallEventNames.incoming, {
        'callId': 'c1',
        'conversationId': _conversationId,
        'type': 'direct',
        'initiatorId': 'a1',
        'initiatorName': 'teacher_t',
      });
      socket.emit(CallEventNames.accepted, _accepted('c1'));
      socket.emit(CallEventNames.declined, _accepted('c1'));
      socket.emit(CallEventNames.ended, {
        'callId': 'c1',
        'conversationId': _conversationId,
        'outcome': 'answered',
        'durationSeconds': 12,
      });
      await pumpEventQueue();

      expect(seen.map((e) => e.runtimeType).toList(), [
        CallIncoming,
        CallAccepted,
        CallDeclined,
        CallEnded,
      ]);
    });

    test('unrelated events are ignored without reaching the stream', () async {
      await client.connect();
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      socket.emit('message.created', {'messageId': 'm1'});
      socket.emit('typing.started', {'actorId': 'a1'});
      socket.emit('presence.changed', {'actorId': 'a1'});
      await pumpEventQueue();

      expect(seen, isEmpty);
    });

    test('a malformed call event is dropped, and does not break the stream',
        () async {
      await client.connect();
      final seen = <CallEvent>[];
      final errors = <Object>[];
      client.events.listen(seen.add, onError: errors.add);

      // Missing conversationId: unroutable, so untrustworthy.
      socket.emit(CallEventNames.accepted, {'callId': 'c1', 'actorId': 'a1'});
      // And a well-formed one straight after: the stream must still be alive.
      socket.emit(CallEventNames.accepted, _accepted('c2'));
      await pumpEventQueue();

      expect(errors, isEmpty, reason: 'must not surface as a stream error');
      expect(seen, hasLength(1));
      expect((seen.single as CallAccepted).callId, 'c2');
    });

    test('an unknown call type is dropped rather than guessed at', () async {
      await client.connect();
      final seen = <CallEvent>[];
      client.events.listen(seen.add);

      socket.emit(CallEventNames.incoming, {
        'callId': 'c1',
        'conversationId': _conversationId,
        'type': 'video',
        'initiatorId': 'a1',
        'initiatorName': 'teacher_t',
      });
      await pumpEventQueue();

      expect(seen, isEmpty);
    });
  });

  group('F/G. subscription is the server’s decision', () {
    test('a subscription asks by conversationId and never names a room',
        () async {
      await client.connect();
      final result = await client.subscribe(_conversationId);

      expect(result.ok, isTrue);
      // The seam accepts a conversation id. There is no room parameter to pass.
      expect(socket.subscribed, [_conversationId]);
    });

    test('a refusal is returned as the server gave it, and not retried',
        () async {
      socket.refusals[_conversationId] = 'COMM.NOT_CONVERSATION_MEMBER';
      await client.connect();

      final result = await client.subscribe(_conversationId);

      expect(result.ok, isFalse);
      expect(result.code, 'COMM.NOT_CONVERSATION_MEMBER');
      expect(socket.subscribed, hasLength(1));
    });

    test('a reconnect re-asks the server, rather than assuming the room held',
        () async {
      await client.connect();
      await client.subscribe(_conversationId);
      socket.subscribed.clear();

      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      // Re-asked, so authorization is re-evaluated: a relationship revoked
      // while the socket was down must not be restored by memory.
      expect(socket.subscribed, [_conversationId]);
    });

    test('a refused subscription is not restored on reconnect', () async {
      socket.refusals[_conversationId] = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED';
      await client.connect();
      await client.subscribe(_conversationId);
      socket.subscribed.clear();

      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      expect(socket.subscribed, isEmpty);
    });

    test('a resubscription the server now refuses is forgotten', () async {
      await client.connect();
      await client.subscribe(_conversationId);
      socket.subscribed.clear();

      // The relationship is revoked while the socket is down.
      socket.refusals[_conversationId] = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED';
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();
      socket.subscribed.clear();

      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      expect(socket.subscribed, isEmpty);
    });

    test('unsubscribe stops it being restored', () async {
      await client.connect();
      await client.subscribe(_conversationId);
      await client.unsubscribe(_conversationId);
      socket.subscribed.clear();

      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      expect(socket.unsubscribed, [_conversationId]);
      expect(socket.subscribed, isEmpty);
    });

    test('subscribing after dispose is refused locally', () async {
      await client.connect();
      await client.dispose();

      final result = await client.subscribe(_conversationId);

      expect(result.ok, isFalse);
      expect(socket.subscribed, isEmpty);
    });
  });

  group('G. no credential reaches a log', () {
    // Asserted against the source rather than a captured sink: RedactingLogger
    // writes through dart:developer and masks token-shaped values anyway, so a
    // runtime check would pass even if a call site did hand it a token. What
    // matters is that no call site does. The same reasoning as the API's
    // control-plane/media-plane separation tests, which read the script.
    late String clientSource;
    late String socketSource;

    setUpAll(() {
      clientSource =
          File('lib/core/realtime/call_realtime_client.dart').readAsStringSync();
      socketSource =
          File('lib/core/realtime/realtime_socket.dart').readAsStringSync();
    });

    test('the client never passes token material to the logger', () {
      final logCalls = RegExp(r'_log\.\w+\([^;]*?\);', dotAll: true)
          .allMatches(clientSource)
          .map((m) => m.group(0)!)
          .toList();

      expect(logCalls, isNotEmpty, reason: 'it does log something');
      for (final call in logCalls) {
        expect(call, isNot(contains('token')), reason: call);
        expect(call, isNot(contains('Authorization')), reason: call);
        expect(call, isNot(contains('payload')), reason: call);
      }
    });

    test('the transport logs nothing at all', () {
      // The seam holds the live credential. It has no logger, so there is no
      // call site there that could grow one by accident.
      expect(socketSource, isNot(contains('RedactingLogger')));
      expect(socketSource, isNot(contains('print(')));
    });

    test('neither file carries a hard-coded credential or endpoint', () {
      for (final source in [clientSource, socketSource]) {
        expect(source, isNot(matches(RegExp(r'\beyJ[A-Za-z0-9_-]{5,}\.'))));
        expect(source, isNot(contains('Bearer ')));
        expect(source, isNot(contains('livekit')));
        expect(source, isNot(contains('apiSecret')));
      }
    });
  });

  group('D. the token lifecycle when a credential is refused', () {
    test('D5. a refusal spends one refresh and reconnects with what it returns',
        () async {
      final tokens = FakeTokens('stale-token', renewsTo: 'fresh-token');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(client.dispose);

      await client.connect();
      expect(socket.connectedWith, ['stale-token']);

      // The server refuses the handshake: `io server disconnect`.
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();

      expect(tokens.refreshCalls, 1);
      expect(socket.connectedWith, ['stale-token', 'fresh-token']);
    });

    test('D4/D6. a session that cannot be renewed stops, it does not loop',
        () async {
      final tokens = FakeTokens('stale-token', renewable: false);
      final client = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(client.dispose);

      await client.connect();
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();

      expect(tokens.refreshCalls, 1);
      // One attempt, and no second connection. Reporting the dead session is
      // the session lifecycle's job, not this client's.
      expect(socket.connectedWith, hasLength(1));
      expect(client.state, CallRealtimeState.unauthorized);
    });

    test('D4. a refusal that survives the refresh does not become a storm',
        () async {
      // The nastiest shape: refresh keeps handing back a token the server keeps
      // refusing. Without a budget this is an infinite reconnect.
      final tokens = FakeTokens('stale-token', renewsTo: 'still-bad');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(client.dispose);

      await client.connect();
      for (var i = 0; i < 5; i++) {
        socket.moveTo(RealtimeSocketState.unauthorized);
        await pumpEventQueue();
      }

      // Refused, refreshed, refused again, stopped.
      expect(tokens.refreshCalls, 1);
      expect(socket.connectedWith, ['stale-token', 'still-bad']);
    });

    test('a connection that works restores the budget for a later refusal',
        () async {
      final tokens = FakeTokens('t1', renewsTo: 't2');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(client.dispose);

      await client.connect();
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();
      expect(tokens.refreshCalls, 1);

      // It connects this time.
      socket.moveTo(RealtimeSocketState.connected);
      await pumpEventQueue();

      // A refusal much later is a new problem and deserves its own attempt.
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();
      expect(tokens.refreshCalls, 2);
    });

    test('D9b. a dispose DURING the refresh cancels the reconnect', () async {
      // The race the second guard exists for: the refusal arrived, the refresh
      // is in flight, and the user signs out before it returns. Reconnecting
      // afterwards would open a socket for a session that has ended -- with a
      // credential that was renewed after the sign-out.
      final tokens = SlowTokens('stale-token', 'fresh-token');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);

      await client.connect();
      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();
      expect(tokens.refreshCalls, 1, reason: 'the refresh is in flight');

      await client.dispose();
      tokens.releaseRefresh();
      await pumpEventQueue();

      // The refresh completed and produced a usable token. Nothing used it.
      expect(socket.connectedWith, ['stale-token']);
    });

    test('D9. a disposed client neither refreshes nor reconnects', () async {
      final tokens = FakeTokens('stale-token', renewsTo: 'fresh-token');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);

      await client.connect();
      await client.dispose();

      socket.moveTo(RealtimeSocketState.unauthorized);
      await pumpEventQueue();

      // Signing out must not be followed by the client quietly renewing the
      // session it was disposed with.
      expect(tokens.refreshCalls, 0);
      expect(socket.connectedWith, hasLength(1));
    });

    test('D2. an ordinary drop does not refresh — only a refusal does', () async {
      final tokens = FakeTokens('t1', renewsTo: 't2');
      final client = CallRealtimeClient(socket: socket, tokens: tokens);
      addTearDown(client.dispose);

      await client.connect();
      socket.moveTo(RealtimeSocketState.disconnected);
      await pumpEventQueue();

      // A network blip is socket.io's to retry with the credential it has.
      // Refreshing on every drop would be churn nobody asked for.
      expect(tokens.refreshCalls, 0);
    });

    test('D8. no token reaches a log, on any of these paths', () {
      final source =
          File('lib/core/realtime/call_realtime_client.dart').readAsStringSync();
      final logCalls = RegExp(r'_log\.\w+\([^;]*?\);', dotAll: true)
          .allMatches(source)
          .map((m) => m.group(0)!);

      for (final call in logCalls) {
        // Prose may say the word; what must never appear is an interpolated
        // credential. `$renewed` or `$token` inside a log line is the failure
        // this is looking for, not the noun.
        expect(call, isNot(contains(r'$renewed')), reason: call);
        expect(call, isNot(contains(r'$token')), reason: call);
        expect(call, isNot(contains(r'${_tokens')), reason: call);
        expect(call, isNot(contains('accessToken')), reason: call);
      }
    });
  });
}
