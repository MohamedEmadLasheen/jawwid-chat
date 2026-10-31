import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_client.dart' show TokenProvider;
import '../../../core/realtime/call_realtime_client.dart';
import '../../calls/application/call_session.dart';

/// PARENT-015: brings the session's realtime connection back when nothing
/// else will.
///
/// WHY IT IS NEEDED. A graceful API restart closes socket.io, and the client
/// is told `io server disconnect` -- the same reason the gateway gives a
/// refused token, so the transport reports it as unauthorized and socket.io
/// itself does not reconnect from it. The client spends its one renewal at
/// once, while the API is still down; the refresh never reaches the server
/// (`Renewal.unreachable`), comes back empty, and the client stops for good.
/// Every open app was left without live chat after every deploy, until it was
/// killed.
///
/// WHAT IT DOES. While the client sits unauthorized or disconnected, it tries
/// again on a jittered, growing wait (2 s, 4 s ... at most 60 s): after a
/// refusal it renews the session through the session's own [TokenProvider]
/// (the single-flighted one the HTTP stack uses, so no second refresh races
/// it), then asks the client to connect. The client's ordinary path does the
/// rest: it resubscribes every room the server still allows and, once they
/// are back, tells the chat to catch up (ChatSignal.reconnected). A refresh
/// the server refuses ends the session as it always has; one that cannot
/// reach the server only waits for the next try.
///
/// WHAT IT NEVER DOES. Connect a client that is connecting or connected (one
/// socket, one set of listeners); run in the background (paused, and tried at
/// once on resume); outlive its session (keyed on the session's client, and
/// disposed with it). It touches no call state: it only calls the client's
/// own connect, which carries call signalling back with everything else.
class RealtimeKeeper {
  RealtimeKeeper({
    required CallRealtimeClient client,
    required TokenProvider tokens,
    this.firstWait = const Duration(seconds: 2),
    this.longestWait = const Duration(seconds: 60),
    Random? random,
  })  : _client = client,
        _tokens = tokens,
        _random = random ?? Random();

  final CallRealtimeClient _client;
  final TokenProvider _tokens;
  final Random _random;
  final Duration firstWait;
  final Duration longestWait;

  StreamSubscription<CallRealtimeState>? _states;
  Timer? _timer;
  int _attempts = 0;
  bool _paused = false;
  bool _trying = false;
  bool _disposed = false;

  /// The wait before try [attempt] (0-based): doubling from [first], at most
  /// [longest], then ±20% so a deploy does not bring every app back in the
  /// same second.
  static Duration waitFor(int attempt, {required Duration first, required Duration longest, required Random random}) {
    final grown = first.inMilliseconds * pow(2, min(attempt, 20));
    final base = min(grown, longest.inMilliseconds.toDouble());
    final jitter = 0.8 + random.nextDouble() * 0.4;
    return Duration(milliseconds: (base * jitter).round());
  }

  /// Whether a try is waiting on its timer (the tests' view of a leak).
  @visibleForTesting
  bool get waiting => _timer != null;

  void start() {
    if (_disposed || _states != null) return;
    _states = _client.states.listen(_onState);
    _onState(_client.state);
  }

  void _onState(CallRealtimeState state) {
    if (_disposed) return;
    switch (state) {
      case CallRealtimeState.connected:
        _attempts = 0;
        _cancel();
      case CallRealtimeState.connecting:
      case CallRealtimeState.idle:
        // In hand, or not started: nothing to add.
        _cancel();
      case CallRealtimeState.unauthorized:
      case CallRealtimeState.disconnected:
        _schedule();
    }
  }

  bool get _down => _client.state == CallRealtimeState.unauthorized || _client.state == CallRealtimeState.disconnected;

  void _schedule() {
    if (_disposed || _paused || _trying || _timer != null || !_down) return;
    _timer = Timer(waitFor(_attempts, first: firstWait, longest: longestWait, random: _random), () {
      _timer = null;
      unawaited(_try());
    });
  }

  Future<void> _try() async {
    if (_disposed || _paused || _trying || !_down) return;
    _trying = true;
    _attempts++;
    try {
      if (_client.state == CallRealtimeState.unauthorized) {
        final renewed = await _tokens.refresh();
        if (_disposed || _paused) return;
        // Unreachable (or the session is over, which signs out on its own path).
        if (renewed == null || renewed.isEmpty) return;
      }
      await _client.connect();
    } on Object {
      // A try that throws is a try that failed: the next one comes.
    } finally {
      _trying = false;
      // Still down (the connect was refused at once, or never left): wait again.
      _schedule();
    }
  }

  /// The app went to the background: nothing runs there.
  void pause() {
    _paused = true;
    _cancel();
  }

  /// The app is back: if the connection is down, try at once.
  void resume() {
    if (_disposed) return;
    _paused = false;
    _cancel();
    if (_down) unawaited(_try());
  }

  void _cancel() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _cancel();
    unawaited(_states?.cancel());
    _states = null;
  }
}

/// The session's keeper: keyed on its realtime client (itself keyed on the
/// account), so a sign-out disposes it with the client and the next session
/// gets its own. Watched by the signed-in shell beside the live chat.
final realtimeKeeperProvider = Provider<RealtimeKeeper?>((ref) {
  final client = ref.watch(callRealtimeClientProvider);
  if (client == null) return null;

  final keeper = RealtimeKeeper(client: client, tokens: ref.watch(realtimeTokenProvider));
  final lifecycle = AppLifecycleListener(onPause: keeper.pause, onResume: keeper.resume);
  ref.onDispose(() {
    lifecycle.dispose();
    keeper.dispose();
  });
  keeper.start();
  return keeper;
});
