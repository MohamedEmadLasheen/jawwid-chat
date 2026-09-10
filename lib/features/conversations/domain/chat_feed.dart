import '../../../shared/models/conversation.dart';
import '../../../shared/utils/search_text.dart';
import 'conversation_list.dart';

/// The chip row above the conversation list.
///
/// These are **filters of one feed**, not destinations. That is the whole point of the
/// information architecture: Groups used to be a tab competing with Chats, and a user who
/// could not find a group had to guess which of two lists it lived in.
enum ChatFilter {
  all,
  unread,
  groups,

  /// Backed by the existing per-user `isPinned` preference (§42) — there is no separate
  /// favourites field on the backend, and inventing one would be a fiction. The label is a
  /// UI choice; the stored state is the same pin the list has always ordered by.
  favorites,
}

/// Turns the sectioned list the controller produces into the flat, familiar feed a
/// messaging app shows, then applies the active filter and search.
///
/// Flattening rather than re-sorting deliberately preserves the ordering
/// [ConversationListBuilder] already establishes and that `conversation_list_test.dart`
/// pins down: the family's Jawwid thread first, then each child by that child's most recent
/// activity, then staff — with pinned rows ahead of the rest inside each group. That order
/// already reads the way a chat list should, so this adds no ordering opinion of its own.
abstract final class ChatFeed {
  static List<Conversation> build({
    required List<ConversationSection> sections,
    required ChatFilter filter,
    String query = '',
  }) {
    final flat = [
      for (final section in sections) ...section.conversations,
    ];

    final matching = flat.where((c) => _passes(c, filter) && _matches(c, query));

    return List.unmodifiable(matching);
  }

  /// How many conversations a chip would show, for the badge on the Unread chip.
  static int count({
    required List<ConversationSection> sections,
    required ChatFilter filter,
  }) =>
      build(sections: sections, filter: filter).length;

  static bool _passes(Conversation conversation, ChatFilter filter) =>
      switch (filter) {
        ChatFilter.all => true,
        ChatFilter.unread => conversation.hasUnread,
        ChatFilter.groups => conversation.kind == ConversationKind.studentGroup,
        ChatFilter.favorites => conversation.isPinned,
      };

  /// Matches on the conversation title and, for a student group, the child's name.
  ///
  /// It does **not** match on the last-message preview. The client holds exactly one
  /// message per conversation, so searching it would find the newest message and silently
  /// miss every older one — search that appears to cover message content while covering
  /// almost none of it is worse than search that plainly does not. Message search needs a
  /// backend endpoint; see `docs/mobile/backend-dependencies.md`.
  static bool _matches(Conversation conversation, String query) {
    if (query.trim().isEmpty) return true;

    if (SearchText.matches(conversation.title, query)) return true;

    final learner = conversation.learner;
    return learner != null && SearchText.matches(learner.displayName, query);
  }
}
