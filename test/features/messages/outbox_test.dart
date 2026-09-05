import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/messages/domain/outbox.dart';

void main() {
  final t0 = DateTime.utc(2026, 9, 5, 12);

  OutboxEntry entry(String id, {String conversation = 'c1', DateTime? at}) =>
      OutboxEntry(
        clientMessageId: id,
        conversationId: conversation,
        enqueuedAt: at ?? t0,
      );

  group('idempotency', () {
    test('a retry reuses the same client message id', () {
      final outbox = Outbox();
      outbox.enqueue(entry('m1'));

      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: true);
      outbox.retryNow('m1');

      final ready = outbox.nextReady('c1', t0);
      expect(ready, isNotNull);
      expect(ready!.clientMessageId, 'm1', reason: 'retry must not mint a new id');
      expect(outbox.length, 1, reason: 'retry must not create a second entry');
    });

    test('enqueuing the same id twice is a no-op', () {
      final outbox = Outbox();
      outbox.enqueue(entry('m1'));
      outbox.enqueue(entry('m1'));

      expect(outbox.length, 1, reason: 'a double-tapped send must not duplicate');
    });

    test('attempts accumulate across retries rather than resetting', () {
      final outbox = Outbox();
      outbox.enqueue(entry('m1'));

      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: true);
      outbox.retryNow('m1');
      outbox.markSending('m1');

      expect(outbox.entriesFor('c1').single.attempts, 2);
    });
  });

  group('ordering', () {
    test('only the head of a conversation is eligible to send', () {
      final outbox = Outbox()
        ..enqueue(entry('m1'))
        ..enqueue(entry('m2'));

      expect(outbox.nextReady('c1', t0)!.clientMessageId, 'm1');

      outbox.markSending('m1');
      expect(
        outbox.nextReady('c1', t0),
        isNull,
        reason: 'm2 must not overtake an in-flight m1',
      );
    });

    test('a stuck message blocks its successors, preserving order', () {
      final outbox = Outbox()
        ..enqueue(entry('m1'))
        ..enqueue(entry('m2'));

      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: true);

      // m1 is backing off; m2 must still wait behind it.
      expect(outbox.nextReady('c1', t0), isNull);

      final afterBackoff = t0.add(const Duration(minutes: 10));
      expect(outbox.nextReady('c1', afterBackoff)!.clientMessageId, 'm1');
    });

    test('successors send in order once the head is delivered', () {
      final outbox = Outbox()
        ..enqueue(entry('m1'))
        ..enqueue(entry('m2'))
        ..enqueue(entry('m3'));

      outbox.markSent('m1');
      expect(outbox.nextReady('c1', t0)!.clientMessageId, 'm2');

      outbox.markSent('m2');
      expect(outbox.nextReady('c1', t0)!.clientMessageId, 'm3');
    });

    test('a stalled conversation does not block a different one', () {
      final outbox = Outbox()
        ..enqueue(entry('m1', conversation: 'c1'))
        ..enqueue(entry('g1', conversation: 'c2'));

      outbox.markSending('m1');

      final ready = outbox.allReady(t0);
      expect(ready.map((e) => e.clientMessageId), ['g1']);
    });
  });

  group('failure handling', () {
    test('a non-retryable failure schedules no automatic retry', () {
      final outbox = Outbox();
      outbox.enqueue(entry('m1'));
      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: false, failureCode: 'forbidden');

      final stored = outbox.entriesFor('c1').single;
      expect(stored.state, OutboxState.failed);
      expect(stored.nextAttemptAt, isNull, reason: 'must not retry a policy rejection');
      expect(stored.lastFailureCode, 'forbidden');

      // Still available for an explicit user-initiated retry.
      expect(outbox.nextReady('c1', t0), isNotNull);
    });

    test('retries stop once max attempts are exhausted', () {
      final outbox = Outbox(maxAttempts: 2);
      outbox.enqueue(entry('m1'));

      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: true);
      expect(outbox.entriesFor('c1').single.nextAttemptAt, isNotNull);

      outbox.retryNow('m1');
      outbox.markSending('m1');
      outbox.markFailed('m1', t0, retryable: true);

      expect(
        outbox.entriesFor('c1').single.nextAttemptAt,
        isNull,
        reason: 'must not retry indefinitely (§3)',
      );
    });

    test('backoff grows exponentially and is capped', () {
      final outbox = Outbox(
        baseBackoff: const Duration(seconds: 2),
        maxBackoff: const Duration(minutes: 5),
      );

      expect(outbox.backoffFor(0), Duration.zero);
      expect(outbox.backoffFor(1), const Duration(seconds: 2));
      expect(outbox.backoffFor(2), const Duration(seconds: 4));
      expect(outbox.backoffFor(3), const Duration(seconds: 8));
      expect(outbox.backoffFor(50), const Duration(minutes: 5));
    });

    test('discarding removes the entry entirely', () {
      final outbox = Outbox()..enqueue(entry('m1'));
      outbox.discard('m1');
      expect(outbox.isEmpty, isTrue);
    });
  });
}
