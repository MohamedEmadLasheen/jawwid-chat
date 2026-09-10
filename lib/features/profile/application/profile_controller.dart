import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';
import '../../conversations/application/conversations_controller.dart';
import '../domain/profile_view.dart';

/// The profile behind one conversation.
///
/// The conversation is fetched by id rather than read from the list already in memory: the
/// backend stays the authority on whether this viewer may see it, so a profile opened from
/// a stale row or a deep link fails at the boundary instead of rendering from a cache (§52).
final conversationProfileProvider =
    FutureProvider.family<ProfileView, String>((ref, conversationId) async {
  final role = ref.watch(currentRoleProvider);
  if (role == null) {
    throw const AppErrorPlaceholder();
  }

  try {
    final conversation =
        await ref.read(conversationRepositoryProvider).byId(conversationId);

    // Members exist only for a student group, and only that endpoint carries them.
    StudentGroup? group;
    if (conversation.kind == ConversationKind.studentGroup) {
      group = await ref.read(groupRepositoryProvider).group(conversationId);
    }

    return ProfileViewBuilder.forConversation(
      conversation: conversation,
      viewerRole: role,
      group: group,
    );
  } catch (error) {
    throw ErrorMapper.map(error);
  }
});

/// The signed-in user's own account, including their children when they are a parent.
///
/// The children come from the conversations the user can already see — every student group
/// carries its learner — so this asks for no new authority and invents no relationship. A
/// parent who can see the group can see the child it belongs to; that is the same fact.
final myAccountProvider = FutureProvider<ProfileView>((ref) async {
  final user = ref.watch(authControllerProvider).user;
  final role = ref.watch(currentRoleProvider);
  if (user == null || role == null) throw const AppErrorPlaceholder();

  if (role != UserRole.parent) {
    return ProfileViewBuilder.forOwnAccount(
      id: user.id,
      displayName: user.displayName,
      role: role,
      avatarUrl: user.avatarUrl,
    );
  }

  // Wait for the chat list rather than re-fetching it: it is the same data, and a second
  // round trip on a slow network to build a screen the user already has the data for is
  // exactly the cost §47 says not to pay.
  final sections = await ref.watch(conversationsControllerProvider.future);

  final groups = [
    for (final section in sections)
      for (final conversation in section.conversations)
        if (conversation.kind == ConversationKind.studentGroup &&
            conversation.learner != null)
          conversation,
  ];

  // One entry per child, keyed by learner so a child with more than one group is not
  // listed twice.
  final byLearner = <String, Conversation>{};
  for (final conversation in groups) {
    byLearner.putIfAbsent(conversation.learner!.id, () => conversation);
  }

  final children = <ProfileChild>[];
  for (final conversation in byLearner.values) {
    children.add(
      ProfileChild(
        learner: conversation.learner!,
        conversationId: conversation.id,
        groupTitle: conversation.title,
        teacherName: await _teacherName(ref, conversation.id),
        // level, subscription and schedule are omitted rather than guessed. Nothing in the
        // published contract carries them; the UI says so in words.
      ),
    );
  }

  return ProfileViewBuilder.forOwnAccount(
    id: user.id,
    displayName: user.displayName,
    role: role,
    avatarUrl: user.avatarUrl,
    children: children,
  );
});

/// The teacher on a child's group, when the group endpoint resolves one.
///
/// Returns null rather than throwing: a child whose teacher cannot be resolved must still
/// appear on the account screen. Over HTTP the member payload carries no display name at
/// all (gap O3), so null is the expected answer there, not an error.
Future<String?> _teacherName(Ref ref, String conversationId) async {
  try {
    final group = await ref.read(groupRepositoryProvider).group(conversationId);
    for (final member in group.members) {
      if (member.role == ParticipantRole.teacher &&
          member.displayName.trim().isNotEmpty) {
        return member.displayName;
      }
    }
  } catch (_) {
    // Swallowed deliberately — see above.
  }
  return null;
}

/// Thrown when a profile is requested with no session. The router evicts every protected
/// screen on a session ending (§7), so this is a race, not a state the user can reach.
class AppErrorPlaceholder implements Exception {
  const AppErrorPlaceholder();
}
