import 'dart:convert';

import '../../../l10n/app_localizations.dart';

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
    default:
      return l10n.systemUpdate;
  }
}
