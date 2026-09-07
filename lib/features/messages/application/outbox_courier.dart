import 'dart:async';

import 'package:uuid/uuid.dart';

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/message.dart';
import '../data/outbox_store.dart';
import '../domain/outbox.dart';

/// What happened to one queued message. Consumed by whichever conversation is
/// on screen, so its bubbles follow the queue rather than duplicating its rules.
sealed class OutboxSignal {
  const OutboxSignal({required this.clientMessageId, required this.conversationId});
  final String clientMessageId;
  final String conversationId;
}

class OutboxSending extends OutboxSignal {
  const OutboxSending({required super.clientMessageId, required super.conversationId});
}

class OutboxQueued extends OutboxSignal {
  const OutboxQueued({required super.clientMessageId, required super.conversationId});
}

class OutboxAccepted extends OutboxSignal {
  const OutboxAccepted({
    required super.clientMessageId,
    required super.conversationId,
    required this.message,
  });

  /// The server's version, which supersedes the local echo.
  final Message message;
}

class OutboxRejected extends OutboxSignal {
  const OutboxRejected({
    required super.clientMessageId,
    required super.conversationId,
    required this.error,
  });

  final AppError error;
}

/// The app's ONE outgoing queue, and the thing that empties it.
///
/// ## Why this is not on the chat screen's controller
///
/// It used to be. `MessagesController` held an `Outbox` and a map of bodies as
/// plain fields, and Riverpod disposed both when the user left the
/// conversation. That meant a message composed on a train survived exactly as
/// long as the screen it was typed on: backgrounding the app, opening another
/// chat, or the OS reclaiming memory all silently discarded it, and the user
/// had been shown a message bubble saying it was queued.
///
/// A queue whose lifetime is a screen's is not an offline queue. This one is
/// owned by the application, restored from the local database at startup, and
/// drained whenever there is a network — regardless of which conversation, if
/// any, the user is looking at. The screen SUBSCRIBES to it.
///
/// ## Ordering
///
/// Per conversation, only the HEAD entry is ever in flight, so a message stuck
/// retrying is not overtaken by the one typed after it — a flaky network must
/// not silently reorder somebody's words. Conversations are independent: a
/// stalled group does not hold up the Jawwid thread. Both rules live in
/// [Outbox] and are unchanged; this class only gives them a lifetime and a
/// disk.
///
/// ## Duplicates
///
/// Every retry re-sends the SAME `clientMessageId`, generated once at compose
/// time and never regenerated — across backoff, reconnect, app restart and
/// device restart. The server's unique index on it collapses a second arrival
/// into the first. The client cannot guarantee this alone and does not claim
/// to: the guarantee is the pair.
class OutboxCourier {
  OutboxCourier({
    required MessageRepository messages,
    required OutboxStore store,
    Outbox? outbox,
    Uuid uuid = const Uuid(),
  })  : _messages = messages,
        _store = store,
        _uuid = uuid,
        _outbox = outbox ?? Outbox(journal: store);

  final MessageRepository _messages;
  final OutboxStore _store;
  final Outbox _outbox;
  final Uuid _uuid;

  final _signals = StreamController<OutboxSignal>.broadcast();

  /// The payload for each queued client id, so a retry re-sends the original
  /// body rather than reconstructing it. Rebuilt from the database on restore.
  final _payloads = <String, OutgoingMessage>{};

  Timer? _timer;
  bool _draining = false;
  bool _disposed = false;

  Stream<OutboxSignal> get signals => _signals.stream;

  /// Resolves when every journal write issued so far has landed.
  ///
  /// The queue's mutators are synchronous by design (see [Outbox]), so a test
  /// that wants to read the DATABASE rather than the in-memory queue has to
  /// wait for the writes to catch up. Nothing in the app calls this; a test
  /// asserting durability must.
  Future<void> flushJournal() => _outbox.flushed;

  /// Everything queued for one conversation, for the screen to render.
  List<OutboxEntry> entriesFor(String conversationId) =>
      _outbox.entriesFor(conversationId);

  OutgoingMessage? payloadFor(String clientMessageId) => _payloads[clientMessageId];

  int get length => _outbox.length;

  /// Read the queue back from disk. Call once, at startup, before the first
  /// drain.
  ///
  /// Anything found here was composed in a previous run of this process and
  /// never acknowledged — which is exactly the case §10 requires to survive:
  /// app backgrounded, app killed, device restarted, process crashed.
  Future<int> restore() async {
    final persisted = await _store.load();
    _outbox.restore(persisted.map((p) => p.entry));
    for (final row in persisted) {
      _payloads[row.payload.clientMessageId] = row.payload;
    }
    return persisted.length;
  }

  /// Compose and queue. Returns the client id, which is also the idempotency
  /// key, so the caller can track this message.
  ///
  /// The payload is written to disk BEFORE the entry is queued in memory: an
  /// entry with no payload is unsendable, and the order that can leave one
  /// behind is the other one.
  Future<String> enqueue({
    required String conversationId,
    required String body,
    MessageKind kind = MessageKind.text,
    String? replyToMessageId,
    List<String> attachmentIds = const [],
  }) =>
      enqueueWithId(
        clientMessageId: _uuid.v4(),
        conversationId: conversationId,
        body: body,
        kind: kind,
        replyToMessageId: replyToMessageId,
        attachmentIds: attachmentIds,
      );

  /// Queue a message whose client id the caller has already minted.
  ///
  /// The chat screen needs the id BEFORE this returns, to key the optimistic
  /// bubble it puts on screen in the same frame as the tap. Handing the id in
  /// rather than waiting for one out keeps the echo and the queue entry the
  /// same message — and the id is the idempotency key, so there must be exactly
  /// one of it.
  Future<String> enqueueWithId({
    required String clientMessageId,
    required String conversationId,
    required String body,
    MessageKind kind = MessageKind.text,
    String? replyToMessageId,
    List<String> attachmentIds = const [],
  }) async {
    final payload = OutgoingMessage(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      kind: kind,
      body: body,
      replyToMessageId: replyToMessageId,
      attachmentIds: attachmentIds,
    );
    final entry = OutboxEntry(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      enqueuedAt: DateTime.now(),
    );

    _payloads[clientMessageId] = payload;
    await _store.save(entry, payload);
    _outbox.enqueue(entry);

    unawaited(drain());
    return clientMessageId;
  }

  /// Release whatever is ready, across EVERY conversation.
  ///
  /// Re-entrant calls are collapsed rather than queued: the drain loops until
  /// nothing is ready, so a second concurrent pass would only race the first
  /// for the same head entries.
  Future<void> drain() async {
    if (_disposed || _draining) return;
    _draining = true;
    try {
      var progressed = true;
      while (progressed && !_disposed) {
        progressed = false;
        for (final entry in _outbox.allReady(DateTime.now())) {
          if (await _send(entry)) progressed = true;
        }
      }
    } finally {
      _draining = false;
      _scheduleNext();
    }
  }

  /// Sends one entry. Returns true when the queue moved, so the loop knows
  /// whether another pass could achieve anything.
  Future<bool> _send(OutboxEntry entry) async {
    final outgoing = _payloads[entry.clientMessageId];
    if (outgoing == null) {
      // Unsendable: no payload under this id. Dropping it is the only option
      // that terminates — retrying it forever would spin on nothing.
      _outbox.discard(entry.clientMessageId);
      return true;
    }

    _outbox.markSending(entry.clientMessageId);
    _emit(OutboxSending(
      clientMessageId: entry.clientMessageId,
      conversationId: entry.conversationId,
    ));

    try {
      final confirmed = await _messages.send(outgoing);
      _outbox.markSent(entry.clientMessageId);
      _payloads.remove(entry.clientMessageId);
      _emit(OutboxAccepted(
        clientMessageId: entry.clientMessageId,
        conversationId: entry.conversationId,
        message: confirmed,
      ));
      return true;
    } catch (error) {
      final failure = ErrorMapper.map(error);
      _outbox.markFailed(
        entry.clientMessageId,
        DateTime.now(),
        // A policy refusal or a validation failure fails identically forever,
        // so it is parked for an explicit retry rather than re-attempted.
        retryable: failure.isTransient,
        failureCode: failure.code,
      );
      _emit(OutboxRejected(
        clientMessageId: entry.clientMessageId,
        conversationId: entry.conversationId,
        error: failure,
      ));
      return false;
    }
  }

  /// User-initiated retry. Reuses the entry, and therefore the client id.
  Future<void> retry(String clientMessageId) async {
    final entry = _entry(clientMessageId);
    if (entry == null) return;
    _outbox.retryNow(clientMessageId);
    _emit(OutboxQueued(
      clientMessageId: clientMessageId,
      conversationId: entry.conversationId,
    ));
    await drain();
  }

  /// The user abandoned it.
  Future<void> discard(String clientMessageId) async {
    _outbox.discard(clientMessageId);
    _payloads.remove(clientMessageId);
    await _store.remove(clientMessageId);
  }

  /// Everything this account queued, gone. Called on logout: queued words
  /// belong to whoever composed them, and the next person to sign in on this
  /// device must not send them.
  Future<void> clear() async {
    _timer?.cancel();
    _timer = null;
    _outbox.clear();
    _payloads.clear();
    await _store.clear();
  }

  OutboxEntry? _entry(String clientMessageId) {
    for (final conversationId in _outbox.conversationIds) {
      for (final entry in _outbox.entriesFor(conversationId)) {
        if (entry.clientMessageId == clientMessageId) return entry;
      }
    }
    return null;
  }

  /// Re-arm for whenever the soonest backoff expires.
  ///
  /// One timer for the whole queue, set to the EARLIEST deadline across every
  /// conversation — not one per conversation, which would be a timer per
  /// stalled thread.
  void _scheduleNext() {
    _timer?.cancel();
    _timer = null;
    if (_disposed) return;

    DateTime? soonest;
    for (final conversationId in _outbox.conversationIds) {
      for (final entry in _outbox.entriesFor(conversationId)) {
        final at = entry.nextAttemptAt;
        if (at == null) continue;
        if (soonest == null || at.isBefore(soonest)) soonest = at;
      }
    }
    if (soonest == null) return;

    final delay = soonest.difference(DateTime.now());
    _timer = Timer(delay.isNegative ? Duration.zero : delay, () => unawaited(drain()));
  }

  void _emit(OutboxSignal signal) {
    if (!_signals.isClosed) _signals.add(signal);
  }

  Future<void> dispose() async {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    // Let the journal finish, so a shutdown does not truncate the record of
    // what is queued.
    await _outbox.flushed;
    await _signals.close();
  }
}
