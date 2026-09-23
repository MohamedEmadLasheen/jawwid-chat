import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/conversation.dart';
import '../domain/conversation_list.dart';

/// The chat list, sectioned for the signed-in role.
///
/// Pin/mute/archive are applied optimistically and rolled back on failure — these are cheap,
/// user-private preferences (§42), and making the user wait on a round trip for a pin would
/// feel broken on the slow networks this audience is on (§47).
class ConversationsController extends AsyncNotifier<List<ConversationSection>> {
  List<Conversation> _conversations = const [];
  bool _includeArchived = false;

  bool get includeArchived => _includeArchived;

  @override
  Future<List<ConversationSection>> build() => _load();

  Future<List<ConversationSection>> _load() async {
    final repository = ref.read(conversationRepositoryProvider);

    try {
      _conversations = await repository.list(includeArchived: _includeArchived);
      return _sectioned();
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }

  List<ConversationSection> _sectioned() {
    final role = ref.read(currentRoleProvider);
    if (role == null) return const [];

    return ConversationListBuilder.build(
      role: role,
      conversations: _conversations,
      includeArchived: _includeArchived,
    );
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  Future<void> setIncludeArchived(bool value) async {
    _includeArchived = value;
    await refresh();
  }

  Future<void> setPinned(String conversationId, bool pinned) => _optimistic(
        conversationId,
        (c) => c.copyWith(isPinned: pinned),
        () => ref.read(conversationRepositoryProvider).setPinned(conversationId, pinned),
      );

  Future<void> setMuted(String conversationId, bool muted) => _optimistic(
        conversationId,
        (c) => c.copyWith(isMuted: muted),
        () => ref.read(conversationRepositoryProvider).setMuted(conversationId, muted),
      );

  Future<void> setArchived(String conversationId, bool archived) => _optimistic(
        conversationId,
        (c) => c.copyWith(isArchived: archived),
        () => ref
            .read(conversationRepositoryProvider)
            .setArchived(conversationId, archived),
      );

  /// Mark a conversation read up to [throughSequence].
  ///
  /// This lives here rather than on the chat screen's own controller because
  /// **unread is a property of the list**: the row's badge and the tab badge are
  /// both computed from it, and a screen that told only the server would leave
  /// both showing a count for a conversation the user is currently reading.
  ///
  /// Failure is swallowed. Marking read is a side effect of opening a
  /// conversation, not something the user asked for, and a parent who has just
  /// read their messages must not be shown an error about bookkeeping — the
  /// count simply reappears on the next load, which is the honest fallback.
  Future<void> markRead(String conversationId, {required int throughSequence}) async {
    final current =
        _conversations.where((c) => c.id == conversationId).firstOrNull;

    // Already read *here*, so there is nothing to clear and nothing to report.
    // A conversation this controller has never heard of — opened straight from
    // a notification before the list loaded — falls through deliberately: the
    // server is still told, because the user did read the messages, and the
    // badge they are about to see must already be gone.
    if (current != null && current.unreadCount == 0) return;

    if (current != null) {
      _conversations = [
        for (final c in _conversations)
          c.id == conversationId ? c.copyWith(unreadCount: 0) : c,
      ];
      state = AsyncData(_sectioned());
    }

    try {
      await ref
          .read(conversationRepositoryProvider)
          .markRead(conversationId, throughSequence: throughSequence);
    } catch (_) {
      // Deliberately silent; see above.
    }
  }

  Future<void> _optimistic(
    String conversationId,
    Conversation Function(Conversation) apply,
    Future<void> Function() commit,
  ) async {
    final snapshot = _conversations;

    _conversations = [
      for (final c in _conversations) c.id == conversationId ? apply(c) : c,
    ];
    state = AsyncData(_sectioned());

    try {
      await commit();
    } catch (error) {
      _conversations = snapshot;
      state = AsyncData(_sectioned());
      throw ErrorMapper.map(error);
    }
  }

  /// Search is delegated to the backend so it stays inside the caller's authorization —
  /// the client must never assemble a directory of its own (§41).
  Future<List<Conversation>> search(String query) async {
    if (query.trim().isEmpty) return const [];

    try {
      return await ref.read(conversationRepositoryProvider).search(query.trim());
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }
}

final conversationsControllerProvider = AsyncNotifierProvider<
    ConversationsController, List<ConversationSection>>(ConversationsController.new);

/// Total unread across everything, for the tab badge.
final totalUnreadProvider = Provider<int>((ref) {
  final sections = ref.watch(conversationsControllerProvider).value;
  if (sections == null) return 0;

  return sections.fold<int>(
    0,
    (sum, section) =>
        sum +
        section.conversations.fold<int>(0, (inner, c) => inner + c.unreadCount),
  );
});

/// Convenience for screens that need to show a friendly error.
AppError asAppError(Object error) => ErrorMapper.map(error);
