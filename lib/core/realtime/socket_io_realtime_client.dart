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

  /// The connection attempt currently in flight, if any.
  ///
  /// This is what makes [connect] safe to call concurrently. The guard used to
  /// be `if (_socket != null) return`, which is not atomic across the `await`
  /// that follows it: reading the access token is asynchronous, so two callers
  /// could both pass the guard, both build a socket, and the second assignment
  /// would orphan the first — leaving a connection that is still open, still
  /// receiving, and no longer referenced by anything that could close it.
  ///
  /// It is not hypothetical. `MessagesController._attachRealtime()` calls
  /// `connect()` once per chat screen, so opening two conversations inside the
  /// keychain read window is enough.
  Future<void>? _connecting;

  /// Incremented by every [disconnect] and [dispose].
  ///
  /// A connection attempt captures this before it starts awaiting and checks it
  /// again before it takes ownership of a socket. Without it, a `disconnect()`
  /// issued while a `connect()` was still reading the token would be silently
  /// undone by that attempt finishing afterwards — the caller asked for no
  /// connection and would get one anyway.
  int _generation = 0;

  /// Backoff for re-establishing after a TERMINAL disconnect.
  ///
  /// Doubles from 2s to a 60s ceiling and resets on a successful connect. It is
  /// bounded because the disconnect that motivates it is an AUTHORIZATION
  /// answer: the gateway drops a socket whose handshake token no longer
  /// authenticates, and for a genuinely revoked session that answer will not
  /// change. An unbounded retry would be a client hammering a gateway that has
  /// already said no.
  static const _retryFloor = Duration(seconds: 2);
  static const _retryCeiling = Duration(seconds: 60);
  Duration _retryDelay = _retryFloor;
  Timer? _retry;

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

  /// Open the connection. Safe to call concurrently and safe to call twice.
  ///
  /// Every caller that arrives while an attempt is in flight awaits THAT
  /// attempt rather than starting a second one, so N concurrent callers produce
  /// exactly one token read and one socket. The in-flight future is cleared
  /// when the attempt settles, so a failed attempt does not poison later ones.
  @override
  Future<void> connect() {
    // Already connected: nothing to do, and nothing to await.
    if (_socket != null) return Future<void>.value();
    // An attempt is running: join it. This is the whole fix — the decision to
    // start an attempt and the record that one is running happen in the same
    // synchronous step, with no await between them, so there is no window for a
    // second caller to slip through.
    return _connecting ??= _open().whenComplete(() => _connecting = null);
  }

  Future<void> _open() async {
    final generation = _generation;

    final token = await _accessToken();

    // Superseded while reading the token. Return before touching ANY shared
    // state — not just before installing the socket. An attempt that lost the
    // race must not narrate one either: emitting `connecting` here would
    // overwrite the `disconnected` that the disconnect just published, and the
    // UI would show a connection spinner for an attempt that has been
    // abandoned.
    if (generation != _generation) return;

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
          // Never reuse the cached Manager/Socket for this origin. `io()` keys
          // its cache on scheme://host:port, and for an origin-only URL its
          // `sameNamespace` check compares the empty path against a socket
          // registered under '/', so the check never matches and the FIRST
          // Socket is handed back on every later call -- with `auth` frozen at
          // construction. A reconnect after a token refresh would therefore
          // present the ORIGINAL, now-expired token and be rejected forever,
          // which is exactly what the retry below spent its life doing.
          .enableForceNew()
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(30000)
          .setAuth({'token': token})
          .build(),
    );

    socket.onConnect((_) {
      _hasConnectedBefore = true;
      // A good connection forgives the backoff: the next terminal disconnect
      // starts from the floor again rather than inheriting a long delay from
      // an outage that is now over.
      _retryDelay = _retryFloor;
      _retry?.cancel();
      _retry = null;
      _moveTo(RealtimeStatus.connected);
      // Re-subscribe. On a first connect this is a no-op; on a reconnect it is
      // the difference between a live conversation and a silent one.
      for (final conversationId in _wanted) {
        socket.emit(RealtimeEvent.subscribe, {'conversationId': conversationId});
      }
      _startHeartbeat();
    });

    socket.onDisconnect((reason) {
      _stopHeartbeat();

      // A SERVER-initiated disconnect is TERMINAL. socket_io_client calls
      // `destroy()` before emitting this reason — "reconnections don't get
      // triggered for this" — so the library will never bring this socket back,
      // and `enableReconnection()` does not apply.
      //
      // The gateway issues one whenever the handshake token stops
      // authenticating, which for a live socket is simply the access token
      // expiring. Left in place, the dead object made `connect()` a permanent
      // no-op — `_socket != null` reads as "connected" — and the app went
      // silent for the rest of the process while still looking healthy.
      //
      // `_wanted` is deliberately KEPT: the conversations this client is in are
      // still the ones it wants, and the next `onConnect` re-sends them. Only
      // an explicit `disconnect()` forgets them.
      if (reason == 'io server disconnect' && identical(_socket, socket)) {
        socket.dispose();
        _socket = null;
        _moveTo(RealtimeStatus.reconnecting);
        _scheduleRetry();
        return;
      }

      // Everything else is a transport drop, which the library reconnects by
      // itself. Touching `_socket` here would take that away.
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

    // The attempt was superseded while it was reading the token — a
    // disconnect(), a sign-out, or a dispose(). Take the socket back down
    // rather than installing it: the caller asked for no connection.
    if (generation != _generation) {
      socket.dispose();
      return;
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

  /// Re-establish after a terminal disconnect.
  ///
  /// Routed through [connect] rather than building a socket here, so the
  /// single-attempt guard, the generation guard and a FRESH token read all
  /// still apply — the expired token that caused the disconnect is never
  /// replayed. The generation is captured when the retry is scheduled and
  /// re-checked when it fires, so a `disconnect()` in between cannot be undone
  /// by a timer that was already in flight.
  void _scheduleRetry() {
    _retry?.cancel();
    final generation = _generation;
    _retry = Timer(_retryDelay, () {
      _retry = null;
      if (generation != _generation) return;
      unawaited(connect());
    });

    final next = _retryDelay * 2;
    _retryDelay = next > _retryCeiling ? _retryCeiling : next;
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
    // Invalidates any attempt currently in flight, so one that is mid-await
    // cannot install its socket after this returns.
    _generation += 1;
    _stopHeartbeat();
    // A pending terminal-disconnect retry must not resurrect a client the
    // caller has just shut down. The generation bump above already makes the
    // timer a no-op if it fires; cancelling it means it does not fire at all.
    _retry?.cancel();
    _retry = null;
    _retryDelay = _retryFloor;
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
