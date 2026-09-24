import 'dart:async';

import '../logging/redacting_logger.dart';
import '../network/api_client.dart' show TokenProvider;
import 'call_event.dart';
import 'realtime_socket.dart';

/// Where the realtime connection stands, as the application sees it.
///
/// [unauthorized] is terminal for the current credential: the server refused
/// the token and will refuse it again. Recovering means a new session, not
/// another attempt — which is why it is not folded into [disconnected].
enum CallRealtimeState { idle, connecting, connected, disconnected, unauthorized }

/// The Flutter side of call signalling.
///
/// SCOPE. This delivers the four server call events to the application as typed
/// values. It is transport, not behaviour: no UI, no LiveKit, no audio, no
/// CallKit, no push, and no opinion about what a call means. Those are later
/// workstreams and none of them belong above this line.
///
/// WHAT IT IS NOT AUTHORITATIVE ABOUT. Everything. Identity, authorization,
/// conversation membership, the teacher–parent relationship, call state and
/// media authorization are all the server's, and this client holds no copy it
/// could be tempted to decide from. It subscribes by conversationId and the
/// server decides whether that is allowed; it never names a room.
///
/// A [CallAccepted] here means the application-level answer, not a media join.
/// See [CallEvent].
class CallRealtimeClient {
  CallRealtimeClient({
    required RealtimeSocket socket,
    required TokenProvider tokens,
    RedactingLogger logger = const RedactingLogger(),
  })  : _socket = socket,
        _tokens = tokens,
        _log = logger;

  final RealtimeSocket _socket;
  final TokenProvider _tokens;
  final RedactingLogger _log;

  final _events = StreamController<CallEvent>.broadcast();
  final _states = StreamController<CallRealtimeState>.broadcast();

  /// The conversations this client WANTS to be subscribed to. Kept so a
  /// reconnect can restore them: socket.io rejoins the socket, not its rooms,
  /// and a silently unsubscribed client looks identical to a quiet call.
  final _wanted = <String>{};

  StreamSubscription<RealtimeFrame>? _frameSub;
  StreamSubscription<RealtimeSocketState>? _stateSub;

  CallRealtimeState _state = CallRealtimeState.idle;
  bool _connecting = false;
  bool _disposed = false;

  /// Typed call events. Broadcast: several listeners are fine, and a late
  /// listener does not replay history it would misread as new.
  Stream<CallEvent> get events => _events.stream;

  Stream<CallRealtimeState> get states => _states.stream;

  CallRealtimeState get state => _state;

  /// Connect, using the session the app already has.
  ///
  /// NO ANONYMOUS MODE. Without a token this returns having connected to
  /// nothing and reports [CallRealtimeState.unauthorized]. There is no branch
  /// that opens an unauthenticated socket, because the server would refuse it
  /// anyway and a client that tried would only be hiding the refusal.
  ///
  /// Safe to call more than once: a second call while connecting or connected
  /// is a no-op rather than a second socket. That is what keeps one reconnect
  /// from ending as two live sockets delivering every event twice.
  Future<void> connect() async {
    if (_disposed || _connecting) return;
    if (_state == CallRealtimeState.connected ||
        _state == CallRealtimeState.connecting) {
      return;
    }

    _connecting = true;
    try {
      final token = await _tokens.accessToken();
      if (token == null || token.isEmpty) {
        _log.warn('realtime: no session, not connecting');
        _setState(CallRealtimeState.unauthorized);
        return;
      }

      // Cancel before subscribing, always. This is the single place listeners
      // are attached, and attaching without cancelling first is precisely how a
      // reconnect starts delivering each event twice.
      await _detach();

      _frameSub = _socket.frames.listen(_onFrame);
      _stateSub = _socket.states.listen(_onSocketState);

      _setState(CallRealtimeState.connecting);
      await _socket.connect(token);
    } finally {
      _connecting = false;
    }
  }

  /// Subscribe to a conversation's call events.
  ///
  /// The server authorizes this. A refusal comes back as `ok: false` with a
  /// `COMM.*` code and is returned as-is: the client does not retry it, does
  /// not soften it, and above all does not join anything locally instead.
  Future<SubscriptionResult> subscribe(String conversationId) async {
    if (_disposed) {
      return const SubscriptionResult(ok: false, code: 'COMM.NOT_CONNECTED');
    }
    final result = await _socket.subscribe(conversationId);
    if (result.ok) {
      _wanted.add(conversationId);
    } else {
      // Not remembered, so a reconnect does not re-ask for something already
      // refused.
      _log.warn('realtime: subscribe refused', data: {'code': result.code});
    }
    return result;
  }

  Future<void> unsubscribe(String conversationId) async {
    _wanted.remove(conversationId);
    if (!_disposed) await _socket.unsubscribe(conversationId);
  }

  void _onSocketState(RealtimeSocketState socketState) {
    switch (socketState) {
      case RealtimeSocketState.connecting:
        _setState(CallRealtimeState.connecting);
      case RealtimeSocketState.connected:
        _setState(CallRealtimeState.connected);
        // Rooms do not survive a reconnect; the socket does. Restore what we
        // were subscribed to, and let the server authorize each one again --
        // a relationship revoked while we were away must not come back just
        // because we were in the room before it was.
        unawaited(_resubscribe());
      case RealtimeSocketState.disconnected:
        _setState(CallRealtimeState.disconnected);
      case RealtimeSocketState.unauthorized:
        _log.warn('realtime: server refused the connection');
        _setState(CallRealtimeState.unauthorized);
    }
  }

  Future<void> _resubscribe() async {
    for (final conversationId in _wanted.toList()) {
      final result = await _socket.subscribe(conversationId);
      if (!result.ok) {
        _wanted.remove(conversationId);
        _log.warn(
          'realtime: resubscribe refused',
          data: {'code': result.code},
        );
      }
    }
  }

  void _onFrame(RealtimeFrame frame) {
    if (_events.isClosed) return;
    try {
      final event = decodeCallEvent(frame.event, frame.payload);
      // null means "not a call event" -- typing, presence, messages. Somebody
      // else's frame, not a fault.
      if (event != null) _events.add(event);
    } on CallEventFormatException catch (error) {
      // FAIL CLOSED. A call event we cannot trust is dropped, not delivered
      // half-built and not rethrown into whatever happens to be listening.
      // Logged by field name only: the payload itself never reaches a log.
      _log.warn(
        'realtime: malformed call event dropped',
        data: {'event': error.event, 'field': error.field},
      );
    }
  }

  void _setState(CallRealtimeState next) {
    _state = next;
    if (!_states.isClosed) _states.add(next);
  }

  Future<void> _detach() async {
    await _frameSub?.cancel();
    await _stateSub?.cancel();
    _frameSub = null;
    _stateSub = null;
  }

  /// Tear down. Idempotent: calling it twice is not an error, and nothing it
  /// has already released is released again.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _detach();
    _wanted.clear();
    await _socket.dispose();
    _setState(CallRealtimeState.idle);
    await _events.close();
    await _states.close();
  }
}
