import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../../calls/application/call_capability.dart';

/// PD-20: whether the signed-in Sales seat is a LIVE member of this trial group, read
/// from the group's own member list (`GET /conversations/:id`). Session-bound.
///
/// Sales sees every teacher's trial group but is a member only of those they joined; the
/// server's call capability refuses a non-member (`COMM.NOT_CONVERSATION_MEMBER`).
final trialGroupMembershipProvider = FutureProvider.autoDispose.family<bool, String>((ref, conversationId) async {
  final me = ref.watch(principalIdProvider);
  if (me == null || me.isEmpty) return false;
  final group = await ref.watch(groupRepositoryProvider).group(conversationId);
  return group.members.any((m) => m.id == me);
});

/// "Join this group", above a trial group's thread -- for a Sales viewer who is not yet a
/// member, and for nobody else. Joining is `POST /trials/groups/:id/join`; afterwards the
/// membership and the call capability are asked again, so the call button is whatever the
/// server now says, exactly as for any other member.
///
/// Absent (not disabled) while membership is unknown, for a member, and for every other
/// role: a teacher is always a member of their own trial group, and a parent never sees one.
class TrialGroupJoinBanner extends ConsumerStatefulWidget {
  const TrialGroupJoinBanner({super.key, required this.conversationId, this.onJoined});

  final String conversationId;

  /// Refreshes whatever else describes the conversation (the route's own copy).
  final VoidCallback? onJoined;

  @override
  ConsumerState<TrialGroupJoinBanner> createState() => _TrialGroupJoinBannerState();
}

class _TrialGroupJoinBannerState extends ConsumerState<TrialGroupJoinBanner> {
  bool _joining = false;

  Future<void> _join() async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    setState(() => _joining = true);
    try {
      await ref.read(trialRepositoryProvider).joinGroup(widget.conversationId);
      ref.invalidate(trialGroupMembershipProvider(widget.conversationId));
      ref.invalidate(callCapabilityProvider(widget.conversationId));
      widget.onJoined?.call();
    } catch (error) {
      final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
      messenger?.showSnackBar(SnackBar(content: Text(message.title)));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (ref.watch(currentRoleProvider) != UserRole.sales) return const SizedBox.shrink();
    // The super admin starts a group call without a seat in the chat (PD-19 amendments), so
    // joining a trial group would only add it to the member list.
    if (ref.watch(isSuperAdminProvider)) return const SizedBox.shrink();
    final member = ref.watch(trialGroupMembershipProvider(widget.conversationId));
    if (member.value != false) return const SizedBox.shrink();

    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    return Container(
      key: const ValueKey('trial-group-join'),
      width: double.infinity,
      color: tokens.colorStatusInfoBg,
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing2),
      child: Row(
        children: [
          Icon(Icons.group_outlined, size: 18, color: tokens.colorStatusInfoFg),
          const SizedBox(width: Spacing.spacing3),
          Expanded(
            child: Text(l10n.trialGroupNotMember, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextPrimary)),
          ),
          const SizedBox(width: Spacing.spacing3),
          FilledButton.tonal(
            // The theme's buttons are full-width; this one sits in a row.
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: _joining ? null : _join,
            child: Text(l10n.trialGroupJoin),
          ),
        ],
      ),
    );
  }
}
