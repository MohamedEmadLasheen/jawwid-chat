import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../logging/redacting_logger.dart';
import 'realtime_client.dart';
import 'realtime_events.dart';

/// [RealtimeClient] over Socket.IO, against the backend's own gateway.
///
/// AUTHENTICATION. The access token goes in the handshake `auth` map, which is
/// where `realtime.gateway.ts#handshakeToken` looks first, and it is verified by
/// the same `AuthService.authenticate()` the HTTP guard uses. It is deliberately
/// NOT put in the query string: a query string ends up in access logs and proxy
/// logs, where a token outlives the session it belongs to.
///
/// RECONNECTION is the library's, configured rather than reimplemented. What
/// this class adds is the part a reconnect policy cannot know: on every
/// reconnect the conversation subscriptions are replayed, because rooms live on
/// the server's socket and a new socket has joined none of them. Without that
/// replay a parent who went through a tunnel would stay silently unsubscribed.
///
/// A CREDENTIAL CANNOT BE SWAPPED IN PLACE. The server authenticates once, at
/// handshake. [connect] with a different token therefore tears the socket down
/// and opens a new one; calling it with the same token is a no-op, so an app
/// that calls it on every resume does not churn the connection.
class SocketIoRealtimeClient implements RealtimeClient {
  SocketIoRealtimeClient({
    required String baseUrl,
    RedactingLogger logger = const RedactingLogger(),
  })  : _baseUrl = baseUrl,
        _logger = logger;

  final String _baseUrl;
  final RedactingLogger _logger;

  io.Socket? _socket;
  String? _token;

  /// Replayed on every reconnect. The server's rooms do not survive a new
  /// socket, so this client must remember what it was in.
  final _subscriptions = <String>{};

  final _events = StreamController<RealtimeEvent>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();
  RealtimeStatus _current = RealtimeStatus.disconnected;

  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  Stream<RealtimeStatus> get status => _status.stream;

  @override
  RealtimeStatus get currentStatus => _current;

  @override
  Future<void> connect(String accessToken) async {
    if (_socket != null && _token == accessToken) {
      // Same credential, already connected or connecting. An app that calls
      // this on every resume must not churn the socket.
      return;
    }

    await _teardown();
    _token = accessToken;
    _setStatus(RealtimeStatus.connecting);

    final socket = io.io(
      _baseUrl,
      io.OptionBuilder()
          // WebSocket only. The polling fallback would send the handshake as
          // ordinary HTTP requests, and this app has no reason to need it.
          .setTransports(['websocket'])
          .disableAutoConnect()
          // The server reads `auth.token`. Not the query string, ever.
          .setAuth({'token': accessToken})
          .enableReconnection()
          .setReconnectionDelay(1000)
          // Capped backoff. A phone that has been in a tunnel for an hour must
          // reconnect within seconds of coming back, not wait out an
          // exponential curve that grew while nobody was watching.
          .setReconnectionDelayMax(15000)
          .build(),
    );

    socket.onConnect((_) {
      _setStatus(RealtimeStatus.connected);
      // Rejoin every room this client was in. A new socket has joined none.
      for (final conversationId in _subscriptions) {
        socket.emit(RealtimeCommands.subscribeConversation, {
          'conversationId': conversationId,
        });
      }
    });

    socket.onReconnectAttempt((_) => _setStatus(RealtimeStatus.reconnecting));
    socket.onDisconnect((_) => _setStatus(RealtimeStatus.disconnected));

    socket.onConnectError((error) {
      // Never log the error object: a handshake failure can echo the auth map,
      // and the auth map is the access token.
      _logger.debug('realtime connect failed');
      _setStatus(RealtimeStatus.disconnected);
    });

    // One handler per contract event. Registering by name rather than using a
    // catch-all is what keeps an unrecognised server event out of the app's
    // event stream.
    for (final name in RealtimeEvents.all) {
      socket.on(name, (data) {
        if (data is! Map) return;
        _events.add(
          RealtimeEvent(name: name, payload: Map<String, Object?>.from(data)),
        );
      });
    }

    _socket = socket;
    socket.connect();
  }

  @override
  Future<void> disconnect() async {
    await _teardown();
    _subscriptions.clear();
    _token = null;
    _setStatus(RealtimeStatus.disconnected);
  }

  @override
  Future<bool> subscribeConversation(String conversationId) async {
    // Remembered whether or not the socket is up, so a subscription requested
    // while offline is honoured on the next connect rather than lost.
    _subscriptions.add(conversationId);

    final socket = _socket;
    if (socket == null || !socket.connected) return false;

    final completer = Completer<bool>();
    socket.emitWithAck(
      RealtimeCommands.subscribeConversation,
      {'conversationId': conversationId},
      ack: (dynamic response) {
        if (completer.isCompleted) return;
        completer.complete(response is Map && response['ok'] == true);
      },
    );

    // The server always acknowledges; the timeout is for the case where the
    // connection dies mid-request, so a caller is never left awaiting forever.
    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => false,
    );
  }

  @override
  Future<void> unsubscribeConversation(String conversationId) async {
    _subscriptions.remove(conversationId);
    _socket?.emit(RealtimeCommands.unsubscribeConversation, {
      'conversationId': conversationId,
    });
  }

  @override
  void dispose() {
    _socket?.dispose();
    _socket = null;
    _events.close();
    _status.close();
  }

  Future<void> _teardown() async {
    final socket = _socket;
    if (socket == null) return;
    _socket = null;
    socket.clearListeners();
    socket.dispose();
  }

  void _setStatus(RealtimeStatus status) {
    if (_current == status) return;
    _current = status;
    if (!_status.isClosed) _status.add(status);
  }
}
