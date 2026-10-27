import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../shared/utils/app_clock.dart';

/// PD-26: the teacher members of this conversation who are away today, read from
/// the conversation's own member list (`GET /conversations/:id`), where the server
/// marks them. Empty on any failure: the notice is advisory, never a gate.
///
/// Live without polling (PD-26 amendment): the chat realtime coordinator
/// invalidates it on the conversation's own signals and after a reconnect, and
/// the banner re-reads it when the app resumes and when the leave it shows ends.
final awayTeachersProvider = FutureProvider.autoDispose.family<List<GroupMember>, String>((ref, conversationId) async {
  try {
    final group = await ref.watch(groupRepositoryProvider).group(conversationId);
    return [for (final m in group.members) if (m.away != null) m];
  } catch (_) {
    return const [];
  }
});

/// "Now", for deciding when the notice may stop being true. [AppClock.now] in the app;
/// a pinned instant in tests, so a test does not depend on the hour it runs at.
final awayClockProvider = Provider<DateTime Function()>((ref) => AppClock.now);
