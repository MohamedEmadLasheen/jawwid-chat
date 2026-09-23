import 'dart:async';

import 'realtime_events.dart';

/// The app's realtime transport.
///
/// ONE TRANSPORT, SHARED. Notifications need it first, but nothing about this
/// interface is notification-shaped: it carries every event in the server's
/// contract and hands them to whoever is listening. When the messages feature
/// starts consuming `message.created` it adds a listener to [events], not a
/// second socket — which matters because a second socket would mean a second
/// authentication, a second reconnect policy, and two answers to "am I online".
///
/// REALTIME IS NOT THE SOURCE OF TRUTH. Everything that arrives here is already
/// in the database and reachable over HTTP. A missed event costs latency, never
/// a notification, which is why nothing in this interface offers delivery
/// guarantees, replay or acknowledgement — offering them would invite a caller
/// to depend on them.
abstract interface class RealtimeClient {
  /// Every event from the server, already filtered to the known contract.
  Stream<RealtimeEvent> get events;

  /// Transport state, for the UI and for deciding when to re-sync.
  Stream<RealtimeStatus> get status;

  RealtimeStatus get currentStatus;

  /// Connect, or re-connect with a fresh credential.
  ///
  /// Idempotent for the same token: calling it twice does not open two sockets.
  /// Called again with a different token — after a refresh — it reconnects,
  /// because the server authenticates once at handshake and an expired token
  /// cannot be swapped in on a live connection.
  Future<void> connect(String accessToken);

  /// Drop the connection. Called on sign-out, so a revoked session's socket
  /// does not outlive it.
  Future<void> disconnect();

  /// Ask the server to join a conversation room. Authorization is the server's:
  /// it runs the same check the REST path does and refuses if it says no.
  Future<bool> subscribeConversation(String conversationId);

  Future<void> unsubscribeConversation(String conversationId);

  void dispose();
}

/// A [RealtimeClient] that connects to nothing.
///
/// The default in tests and in a fixture build, so no suite opens a socket. It
/// is a real implementation of the contract rather than a throwing stub: code
/// under test should exercise the same paths it does in production, and a stub
/// that threw would make "realtime is unavailable" an error case the app never
/// actually handles.
class InertRealtimeClient implements RealtimeClient {
  final _events = StreamController<RealtimeEvent>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();
  RealtimeStatus _current = RealtimeStatus.disconnected;

  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  Stream<RealtimeStatus> get status => _status.stream;

  @override
  RealtimeStatus get currentStatus => _current;

  /// Push an event as though the server had sent it. Tests only.
  void emit(String name, Map<String, Object?> payload) {
    if (!RealtimeEvents.all.contains(name)) return;
    _events.add(RealtimeEvent(name: name, payload: payload));
  }

  void setStatus(RealtimeStatus status) {
    _current = status;
    _status.add(status);
  }

  @override
  Future<void> connect(String accessToken) async =>
      setStatus(RealtimeStatus.connected);

  @override
  Future<void> disconnect() async => setStatus(RealtimeStatus.disconnected);

  @override
  Future<bool> subscribeConversation(String conversationId) async => true;

  @override
  Future<void> unsubscribeConversation(String conversationId) async {}

  @override
  void dispose() {
    _events.close();
    _status.close();
  }
}
