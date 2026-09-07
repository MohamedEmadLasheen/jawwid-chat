import 'dart:async';

import '../logging/redacting_logger.dart';
import 'realtime_events.dart';

/// The realtime transport, as the rest of the app sees it.
///
/// An interface rather than the socket itself, for the reason every other
/// transport here is one: the controllers and their tests must be able to drive
/// arrivals, reconnects and out-of-order delivery deterministically, and none
/// of that is testable against a real socket.
abstract interface class RealtimeClient {
  Stream<RealtimeEnvelope> get events;

  Stream<RealtimeStatus> get status;

  RealtimeStatus get currentStatus;

  /// Open the connection. Safe to call when already connected.
  Future<void> connect();

  /// Ask to receive events for a conversation.
  ///
  /// The server authorizes this exactly as it authorizes reading the
  /// conversation over HTTP; a refusal means the actor may not read it, and the
  /// client must not retry it as though it were a network fault.
  ///
  /// Returns the actors already typing there, so an indicator that started
  /// before this client joined is not invisible until the next keystroke.
  Future<List<String>> subscribe(String conversationId);

  Future<void> unsubscribe(String conversationId);

  Future<void> setTyping(String conversationId, {required bool isTyping});

  /// Acknowledge that these messages are on this device.
  ///
  /// This is what makes DELIVERED honest: it is asserted by the recipient's
  /// client when it actually holds the message, not inferred by the sender.
  Future<void> acknowledgeDelivered(List<String> messageIds);

  Future<void> disconnect();

  Future<void> dispose();
}

/// A [RealtimeClient] that is never connected.
///
/// Used by the fixture build and by tests that are not about realtime. It is
/// silent rather than throwing: a missing realtime connection degrades the app
/// to polling-by-refresh, which is a worse experience but not a failure, and an
/// exception here would surface an error for something the user did not ask
/// for.
class OfflineRealtimeClient implements RealtimeClient {
  OfflineRealtimeClient({RedactingLogger logger = const RedactingLogger()})
      : _logger = logger;

  final RedactingLogger _logger;
  final _events = StreamController<RealtimeEnvelope>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();

  @override
  Stream<RealtimeEnvelope> get events => _events.stream;

  @override
  Stream<RealtimeStatus> get status => _status.stream;

  @override
  RealtimeStatus get currentStatus => RealtimeStatus.idle;

  @override
  Future<void> connect() async =>
      _logger.debug('realtime disabled for this build');

  @override
  Future<List<String>> subscribe(String conversationId) async => const [];

  @override
  Future<void> unsubscribe(String conversationId) async {}

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {}

  @override
  Future<void> acknowledgeDelivered(List<String> messageIds) async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<void> dispose() async {
    await _events.close();
    await _status.close();
  }
}

/// A [RealtimeClient] driven by the test, for deterministic arrival scenarios.
///
/// Exists in `lib/` rather than `test/` because the fixture build uses it to
/// exercise the chat screen without a backend.
class FakeRealtimeClient implements RealtimeClient {
  final _events = StreamController<RealtimeEnvelope>.broadcast();
  final _status = StreamController<RealtimeStatus>.broadcast();

  RealtimeStatus _current = RealtimeStatus.idle;

  /// Every conversation this client is subscribed to, in subscription order.
  final List<String> subscriptions = [];

  /// Every delivery acknowledgement made, for asserting the receipt path.
  final List<String> acknowledged = [];

  /// Typing frames sent, as (conversationId, isTyping).
  final List<(String, bool)> typingFrames = [];

  /// Actors the server should report as already typing on subscribe.
  List<String> typingOnSubscribe = const [];

  @override
  Stream<RealtimeEnvelope> get events => _events.stream;

  @override
  Stream<RealtimeStatus> get status => _status.stream;

  @override
  RealtimeStatus get currentStatus => _current;

  /// Push an event as though the server had sent it.
  void emit(String event, Map<String, Object?> payload) =>
      _events.add(RealtimeEnvelope(event, payload));

  /// Move the connection, as a flaky network would.
  void moveTo(RealtimeStatus next) {
    _current = next;
    _status.add(next);
  }

  @override
  Future<void> connect() async => moveTo(RealtimeStatus.connected);

  @override
  Future<List<String>> subscribe(String conversationId) async {
    subscriptions.add(conversationId);
    return typingOnSubscribe;
  }

  @override
  Future<void> unsubscribe(String conversationId) async {
    subscriptions.remove(conversationId);
  }

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {
    typingFrames.add((conversationId, isTyping));
  }

  @override
  Future<void> acknowledgeDelivered(List<String> messageIds) async {
    acknowledged.addAll(messageIds);
  }

  @override
  Future<void> disconnect() async => moveTo(RealtimeStatus.disconnected);

  @override
  Future<void> dispose() async {
    await _events.close();
    await _status.close();
  }
}
