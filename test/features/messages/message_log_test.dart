import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/messages/domain/message_log.dart';
import 'package:jawwid_chat/shared/models/message.dart';

void main() {
  final t0 = DateTime.utc(2026, 9, 5, 12);

  Message confirmed(String clientId, int sequence, {String? serverId}) => Message(
        id: serverId ?? 'srv_$clientId',
        clientMessageId: clientId,
        conversationId: 'c1',
        sequence: sequence,
        kind: MessageKind.text,
        createdAt: t0.add(Duration(seconds: sequence)),
        deliveryState: DeliveryState.sent,
      );

  Message pending(String clientId, {int offsetSeconds = 0}) => Message(
        clientMessageId: clientId,
        conversationId: 'c1',
        kind: MessageKind.text,
        createdAt: t0.add(Duration(seconds: offsetSeconds)),
        deliveryState: DeliveryState.queued,
      );

  group('ordering', () {
    test('orders by server sequence, not by local timestamp', () {
      // A device with a skewed clock: local times disagree with the server's order.
      final a = Message(
        id: 'srv_a',
        clientMessageId: 'a',
        conversationId: 'c1',
        sequence: 1,
        kind: MessageKind.text,
        createdAt: t0.add(const Duration(hours: 5)),
        deliveryState: DeliveryState.sent,
      );
      final b = confirmed('b', 2);

      final log = MessageLog.empty().merge([b, a]);

      expect(log.messages.map((m) => m.clientMessageId), ['a', 'b']);
    });

    test('pending messages always sort after confirmed ones', () {
      final log = MessageLog.empty().merge([
        pending('local', offsetSeconds: 0),
        confirmed('a', 10),
      ]);

      expect(log.messages.map((m) => m.clientMessageId), ['a', 'local']);
    });

    test('pending messages keep compose order', () {
      final log = MessageLog.empty().merge([
        pending('second', offsetSeconds: 2),
        pending('first', offsetSeconds: 1),
      ]);

      expect(log.messages.map((m) => m.clientMessageId), ['first', 'second']);
    });

    test('merging an older page keeps the whole log ordered', () {
      final log = MessageLog.empty()
          .merge([confirmed('c', 3), confirmed('d', 4)])
          .merge([confirmed('a', 1), confirmed('b', 2)]);

      expect(log.messages.map((m) => m.clientMessageId), ['a', 'b', 'c', 'd']);
    });
  });

  group('identity and de-duplication', () {
    test('a local echo and its server confirmation are one message', () {
      final log = MessageLog.empty()
          .merge([pending('m1')])
          .merge([confirmed('m1', 7)]);

      expect(log.length, 1, reason: 'must not show the sent message twice');
      expect(log.messages.single.sequence, 7);
      expect(log.messages.single.deliveryState, DeliveryState.sent);
    });

    test('a confirmed message is never dragged back to a local state', () {
      // A slow retry resolving after the server already confirmed the message.
      final log = MessageLog.empty()
          .merge([confirmed('m1', 7)])
          .merge([pending('m1')]);

      expect(log.messages.single.deliveryState, DeliveryState.sent);
      expect(log.messages.single.sequence, 7);
    });

    test('the same message delivered twice over realtime appears once', () {
      final log = MessageLog.empty()
          .merge([confirmed('m1', 7)])
          .merge([confirmed('m1', 7)]);

      expect(log.length, 1);
    });

    test('messages without any usable identity are ignored', () {
      final anonymous = Message(
        clientMessageId: '',
        conversationId: 'c1',
        kind: MessageKind.text,
        createdAt: t0,
        deliveryState: DeliveryState.sent,
      );

      expect(MessageLog.empty().merge([anonymous]).isEmpty, isTrue);
    });
  });

  group('state transitions', () {
    test('updateOne applies a delivery-state change in place', () {
      final log = MessageLog.empty().merge([confirmed('m1', 1)]).updateOne(
            'm1',
            (m) => m.copyWith(deliveryState: DeliveryState.read),
          );

      expect(log.messages.single.deliveryState, DeliveryState.read);
    });

    test('updateOne on an unknown id leaves the log untouched', () {
      final log = MessageLog.empty().merge([confirmed('m1', 1)]);
      final after = log.updateOne('nope', (m) => m.copyWith(isDeleted: true));

      expect(after.length, 1);
      expect(after.messages.single.isDeleted, isFalse);
    });
  });

  group('pagination and resync', () {
    test('carries the older-page cursor forward', () {
      final log = MessageLog.empty()
          .merge([confirmed('a', 1)], oldestCursor: 'cur_1', hasMoreOlder: true);

      expect(log.oldestCursor, 'cur_1');
      expect(log.hasMoreOlder, isTrue);

      // A realtime arrival must not clobber the pagination cursor.
      final after = log.merge([confirmed('b', 2)]);
      expect(after.oldestCursor, 'cur_1');
    });

    test('highestSequence is the resync watermark and ignores pending messages', () {
      final log = MessageLog.empty()
          .merge([confirmed('a', 4), confirmed('b', 9), pending('local')]);

      expect(log.highestSequence, 9);
    });

    test('highestSequence is null when nothing is confirmed yet', () {
      expect(MessageLog.empty().merge([pending('local')]).highestSequence, isNull);
    });
  });

  group('approval visibility', () {
    test('a pending-approval message is not treated as visible to others', () {
      final m = confirmed('m1', 1).copyWith(approvalState: ApprovalState.pending);
      expect(m.isVisibleToOthers, isFalse);
    });

    test('a rejected message is not treated as visible to others', () {
      final m = confirmed('m1', 1).copyWith(approvalState: ApprovalState.rejected);
      expect(m.isVisibleToOthers, isFalse);
    });

    test('an approved message is visible', () {
      final m = confirmed('m1', 1).copyWith(approvalState: ApprovalState.approved);
      expect(m.isVisibleToOthers, isTrue);
    });
  });
}
