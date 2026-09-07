import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Which actions a message offers.
///
/// The backend remains authoritative, so this is about what the UI SHOWS — and
/// the test that matters most is the conservative direction: an action offered
/// and then refused reads as a broken app, so anything the server would refuse
/// must not appear.
void main() {
  final now = DateTime.utc(2026, 9, 5, 12);

  Message message({
    String? id = 'srv_1',
    bool isMine = true,
    bool isDeleted = false,
    MessageKind kind = MessageKind.text,
    DeliveryState deliveryState = DeliveryState.sent,
    ApprovalState approvalState = ApprovalState.notRequired,
    Duration age = Duration.zero,
    String body = 'مرحبا',
  }) =>
      Message(
        id: id,
        clientMessageId: 'c1',
        conversationId: 'conv',
        sequence: id == null ? null : 1,
        kind: kind,
        body: body,
        createdAt: now.subtract(age),
        deliveryState: deliveryState,
        approvalState: approvalState,
        isMine: isMine,
        isDeleted: isDeleted,
      );

  MessageCapabilities of(Message m, {bool isReadOnly = false}) =>
      MessageCapabilities.of(m, isReadOnly: isReadOnly, now: now);

  group('a message the user just sent', () {
    test('offers everything', () {
      final can = of(message());
      expect(can.canReply, isTrue);
      expect(can.canReact, isTrue);
      expect(can.canForward, isTrue);
      expect(can.canEdit, isTrue);
      expect(can.canCopy, isTrue);
      expect(can.canDeleteForMe, isTrue);
      expect(can.canDeleteForEveryone, isTrue);
    });
  });

  group('a message somebody else sent', () {
    test('cannot be edited or deleted for everyone', () {
      final can = of(message(isMine: false));
      expect(can.canEdit, isFalse);
      expect(can.canDeleteForEveryone, isFalse);
      // But it can be replied to, reacted to, forwarded, and hidden.
      expect(can.canReply, isTrue);
      expect(can.canForward, isTrue);
      expect(can.canDeleteForMe, isTrue);
    });
  });

  group('windows', () {
    test('editing closes after the edit window', () {
      expect(of(message(age: const Duration(minutes: 14))).canEdit, isTrue);
      expect(of(message(age: const Duration(minutes: 16))).canEdit, isFalse);
    });

    test('delete-for-everyone closes after its own, longer window', () {
      expect(of(message(age: const Duration(minutes: 59))).canDeleteForEveryone, isTrue);
      expect(of(message(age: const Duration(minutes: 61))).canDeleteForEveryone, isFalse);
    });

    test('hiding one\'s own copy has NO window', () {
      // It destroys nothing and is private, so a participant may always tidy
      // their own view — which is exactly what the server allows.
      expect(of(message(age: const Duration(days: 400))).canDeleteForMe, isTrue);
    });
  });

  group('messages that are not ordinary', () {
    test('a message that never reached the server offers nothing', () {
      // It has no server identity, so none of these operations can name it.
      // The failed-send bubble offers retry and discard instead.
      final can = of(message(id: null, deliveryState: DeliveryState.failed));
      expect(can.hasAny, isFalse);
    });

    test('a withdrawn message can only be hidden', () {
      final can = of(message(isDeleted: true));
      expect(can.canReply, isFalse);
      expect(can.canEdit, isFalse);
      expect(can.canForward, isFalse);
      expect(can.canReact, isFalse);
      expect(can.canDeleteForEveryone, isFalse);
      expect(can.canDeleteForMe, isTrue);
    });

    test('a message awaiting approval cannot be forwarded or edited', () {
      // It is not visible to anyone else yet; forwarding it would spread
      // something the group has not been shown, and the server refuses it.
      final can = of(message(approvalState: ApprovalState.pending));
      expect(can.canForward, isFalse);
      expect(can.canEdit, isFalse);
      expect(can.canReply, isFalse);
    });

    test('a media message has no editable body and is not forwarded', () {
      for (final kind in [MessageKind.image, MessageKind.voice, MessageKind.file]) {
        final can = of(message(kind: kind));
        expect(can.canEdit, isFalse, reason: kind.name);
        // Its content is an object in storage with its own scoped URL; copying
        // the row would point a new audience at an object they were never
        // authorized for.
        expect(can.canForward, isFalse, reason: kind.name);
      }
    });

    test('a system message is not actionable at all', () {
      final can = of(message(kind: MessageKind.system));
      expect(can.canReply, isFalse);
      expect(can.canDeleteForMe, isFalse);
      expect(can.hasAny, isFalse);
    });
  });

  group('a read-only conversation', () {
    test('offers no action that would write to it', () {
      final can = of(message(), isReadOnly: true);
      expect(can.canReply, isFalse);
      expect(can.canReact, isFalse);
      expect(can.canEdit, isFalse);

      // Reading actions remain: copying and forwarding elsewhere do not write
      // here, and hiding a message is this user's own view.
      expect(can.canCopy, isTrue);
      expect(can.canForward, isTrue);
      expect(can.canDeleteForMe, isTrue);
    });
  });
}
