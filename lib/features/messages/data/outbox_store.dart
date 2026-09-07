import 'package:sqflite/sqflite.dart';

import '../../../core/data/repositories.dart';
import '../../../core/storage/local_database.dart';
import '../../../shared/models/message.dart';
import '../domain/outbox.dart';

/// One persisted queue entry: its state, and the message it will send.
class PersistedOutboxEntry {
  const PersistedOutboxEntry({required this.entry, required this.payload});

  final OutboxEntry entry;
  final OutgoingMessage payload;
}

/// Where the outgoing queue survives.
///
/// An interface, so the queue's LOGIC ([Outbox]) can be tested without a
/// database and the app can run with no filesystem — and so that the sqlite
/// implementation is one replaceable thing rather than a dependency threaded
/// through the controller.
abstract interface class OutboxStore implements OutboxJournal {
  /// Everything still queued, oldest first. Called once at startup.
  Future<List<PersistedOutboxEntry>> load();

  /// Record an entry and its payload. Called on every state transition.
  Future<void> save(OutboxEntry entry, OutgoingMessage payload);

  /// Update the state of an entry already stored, leaving its payload alone.
  /// This is [OutboxJournal.update]: the queue itself writes its transitions
  /// through this interface without knowing there is a database behind it.
  @override
  Future<void> update(OutboxEntry entry);

  /// The server accepted it, or the user abandoned it.
  @override
  Future<void> remove(String clientMessageId);

  Future<void> clear();
}

/// For tests, and for a build with no filesystem. Loses everything on restart —
/// which is the behaviour this whole file exists to stop being the only one.
class InMemoryOutboxStore implements OutboxStore {
  final _rows = <String, PersistedOutboxEntry>{};

  @override
  Future<List<PersistedOutboxEntry>> load() async => _rows.values.toList()
    ..sort((a, b) => a.entry.enqueuedAt.compareTo(b.entry.enqueuedAt));

  @override
  Future<void> save(OutboxEntry entry, OutgoingMessage payload) async {
    _rows[entry.clientMessageId] = PersistedOutboxEntry(entry: entry, payload: payload);
  }

  @override
  Future<void> update(OutboxEntry entry) async {
    final existing = _rows[entry.clientMessageId];
    if (existing == null) return;
    _rows[entry.clientMessageId] =
        PersistedOutboxEntry(entry: entry, payload: existing.payload);
  }

  @override
  Future<void> remove(String clientMessageId) async => _rows.remove(clientMessageId);

  @override
  Future<void> clear() async => _rows.clear();
}

/// The real store: one row per queued message in the app's local database.
///
/// ## What a restart sees
///
/// Every entry comes back with the attempt count and the failure code it had,
/// so backoff and the retry budget are not silently reset by closing the app —
/// which would turn a permanently-refused message into an infinite retry loop
/// spread across launches, one attempt each.
///
/// The one state that does NOT come back as itself is [OutboxState.sending].
/// A row is written as `sending` immediately before the request goes out, so an
/// app that dies mid-request leaves one behind, and `sending` on load means
/// exactly "a request was in flight and this process never learned how it
/// ended". It is restored as `queued` and re-sent.
///
/// That re-send is safe, and it is safe for a stated reason rather than by
/// hope: the retry carries the SAME `client_message_id`, and the server's
/// unique index on it turns a second arrival into the same message rather than
/// a new one. This is the client half of the at-least-once contract the
/// backend outbox states on its side; neither half is sufficient alone, which
/// is why §15 says duplicate prevention may not rest on the client.
class SqliteOutboxStore implements OutboxStore {
  SqliteOutboxStore(this._database);

  final AppDatabase _database;
  Database get _db => _database.db;

  @override
  Future<List<PersistedOutboxEntry>> load() async {
    final rows = await _db.query('outbox_message', orderBy: 'enqueued_at ASC');
    return rows.map(_fromRow).toList();
  }

  @override
  Future<void> save(OutboxEntry entry, OutgoingMessage payload) async {
    await _db.insert(
      'outbox_message',
      _toRow(entry, payload),
      // The primary key is the client message id, so a re-save of the same
      // message updates it. This is what makes save() usable for both "new"
      // and "state changed" without the caller having to know which it is.
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  @override
  Future<void> update(OutboxEntry entry) async {
    await _db.update(
      'outbox_message',
      {
        'status': entry.state.name,
        'attempts': entry.attempts,
        'next_attempt_at': entry.nextAttemptAt?.millisecondsSinceEpoch,
        'last_failure_code': entry.lastFailureCode,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'client_message_id = ?',
      whereArgs: [entry.clientMessageId],
    );
  }

  @override
  Future<void> remove(String clientMessageId) async {
    await _db.delete(
      'outbox_message',
      where: 'client_message_id = ?',
      whereArgs: [clientMessageId],
    );
  }

  @override
  Future<void> clear() => _database.clear();

  Map<String, Object?> _toRow(OutboxEntry entry, OutgoingMessage payload) => {
        'client_message_id': entry.clientMessageId,
        'conversation_id': entry.conversationId,
        'status': entry.state.name,
        'attempts': entry.attempts,
        'enqueued_at': entry.enqueuedAt.millisecondsSinceEpoch,
        'next_attempt_at': entry.nextAttemptAt?.millisecondsSinceEpoch,
        'last_failure_code': entry.lastFailureCode,
        'kind': payload.kind.name,
        'body': payload.body,
        'reply_to_message_id': payload.replyToMessageId,
        // A joined string rather than a child table: the list is short, it is
        // never queried BY element, and a second table would need its own
        // migration and its own cascade for no reader.
        'attachment_ids': payload.attachmentIds.join(','),
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      };

  PersistedOutboxEntry _fromRow(Map<String, Object?> row) {
    final clientMessageId = row['client_message_id']! as String;
    final conversationId = row['conversation_id']! as String;
    final stored = row['status'] as String?;

    final attachmentIds = (row['attachment_ids'] as String? ?? '')
        .split(',')
        .where((s) => s.isNotEmpty)
        .toList();

    return PersistedOutboxEntry(
      entry: OutboxEntry(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        enqueuedAt: DateTime.fromMillisecondsSinceEpoch(row['enqueued_at']! as int),
        // See the class comment: an interrupted `sending` becomes `queued`.
        state: _restoreState(stored),
        attempts: row['attempts'] as int? ?? 0,
        nextAttemptAt: row['next_attempt_at'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(row['next_attempt_at']! as int),
        lastFailureCode: row['last_failure_code'] as String?,
      ),
      payload: OutgoingMessage(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        kind: MessageKind.values.firstWhere(
          (k) => k.name == row['kind'],
          orElse: () => MessageKind.text,
        ),
        body: row['body'] as String? ?? '',
        replyToMessageId: row['reply_to_message_id'] as String?,
        attachmentIds: attachmentIds,
      ),
    );
  }

  /// `sending` is not a state a restored entry can be in: nothing is in flight
  /// in a process that has only just started. An unrecognised value is treated
  /// the same way, because the safe direction for "I do not know what happened
  /// to this" is to try again with the same idempotency key.
  static OutboxState _restoreState(String? stored) {
    return switch (stored) {
      'failed' => OutboxState.failed,
      _ => OutboxState.queued,
    };
  }
}
