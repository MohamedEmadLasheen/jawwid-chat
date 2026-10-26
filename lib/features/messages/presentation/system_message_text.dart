import 'dart:convert';

import 'package:intl/intl.dart';

import '../../../l10n/app_localizations.dart';

/// PD-33: "3 Nov" -- a cover's end day, in the reader's language and clock.
String coverDay(DateTime until, L10n l10n) => DateFormat.MMMd(l10n.localeName).format(until.toLocal());

/// A system message's body is the backend's `{ "kind": ..., ...facts }`
/// (`ConversationService.systemMessage`): it is rendered, never shown raw.
/// An unknown kind, or a body that is not that JSON, reads as a generic update.
/// The same kinds and wording as the Admin Web chat (`features/chat/copy.ts`).
String systemMessageText(String body, L10n l10n) {
  Map<String, dynamic> facts;
  try {
    final decoded = jsonDecode(body);
    if (decoded is! Map<String, dynamic>) return l10n.systemUpdate;
    facts = decoded;
  } on FormatException {
    return l10n.systemUpdate;
  }

  int count(Object? v) => v is num ? v.toInt() : 0;

  switch (facts['kind']) {
    case 'group.created':
      final learner = facts['learner'];
      return learner is String && learner.isNotEmpty
          ? l10n.systemGroupCreated(learner)
          : l10n.systemGroupCreatedNoLearner;
    case 'group.membership_changed':
      return l10n.systemGroupMembersUpdated(
        count(facts['added']),
        count(facts['removed']),
      );
    case 'group.archived':
      return l10n.systemGroupArchived;
    case 'group.supervisor_changed':
      final name = facts['supervisor'];
      return name is String && name.isNotEmpty
          ? l10n.systemGroupSupervisorChanged(name)
          : l10n.systemGroupSupervisorChangedNoName;
    case 'direct.supervisor_changed':
      final name = facts['supervisor'];
      return name is String && name.isNotEmpty
          ? l10n.systemDirectSupervisorChanged(name)
          : l10n.systemDirectSupervisorChangedNoName;
    case 'group.learner_detached':
      return l10n.systemGroupLearnerDetached;
    case 'cover.started':
    case 'cover.extended':
      final cover = facts['cover'];
      final supervisor = facts['supervisor'];
      final until = facts['until'] is String ? DateTime.tryParse(facts['until'] as String) : null;
      if (cover is! String || supervisor is! String || until == null) return l10n.systemCoverStartedNoName;
      return facts['kind'] == 'cover.started'
          ? l10n.systemCoverStarted(cover, supervisor, coverDay(until, l10n))
          : l10n.systemCoverExtended(cover, supervisor, coverDay(until, l10n));
    case 'cover.ended':
      final supervisor = facts['supervisor'];
      return supervisor is String && supervisor.isNotEmpty
          ? l10n.systemCoverEnded(supervisor)
          : l10n.systemCoverEndedNoName;
    // PD-35: a visible seat, taken or left.
    case 'seat.joined':
      return l10n.systemSeatJoined(_seatWho(facts, l10n));
    case 'seat.stepped_in':
      return l10n.systemSeatSteppedIn(_seatWho(facts, l10n));
    case 'seat.left':
      final name = _seatName(facts, l10n);
      return facts['ended'] == 'idle'
          ? l10n.systemSeatLeftIdle(name)
          : l10n.systemSeatLeft(name);
    default:
      return l10n.systemUpdate;
  }
}

String _seatName(Map<String, dynamic> facts, L10n l10n) {
  final name = facts['name'];
  return name is String && name.trim().isNotEmpty ? name : l10n.systemSeatSomeone;
}

/// "Ola (teacher supervisor)", or the name alone for a role word this build
/// does not know (the server sends the word's key, never wording).
String _seatWho(Map<String, dynamic> facts, L10n l10n) {
  final name = _seatName(facts, l10n);
  final role = switch (facts['role']) {
    'teacher_supervisor' => l10n.seatRoleTeacherSupervisor,
    'supervisor' => l10n.seatRoleSupervisor,
    'manager' => l10n.seatRoleManager,
    'super_admin' => l10n.seatRoleAdministration,
    _ => null,
  };
  return role == null ? name : l10n.systemSeatWho(name, role);
}
