import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Which actions a message offers.
///
/// These are the rules §35 states, asserted as data rather than through a
/// pumped sheet: an affordance the backend would refuse must be **absent**, and
/// the cheapest way to keep that true is to make the decision a pure function
/// that a test can enumerate.
void main() {
  Message message({
    String? id = 'srv_1',
    String body = 'السلام عليكم',
    MessageKind kind = MessageKind.text,
    List<Attachment> attachments = const [],
    bool isMine = false,
    bool isDeleted = false,
    DeliveryState deliveryState = DeliveryState.delivered,
    ApprovalState approvalState = ApprovalState.notRequired,
  }) {
    return Message(
      id: id,
      clientMessageId: 'c_1',
      conversationId: 'conv_1',
      kind: kind,
      body: body,
      attachments: attachments,
      createdAt: DateTime.utc(2026, 9, 5, 12),
      deliveryState: deliveryState,
      approvalState: approvalState,
      isMine: isMine,
      isDeleted: isDeleted,
    );
  }

  const photo = Attachment(id: 'a1', kind: MessageKind.image, url: 'https://x/1');
  const document = Attachment(
    id: 'a2',
    kind: MessageKind.file,
    fileName: 'Homework.pdf',
    byteSize: 2400000,
  );
  const voice = Attachment(id: 'a3', kind: MessageKind.voice, durationMs: 4000);

  group('what can be acted on at all', () {
    test('a delivered message can', () {
      expect(canActOn(message()), isTrue);
    });

    test('a system message cannot — it is nobody\'s message', () {
      expect(canActOn(message(kind: MessageKind.system)), isFalse);
    });

    test('an already-deleted message cannot', () {
      expect(canActOn(message(isDeleted: true)), isFalse);
    });

    test('a message still in the outbox cannot', () {
      // It has no server id, so there is nothing to react to or delete; the
      // bubble carries Retry and Discard instead.
      for (final state in [
        DeliveryState.queued,
        DeliveryState.sending,
        DeliveryState.failed,
      ]) {
        expect(
          canActOn(message(deliveryState: state)),
          isFalse,
          reason: '$state is a local state',
        );
      }
    });
  });

  group('text', () {
    test('offers reply, copy and delete-for-me', () {
      expect(
        actionsFor(message()),
        [MessageAction.reply, MessageAction.copy, MessageAction.deleteForMe],
      );
    });

    test('offers no Open — there is nothing to open', () {
      expect(actionsFor(message()), isNot(contains(MessageAction.open)));
    });
  });

  group('photo, file and voice', () {
    test('a photo offers Open', () {
      final actions = actionsFor(
        message(body: '', kind: MessageKind.image, attachments: [photo]),
      );
      expect(actions, contains(MessageAction.open));
      expect(
        actions,
        isNot(contains(MessageAction.copy)),
        reason: 'a photo with no caption has no text to copy',
      );
    });

    test('a file offers Open', () {
      expect(
        actionsFor(
          message(body: '', kind: MessageKind.file, attachments: [document]),
        ),
        contains(MessageAction.open),
      );
    });

    test('a voice note offers neither Copy nor Open', () {
      // §35 lists exactly Reply, Forward and Delete for voice. Forward is not
      // built (no endpoint), so what remains is Reply and Delete.
      final actions = actionsFor(
        message(body: '', kind: MessageKind.voice, attachments: [voice]),
      );
      expect(actions, isNot(contains(MessageAction.copy)));
      expect(actions, isNot(contains(MessageAction.open)));
      expect(actions, contains(MessageAction.reply));
    });

    test('a photo sent with a caption offers both Copy and Open', () {
      final actions = actionsFor(
        message(kind: MessageKind.image, attachments: [photo]),
      );
      expect(actions, containsAll([MessageAction.copy, MessageAction.open]));
    });
  });

  group('delete for everyone', () {
    test('is offered on the user\'s own published message', () {
      expect(
        actionsFor(message(isMine: true)),
        contains(MessageAction.deleteForEveryone),
      );
    });

    test('is never offered on somebody else\'s message', () {
      // The server refuses it (COMM.NOT_MESSAGE_AUTHOR); offering it would
      // teach the parent that the app's buttons do not mean anything.
      expect(
        actionsFor(message(isMine: false)),
        isNot(contains(MessageAction.deleteForEveryone)),
      );
    });

    test('is not offered while a message is still awaiting approval', () {
      // Nobody has seen it, so there is nothing to retract from anyone.
      expect(
        actionsFor(
          message(isMine: true, approvalState: ApprovalState.pending),
        ),
        isNot(contains(MessageAction.deleteForEveryone)),
      );
    });

    test('delete-for-me is always available where delete-for-everyone is', () {
      final actions = actionsFor(message(isMine: true));
      expect(actions, contains(MessageAction.deleteForMe));
      expect(
        actions.indexOf(MessageAction.deleteForMe),
        lessThan(actions.indexOf(MessageAction.deleteForEveryone)),
        reason: 'the less destructive option is offered first',
      );
    });
  });

  group('the reaction set', () {
    test('is the six the brief names, in order', () {
      expect(kQuickReactions, ['❤️', '👍', '😂', '😢', '😮', '👏']);
    });
  });
}
