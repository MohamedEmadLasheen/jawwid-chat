import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';

/// PD-26: the teacher members of this conversation who are away today, read from
/// the conversation's own member list (`GET /conversations/:id`), where the server
/// marks them. Empty on any failure: the notice is advisory, never a gate.
final awayTeachersProvider = FutureProvider.autoDispose.family<List<GroupMember>, String>((ref, conversationId) async {
  try {
    final group = await ref.watch(groupRepositoryProvider).group(conversationId);
    return [for (final m in group.members) if (m.away != null) m];
  } catch (_) {
    return const [];
  }
});

/// "Ustadh Omar is on leave until 3 Nov. Messages still reach them." -- above the
/// thread, for as long as the server says a teacher here is away. Messaging is not
/// blocked (owner decision, PD-26); the family just knows not to expect a quick reply.
/// Absent while unknown and when nobody is away.
class TeacherAwayBanner extends ConsumerWidget {
  const TeacherAwayBanner({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final away = ref.watch(awayTeachersProvider(conversationId)).value ?? const <GroupMember>[];
    if (away.isEmpty) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final dates = MaterialLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final m in away)
          JawwidBanner(
            icon: Icons.event_busy_outlined,
            tone: JawwidBannerTone.warning,
            message: () {
              final until = m.away!.until;
              final date = dates.formatMediumDate(DateTime(until.year, until.month, until.day));
              return m.away!.kind == MemberAwayKind.leave
                  ? l10n.chatTeacherOnLeave(m.displayName, date)
                  : l10n.chatTeacherAway(m.displayName, date);
            }(),
          ),
      ],
    );
  }
}
