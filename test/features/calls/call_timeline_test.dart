/// Where a call sits in a conversation, and why the order cannot wobble.
///
/// The card is DERIVED from call history rather than stored as a system message
/// (the approved W7 D2a design), which means the thread's order is computed on
/// every build. `List.sort` is not stable in Dart, so without an explicit
/// tiebreak two items sharing a millisecond could swap places between frames and
/// the thread would visibly shuffle. That is what these assert.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/features/calls/domain/call_timeline.dart';
import 'package:jawwid_chat/shared/models/message.dart';

Message message(String id, DateTime at) => Message(
      id: id,
      clientMessageId: 'client_$id',
      conversationId: 'conv_1',
      authorId: 'actor_1',
      authorName: 'Someone',
      kind: MessageKind.text,
      body: 'body $id',
      createdAt: at,
      deliveryState: DeliveryState.sent,
    );

CallHistoryEntry call(
  String id,
  DateTime at, {
  CallOutcome outcome = CallOutcome.answered,
  Duration? duration,
}) =>
    CallHistoryEntry(
      id: id,
      conversationId: 'conv_1',
      title: 'Mr. Ahmed',
      startedAt: at,
      outcome: outcome,
      isGroup: false,
      duration: duration,
    );

void main() {
  final t0 = DateTime.utc(2026, 9, 27, 10);

  test('oldest first, interleaved by time', () {
    final items = mergeThread(
      messages: [
        message('m1', t0),
        message('m2', t0.add(const Duration(minutes: 10))),
      ],
      calls: [call('c1', t0.add(const Duration(minutes: 5)))],
    );

    expect(items.map((i) => i.tiebreak), ['m1', 'c1', 'm2']);
  });

  test('a conversation with only calls still has a timeline', () {
    final items = mergeThread(
      messages: const [],
      calls: [call('c1', t0), call('c2', t0.add(const Duration(minutes: 1)))],
    );

    expect(items.map((i) => i.tiebreak), ['c1', 'c2']);
    expect(items.every((i) => i is CallItem), isTrue);
  });

  test('a conversation with no calls is unchanged', () {
    final items = mergeThread(
      messages: [message('m1', t0), message('m2', t0)],
      calls: const [],
    );

    expect(items.map((i) => i.tiebreak), ['m1', 'm2']);
    expect(items.every((i) => i is MessageItem), isTrue);
  });

  test('the same instant orders the MESSAGE first, deterministically', () {
    // Ten merges of the same input must produce the same order every time. A
    // tiebreak-free sort passes this by luck at best.
    for (var run = 0; run < 10; run++) {
      final items = mergeThread(
        messages: [message('m1', t0)],
        calls: [call('c1', t0)],
      );
      expect(items.map((i) => i.tiebreak), ['m1', 'c1'], reason: 'run $run');
    }
  });

  test('two calls at the same instant are ordered by id, not by luck', () {
    for (var run = 0; run < 10; run++) {
      final items = mergeThread(
        messages: const [],
        calls: [call('c_b', t0), call('c_a', t0)],
      );
      expect(items.map((i) => i.tiebreak), ['c_a', 'c_b'], reason: 'run $run');
    }
  });

  test('input order does not change output order', () {
    final forwards = mergeThread(
      messages: [message('m1', t0), message('m2', t0)],
      calls: [call('c1', t0), call('c2', t0)],
    );
    final backwards = mergeThread(
      messages: [message('m2', t0), message('m1', t0)],
      calls: [call('c2', t0), call('c1', t0)],
    );

    expect(
      forwards.map((i) => i.tiebreak),
      backwards.map((i) => i.tiebreak),
      reason: 'the thread must not depend on the order the two lists arrived in',
    );
  });

  test('a call item carries the history record, and nothing derived from it', () {
    final entry = call('c1', t0, outcome: CallOutcome.missed);
    final items = mergeThread(messages: const [], calls: [entry]);

    final item = items.single as CallItem;
    expect(item.call, same(entry));
    expect(item.at, entry.startedAt);
    expect(
      item.call.outcome,
      CallOutcome.missed,
      reason: 'the outcome is the server record\'s, never recomputed here',
    );
  });
}
