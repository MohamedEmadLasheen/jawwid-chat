import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/policy/communication_policy.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

void main() {
  group('CommunicationPolicy — the teacher/parent rule', () {
    test('a parent may never open a 1:1 with a teacher', () {
      expect(
        CommunicationPolicy.allowsDirectConversation(
          UserRole.parent,
          ParticipantRole.teacher,
        ),
        isFalse,
      );
    });

    test('a teacher may never open a 1:1 with a parent', () {
      expect(
        CommunicationPolicy.allowsDirectConversation(
          UserRole.teacher,
          ParticipantRole.parent,
        ),
        isFalse,
      );
    });

    test('neither may call the other directly', () {
      expect(
        CommunicationPolicy.allowsDirectCall(UserRole.parent, ParticipantRole.teacher),
        isFalse,
      );
      expect(
        CommunicationPolicy.allowsDirectCall(UserRole.teacher, ParticipantRole.parent),
        isFalse,
      );
    });

    test('sharing a student group grants no 1:1 channel', () {
      // §25: group membership must never become a directory.
      expect(
        CommunicationPolicy.allowsDirectContactFromGroupMember(
          UserRole.parent,
          ParticipantRole.teacher,
        ),
        isFalse,
      );
      expect(
        CommunicationPolicy.allowsDirectContactFromGroupMember(
          UserRole.teacher,
          ParticipantRole.parent,
        ),
        isFalse,
      );
    });
  });

  group('CommunicationPolicy — permitted channels', () {
    test('both roles may hold a 1:1 with Jawwid staff', () {
      for (final role in UserRole.values) {
        expect(
          CommunicationPolicy.allowsDirectConversation(role, ParticipantRole.admin),
          isTrue,
          reason: '${role.name} must be able to reach an admin',
        );
        expect(
          CommunicationPolicy.allowsDirectCall(role, ParticipantRole.admin),
          isTrue,
        );
      }
    });

    test('nobody may open a 1:1 with the system actor or an unknown role', () {
      for (final role in UserRole.values) {
        expect(
          CommunicationPolicy.allowsDirectConversation(role, ParticipantRole.system),
          isFalse,
        );
        expect(
          CommunicationPolicy.allowsDirectConversation(role, ParticipantRole.unknown),
          isFalse,
        );
      }
    });

    test('an unrecognised role string degrades to unknown, and is therefore denied', () {
      // A future backend role must fail closed, not open.
      final parsed = ParticipantRole.parse('some_new_role');
      expect(parsed, ParticipantRole.unknown);
      expect(
        CommunicationPolicy.allowsDirectConversation(UserRole.parent, parsed),
        isFalse,
      );
    });

    test('every role pairing has an explicit decision', () {
      // Guards against a future ParticipantRole being silently allowed.
      for (final viewer in UserRole.values) {
        for (final other in ParticipantRole.values) {
          expect(
            () => CommunicationPolicy.allowsDirectConversation(viewer, other),
            returnsNormally,
          );
        }
      }
    });
  });
}
