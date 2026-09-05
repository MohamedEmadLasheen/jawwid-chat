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
