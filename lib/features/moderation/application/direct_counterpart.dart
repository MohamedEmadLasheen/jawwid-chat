import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../profile/domain/profile_view.dart';

/// The other person of a DIRECT conversation, or null when there is no one person to act on
/// (PD-57: Report and Block on a one-to-one profile).
///
/// A one-to-one profile's `subject` is the CONVERSATION (its id is the conversation id, with
/// no role), so it cannot name a person. This reads `GET /conversations/:id` and its
/// `members` -- the same members the group profile already trusts -- and answers:
/// - null for a group, and for the family's conversation with the academy (`official`, the
///   administrative channel: never reported or blocked from here);
/// - null unless exactly one member other than the viewer is listed;
/// - null on any failure: nothing is offered on a guess.
///
/// Advisory: whatever is then sent, the server decides.
final directCounterpartProvider = FutureProvider.autoDispose.family<ProfilePerson?, String>((
  ref,
  conversationId,
) async {
  final viewerId = ref.watch(principalIdProvider);
  if (viewerId == null || viewerId.isEmpty) return null;
  try {
    final conversation = await ref.read(conversationRepositoryProvider).byId(conversationId);
    if (!conversation.kind.isDirect) return null;
    final group = await ref.read(groupRepositoryProvider).group(conversationId);
    final others = [
      for (final m in group.members)
        if (m.id.isNotEmpty && m.id != viewerId && m.id != conversationId) m,
    ];
    if (others.length != 1) return null;
    final other = others.single;
    return ProfilePerson(id: other.id, displayName: other.displayName, role: other.role, avatarUrl: other.avatarUrl);
  } catch (_) {
    return null;
  }
});
