import 'dart:async';
import 'dart:math' as math;

/// Where an outgoing message is in the send pipeline.
enum OutboxState { queued, sending, failed }

/// The durable record of the queue's state.
///
/// Declared here, in the domain, and implemented by the sqlite store in
/// `data/`: the queue's RULES must stay testable without a database, and the
/// dependency has to point inwards or the domain would import its own storage.
///
/// Only STATE transitions travel through this. A message's payload is written
/// once, by whoever enqueued it and therefore has it; the outbox never sees a
/// body and has no business persisting one.
abstract interface class OutboxJournal {
  Future<void> update(OutboxEntry entry);
  Future<void> remove(String clientMessageId);
}

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
    OutboxJournal? journal,
  })  : _baseBackoff = baseBackoff,
        _maxBackoff = maxBackoff,
        _journal = journal;

  final int maxAttempts;
  final Duration _baseBackoff;
  final Duration _maxBackoff;

  /// Where the queue survives a restart. Null in tests about the RULES, and in
  /// a build with no filesystem.
  final OutboxJournal? _journal;

  /// Journal writes, chained.
  ///
  /// The mutators stay SYNCHRONOUS on purpose. They are called from the send
  /// path and from a Riverpod notifier, and making them async would turn every
  /// call site — and every existing test of the ordering rules — into an await
  /// for a local disk write that nothing needs to wait for. Chaining the
  /// futures instead preserves write ORDER, which is the property that actually
  /// matters: a `failed` must never land after the `queued` that superseded it.
  ///
  /// The crash window this leaves is honest and bounded. A process that dies
  /// between the in-memory transition and its journal write restores the
  /// PREVIOUS state of that entry — never a lost entry, because the entry
  /// itself was written when it was enqueued, and never a duplicate, because
  /// the client message id is unchanged and the server deduplicates on it. The
  /// worst case is one extra attempt.
  Future<void> _writes = Future.value();

  /// Resolves when every journal write issued so far has landed. For tests, and
  /// for a clean shutdown.
  Future<void> get flushed => _writes;

  void _journalUpdate(OutboxEntry entry) {
    final journal = _journal;
    if (journal == null) return;
    _writes = _writes.then((_) => journal.update(entry)).catchError((Object _) {
      // A failed local write must not take the send path down with it. The
      // entry is still in memory and still sends; what is lost is only its
      // durability across a restart, and surfacing that as an error for
      // something the user did not do would be worse than the risk.
    });
  }

  void _journalRemove(String clientMessageId) {
    final journal = _journal;
    if (journal == null) return;
    _writes =
        _writes.then((_) => journal.remove(clientMessageId)).catchError((Object _) {});
  }

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

  /// Re-seat entries read back from the journal at startup.
  ///
  /// Separate from [enqueue] because it must NOT journal: these entries came
  /// from the journal, and writing them straight back would be a round trip for
  /// nothing. Order is the caller's — the store returns them oldest first, and
  /// per-conversation order is the whole point of the queue.
  void restore(Iterable<OutboxEntry> entries) {
    for (final entry in entries) {
      final queue = _byConversation.putIfAbsent(entry.conversationId, () => []);
      if (queue.any((e) => e.clientMessageId == entry.clientMessageId)) continue;
      queue.add(entry);
    }
  }

  /// Every conversation with anything queued. The app-level drain needs this:
  /// a message queued while offline must send after a restart whether or not
  /// its conversation is the one on screen.
  List<String> get conversationIds => List.unmodifiable(_byConversation.keys);

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
    _journalRemove(clientMessageId);
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
          // Every transition is journalled from the one place that performs
          // one, so a new mutator cannot forget to persist itself.
          _journalUpdate(queue[i]);
          return;
        }
      }
    }
  }

  void clear() => _byConversation.clear();
}
