import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/core/policy/communication_policy.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Conformance to `apps/api/src/communication/contracts/` — the DTO shapes AI #2 publishes.
void main() {
  group('seq is a stringified 64-bit integer', () {
    test('parses a string sequence', () {
      expect(WireMappers.parseSeq('42'), 42);
    });

    test('parses a sequence beyond 2^53 without losing precision', () {
      // This is exactly why the backend stringifies it. A double-backed parse would round.
      const big = '9007199254740993'; // 2^53 + 1
      expect(WireMappers.parseSeq(big), 9007199254740993);
    });

    test('tolerates a plain number', () {
      expect(WireMappers.parseSeq(7), 7);
    });

    test('a malformed sequence yields null rather than throwing', () {
      // One bad row must not blank a whole conversation.
      expect(WireMappers.parseSeq('not-a-number'), isNull);
      expect(WireMappers.parseSeq(null), isNull);
      expect(WireMappers.parseSeq(const {}), isNull);
    });
  });

  group('conversation type', () {
    test('official is the Jawwid support thread', () {
      expect(
        WireMappers.conversationKind('official'),
        ConversationKind.jawwidSupport,
      );
    });

    test('student_group and class_group are both student groups', () {
      expect(
        WireMappers.conversationKind('student_group'),
        ConversationKind.studentGroup,
      );
      expect(
        WireMappers.conversationKind('class_group'),
        ConversationKind.studentGroup,
      );
    });

    test('direct is a staff conversation', () {
      expect(WireMappers.conversationKind('direct'), ConversationKind.adminDirect);
    });

    test('an unknown type does not become a student group', () {
      expect(
        WireMappers.conversationKind('something_new'),
        ConversationKind.adminDirect,
      );
    });
  });

  group('member and author roles fail closed', () {
    test('known roles map through', () {
      expect(WireMappers.memberRole('parent'), ParticipantRole.parent);
      expect(WireMappers.memberRole('teacher'), ParticipantRole.teacher);
      expect(WireMappers.memberRole('admin'), ParticipantRole.admin);
    });

    test('an observer gets no 1:1 affordance', () {
      final role = WireMappers.memberRole('observer');
      expect(
        CommunicationPolicy.allowsDirectConversation(UserRole.parent, role),
        isFalse,
      );
    });

    test('an unrecognised role is denied rather than allowed', () {
      final role = WireMappers.memberRole('future_role');
      expect(role, ParticipantRole.unknown);
      for (final viewer in UserRole.values) {
        expect(
          CommunicationPolicy.allowsDirectConversation(viewer, role),
          isFalse,
        );
      }
    });

    test('author kinds map from the wire vocabulary', () {
      expect(WireMappers.authorRole('contact'), ParticipantRole.parent);
      expect(WireMappers.authorRole('teacher'), ParticipantRole.teacher);
      expect(WireMappers.authorRole('staff'), ParticipantRole.admin);
      expect(WireMappers.authorRole('system'), ParticipantRole.system);
    });
  });

  group('moderation outranks receipts', () {
    Map<String, Object?> messageJson({
      String moderation = 'published',
      List<Object?> receipts = const [],
    }) =>
        {
          'id': 'srv_1',
          'conversationId': 'c1',
          'seq': '5',
          'authorId': 'me',
          'authorKind': 'contact',
          'type': 'text',
          'body': 'مرحبا',
          'moderation': moderation,
          'createdAt': '2026-09-05T12:00:00.000Z',
          'receipts': receipts,
          'reactions': const [],
          'attachments': const [],
        };

    test('a pending message is not visible to others', () {
      final message =
          WireMappers.message(messageJson(moderation: 'pending'), viewerActorId: 'me');

      expect(message.approvalState, ApprovalState.pending);
      expect(message.isVisibleToOthers, isFalse);
    });

    test('a rejected message is terminal and not visible to others', () {
      final message =
          WireMappers.message(messageJson(moderation: 'rejected'), viewerActorId: 'me');

      expect(message.approvalState, ApprovalState.rejected);
      expect(message.isVisibleToOthers, isFalse);
    });

    test('published means live', () {
      final message = WireMappers.message(messageJson(), viewerActorId: 'me');
      expect(message.approvalState, ApprovalState.notRequired);
      expect(message.isVisibleToOthers, isTrue);
    });

    test('read beats delivered beats sent', () {
      expect(
        WireMappers.deliveryState([
          {'state': 'delivered'},
          {'state': 'read'},
        ]),
        DeliveryState.read,
      );
      expect(
        WireMappers.deliveryState([
          {'state': 'sent'},
          {'state': 'delivered'},
        ]),
        DeliveryState.delivered,
      );
      expect(WireMappers.deliveryState(const []), DeliveryState.sent);
    });

    test('a server message is never mapped to a client-only state', () {
      final message = WireMappers.message(messageJson(), viewerActorId: 'me');
      expect(
        message.deliveryState.isLocal,
        isFalse,
        reason: 'queued/sending/failed are the client\'s to author, not the wire\'s',
      );
    });
  });

  group('message identity and ownership', () {
    test('falls back to the server id when there is no client id', () {
      final message = WireMappers.message(
        {
          'id': 'srv_9',
          'conversationId': 'c1',
          'seq': '9',
          'type': 'text',
          'createdAt': '2026-09-05T12:00:00.000Z',
        },
        viewerActorId: 'me',
      );

      expect(message.clientMessageId, 'srv_9');
    });

    test('isMine is decided by actor id, not by role', () {
      final mine = WireMappers.message(
        {
          'id': 'a',
          'conversationId': 'c1',
          'authorId': 'me',
          'authorKind': 'contact',
          'type': 'text',
          'createdAt': '2026-09-05T12:00:00.000Z',
        },
        viewerActorId: 'me',
      );
      final theirs = WireMappers.message(
        {
          'id': 'b',
          'conversationId': 'c1',
          'authorId': 'someone-else',
          'authorKind': 'contact',
          'type': 'text',
          'createdAt': '2026-09-05T12:00:00.000Z',
        },
        viewerActorId: 'me',
      );

      expect(mine.isMine, isTrue);
      expect(theirs.isMine, isFalse);
    });

    test('reactions are grouped and mine is detected', () {
      final message = WireMappers.message(
        {
          'id': 'a',
          'conversationId': 'c1',
          'type': 'text',
          'createdAt': '2026-09-05T12:00:00.000Z',
          'reactions': [
            {'actorId': 'me', 'emoji': '👍'},
            {'actorId': 'other', 'emoji': '👍'},
            {'actorId': 'other', 'emoji': '❤️'},
          ],
        },
        viewerActorId: 'me',
      );

      final thumbs = message.reactions.firstWhere((r) => r.emoji == '👍');
      expect(thumbs.count, 2);
      expect(thumbs.mine, isTrue);

      final heart = message.reactions.firstWhere((r) => r.emoji == '❤️');
      expect(heart.mine, isFalse);
    });

    test('a deleted message is marked deleted', () {
      final message = WireMappers.message(
        {
          'id': 'a',
          'conversationId': 'c1',
          'type': 'text',
          'createdAt': '2026-09-05T12:00:00.000Z',
          'deletedAt': '2026-09-05T13:00:00.000Z',
        },
        viewerActorId: 'me',
      );

      expect(message.isDeleted, isTrue);
    });
  });

  group('approval policy is per viewer role', () {
    final json = <String, Object?>{
      'id': 'c1',
      'type': 'student_group',
      'title': 'أحمد · جَوِّد',
      'lastActivityAt': '2026-09-05T12:00:00.000Z',
      'teacherRequiresApproval': true,
      'parentRequiresApproval': false,
    };

    test('a teacher sees the teacher policy', () {
      final conversation =
          WireMappers.conversation(json, viewerRole: UserRole.teacher);
      expect(conversation.requiresApproval, isTrue);
    });

    test('a parent sees the parent policy', () {
      final conversation =
          WireMappers.conversation(json, viewerRole: UserRole.parent);
      expect(conversation.requiresApproval, isFalse);
    });

    test('an archived conversation is read-only', () {
      final conversation = WireMappers.conversation(
        {...json, 'archivedAt': '2026-09-05T14:00:00.000Z'},
        viewerRole: UserRole.parent,
      );

      expect(conversation.isArchived, isTrue);
      expect(conversation.isReadOnly, isTrue);
    });
  });
}
