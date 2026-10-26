import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/conversation.dart';
import '../domain/profile_view.dart';

/// The profile behind one conversation.
///
/// The conversation is fetched by id rather than read from the list already in memory: the
/// backend stays the authority on whether this viewer may see it, so a profile opened from
/// a stale row or a deep link fails at the boundary instead of rendering from a cache (§52).
final conversationProfileProvider =
    FutureProvider.family<ProfileView, String>((ref, conversationId) async {
  // THE SESSION BOUNDARY. Watching the ROLE is not enough: Parent A -> Parent B changes the
  // person without changing the role, and this is a family keyed by conversation id that is
  // not autoDispose — so a profile fetched for one principal would be served to the next
  // from cache, with no refetch, exactly as the message log was.
  //
  // `watch` rather than the `SessionScoped` reset, because a FutureProvider has no state to
  // assign. That leaves the previous value readable during the reload, which is safe HERE
  // and only here: signing out routes to the sign-in screen, so no profile screen can still
  // be mounted when the next principal arrives, and their first visit flushes this.
  ref.watch(principalIdProvider);

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

/// The signed-in STAFF member's own account (a teacher's and a parent's are their own
/// profile screens -- MyAccountScreen).
///
/// It used to list a parent's children from their `student_group` conversations. Real
/// parents (PD-16 enrolment) have FAMILY groups, so it found none and said "No children
/// are linked to your account yet" under the children's photos (owner, 2026-10-24). A
/// parent's children now come from the server's parent profile (PD-17), on one screen.
final myAccountProvider = FutureProvider<ProfileView>((ref) async {
  final user = ref.watch(authControllerProvider).user;
  final role = ref.watch(currentRoleProvider);
  if (user == null || role == null) throw const AppErrorPlaceholder();

  return ProfileViewBuilder.forOwnAccount(
    id: user.id,
    displayName: user.displayName,
    role: role,
    avatarUrl: user.avatarUrl,
  );
});

/// Thrown when a profile is requested with no session. The router evicts every protected
/// screen on a session ending (§7), so this is a race, not a state the user can reach.
class AppErrorPlaceholder implements Exception {
  const AppErrorPlaceholder();
}
