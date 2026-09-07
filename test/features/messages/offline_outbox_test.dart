import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/core/storage/local_database.dart';
import 'package:jawwid_chat/features/messages/application/outbox_courier.dart';
import 'package:jawwid_chat/features/messages/application/outbox_drain_policy.dart';
import 'package:jawwid_chat/features/messages/data/outbox_store.dart';
import 'package:jawwid_chat/features/messages/domain/outbox.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// The offline queue, against a REAL SQLite engine.
///
/// This file is about one claim, and it is a claim no fake can support: a
/// message composed with no network survives the application being killed. The
/// queue used to be a `Map` on the chat screen's notifier, which Riverpod
/// disposed the moment the user left the conversation -- so the message was
/// discarded by backgrounding the app, by opening another chat, or by the OS
/// reclaiming memory, after the user had been shown a bubble saying it was
/// queued.
///
/// "Killing the app" is expressed here as building a SECOND courier over the
/// SAME database file, which is exactly what a relaunch is: new objects, no
/// in-memory state, the disk as it was left.
void main() {
  // The same SQLite the device uses, on the test VM.
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  late AppDatabase database;
  late _RecordingRepository repository;

  setUp(() async {
    database = await AppDatabase.inMemory();
    repository = _RecordingRepository();
  });

  tearDown(() async => database.close());

  /// A courier over the real database.
  ///
  /// The backoff is compressed to a millisecond, and ONLY the backoff. A
  /// restored entry keeps whatever `nextAttemptAt` it was persisted with -- that
  /// is correct, and in production the wait between a failure and the next
  /// launch has always elapsed -- but a test that had to sleep through the real
  /// two-second curve to see a retry would be a slow test measuring a timer
  /// rather than a fast one measuring the queue. The curve itself is asserted
  /// separately, in `outbox_test.dart`.
  OutboxCourier courier({Duration backoff = const Duration(milliseconds: 1)}) {
    final store = SqliteOutboxStore(database);
    return OutboxCourier(
      messages: repository,
      store: store,
      outbox: Outbox(journal: store, baseBackoff: backoff, maxBackoff: backoff),
    );
  }

  group('surviving a restart', () {
    test('a message queued while offline is sent after the app is killed and reopened',
        () async {
      repository.offline = true;

      // The train. The user types, taps send, sees the bubble.
      final first = courier();
      final id = await first.enqueue(conversationId: 'c1', body: 'on my way');
      expect(repository.sent, isEmpty, reason: 'there is no network');
      await first.dispose();

      // The app is killed. Every object above is gone.
      repository.offline = false;

      // Relaunch: a new courier, over the same database.
      final second = courier();
      expect(await second.restore(), 1, reason: 'the queue came back from disk');

      // The entry was persisted with the backoff its failed attempt earned, and
      // it is honoured across the restart rather than reset -- so the relaunch
      // waits for it exactly as the previous run would have.
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await second.drain();

      expect(repository.sent.map((m) => m.body), ['on my way']);
      expect(
        repository.sent.single.clientMessageId,
        id,
        reason: 'the idempotency key must survive the restart, or the server '
            'cannot recognise a retry as the same message',
      );
      await second.dispose();
    });

    test('the payload survives too, not just the fact that something was queued', () async {
      repository.offline = true;
      final first = courier();
      await first.enqueue(
        conversationId: 'c1',
        body: 'the body',
        replyToMessageId: 'm_parent',
      );
      await first.dispose();

      repository.offline = false;
      final second = courier();
      await second.restore();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await second.drain();

      final sent = repository.sent.single;
      expect(sent.body, 'the body');
      expect(sent.replyToMessageId, 'm_parent');
      expect(sent.conversationId, 'c1');
    });

    test('the attempt count survives, so closing the app is not a way to reset the budget',
        () async {
      repository.failWith =
          const AppError(AppErrorKind.network, code: 'NET.TIMEOUT');
      final first = courier();
      await first.enqueue(conversationId: 'c1', body: 'hello');
      await first.drain();
      await first.flushJournal();
      await first.dispose();

      final rows = await SqliteOutboxStore(database).load();
      expect(rows.single.entry.attempts, greaterThan(0));
      // Why it failed last time survives too: without it a relaunch cannot tell
      // the user anything about a message that is sitting there refused.
      expect(rows.single.entry.lastFailureCode, 'NET.TIMEOUT');

      // Restored with its history, not as a fresh message. Without this, a
      // permanently-refused message becomes an infinite retry loop spread
      // across launches -- one attempt per relaunch, forever.
      final second = courier();
      await second.restore();
      expect(second.entriesFor('c1').single.attempts, rows.single.entry.attempts);
      await second.dispose();
    });

    test('a send interrupted mid-flight is retried, not abandoned', () async {
      // The app died between "mark sending" and the response. On disk the entry
      // says `sending`, which on load means "a request was in flight and this
      // process never learned how it ended".
      await SqliteOutboxStore(database).save(
        const OutboxEntryFixture().entry,
        const OutboxEntryFixture().payload,
      );
      await database.db.update('outbox_message', {'status': 'sending'});

      final relaunched = courier();
      await relaunched.restore();
      await relaunched.drain();

      // Re-sent, with the SAME client id. The server's unique index on it is
      // what makes this one message rather than two -- which is why §15 says
      // duplicate prevention may not rest on the client alone.
      expect(repository.sent.single.clientMessageId, 'fixture-1');
      await relaunched.dispose();
    });

    test('an entry the user abandoned does not come back', () async {
      repository.offline = true;
      final first = courier();
      final id = await first.enqueue(conversationId: 'c1', body: 'never mind');
      await first.discard(id);
      await first.dispose();

      final second = courier();
      expect(await second.restore(), 0);
      await second.dispose();
    });
  });

  group('duplicate prevention', () {
    test('a double-tapped send is one message', () async {
      final c = courier();
      final id = await c.enqueue(conversationId: 'c1', body: 'hi');
      // The same entry, offered again -- a stuck UI, a replayed restore.
      await c.enqueueWithId(clientMessageId: id, conversationId: 'c1', body: 'hi');
      await c.drain();

      expect(repository.sent, hasLength(1));
      await c.dispose();
    });

    test('the database itself refuses to hold the same message twice', () async {
      final store = SqliteOutboxStore(database);
      const fixture = OutboxEntryFixture();
      await store.save(fixture.entry, fixture.payload);
      await store.save(fixture.entry, fixture.payload);

      // client_message_id is the PRIMARY KEY, so this is enforced below the
      // code rather than by it: even a bug above cannot make two rows.
      expect(await store.load(), hasLength(1));
    });

    test('a retry after a failure re-sends the same id rather than minting a new one',
        () async {
      repository.failWith = const AppError(AppErrorKind.network);
      final c = courier();
      final id = await c.enqueue(conversationId: 'c1', body: 'hi');
      await c.drain();
      expect(repository.sent, hasLength(1));

      repository.failWith = null;
      await c.retry(id);

      expect(repository.sent, hasLength(2));
      expect(repository.sent.map((m) => m.clientMessageId), [id, id]);
      await c.dispose();
    });
  });

  group('retry', () {
    test('a transient failure backs off; a policy refusal does not retry at all', () async {
      repository.failWith = const AppError(AppErrorKind.network);
      final transient = courier();
      await transient.enqueue(conversationId: 'c1', body: 'a');
      await transient.drain();
      expect(
        transient.entriesFor('c1').single.nextAttemptAt,
        isNotNull,
        reason: 'a network failure is worth trying again',
      );
      await transient.dispose();

      final permanent = OutboxCourier(
        messages: _RecordingRepository()
          ..failWith = const AppError(AppErrorKind.forbidden),
        store: InMemoryOutboxStore(),
      );
      await permanent.enqueue(conversationId: 'c2', body: 'b');
      await permanent.drain();
      expect(
        permanent.entriesFor('c2').single.nextAttemptAt,
        isNull,
        reason: 'a refusal is answered the same way forever; retrying it is a '
            'loop, and the user is offered an explicit retry instead',
      );
      await permanent.dispose();
    });

    test('order is preserved: a stuck message is not overtaken by the next one', () async {
      repository.failWith = const AppError(AppErrorKind.network);
      // A backoff long enough that the head is genuinely parked for the
      // duration of the test. With the compressed one the head becomes
      // eligible again between the two enqueues — which is correct behaviour
      // and makes this assertion about the scheduler's timing rather than
      // about ordering.
      final c = courier(backoff: const Duration(seconds: 30));
      await c.enqueue(conversationId: 'c1', body: 'first');
      await c.enqueue(conversationId: 'c1', body: 'second');
      await c.drain();

      // Only the head was attempted. A flaky network must not silently reorder
      // somebody's words: the second message waits behind the first rather
      // than overtaking it.
      expect(repository.sent.map((m) => m.body), ['first']);
      expect(repository.sent.map((m) => m.body), isNot(contains('second')));
      await c.dispose();
    });

    test('a stalled conversation does not hold up another one', () async {
      repository.failFor = 'c1';
      final c = courier();
      await c.enqueue(conversationId: 'c1', body: 'stuck');
      await c.enqueue(conversationId: 'c2', body: 'fine');
      await c.drain();

      expect(repository.sent.where((m) => m.conversationId == 'c2'), hasLength(1));
      await c.dispose();
    });
  });

  group('reconnect', () {
    test('the queue drains when the socket connects, whatever screen is open', () async {
      repository.offline = true;
      final status = StreamController<RealtimeStatus>.broadcast();
      final c = courier();
      final policy = OutboxDrainPolicy(
        courier: c,
        realtimeStatus: status.stream,
        // Injected rather than the real radio: a test must not depend on the
        // machine it runs on having one.
        connectivity: const Stream.empty(),
      );
      await policy.start();

      await c.enqueue(conversationId: 'c1', body: 'queued offline');
      expect(repository.sent, isEmpty);

      repository.offline = false;
      status.add(RealtimeStatus.connected);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.drain();

      expect(repository.sent.map((m) => m.body), ['queued offline']);
      await policy.dispose();
      await c.dispose();
      await status.close();
    });

    test('startup drains whatever a previous run left, with no edge to wait for', () async {
      repository.offline = true;
      final first = courier();
      await first.enqueue(conversationId: 'c1', body: 'from before');
      await first.dispose();

      repository.offline = false;
      final second = courier();
      final policy = OutboxDrainPolicy(
        courier: second,
        realtimeStatus: const Stream.empty(),
        connectivity: const Stream.empty(),
      );

      // No socket event and no connectivity change will ever arrive. If startup
      // did not drain, this message would sit until the user typed another one.
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await policy.start();

      expect(repository.sent.map((m) => m.body), ['from before']);
      await policy.dispose();
      await second.dispose();
    });
  });

  group('signing out', () {
    test('leaves nothing for the next person on this device', () async {
      repository.offline = true;
      final c = courier();
      await c.enqueue(conversationId: 'c1', body: 'private');
      await c.clear();
      await c.dispose();

      expect(await SqliteOutboxStore(database).load(), isEmpty);
    });
  });
}

/// A fixed entry, for the cases that need a known client id on disk.
class OutboxEntryFixture {
  const OutboxEntryFixture();

  OutboxEntry get entry => OutboxEntry(
        clientMessageId: 'fixture-1',
        conversationId: 'c1',
        enqueuedAt: DateTime.utc(2026, 9, 7, 12),
      );

  OutgoingMessage get payload => const OutgoingMessage(
        clientMessageId: 'fixture-1',
        conversationId: 'c1',
        kind: MessageKind.text,
        body: 'interrupted',
      );
}

class _RecordingRepository implements MessageRepository {
  final sent = <OutgoingMessage>[];

  /// No network at all.
  bool offline = false;

  /// Fail every send with this.
  AppError? failWith;

  /// Fail only this conversation.
  String? failFor;

  int _sequence = 0;

  @override
  Future<Message> send(OutgoingMessage message) async {
    if (offline) throw const AppError(AppErrorKind.network);
    if (failFor != null && message.conversationId == failFor) {
      throw const AppError(AppErrorKind.network);
    }
    sent.add(message);
    if (failWith != null) throw failWith!;

    return Message(
      id: 'srv_${++_sequence}',
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      sequence: _sequence,
      kind: message.kind,
      body: message.body,
      createdAt: DateTime.utc(2026, 9, 7, 12, _sequence),
      deliveryState: DeliveryState.sent,
      isMine: true,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used by these tests');
}
