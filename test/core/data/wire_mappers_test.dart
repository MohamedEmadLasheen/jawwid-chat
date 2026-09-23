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

    test('an unknown type does not become a student group', () {
      expect(
        WireMappers.conversationKind('something_new'),
        ConversationKind.adminDirect,
      );
    });
  });

  /// PD-6 (2026-09-23). A `direct` conversation may be Parent <-> Admin,
  /// Teacher <-> Admin or Parent <-> Teacher, so the type no longer decides it and the
  /// participants do.
  ///
  /// `actorKind` is what these read, never `memberRole`: a teacher can carry
  /// `member_role: 'admin'` on their membership row — red-team RT-025 C5 is that attack
  /// against the server — so the role label is not an identity.
  ///
  /// None of this authorizes anything. The server refuses an unauthorized pairing with
  /// COMM.TEACHER_PARENT_NOT_AUTHORIZED whatever this mapper decides.
  group('PD-6 direct conversation classification', () {
    Map<String, Object?> member(String actorKind, {String? role}) => {
          'actorId': 'actor-$actorKind',
          'actorKind': actorKind,
          'memberRole': role ?? actorKind,
          'isSilent': false,
        };

    test('1. Parent <-> Admin direct is an admin direct', () {
      expect(
        WireMappers.conversationKind(
          'direct',
          members: [member('contact', role: 'parent'), member('staff', role: 'admin')],
        ),
        ConversationKind.adminDirect,
      );
    });

    test('2. Teacher <-> Admin direct is an admin direct', () {
      expect(
        WireMappers.conversationKind(
          'direct',
          members: [member('teacher'), member('staff', role: 'admin')],
        ),
        ConversationKind.adminDirect,
      );
    });

    test('3. Parent <-> Teacher direct is a teacher-parent direct', () {
      expect(
        WireMappers.conversationKind(
          'direct',
          members: [member('contact', role: 'parent'), member('teacher')],
        ),
        ConversationKind.teacherParentDirect,
      );
    });

    test('4. participant order does not change the classification', () {
      final forward = WireMappers.conversationKind(
        'direct',
        members: [member('contact', role: 'parent'), member('teacher')],
      );
      final reversed = WireMappers.conversationKind(
        'direct',
        members: [member('teacher'), member('contact', role: 'parent')],
      );
      expect(reversed, forward);
      expect(reversed, ConversationKind.teacherParentDirect);
    });

    group('5. anything ambiguous fails closed, never to teacherParentDirect', () {
      final ambiguous = <String, Object?>{
        'members absent entirely (the list endpoint sends none)': null,
        'members empty': <Object?>[],
        'members not a list': 'contact,teacher',
        'a single participant': [member('contact', role: 'parent')],
        'three participants': [
          member('contact', role: 'parent'),
          member('teacher'),
          member('staff', role: 'admin'),
        ],
        'two contacts': [member('contact'), member('contact')],
        'two teachers': [member('teacher'), member('teacher')],
        'an unrecognised actorKind alongside a valid pair': [
          member('contact', role: 'parent'),
          member('teacher'),
          {'actorId': 'x', 'actorKind': 'future_kind'},
        ],
        'a malformed member entry': [member('contact'), 'not-an-object'],
        'a member with no actorKind at all': [
          member('contact', role: 'parent'),
          {'actorId': 'y', 'memberRole': 'teacher'},
        ],
      };

      ambiguous.forEach((description, members) {
        test(description, () {
          expect(
            WireMappers.conversationKind('direct', members: members),
            ConversationKind.unknownDirect,
            reason: 'must not be classified as an authorized teacher-parent channel',
          );
        });
      });

      test('memberRole alone can never produce teacherParentDirect', () {
        // The RT-025 C5 shape: a teacher wearing member_role 'admin', and a staff
        // member wearing 'teacher'. Reading roles instead of kinds would invert both.
        expect(
          WireMappers.conversationKind(
            'direct',
            members: [
              {'actorId': 'a', 'actorKind': 'staff', 'memberRole': 'teacher'},
              {'actorId': 'b', 'actorKind': 'staff', 'memberRole': 'parent'},
            ],
          ),
          isNot(ConversationKind.teacherParentDirect),
        );
      });
    });

    test('6. group conversations are unchanged by members being present', () {
      for (final type in ['student_group', 'class_group']) {
        expect(
          WireMappers.conversationKind(
            type,
            members: [member('contact', role: 'parent'), member('teacher')],
          ),
          ConversationKind.studentGroup,
          reason: '$type must not be reclassified by its participants',
        );
      }
    });

    test('7. non-direct types are unchanged, with or without members', () {
      expect(WireMappers.conversationKind('official'), ConversationKind.jawwidSupport);
      expect(
        WireMappers.conversationKind('official', members: [member('contact'), member('teacher')]),
        ConversationKind.jawwidSupport,
      );
      expect(
        WireMappers.conversationKind('something_new', members: [member('teacher')]),
        ConversationKind.adminDirect,
      );
    });

    test('every direct shape reports isDirect, so no row can fall out of the list', () {
      const shapes = [
        ConversationKind.adminDirect,
        ConversationKind.teacherParentDirect,
        ConversationKind.unknownDirect,
      ];
      for (final kind in shapes) {
        expect(kind.isDirect, isTrue, reason: '$kind must group with the other 1:1 rows');
      }
      expect(ConversationKind.studentGroup.isDirect, isFalse);
      expect(ConversationKind.jawwidSupport.isDirect, isFalse);
    });

    test('the full conversation mapper carries members through', () {
      final conversation = WireMappers.conversation(
        {
          'id': 'c1',
          'type': 'direct',
          'title': 'Ustadh Mohamed',
          'lastActivityAt': '2026-09-23T10:00:00Z',
          'members': [member('contact', role: 'parent'), member('teacher')],
        },
        viewerRole: UserRole.parent,
      );
      expect(conversation.kind, ConversationKind.teacherParentDirect);
    });

    test('the full conversation mapper fails closed when the payload omits members', () {
      final conversation = WireMappers.conversation(
        {
          'id': 'c2',
          'type': 'direct',
          'title': 'Jawwid',
          'lastActivityAt': '2026-09-23T10:00:00Z',
        },
        viewerRole: UserRole.parent,
      );
      expect(conversation.kind, ConversationKind.unknownDirect);
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

  group('voice attachments carry everything the player needs', () {
    Map<String, Object?> voiceMessage(Map<String, Object?> attachment) => {
          'id': 'srv_1',
          'conversationId': 'conv_1',
          'seq': '7',
          'authorKind': 'staff',
          'authorId': 'actor_staff',
          'type': 'voice',
          'body': null,
          'moderation': 'published',
          'createdAt': '2026-09-05T12:00:00.000Z',
          'attachments': [attachment],
          'reactions': const [],
          'receipts': const [],
        };

    test('the signed URL is mapped, not dropped', () {
      final message = WireMappers.message(
        voiceMessage({
          'id': 'att_1',
          'kind': 'voice',
          'mimeType': 'audio/mpeg',
          'byteSize': 20480,
          'durationMs': 4200,
          'url': 'https://storage.invalid/signed',
          'thumbnailUrl': null,
        }),
        viewerActorId: 'actor_parent',
      );

      final attachment = message.attachments.single;
      expect(message.kind, MessageKind.voice);
      expect(attachment.kind, MessageKind.voice);
      // Without the url there is nothing to play; this is the field whose
      // absence made a voice message unplayable.
      expect(attachment.url, 'https://storage.invalid/signed');
      expect(attachment.mimeType, 'audio/mpeg');
      expect(attachment.byteSize, 20480);
      expect(attachment.durationMs, 4200);
      expect(attachment.duration, const Duration(milliseconds: 4200));
    });

    test('a signed URL is recognised as remote, a local path as not', () {
      final remote = WireMappers.attachment(const {
        'id': 'att_1',
        'kind': 'voice',
        'url': 'https://storage.invalid/signed',
      });
      expect(remote.isLocal, isFalse);

      const pending = Attachment(
        id: 'draft',
        kind: MessageKind.voice,
        url: '/tmp/voice_1.ogg',
      );
      expect(pending.isLocal, isTrue);
    });

    test('a voice message with no duration still maps rather than throwing', () {
      final message = WireMappers.message(
        voiceMessage({'id': 'att_1', 'kind': 'voice'}),
        viewerActorId: 'actor_parent',
      );

      final attachment = message.attachments.single;
      expect(attachment.url, isNull);
      expect(attachment.durationMs, isNull);
      expect(attachment.duration, isNull);
    });

    test('a deleted voice message keeps no attachment to play', () {
      final message = WireMappers.message(
        {...voiceMessage({'id': 'att_1', 'kind': 'voice'}), 'deletedForAll': true,
          'attachments': const []},
        viewerActorId: 'actor_parent',
      );

      expect(message.isDeleted, isTrue);
      expect(message.attachments, isEmpty);
    });
  });
}
