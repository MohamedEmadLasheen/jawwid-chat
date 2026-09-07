import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/features/messages/application/conversation_realtime.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Realtime translation and the client-side state it drives.
///
/// Kept apart from the controller tests because these are the pieces where a
/// mistake is invisible until it is a bug in production: an event for another
/// conversation applied to this one, a receipt that moves backwards, a typing
/// indicator that never clears.
void main() {
  const conversationId = 'c1';

  RealtimeEnvelope envelope(String event, Map<String, Object?> payload) =>
      RealtimeEnvelope(event, payload);

  group('translating events into signals', () {
    test('an event for ANOTHER conversation is ignored', () {
      final signal = ConversationSignals.read(
        envelope(RealtimeEvent.messageCreated, {
          'conversationId': 'somewhere-else',
          'messageId': 'm1',
        }),
        conversationId,
      );
      expect(signal, isNull);
    });

    test('an unknown event is ignored rather than an error', () {
      // A backend that adds an event must not break a client that predates it.
      final signal = ConversationSignals.read(
        envelope('something.invented.later', {'conversationId': conversationId}),
        conversationId,
      );
      expect(signal, isNull);
    });

    test('a payload missing the field the signal needs is ignored', () {
      for (final event in [
        RealtimeEvent.messageCreated,
        RealtimeEvent.messageUpdated,
        RealtimeEvent.messageDeleted,
        RealtimeEvent.reactionAdded,
      ]) {
        expect(
          ConversationSignals.read(
            envelope(event, {'conversationId': conversationId}),
            conversationId,
          ),
          isNull,
          reason: event,
        );
      }
    });

    test('message.created asks for a fetch and carries no body', () {
      final signal = ConversationSignals.read(
        envelope(RealtimeEvent.messageCreated, {
          'conversationId': conversationId,
          'messageId': 'm1',
          'seq': '4',
        }),
        conversationId,
      );

      // The body is subject to per-reader rules only the read path applies, so
      // the arrival is a prompt to fetch and never content to trust.
      expect(signal, isA<MessagesArrived>());
      expect((signal! as MessagesArrived).messageId, 'm1');
    });

    test('message.updated carries the new body, because its audience already had it', () {
      final signal = ConversationSignals.read(
        envelope(RealtimeEvent.messageUpdated, {
          'conversationId': conversationId,
          'messageId': 'm1',
          'body': 'صححتها',
          'editedAt': '2026-09-05T12:05:00.000Z',
        }),
        conversationId,
      );

      expect(signal, isA<MessageEdited>());
      expect((signal! as MessageEdited).body, 'صححتها');
    });

    test('a receipt names the state it moved to', () {
      final signal = ConversationSignals.read(
        envelope(RealtimeEvent.messageReceiptUpdated, {
          'conversationId': conversationId,
          'messageId': 'm1',
          'actorId': 'other',
          'state': 'read',
        }),
        conversationId,
      );

      expect(signal, isA<ReceiptAdvanced>());
      expect((signal! as ReceiptAdvanced).state, DeliveryState.read);
    });

    test('a reaction carries its delta, so no refetch is needed', () {
      final added = ConversationSignals.read(
        envelope(RealtimeEvent.reactionAdded, {
          'conversationId': conversationId,
          'messageId': 'm1',
          'actorId': 'a1',
          'emoji': '👍',
        }),
        conversationId,
      )! as ReactionsChanged;

      expect(added.added, isTrue);
      expect(added.emoji, '👍');
      expect(added.actorId, 'a1');

      final removed = ConversationSignals.read(
        envelope(RealtimeEvent.reactionRemoved, {
          'conversationId': conversationId,
          'messageId': 'm1',
          'actorId': 'a1',
          'emoji': '👍',
        }),
        conversationId,
      )! as ReactionsChanged;
      expect(removed.added, isFalse);
    });

    test('a reaction with no emoji is ignored rather than applied as a blank', () {
      expect(
        ConversationSignals.read(
          envelope(RealtimeEvent.reactionAdded, {
            'conversationId': conversationId,
            'messageId': 'm1',
            'actorId': 'a1',
          }),
          conversationId,
        ),
        isNull,
      );
    });

    test('typing carries the actor and whether they started or stopped', () {
      final started = ConversationSignals.read(
        envelope(RealtimeEvent.typingStarted, {
          'conversationId': conversationId,
          'actorId': 'a1',
          'displayName': 'أحمد',
        }),
        conversationId,
      )! as TypingChanged;
      expect(started.isTyping, isTrue);
      expect(started.displayName, 'أحمد');

      final stopped = ConversationSignals.read(
        envelope(RealtimeEvent.typingStopped, {
          'conversationId': conversationId,
          'actorId': 'a1',
          'displayName': 'أحمد',
        }),
        conversationId,
      )! as TypingChanged;
      expect(stopped.isTyping, isFalse);
    });
  });

  group('TypingRegistry', () {
    test('tracks who is typing and reports changes once each', () {
      var changes = 0;
      final registry = TypingRegistry()..onChanged = () => changes++;
      addTearDown(registry.dispose);

      registry.start('a1', 'أحمد');
      registry.start('a2', 'سارة');
      expect(registry.names, ['أحمد', 'سارة']);
      expect(changes, 2);

      // A refresh from a still-typing actor is not a change.
      registry.start('a1', 'أحمد');
      expect(changes, 2);

      registry.stop('a1');
      expect(registry.names, ['سارة']);
      expect(changes, 3);
    });

    test('stopping somebody who was not typing changes nothing', () {
      var changes = 0;
      final registry = TypingRegistry()..onChanged = () => changes++;
      addTearDown(registry.dispose);

      registry.stop('nobody');
      expect(changes, 0);
    });

    testWidgets('an indicator expires by itself when no stop ever arrives', (tester) async {
      // The server broadcasts a stop on a disconnect, but that broadcast cannot
      // reach a client whose OWN connection dropped in between. Without a local
      // expiry, "…is typing" would then be stuck on screen indefinitely.
      final registry = TypingRegistry(timeout: const Duration(milliseconds: 50));
      addTearDown(registry.dispose);

      registry.start('a1', 'أحمد');
      expect(registry.isEmpty, isFalse);

      await tester.pump(const Duration(milliseconds: 80));
      expect(registry.isEmpty, isTrue);
    });

    test('clearing drops everyone — a dead connection vouches for nobody', () {
      final registry = TypingRegistry();
      addTearDown(registry.dispose);

      registry.start('a1', 'أحمد');
      registry.start('a2', 'سارة');
      registry.clear();

      expect(registry.isEmpty, isTrue);
    });
  });

  group('UnreadMarker', () {
    Message confirmed(int seq) => Message(
          id: 'srv_$seq',
          clientMessageId: 'c_$seq',
          conversationId: conversationId,
          sequence: seq,
          kind: MessageKind.text,
          body: 'm$seq',
          createdAt: DateTime.utc(2026, 9, 5, 12, seq),
          deliveryState: DeliveryState.sent,
        );

    test('sits above the first unread message', () {
      final marker = UnreadMarker.from(
        ordered: [for (var i = 1; i <= 10; i++) confirmed(i)],
        unreadCount: 3,
      );

      expect(marker.firstUnreadSequence, 8);
      expect(marker.count, 3);
      expect(marker.marks(confirmed(8)), isTrue);
      expect(marker.marks(confirmed(7)), isFalse);
    });

    test('is absent when there is nothing unread', () {
      final marker = UnreadMarker.from(
        ordered: [confirmed(1), confirmed(2)],
        unreadCount: 0,
      );
      expect(marker.isEmpty, isTrue);
      expect(marker.marks(confirmed(1)), isFalse);
    });

    test('degrades UPWARDS when the page does not hold every unread message', () {
      // Being wrong in this direction puts the divider too high. The other
      // direction would hide unread messages above it, which is the failure
      // that matters.
      final marker = UnreadMarker.from(
        ordered: [confirmed(9), confirmed(10)],
        unreadCount: 40,
      );
      expect(marker.firstUnreadSequence, 9);
    });

    test('ignores messages that have no server sequence yet', () {
      final pending = Message(
        clientMessageId: 'local',
        conversationId: conversationId,
        kind: MessageKind.text,
        body: 'queued',
        createdAt: DateTime.utc(2026, 9, 5, 13),
        deliveryState: DeliveryState.queued,
      );

      final marker = UnreadMarker.from(
        ordered: [confirmed(1), confirmed(2), pending],
        unreadCount: 1,
      );
      // The divider is a position in the SERVER's ordering; a message the
      // server has never seen cannot be one.
      expect(marker.firstUnreadSequence, 2);
    });
  });
}
