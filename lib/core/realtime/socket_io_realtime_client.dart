import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../logging/redacting_logger.dart';
import 'realtime_client.dart';
import 'realtime_events.dart';

/// The real transport: Socket.IO against the backend's gateway.
///
/// ## Authentication
///
/// The socket presents the SAME bearer access token an HTTP request does, in
/// `handshake.auth.token`, and the gateway verifies it with the same
/// `AuthService`. There is no separate socket identity and nothing for a client
/// to assert about itself — the gateway's own comment records that naming your
/// own actor in the handshake was RT-001, and it is gone.
///
/// The token is read fresh on every connection attempt, not captured once, so a
/// reconnect after a refresh presents the NEW token. Capturing it would make
/// every reconnect after ~15 minutes fail with an expired credential, which is
/// exactly the window a flaky mobile network reconnects in.
///
/// ## Rooms
///
/// A client never names a room. It emits `conversation.subscribe` with a
/// conversation id and the server runs `AuthorizationService.canRead` before
/// joining it, so guessing or forging a room name gains nothing.
///
/// ## Reconnection
///
/// Socket.IO's own backoff is used rather than a hand-rolled one, and
/// subscriptions are re-established on every `connect` — including reconnects.
/// Rooms do not survive a disconnect on the server side, so a client that
/// subscribed once and assumed it stayed subscribed would go silent after the
/// first dropped connection and never say so.
class SocketIoRealtimeClient implements RealtimeClient {
  SocketIoRealtimeClient({
    required String baseUrl,
    required Future<String?> Function() accessToken,
    RedactingLogger logger = const RedactingLogger(),
    Duration heartbeat = const Duration(seconds: 20),
  })  : _baseUrl = baseUrl,
        _accessToken = accessToken,
        _logger = logger,
        _heartbeatInterval = heartbeat;

  /// Every event name the client forwards. An event outside this set is
  /// ignored rather than surfaced: a backend that adds one must not make an
  /// older client emit envelopes nothing understands.
  static const _forwarded = <String>{
    RealtimeEvent.messageCreated,
    RealtimeEvent.messageUpdated,
    RealtimeEvent.messageDeleted,
    RealtimeEvent.messageReceiptUpdated,
    RealtimeEvent.reactionAdded,
    RealtimeEvent.reactionRemoved,
    RealtimeEvent.typingStarted,
    RealtimeEvent.typingStopped,
    RealtimeEvent.presenceChanged,
    RealtimeEvent.conversationUpdated,
    RealtimeEvent.membershipChanged,
    RealtimeEvent.approvalDecided,
  };

  final String _baseUrl;
  final Future<String?> Function() _accessToken;
  final RedactingLogger _logger;
  final Duration _heartbeatInterval;

  final _events = StreamController<RealtimeEnvelope>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();

  /// Conversations this client wants to be subscribed to. Re-sent on every
  /// (re)connect, because server-side room membership does not survive one.
  final Set<String> _wanted = {};

  io.Socket? _socket;
  Timer? _heartbeat;
  RealtimeStatus _current = RealtimeStatus.idle;
  bool _hasConnectedBefore = false;

  @override
  Stream<RealtimeEnvelope> get events => _events.stream;

  @override
  Stream<RealtimeStatus> get status => _status.stream;

  @override
  RealtimeStatus get currentStatus => _current;

  void _moveTo(RealtimeStatus next) {
    if (_current == next) return;
    _current = next;
    if (!_status.isClosed) _status.add(next);
  }

  @override
  Future<void> connect() async {
    if (_socket != null) return;

    final token = await _accessToken();
    if (token == null || token.isEmpty) {
      // No session, no socket. Connecting anonymously would be disconnected by
      // the gateway immediately, and retried forever by the reconnect logic.
      _moveTo(RealtimeStatus.disconnected);
      return;
    }

    _moveTo(RealtimeStatus.connecting);

    final socket = io.io(
      _baseUrl,
      io.OptionBuilder()
          // Websocket only. The polling fallback would send the token as a
          // query parameter on an ordinary GET, where it lands in access logs
          // and proxy caches.
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(30000)
          .setAuth({'token': token})
          .build(),
    );

    socket.onConnect((_) {
      _hasConnectedBefore = true;
      _moveTo(RealtimeStatus.connected);
      // Re-subscribe. On a first connect this is a no-op; on a reconnect it is
      // the difference between a live conversation and a silent one.
      for (final conversationId in _wanted) {
        socket.emit(RealtimeEvent.subscribe, {'conversationId': conversationId});
      }
      _startHeartbeat();
    });

    socket.onDisconnect((_) {
      _stopHeartbeat();
      _moveTo(_hasConnectedBefore ? RealtimeStatus.reconnecting : RealtimeStatus.disconnected);
    });

    socket.onConnectError((error) {
      // Never log the error object itself: on an auth failure it can carry the
      // credential that was rejected.
      _logger.debug('realtime connect failed');
      _moveTo(_hasConnectedBefore ? RealtimeStatus.reconnecting : RealtimeStatus.disconnected);
    });

    // A fresh token for every reconnect attempt, so a session refreshed while
    // offline is the one presented when the network returns.
    socket.on('reconnect_attempt', (_) async {
      final fresh = await _accessToken();
      if (fresh != null && fresh.isNotEmpty) {
        socket.auth = {'token': fresh};
      }
    });

    for (final event in _forwarded) {
      socket.on(event, (data) {
        final payload = data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};
        if (!_events.isClosed) _events.add(RealtimeEnvelope(event, payload));
      });
    }

    _socket = socket;
    socket.connect();
  }

  /// Keeps presence alive, and is where the SERVER notices a revoked session:
  /// the gateway re-validates the socket's identity on this frame and drops the
  /// connection if the session or the principal has gone.
  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeat = Timer.periodic(_heartbeatInterval, (_) {
      _socket?.emit(RealtimeEvent.heartbeat, <String, Object?>{});
    });
  }

  void _stopHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = null;
  }

  @override
  Future<List<String>> subscribe(String conversationId) async {
    _wanted.add(conversationId);
    final socket = _socket;
    if (socket == null || !socket.connected) return const [];

    final completer = Completer<List<String>>();
    socket.emitWithAck(
      RealtimeEvent.subscribe,
      {'conversationId': conversationId},
      ack: (response) {
        if (completer.isCompleted) return;
        final map = response is Map ? response : const {};
        if (map['ok'] != true) {
          // A refusal is a policy answer, not a transport fault. Stop asking:
          // reconnecting and re-subscribing forever would hammer the gateway
          // with a request that is answered the same way every time.
          _wanted.remove(conversationId);
          _logger.debug('realtime subscribe refused');
          completer.complete(const []);
          return;
        }
        final typing = (map['typing'] as List?) ?? const [];
        completer.complete([
          for (final actor in typing)
            if (actor is String) actor,
        ]);
      },
    );

    // The ack is a courtesy, not a guarantee. A socket that goes away mid-frame
    // would otherwise leave this future pending forever and hang whatever
    // awaited it.
    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => const [],
    );
  }

  @override
  Future<void> unsubscribe(String conversationId) async {
    _wanted.remove(conversationId);
    _socket?.emit(RealtimeEvent.unsubscribe, {'conversationId': conversationId});
  }

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {
    _socket?.emit(
      isTyping ? RealtimeEvent.typingStart : RealtimeEvent.typingStop,
      {'conversationId': conversationId},
    );
  }

  @override
  Future<void> acknowledgeDelivered(List<String> messageIds) async {
    if (messageIds.isEmpty) return;
    _socket?.emit(RealtimeEvent.delivered, {'messageIds': messageIds});
  }

  @override
  Future<void> disconnect() async {
    _stopHeartbeat();
    _socket?.dispose();
    _socket = null;
    _wanted.clear();
    _hasConnectedBefore = false;
    _moveTo(RealtimeStatus.disconnected);
  }

  @override
  Future<void> dispose() async {
    await disconnect();
    await _events.close();
    await _status.close();
  }
}
