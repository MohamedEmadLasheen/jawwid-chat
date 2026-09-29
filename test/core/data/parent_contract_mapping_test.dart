import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/system_event.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The client half of the Parent contract fixes.
///
/// Each of these was a Flutter symptom with an API cause: a blank row, a role
/// word where a name belongs, raw JSON on screen, a pin that forgot itself. The
/// causes are fixed in the payload and asserted server-side; this asserts that
/// the client actually READS what the payload now carries — which is the other
/// half, and the half that was silently dropping fields before.
void main() {
  Map<String, Object?> directDto({
    Object? counterpart,
    Object? viewerState,
    Object? lastMessage,
    Object? viewerRequiresApproval,
    bool parentRequiresApproval = true,
  }) =>
      {
        'id': 'c1',
        'type': 'direct',
        'title': null,
        'lastActivityAt': '2026-09-29T10:00:00.000Z',
        'lastSeq': '4',
        'archivedAt': null,
        'teacherRequiresApproval': true,
        'parentRequiresApproval': parentRequiresApproval,
        'counterpart': ?counterpart,
        'viewerState': ?viewerState,
        'lastMessage': ?lastMessage,
        'viewerRequiresApproval': ?viewerRequiresApproval,
      };

  Conversation map(Map<String, Object?> json, {String viewer = 'me'}) =>
      WireMappers.conversation(
        json,
        viewerRole: UserRole.parent,
        viewerActorId: viewer,
      );

  // -------------------------------------------------------------------------
  group('a 1:1 is named by its counterpart', () {
    test('displayTitle falls back to the other participant', () {
      final c = map(directDto(counterpart: {
        'actorId': 'a1',
        'actorKind': 'staff',
        'displayName': 'Dina',
      }));

      expect(c.title, '');
      expect(c.displayTitle, 'Dina');
    });

    test('the room own title wins when it has one', () {
      final c = map({
        ...directDto(counterpart: {
          'actorId': 'a1',
          'actorKind': 'staff',
          'displayName': 'Dina',
        }),
        'type': 'student_group',
        'title': 'Adam · Jawwid',
      });

      expect(c.displayTitle, 'Adam · Jawwid');
    });

    test('stays empty rather than showing an id when unresolved', () {
      // A blank name is a state the UI renders as unresolved. An actor id on a
      // family surface is never acceptable (§25).
      final c = map(directDto(counterpart: {
        'actorId': 'a1',
        'actorKind': 'staff',
        'displayName': null,
      }));

      expect(c.displayTitle, '');
      expect(c.displayTitle, isNot(contains('a1')));
    });

    test('is absent when the payload carries no counterpart', () {
      expect(map(directDto()).counterpart, isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('the approval notice comes from the server', () {
    test('honours viewerRequiresApproval when present', () {
      expect(map(directDto(viewerRequiresApproval: false)).requiresApproval, isFalse);
      expect(map(directDto(viewerRequiresApproval: true)).requiresApproval, isTrue);
    });

    test('a 1:1 is never held, even with parentRequiresApproval stored true', () {
      // The exact defect: the stored flag is true on a direct row and approval
      // has never applied there. Asserted on the fallback path too, so an older
      // backend does not reintroduce it.
      final c = map(directDto(parentRequiresApproval: true));

      expect(c.requiresApproval, isFalse);
    });

    test('the fallback reads ONE flag, chosen by role, never both OR-ed', () {
      final group = {
        ...directDto(parentRequiresApproval: false),
        'type': 'student_group',
        'teacherRequiresApproval': true,
      };

      // A parent must not be told their messages are reviewed because the
      // teacher's are.
      expect(map(group).requiresApproval, isFalse);
      expect(
        WireMappers.conversation(group,
                viewerRole: UserRole.teacher, viewerActorId: 'me')
            .requiresApproval,
        isTrue,
      );
    });
  });

  // -------------------------------------------------------------------------
  group('pin and mute are read back, not assumed', () {
    test('a stored pin comes back as pinned', () {
      final c = map(directDto(viewerState: {
        'pinnedAt': '2026-09-29T09:00:00.000Z',
        'mutedUntil': null,
        'archivedAt': null,
      }));

      expect(c.isPinned, isTrue);
    });

    test('a mute in the future is a mute; one in the past is not', () {
      final future = DateTime.now().toUtc().add(const Duration(days: 1));
      final past = DateTime.now().toUtc().subtract(const Duration(days: 1));

      expect(
        map(directDto(viewerState: {'mutedUntil': future.toIso8601String()})).isMuted,
        isTrue,
      );
      expect(
        map(directDto(viewerState: {'mutedUntil': past.toIso8601String()})).isMuted,
        isFalse,
      );
    });

    test('the caller own archive hides the row without making it read-only', () {
      // Two different archives: staff closing the room, and this reader filing
      // their own copy. Only the first disables the composer.
      final c = map(directDto(viewerState: {
        'archivedAt': '2026-09-29T09:00:00.000Z',
      }));

      expect(c.isArchived, isTrue);
      expect(c.isReadOnly, isFalse);
    });

    test('no viewerState means not pinned and not muted, not a crash', () {
      final c = map(directDto());

      expect(c.isPinned, isFalse);
      expect(c.isMuted, isFalse);
    });
  });

  // -------------------------------------------------------------------------
  group('the list row preview', () {
    test('carries a text body and its author', () {
      final c = map(directDto(lastMessage: {
        'id': 'm1',
        'type': 'text',
        'authorKind': 'staff',
        'authorId': 'a1',
        'authorName': 'Dina',
        'preview': 'see you at five',
        'systemEvent': null,
        'createdAt': '2026-09-29T10:00:00.000Z',
      }));

      expect(c.lastMessage!.kind, MessageKind.text);
      expect(c.lastMessage!.text, 'see you at five');
      expect(c.lastMessage!.authorName, 'Dina');
      expect(c.lastMessage!.isMine, isFalse);
    });

    test('knows when the last message is the reader own', () {
      final c = map(
        directDto(lastMessage: {
          'id': 'm1',
          'type': 'text',
          'authorKind': 'contact',
          'authorId': 'me',
          'preview': 'thanks',
          'createdAt': '2026-09-29T10:00:00.000Z',
        }),
      );

      expect(c.lastMessage!.isMine, isTrue);
    });

    test('takes a voice note with no text at all', () {
      final c = map(directDto(lastMessage: {
        'id': 'm1',
        'type': 'voice',
        'authorKind': 'staff',
        'authorId': 'a1',
        'preview': null,
        'createdAt': '2026-09-29T10:00:00.000Z',
      }));

      expect(c.lastMessage!.kind, MessageKind.voice);
      expect(c.lastMessage!.text, isNull);
    });

    test('takes a system event and no body', () {
      final c = map(directDto(lastMessage: {
        'id': 'm1',
        'type': 'system',
        'authorKind': 'system',
        'authorId': null,
        'preview': null,
        'systemEvent': {
          'kind': 'group.created',
          'params': {'learner': 'Adam'},
        },
        'createdAt': '2026-09-29T10:00:00.000Z',
      }));

      expect(c.lastMessage!.systemEvent!.kind, 'group.created');
      expect(c.lastMessage!.text, isNull);
    });

    test('is null for a conversation with nothing in it', () {
      expect(map(directDto()).lastMessage, isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('a message carries its author name and its system event', () {
    Message message(Map<String, Object?> json) =>
        WireMappers.message(json, viewerActorId: 'me');

    test('reads authorName from the payload', () {
      final m = message({
        'id': 'm1',
        'authorId': 'a1',
        'authorKind': 'teacher',
        'authorName': 'Nour',
        'type': 'text',
        'body': 'hello',
        'createdAt': '2026-09-29T10:00:00.000Z',
      });

      expect(m.authorName, 'Nour');
    });

    test('leaves the name empty when the backend could not resolve it', () {
      final m = message({
        'id': 'm1',
        'authorId': 'a1',
        'authorKind': 'teacher',
        'authorName': null,
        'type': 'text',
        'body': 'hello',
        'createdAt': '2026-09-29T10:00:00.000Z',
      });

      expect(m.authorName, isEmpty);
      expect(m.authorName, isNot('a1'));
    });

    test('reads a system event, and the body it replaced is gone', () {
      final m = message({
        'id': 'm1',
        'authorId': null,
        'authorKind': 'system',
        'type': 'system',
        'body': null,
        'systemEvent': {
          'kind': 'group.created',
          'params': {'learner': 'Adam'},
        },
        'createdAt': '2026-09-29T10:00:00.000Z',
      });

      expect(m.systemEvent!.kind, 'group.created');
      expect(m.systemEvent!.param('learner'), 'Adam');
      expect(m.body, isEmpty);
    });
  });

  // -------------------------------------------------------------------------
  group('SystemEvent parsing is total', () {
    test('returns null for anything that is not an event', () {
      for (final input in <Object?>[
        null,
        'a string',
        <Object?>[],
        <String, Object?>{},
        {'kind': ''},
        {'kind': 42},
      ]) {
        expect(SystemEvent.fromJson(input), isNull, reason: '$input');
      }
    });

    test('tolerates missing or non-string params', () {
      final event = SystemEvent.fromJson({
        'kind': 'group.created',
        'params': {'learner': 'Adam', 'count': 2},
      })!;

      expect(event.param('learner'), 'Adam');
      expect(event.param('count'), isNull);
      expect(event.param('absent'), isNull);
    });

    test('treats a blank parameter as absent, so a sentence can change', () {
      final event = SystemEvent.fromJson({
        'kind': 'group.created',
        'params': {'learner': '   '},
      })!;

      expect(event.param('learner'), isNull);
    });
  });
}
