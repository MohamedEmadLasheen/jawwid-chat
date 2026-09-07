import 'dart:async';

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
      build() {
    var reads = 0;
    String? token = 'a-token';
    final client = SocketIoRealtimeClient(
      // Port 1 is closed; nothing here needs the connection to succeed, only
      // the attempt to be counted.
      baseUrl: 'http://127.0.0.1:1',
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
