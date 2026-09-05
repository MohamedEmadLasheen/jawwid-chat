import 'dart:math' as math;

/// Where an outgoing message is in the send pipeline.
enum OutboxState { queued, sending, failed }

/// One queued outgoing message.
///
/// [clientMessageId] is assigned at compose time and is **never regenerated** — that is the
/// whole basis of the idempotency guarantee in §16/§17. A retry re-sends the same entry.
class OutboxEntry {
  const OutboxEntry({
    required this.clientMessageId,
    required this.conversationId,
    required this.enqueuedAt,
    this.state = OutboxState.queued,
    this.attempts = 0,
    this.nextAttemptAt,
    this.lastFailureCode,
  });

  final String clientMessageId;
  final String conversationId;
  final DateTime enqueuedAt;
  final OutboxState state;
  final int attempts;

  /// Earliest time this entry may be attempted again. Null means "immediately".
  final DateTime? nextAttemptAt;

  final String? lastFailureCode;

  OutboxEntry copyWith({
    OutboxState? state,
    int? attempts,
    DateTime? nextAttemptAt,
    bool clearNextAttempt = false,
    String? lastFailureCode,
  }) {
    return OutboxEntry(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      enqueuedAt: enqueuedAt,
      state: state ?? this.state,
      attempts: attempts ?? this.attempts,
      nextAttemptAt: clearNextAttempt ? null : (nextAttemptAt ?? this.nextAttemptAt),
      lastFailureCode: lastFailureCode ?? this.lastFailureCode,
    );
  }
}

/// The offline send queue (§17).
///
/// Two properties matter more than anything else here:
///
/// * **Order is preserved per conversation.** Only the *head* entry of a conversation is ever
///   eligible to send. If message 1 is stuck retrying, message 2 waits behind it rather than
///   overtaking it — otherwise a flaky network would silently reorder a user's messages.
/// * **Retries reuse the same entry**, so the server sees the same `client_message_id` and
///   deduplicates instead of creating a second message.
///
/// Conversations are independent of each other: a stalled group does not block the Jawwid
/// thread.
class Outbox {
  Outbox({
    this.maxAttempts = 8,
    Duration baseBackoff = const Duration(seconds: 2),
    Duration maxBackoff = const Duration(minutes: 5),
  })  : _baseBackoff = baseBackoff,
        _maxBackoff = maxBackoff;

  final int maxAttempts;
  final Duration _baseBackoff;
  final Duration _maxBackoff;

  /// Insertion-ordered per conversation.
  final Map<String, List<OutboxEntry>> _byConversation = {};

  List<OutboxEntry> entriesFor(String conversationId) =>
      List.unmodifiable(_byConversation[conversationId] ?? const []);

  int get length =>
      _byConversation.values.fold(0, (sum, list) => sum + list.length);

  bool get isEmpty => length == 0;

  /// Add a newly composed message to the tail of its conversation's queue.
  ///
  /// Enqueuing an id that is already queued is a no-op — this is what makes an accidental
  /// double-tap on "send" harmless (§71).
  void enqueue(OutboxEntry entry) {
    final queue = _byConversation.putIfAbsent(entry.conversationId, () => []);
    final alreadyQueued =
        queue.any((e) => e.clientMessageId == entry.clientMessageId);
    if (alreadyQueued) return;
    queue.add(entry);
  }

  /// The next entry eligible to be sent for [conversationId], or null.
  ///
  /// Returns the head only, and only when it is not already in flight and its backoff has
  /// elapsed.
  OutboxEntry? nextReady(String conversationId, DateTime now) {
    final queue = _byConversation[conversationId];
    if (queue == null || queue.isEmpty) return null;

    final head = queue.first;
    if (head.state == OutboxState.sending) return null;

    final notBefore = head.nextAttemptAt;
    if (notBefore != null && now.isBefore(notBefore)) return null;

    return head;
  }

  /// Every conversation with an entry ready to send at [now].
  List<OutboxEntry> allReady(DateTime now) {
    final ready = <OutboxEntry>[];
    for (final conversationId in _byConversation.keys) {
      final entry = nextReady(conversationId, now);
      if (entry != null) ready.add(entry);
    }
    return ready;
  }

  void markSending(String clientMessageId) {
    _mutate(
      clientMessageId,
      (e) => e.copyWith(
        state: OutboxState.sending,
        attempts: e.attempts + 1,
        clearNextAttempt: true,
      ),
    );
  }

  /// The server accepted it; drop it from the queue.
  void markSent(String clientMessageId) {
    for (final queue in _byConversation.values) {
      queue.removeWhere((e) => e.clientMessageId == clientMessageId);
    }
    _byConversation.removeWhere((_, queue) => queue.isEmpty);
  }

  /// The attempt failed.
  ///
  /// [retryable] false — a policy rejection, a validation failure — parks the entry as
  /// [OutboxState.failed] with no scheduled retry, because retrying it would only fail
  /// again (§3: "do not retry indefinitely"). The user is offered an explicit retry.
  void markFailed(
    String clientMessageId,
    DateTime now, {
    required bool retryable,
    String? failureCode,
  }) {
    _mutate(clientMessageId, (e) {
      final exhausted = e.attempts >= maxAttempts;
      final scheduleRetry = retryable && !exhausted;

      return e.copyWith(
        state: OutboxState.failed,
        nextAttemptAt: scheduleRetry ? now.add(backoffFor(e.attempts)) : null,
        clearNextAttempt: !scheduleRetry,
        lastFailureCode: failureCode,
      );
    });
  }

  /// User-initiated retry: clears the backoff so the entry is immediately eligible. The
  /// entry — and therefore the client message id — is untouched.
  void retryNow(String clientMessageId) {
    _mutate(
      clientMessageId,
      (e) => e.copyWith(state: OutboxState.queued, clearNextAttempt: true),
    );
  }

  /// Remove an entry the user abandoned.
  void discard(String clientMessageId) => markSent(clientMessageId);

  /// Exponential backoff, capped. [attempts] is the number already made.
  Duration backoffFor(int attempts) {
    if (attempts <= 0) return Duration.zero;
    final exponent = math.min(attempts - 1, 20);
    final millis = _baseBackoff.inMilliseconds * math.pow(2, exponent);
    final capped = math.min(millis, _maxBackoff.inMilliseconds.toDouble());
    return Duration(milliseconds: capped.round());
  }

  void _mutate(String clientMessageId, OutboxEntry Function(OutboxEntry) update) {
    for (final queue in _byConversation.values) {
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].clientMessageId == clientMessageId) {
          queue[i] = update(queue[i]);
          return;
        }
      }
    }
  }

  void clear() => _byConversation.clear();
}
