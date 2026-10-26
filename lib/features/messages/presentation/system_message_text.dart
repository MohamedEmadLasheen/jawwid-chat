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
    // PD-36: someone asked into a family 1:1 stepped in, or out (no seat: a 1:1 never grows).
    case 'mention.stepped_in':
      final name = facts['name'];
      return name is String && name.isNotEmpty ? l10n.systemMentionSteppedIn(name) : l10n.systemMentionSteppedInNoName;
    case 'mention.stepped_out':
      final name = facts['name'];
      return name is String && name.isNotEmpty ? l10n.systemMentionSteppedOut(name) : l10n.systemMentionSteppedOutNoName;
    default:
      return l10n.systemUpdate;
  }
}
