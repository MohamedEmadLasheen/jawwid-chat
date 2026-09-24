import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

/// The transport seam.
///
/// Everything above this interface is ours and is tested without a network;
/// everything below it is `socket_io_client`. Same reason `lib/core/audio` and
/// `lib/core/media/media_picker.dart` exist: a test should never have to open
/// the real thing to prove our logic.
///
/// Deliberately narrow. It carries the four verbs [CallRealtimeClient] needs
/// and no more — no namespaces, no rooms, no broadcast, nothing that would let
/// a caller reach past the client's discipline and register its own listeners.
abstract interface class RealtimeSocket {
  /// Frames from the server: the event name and its payload, as sent.
  Stream<RealtimeFrame> get frames;

  /// Transport state. Not authentication state — see [RealtimeSocketState].
  Stream<RealtimeSocketState> get states;

  /// Open the connection. `token` is put in the socket.io handshake as
  /// `auth: { token }`, which is what the server reads
  /// (API-CONTRACT §1; `realtime.gateway.ts` `handshakeToken`).
  Future<void> connect(String token);

  /// Ask the server to join a conversation room, and wait for its answer.
  ///
  /// The CLIENT NEVER NAMES A ROOM. It sends a conversationId; the server runs
  /// the same AuthorizationService the REST path uses and joins the socket only
  /// if that allows it. A forged or guessed id gains nothing, which is why this
  /// returns the server's verdict rather than a local boolean.
  Future<SubscriptionResult> subscribe(String conversationId);

  Future<void> unsubscribe(String conversationId);

  Future<void> dispose();
}

/// One frame off the wire.
class RealtimeFrame {
  const RealtimeFrame(this.event, this.payload);

  final String event;
  final Object? payload;
}

/// Transport state.
///
/// [unauthorized] is separate from [disconnected] on purpose: the server
/// disconnects a socket whose token is missing, malformed or revoked, and
/// treating that as an ordinary drop would reconnect forever against a
/// credential that will never work. It is terminal until the session is
/// renewed.
enum RealtimeSocketState { connecting, connected, disconnected, unauthorized }

/// The server's answer to `conversation.subscribe`, verbatim.
///
/// `{ ok: boolean, code?: string }` — the code is a `COMM.*` refusal
/// (`errors.ts`) and is the server's, never inferred here.
class SubscriptionResult {
  const SubscriptionResult({required this.ok, this.code});

  final bool ok;
  final String? code;
}

/// The real transport.
///
/// Reconnection is socket.io's own, configured here rather than reimplemented:
/// a second retry engine on top of the library's would produce two backoffs
/// racing each other.
class SocketIoRealtimeSocket implements RealtimeSocket {
  SocketIoRealtimeSocket({required String baseUrl}) : _baseUrl = baseUrl;

  final String _baseUrl;

  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

  io.Socket? _socket;
  bool _disposed = false;

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async {
    if (_disposed) return;
    // Already wired: replace the credential rather than stacking a second
    // socket and a second set of handlers on top of the first.
    if (_socket != null) _teardownSocket();

    // The library's own teardown throws into nobody's hands.
    //
    // When the SERVER closes the socket -- which for this gateway is every
    // refused token -- socket_io_client tears the transport down through
    // Manager.destroy -> Socket.close -> WebSocketTransport.doClose, and that
    // last step completes with `WebSocketConnectionClosed: Connection Closed`
    // on a future nothing awaits. It escapes as an unhandled asynchronous
    // error: in a test it fails the test, and in the app it reaches the zone
    // handler on a path the user cannot do anything about.
    //
    // Creating the socket inside a guarded zone keeps the library's async work
    // in that zone, so the error is caught here instead of escaping.
    //
    // IT EMITS NOTHING, deliberately. This fires DURING a teardown the proper
    // handler has already reported -- `onDisconnect` has run and said
    // `unauthorized` or `disconnected` from the reason the server gave. Emitting
    // a state here too would arrive second and overwrite that with a guess,
    // turning a refused credential back into an ordinary drop and putting the
    // client into a reconnect loop against a token that will never work.
    //
    // Found by running against a real socket.io server; the mocked tests could
    // not have shown it, because the mock has no transport to fail.
    runZonedGuarded(() => _open(token), (_, _) {});
  }

  void _open(String token) {
    final socket = io.io(
      _baseUrl,
      io.OptionBuilder()
          .setTransports(<String>['websocket'])
          .disableAutoConnect()
          // The contracted position. `auth: { token }` on the default
          // namespace, and nothing else that names the actor: the server reads
          // identity from this token alone.
          .setAuth(<String, dynamic>{'token': token})
          .enableReconnection()
          .build(),
    );

    socket.onConnect((_) => _emitState(RealtimeSocketState.connected));
    socket.onReconnectAttempt((_) => _emitState(RealtimeSocketState.connecting));
    // A disconnect the SERVER initiated is reported by socket.io as
    // `io server disconnect`, and the library does not auto-reconnect from it.
    // This gateway calls `client.disconnect(true)` in exactly two places, both
    // in handleConnection: no token, and a token that does not authenticate to
    // an active actor. So that reason means our credential was refused, and
    // retrying it would fail the same way.
    socket.onDisconnect((reason) => _emitState(
          reason == 'io server disconnect'
              ? RealtimeSocketState.unauthorized
              : RealtimeSocketState.disconnected,
        ));
    socket.onConnectError((_) => _emitState(RealtimeSocketState.disconnected));
    socket.onError((_) => _emitState(RealtimeSocketState.disconnected));
    socket.onAny((event, data) {
      if (_frames.isClosed) return;
      _frames.add(RealtimeFrame(event, data));
    });

    _socket = socket;
    _emitState(RealtimeSocketState.connecting);
    socket.connect();
  }

  void _emitState(RealtimeSocketState state) {
    if (!_states.isClosed) _states.add(state);
  }

  @override
  Future<SubscriptionResult> subscribe(String conversationId) {
    final socket = _socket;
    if (socket == null) {
      return Future.value(
        const SubscriptionResult(ok: false, code: 'COMM.NOT_CONNECTED'),
      );
    }
    final completer = Completer<SubscriptionResult>();
    socket.emitWithAck(
      'conversation.subscribe',
      <String, dynamic>{'conversationId': conversationId},
      ack: (dynamic response) {
        if (completer.isCompleted) return;
        final map = response is Map ? response : const <dynamic, dynamic>{};
        completer.complete(
          SubscriptionResult(
            ok: map['ok'] == true,
            code: map['code'] is String ? map['code'] as String : null,
          ),
        );
      },
    );
    return completer.future;
  }

  @override
  Future<void> unsubscribe(String conversationId) async {
    _socket?.emit(
      'conversation.unsubscribe',
      <String, dynamic>{'conversationId': conversationId},
    );
  }

  /// Drop the current socket, keeping the streams. Used when [connect] is
  /// called again: a new credential replaces the old socket rather than
  /// stacking a second one beside it.
  void _teardownSocket() {
    final socket = _socket;
    _socket = null;
    if (socket == null) return;
    // clearListeners first: a disconnect handler firing during teardown would
    // otherwise push a state onto a controller that is on its way out.
    socket.clearListeners();
    socket.dispose();
  }

  /// Terminal. Drops the socket AND closes the streams.
  ///
  /// dispose means dispose: an earlier shape kept the controllers open here and
  /// closed them from a separate `close()` that nothing ever called, so every
  /// disposed seam left two live StreamControllers behind. Idempotent.
  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _teardownSocket();
    await _frames.close();
    await _states.close();
  }
}
