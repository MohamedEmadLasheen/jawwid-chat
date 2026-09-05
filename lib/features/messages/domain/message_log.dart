import '../../../shared/models/message.dart';

/// The ordered, de-duplicated set of messages for one conversation.
///
/// This is the single place where ordering and identity are decided, because getting either
/// wrong is what produces the failure §18 warns about — "the same conversation should not
/// show messages in contradictory order across devices".
///
/// Rules, in order of precedence:
///
/// 1. **Identity is [Message.clientMessageId] when we have one, otherwise [Message.id].**
///    A message we sent arrives back from the server with an id we have never seen; without
///    keying on the client id it would appear twice.
/// 2. **Confirmed messages sort by the server's [Message.sequence]**, never by local clock.
/// 3. **Pending messages sort after every confirmed message**, in the order they were
///    composed, so the composer always appends to the bottom.
class MessageLog {
  const MessageLog._(this._byKey, this.messages, this.oldestCursor, this.hasMoreOlder);

  factory MessageLog.empty() => const MessageLog._({}, [], null, true);

  final Map<String, Message> _byKey;

  /// Ordered oldest → newest, ready to render.
  final List<Message> messages;

  /// Cursor for the next page of *older* messages (§19). Null when unknown.
  final String? oldestCursor;

  final bool hasMoreOlder;

  bool get isEmpty => messages.isEmpty;
  int get length => messages.length;

  static String _keyOf(Message m) =>
      m.clientMessageId.isNotEmpty ? m.clientMessageId : (m.id ?? '');

  /// Merge [incoming] into the log.
  ///
  /// Used identically for the first page, older pages, realtime arrivals, and local echoes —
  /// one code path, so reconnect reconciliation cannot drift from initial load (§49).
  MessageLog merge(
    Iterable<Message> incoming, {
    String? oldestCursor,
    bool? hasMoreOlder,
  }) {
    final next = Map<String, Message>.from(_byKey);

    for (final message in incoming) {
      final key = _keyOf(message);
      if (key.isEmpty) continue;

      final existing = next[key];
      next[key] = existing == null ? message : _reconcile(existing, message);
    }

    return MessageLog._(
      next,
      _sorted(next.values),
      oldestCursor ?? this.oldestCursor,
      hasMoreOlder ?? this.hasMoreOlder,
    );
  }

  /// Decide which of two versions of the same message wins.
  ///
  /// The server's view wins on everything it asserts, but a *local* state must never be
  /// allowed to overwrite a confirmed one — otherwise a slow retry could drag a delivered
  /// message back to "sending".
  static Message _reconcile(Message existing, Message incoming) {
    final incomingIsConfirmed = !incoming.deliveryState.isLocal;
    final existingIsConfirmed = !existing.deliveryState.isLocal;

    if (incomingIsConfirmed) return incoming;
    if (existingIsConfirmed) return existing;

    // Both local: the newer local state wins (queued → sending → failed).
    return incoming;
  }

  static List<Message> _sorted(Iterable<Message> all) {
    final confirmed = <Message>[];
    final pending = <Message>[];

    for (final m in all) {
      if (m.sequence != null) {
        confirmed.add(m);
      } else {
        pending.add(m);
      }
    }

    confirmed.sort((a, b) {
      final bySequence = a.sequence!.compareTo(b.sequence!);
      if (bySequence != 0) return bySequence;
      return a.clientMessageId.compareTo(b.clientMessageId);
    });

    pending.sort((a, b) {
      final byTime = a.createdAt.compareTo(b.createdAt);
      if (byTime != 0) return byTime;
      return a.clientMessageId.compareTo(b.clientMessageId);
    });

    return List.unmodifiable([...confirmed, ...pending]);
  }

  /// Replace one message in place, keyed by client id. Used for delivery-state and
  /// approval-state transitions arriving over realtime.
  MessageLog updateOne(String clientMessageId, Message Function(Message) update) {
    final existing = _byKey[clientMessageId];
    if (existing == null) return this;

    final next = Map<String, Message>.from(_byKey)
      ..[clientMessageId] = update(existing);
    return MessageLog._(next, _sorted(next.values), oldestCursor, hasMoreOlder);
  }

  Message? byClientId(String clientMessageId) => _byKey[clientMessageId];

  /// The highest sequence we hold, used as the resync watermark after a reconnect (§49).
  int? get highestSequence {
    int? highest;
    for (final m in messages) {
      final s = m.sequence;
      if (s != null && (highest == null || s > highest)) highest = s;
    }
    return highest;
  }
}
