import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/core/realtime/socket_io_realtime_client.dart';

/// Duplicate connection prevention (Phase 4, F-3).
///
/// THE DEFECT. `connect()` guarded with `if (_socket != null) return` and then
/// **awaited** the access-token read before assigning `_socket`. The guard and
/// the assignment were separated by an await, so two callers could both pass
/// the guard, both build a socket, and the second assignment would orphan the
/// first — a connection still open, still receiving, and no longer referenced
/// by anything that could close it. `MessagesController._attachRealtime()`
/// calls `connect()` once per chat screen, so two conversations opened inside
/// the keychain read window was enough to trigger it.
///
/// HOW THESE TESTS SEE IT. The injected `accessToken` callback is read exactly
/// once per attempt that gets past the guard, and a socket is built if and only
/// if that read returns a token. So the number of token reads IS the number of
/// connection attempts, and — for a non-empty token — the number of sockets
/// built. That is the same quantity the original audit probe measured when it
/// reported "guard was passed 2 time(s)".
///
/// The token read is given a real delay, because the race lives in that await.
/// Removing the delay would make these tests pass against the broken code.
void main() {
  /// A client whose token read is slow enough to hold the race window open.
  ({SocketIoRealtimeClient client, int Function() reads, void Function(String?) setToken})
      build({String baseUrl = 'http://127.0.0.1:1'}) {
    var reads = 0;
    String? token = 'a-token';
    final client = SocketIoRealtimeClient(
      // Port 1 is closed by default; nothing in the duplicate-connection tests
      // needs the connection to succeed, only the attempt to be counted. The
      // D3 tests below pass a real fake server, because a TERMINAL disconnect
      // only exists once a connection has actually been made.
      baseUrl: baseUrl,
      accessToken: () async {
        reads += 1;
        // Stands in for the flutter_secure_storage read that really happens
        // here. This delay IS the race window.
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return token;
      },
    );
    return (client: client, reads: () => reads, setToken: (t) => token = t);
  }

  test('two concurrent connect() calls make ONE attempt and ONE socket', () async {
    final h = build();

    // Exactly what two chat screens opening in quick succession do.
    await Future.wait([h.client.connect(), h.client.connect()]);

    expect(
      h.reads(),
      1,
      reason: 'both callers must converge on the same in-flight attempt; '
          'two reads means two sockets and one of them orphaned',
    );
    await h.client.dispose();
  });

  test('five concurrent callers still make one attempt', () async {
    final h = build();

    await Future.wait([
      h.client.connect(),
      h.client.connect(),
      h.client.connect(),
      h.client.connect(),
      h.client.connect(),
    ]);

    expect(h.reads(), 1);
    await h.client.dispose();
  });

  test('a failed attempt does not poison the next one', () async {
    final h = build();

    // No session yet: the attempt returns without building a socket.
    h.setToken(null);
    await h.client.connect();
    expect(h.reads(), 1);
    expect(h.client.currentStatus, RealtimeStatus.disconnected);

    // Signing in must be able to connect. If the in-flight future were cached
    // rather than cleared when it settled, this would silently do nothing and
    // the app would never get a socket again.
    h.setToken('a-token');
    await h.client.connect();
    expect(h.reads(), 2);
    await h.client.dispose();
  });

  test('once connected, further calls reuse the connection', () async {
    final h = build();
    await h.client.connect();
    expect(h.reads(), 1);

    // Every subsequent screen calls connect() too. None of them may build a
    // second socket.
    await Future.wait([h.client.connect(), h.client.connect()]);
    await h.client.connect();

    expect(h.reads(), 1);
    await h.client.dispose();
  });

  test('a disconnect during an in-flight attempt is not undone by it', () async {
    final h = build();

    // The attempt starts and is now awaiting the token read.
    final attempt = h.client.connect();
    // The user signs out mid-read.
    await h.client.disconnect();
    await attempt;

    // The attempt must NOT have installed its socket: the caller asked for no
    // connection. Proven by the next connect() having to start a fresh attempt
    // rather than short-circuiting on a socket that should not exist.
    expect(h.client.currentStatus, RealtimeStatus.disconnected);
    await h.client.connect();
    expect(h.reads(), 2, reason: 'no socket should have survived the disconnect');
    await h.client.dispose();
  });

  /// D3 — the terminal disconnect.
  ///
  /// THE DEFECT. `connect()` returned early whenever `_socket != null`, without
  /// asking whether that socket was still connected. A SERVER-initiated
  /// disconnect is terminal — socket_io_client calls `destroy()` before
  /// emitting `'io server disconnect'`, so the library never reconnects it —
  /// which left a dead object behind that made every later `connect()` a no-op.
  /// The gateway issues exactly that disconnect whenever a live socket's
  /// handshake token stops authenticating, i.e. every time the access token
  /// expires. Realtime then stayed dead for the rest of the process.
  ///
  /// HOW THESE TESTS SEE IT. A terminal disconnect cannot be faked from the
  /// client side: `disconnect()` produces `'io client disconnect'` and takes a
  /// different path. So these two use a real socket against the minimal
  /// Engine.IO/Socket.IO server below, which exists ONLY to open a connection
  /// and then send frame `41`. No production seam is involved.
  group('terminal disconnect', () {
    late _FakeSocketIoServer server;

    setUp(() async => server = await _FakeSocketIoServer.start());
    tearDown(() async => server.stop());

    test('retires the dead socket, so the next connect() really reconnects', () async {
      final h = build(baseUrl: server.url);
      await h.client.connect();
      await server.awaitNamespaceConnect().timeout(const Duration(seconds: 10));
      expect(h.reads(), 1, reason: 'one attempt so far');

      // Subscribe to the reconnecting status BEFORE provoking it, because the
      // status stream is a broadcast and does not replay.
      final reconnecting = h.client.status
          .firstWhere((s) => s == RealtimeStatus.reconnecting)
          .timeout(const Duration(seconds: 10));
      server.sendServerDisconnect();
      await reconnecting;

      // The whole defect in one assertion: before the fix this returned
      // immediately on the stale socket and read no token at all.
      await h.client.connect();
      expect(
        h.reads(),
        2,
        reason: 'a terminal disconnect must leave no socket to short-circuit on',
      );

      await h.client.dispose();
    });

    test('keeps the wanted conversations, and re-sends them on the reconnect', () async {
      final h = build(baseUrl: server.url);
      // The server seeing `40` is not yet the client believing it is connected:
      // that happens when the server's reply lands. `subscribe()` emits only on
      // a connected socket, so wait for the CLIENT's own view.
      final connected = h.client.status
          .firstWhere((s) => s == RealtimeStatus.connected)
          .timeout(const Duration(seconds: 10));
      await h.client.connect();
      await connected;

      await h.client.subscribe('conv-1').timeout(const Duration(seconds: 10));
      expect(server.subscribedConversations, contains('conv-1'));

      server.clearObservedSubscribes();
      final reconnecting = h.client.status
          .firstWhere((s) => s == RealtimeStatus.reconnecting)
          .timeout(const Duration(seconds: 10));
      server.sendServerDisconnect();
      await reconnecting;

      // Nothing calls connect() here: the client's own bounded retry is what
      // brings it back, and `_wanted` is what makes the conversation live again
      // rather than silent. Awaited on the event, not slept on.
      await server.awaitSubscribe('conv-1').timeout(const Duration(seconds: 20));
      expect(server.namespaceConnects, 2, reason: 'exactly one reconnect, not a storm');

      await h.client.dispose();
    });

    /// The reason D3's retry could not recover in the real environment.
    ///
    /// `io()` handed every attempt the SAME Socket object, whose `auth` was
    /// bound once at construction. So the retry loop ran correctly and forever
    /// while presenting the ORIGINAL, expired token, and the gateway rejected
    /// every attempt. What matters is not that a reconnect happens, but which
    /// token it carries.
    test('the retry presents the CURRENT token, not the one the dead socket carried',
        () async {
      final h = build(baseUrl: server.url);
      final connected = h.client.status
          .firstWhere((s) => s == RealtimeStatus.connected)
          .timeout(const Duration(seconds: 10));
      await h.client.connect();
      await connected;
      expect(server.handshakeTokens, ['a-token']);

      // The access token expires and the app refreshes it while the socket is
      // still up -- exactly the sequence the gateway's revalidation produces.
      h.setToken('refreshed-token');

      final reconnecting = h.client.status
          .firstWhere((s) => s == RealtimeStatus.reconnecting)
          .timeout(const Duration(seconds: 10));
      server.sendServerDisconnect();
      await reconnecting;

      await server.awaitNamespaceConnect(after: 1).timeout(const Duration(seconds: 20));
      expect(
        server.handshakeTokens,
        ['a-token', 'refreshed-token'],
        reason: 'a reused Socket presents the original token forever',
      );

      await h.client.dispose();
    });

    test('a disconnect() cancels the pending retry rather than being undone by it',
        () async {
      final h = build(baseUrl: server.url);
      await h.client.connect();
      await server.awaitNamespaceConnect().timeout(const Duration(seconds: 10));

      final reconnecting = h.client.status
          .firstWhere((s) => s == RealtimeStatus.reconnecting)
          .timeout(const Duration(seconds: 10));
      server.sendServerDisconnect();
      await reconnecting;

      // The user signs out while the retry is pending.
      await h.client.disconnect();
      final readsAtSignOut = h.reads();

      // Well past the 2s floor: a cancelled retry reads no token and builds no
      // socket, so a signed-out client cannot be resurrected by its own timer.
      await Future<void>.delayed(const Duration(seconds: 3));
      expect(h.reads(), readsAtSignOut);
      expect(h.client.currentStatus, RealtimeStatus.disconnected);
      expect(server.namespaceConnects, 1);

      await h.client.dispose();
    });
  });

  /// The other half of the discriminator: forcing a fresh Manager must not turn
  /// an ordinary network drop into the terminal path.
  ///
  /// A transport close is the one case the library still owns -- it keeps the
  /// socket and reconnects on its own. Our terminal branch is what re-enters
  /// `_open()`, and `_open()` is the only thing that reads the token. So an
  /// unchanged read count IS the proof that the library, not D3, did the work.
  group('ordinary transport close', () {
    late _FakeSocketIoServer server;

    setUp(() async => server = await _FakeSocketIoServer.start());
    tearDown(() async => server.stop());

    test('is left to the library, and is not taken as terminal', () async {
      final h = build(baseUrl: server.url);
      final connected = h.client.status
          .firstWhere((s) => s == RealtimeStatus.connected)
          .timeout(const Duration(seconds: 10));
      await h.client.connect();
      await connected;
      expect(h.reads(), 1);

      // The socket goes away with no `41`: a network drop, not a decision.
      await server.dropTransport();

      await server.awaitNamespaceConnect(after: 1).timeout(const Duration(seconds: 20));
      expect(
        h.reads(),
        1,
        reason: 'the library reconnected; _open() must not have run a second time',
      );

      await h.client.dispose();
    });
  });

  test('reconnect behaviour is intact: subscriptions are still remembered', () async {
    final h = build();
    await h.client.connect();

    // subscribe() records the wanted conversation even when the socket is not
    // up, so the onConnect handler can re-send it. That is what makes a
    // reconnect resume a live conversation instead of a silent one.
    final typing = await h.client.subscribe('conv-1');
    expect(typing, isEmpty);

    await h.client.disconnect();
    await h.client.dispose();
  });
}

/// The smallest Socket.IO server that can answer this client.
///
/// It speaks only the four frames these tests need — Engine.IO OPEN, namespace
/// CONNECT, an event, and namespace DISCONNECT — because the one behaviour
/// under test (a server-initiated disconnect) cannot be produced any other way:
/// it originates on the wire, and the client's own `disconnect()` takes a
/// different path. It is deliberately NOT a general-purpose implementation.
///
/// Frames, for the reader: `0` open, `40` connect, `41` disconnect,
/// `42[...]` event, `2`/`3` ping/pong.
class _FakeSocketIoServer {
  _FakeSocketIoServer._(this._http);

  final HttpServer _http;
  WebSocket? _ws;

  int namespaceConnects = 0;
  final List<String> subscribedConversations = [];

  /// The `auth` payload of each namespace CONNECT, in order. The client sends
  /// it as the CONNECT frame's data, so a Socket that was reused rather than
  /// rebuilt shows up here as the SAME token appearing twice.
  final List<String?> handshakeTokens = [];

  final _connected = StreamController<void>.broadcast();
  final _subscribes = StreamController<String>.broadcast();

  static Future<_FakeSocketIoServer> start() async {
    final http = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final server = _FakeSocketIoServer._(http);
    unawaited(server._accept());
    return server;
  }

  String get url => 'http://127.0.0.1:${_http.port}';

  Future<void> _accept() async {
    await for (final request in _http) {
      final ws = await WebSocketTransformer.upgrade(request);
      _ws = ws;

      // Engine.IO OPEN. A long ping interval keeps the heartbeat out of these
      // tests: nothing here is about liveness.
      ws.add('0${jsonEncode({
            'sid': 'fake-sid',
            'upgrades': <String>[],
            'pingInterval': 600000,
            'pingTimeout': 600000,
          })}');

      ws.listen(_onFrame, onError: (_) {}, cancelOnError: false);
    }
  }

  void _onFrame(dynamic raw) {
    final frame = raw is String ? raw : '';

    if (frame == '2') {
      _ws?.add('3'); // ping -> pong
      return;
    }

    if (frame.startsWith('40')) {
      namespaceConnects += 1;
      final auth = frame.length > 2 ? jsonDecode(frame.substring(2)) : null;
      handshakeTokens.add(auth is Map ? auth['token'] as String? : null);
      _ws?.add('40${jsonEncode({'sid': 'fake-nsp-sid'})}');
      if (!_connected.isClosed) _connected.add(null);
      return;
    }

    // `42["event",payload]`, optionally with an ack id: `420[...]`.
    if (frame.startsWith('42')) {
      final open = frame.indexOf('[');
      if (open < 0) return;
      final ackId = frame.substring(2, open);
      final decoded = jsonDecode(frame.substring(open));
      if (decoded is! List || decoded.isEmpty) return;

      if (decoded.first == RealtimeEvent.subscribe) {
        final payload = decoded.length > 1 ? decoded[1] : null;
        final id = payload is Map ? payload['conversationId'] as String? : null;
        if (id != null) {
          subscribedConversations.add(id);
          if (!_subscribes.isClosed) _subscribes.add(id);
        }
        // Only an ack-bearing emit expects a reply; the re-subscribe after a
        // reconnect is a plain emit and must not be answered.
        if (ackId.isNotEmpty) {
          _ws?.add('43$ackId${jsonEncode([
                {'ok': true, 'typing': <String>[]}
              ])}');
        }
      }
    }
  }

  Future<void> awaitNamespaceConnect({int after = 0}) => namespaceConnects > after
      ? Future<void>.value()
      : _connected.stream.firstWhere((_) => namespaceConnects > after);

  Future<void> awaitSubscribe(String conversationId) =>
      _subscribes.stream.firstWhere((id) => id == conversationId);

  void clearObservedSubscribes() => subscribedConversations.clear();

  /// An ordinary transport failure: the socket goes away WITHOUT a namespace
  /// DISCONNECT frame. That is what a network drop looks like on the wire, and
  /// the library -- not our terminal branch -- is what must bring it back.
  Future<void> dropTransport() async {
    final ws = _ws;
    _ws = null;
    await ws?.close();
  }

  /// The frame this whole group exists for: a namespace DISCONNECT, which the
  /// client treats as terminal and never reconnects from on its own.
  void sendServerDisconnect() => _ws?.add('41');

  Future<void> stop() async {
    await _connected.close();
    await _subscribes.close();
    await _ws?.close();
    await _http.close(force: true);
  }
}
