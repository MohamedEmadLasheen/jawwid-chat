// PARENT-015 (P1): after an API restart a running app never got realtime back.
// A graceful restart closes socket.io, which the client reads as a refused
// credential ("io server disconnect" -> unauthorized); its one renewal ran
// while the API was still down, came back empty, and nothing ever tried
// again. The keeper tries again: jittered backoff, a refresh through the
// session's own TokenProvider, then the client's ordinary connect -- which
// resubscribes the rooms and tells the chat to catch up. It never connects a
// client that is already connecting or connected, stops with the session and
// pauses in the background.
//
// The client here is the REAL CallRealtimeClient over a fake socket: what is
// proven is the keeper's driving of it, not the wire.
import 'dart:async';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/chat_signal.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/features/conversations/application/realtime_keeper.dart';

// Real time, with the keeper's waits shrunk to milliseconds: the client awaits
// a broadcast subscription's cancel, whose completed future belongs to the root
// zone, so a fake clock never sees its connect finish.
const _room = '22222222-2222-2222-2222-222222222222';

class _Socket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();
  final connects = <String>[];
  final subscribed = <String>[];

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async => connects.add(token);

  @override
  Future<SubscriptionResult> subscribe(String conversationId) async {
    subscribed.add(conversationId);
    return const SubscriptionResult(ok: true);
  }

  @override
  Future<void> unsubscribe(String conversationId) async {}

  @override
  Future<void> dispose() async {}

  void moveTo(RealtimeSocketState s) => _states.add(s);
  void emit(String event, Object? payload) => _frames.add(RealtimeFrame(event, payload));
}

/// A session whose refresh can be made unreachable (the API restarting).
class _Tokens implements TokenProvider {
  _Tokens(this._token);

  String? _token;
  bool reachable = true;
  int refreshes = 0;
  int _n = 0;

  @override
  Future<String?> accessToken() async => _token;

  @override
  Future<String?> refresh() async {
    refreshes++;
    if (!reachable) return null; // Renewal.unreachable: the session is kept, no token now
    return _token = 'renewed-${++_n}';
  }

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Lets the client, the keeper and their streams run for [ms] of real time.
Future<void> _run([int ms = 20]) => Future<void>.delayed(Duration(milliseconds: ms));

Future<void> _until(bool Function() done, {int ms = 2000}) async {
  for (var i = 0; i < ms ~/ 5 && !done(); i++) {
    await _run(5);
  }
}

void main() {
  late _Socket socket;
  late _Tokens tokens;
  late CallRealtimeClient client;
  late RealtimeKeeper keeper;

  setUp(() async {
    socket = _Socket();
    tokens = _Tokens('first');
    client = CallRealtimeClient(socket: socket, tokens: tokens, unknownActorRetryDelay: Duration.zero);
    keeper = RealtimeKeeper(
      client: client,
      tokens: tokens,
      firstWait: const Duration(milliseconds: 10),
      longestWait: const Duration(milliseconds: 40),
      random: Random(7),
    )..start();
    await client.connect();
    socket.moveTo(RealtimeSocketState.connected);
    await _run();
    await client.subscribe(_room);
    await _run();
  });

  tearDown(() async {
    keeper.dispose();
    await client.dispose();
  });

  test('a restart while the API is down: tried again until it is back, then rooms and chat catch up', () async {
    final signals = <ChatSignalKind>[];
    client.chatSignals.listen((s) => signals.add(s.kind));
    socket.subscribed.clear();
    expect(socket.connects, ['first']);

    // The API goes down gracefully: "io server disconnect" reads as refused, and
    // the client's own one-shot renewal finds the API down and gives up.
    tokens.reachable = false;
    socket.moveTo(RealtimeSocketState.unauthorized);
    await _run(5);
    expect(client.state, CallRealtimeState.unauthorized);

    // The keeper keeps trying, backing off, while it stays down -- never connecting without a credential.
    await _until(() => tokens.refreshes >= 4);
    expect(tokens.refreshes, greaterThanOrEqualTo(4));
    expect(socket.connects, ['first']);

    // The API is back.
    tokens.reachable = true;
    await _until(() => socket.connects.length == 2);
    expect(socket.connects.last, startsWith('renewed-'));
    expect(client.state, CallRealtimeState.connecting);
    socket.moveTo(RealtimeSocketState.connected);
    await _until(() => signals.isNotEmpty);
    expect(socket.subscribed, [_room], reason: 'every room comes back');
    expect(signals, [ChatSignalKind.reconnected], reason: 'the chat catches up');

    // Connected: the keeper is quiet.
    final refreshes = tokens.refreshes;
    await _run(150);
    expect([tokens.refreshes, socket.connects.length, keeper.waiting], [refreshes, 2, false]);
  });

  test('the waits back off and are jittered, so apps do not all come back in the same second', () {
    Duration wait(int attempt, int seed) =>
        RealtimeKeeper.waitFor(attempt, first: const Duration(seconds: 2), longest: const Duration(seconds: 60), random: Random(seed));
    expect(wait(0, 1).inMilliseconds, inInclusiveRange(1600, 2400));
    expect(wait(3, 1).inMilliseconds, inInclusiveRange(12800, 19200));
    expect(wait(12, 1).inMilliseconds, inInclusiveRange(48000, 72000));
    final spread = {for (var seed = 0; seed < 20; seed++) wait(2, seed).inMilliseconds};
    expect(spread.length, greaterThan(10));
  });

  test('never a second connect while the client is connecting or connected', () async {
    expect(socket.connects, hasLength(1));
    await _run(150);
    expect(socket.connects, hasLength(1), reason: 'connected: nothing to do');

    // A drop the transport is already retrying (socket.io's own reconnect).
    socket.moveTo(RealtimeSocketState.disconnected);
    socket.moveTo(RealtimeSocketState.connecting);
    await _run(150);
    expect(socket.connects, hasLength(1), reason: 'connecting: the keeper waits');
    expect(tokens.refreshes, 0);
  });

  test('a reconnect with no call active leaves call state alone: no call event, nothing delivered twice', () async {
    final events = <CallEvent>[];
    client.events.listen(events.add);
    final signals = <ChatSignal>[];
    client.chatSignals.listen(signals.add);

    tokens.reachable = false;
    socket.moveTo(RealtimeSocketState.unauthorized);
    await _run(5);
    tokens.reachable = true;
    await _until(() => socket.connects.length == 2);
    socket.moveTo(RealtimeSocketState.connected);
    await _run();
    expect(events, isEmpty);

    // One frame after the reconnect is delivered once, not once per connect.
    signals.clear();
    socket.emit('message.created', {'conversationId': _room, 'seq': 9});
    await _run();
    expect(signals.where((s) => s.kind == ChatSignalKind.messageCreated), hasLength(1));
  });

  test('paused in the background; on resume it tries at once', () async {
    tokens.reachable = false;
    socket.moveTo(RealtimeSocketState.unauthorized);
    await _run(5);
    keeper.pause();
    expect(keeper.waiting, isFalse);
    final before = tokens.refreshes;
    await _run(150);
    expect(tokens.refreshes, before, reason: 'nothing runs in the background');

    tokens.reachable = true;
    keeper.resume();
    await _until(() => socket.connects.length == 2);
    expect(tokens.refreshes, before + 1);
    expect(socket.connects.last, startsWith('renewed-'));
  });

  test('stops with the session: no timer outlives dispose', () async {
    tokens.reachable = false;
    socket.moveTo(RealtimeSocketState.unauthorized);
    await _until(() => keeper.waiting);
    expect(keeper.waiting, isTrue);
    keeper.dispose();
    expect(keeper.waiting, isFalse);
    final refreshes = tokens.refreshes;
    await _run(150);
    expect(tokens.refreshes, refreshes);
  });
}
