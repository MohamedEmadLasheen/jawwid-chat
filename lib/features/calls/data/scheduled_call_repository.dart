import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/scheduled_call.dart';

/// Scheduled calls and call links (PD-13): `/scheduled-calls`.
///
/// A TRANSPORT, NOT A POLICY. Who may schedule, see, join or cancel is decided
/// by the server at every step from the rules that already exist (call
/// capability, conversation membership, creator-only cancel). Nothing here
/// computes a permission, and the one rule it enforces client-side is that a
/// response it cannot fully read is refused rather than half-rendered.
///
/// It takes no part in a call's lifecycle. Join returns which way the call went
/// (`started` or `joined`) and `CallController.joinScheduled` takes it from
/// there through the ordinary call path.
abstract interface class ScheduledCallRepository {
  /// `GET /scheduled-calls`: this actor's not-cancelled calls that are not yet
  /// over, soonest first, in the server's order.
  Future<List<ScheduledCall>> upcoming();

  /// `GET /scheduled-calls/:id`.
  Future<ScheduledCall> get(String id);

  /// `POST /scheduled-calls`. [startsAt] is required for
  /// [ScheduledCallKind.scheduled] and ignored for a link.
  Future<ScheduledCall> create({
    required String conversationId,
    required ScheduledCallKind kind,
    DateTime? startsAt,
    String? title,
  });

  /// `POST /scheduled-calls/:id/cancel`. Creator only; idempotent.
  Future<ScheduledCall> cancel(String id);

  /// `POST /scheduled-calls/:id/join`.
  Future<ScheduledJoin> join(String id);
}

/// The scheduled-call repository for this build.
///
/// Overridden in `bootstrap.dart`. Unoverridden it throws, as every repository
/// provider here does, so a container that forgot to register it reports
/// "not available" instead of an empty list that reads as "nothing scheduled".
final scheduledCallRepositoryProvider = Provider<ScheduledCallRepository>((
  ref,
) {
  throw UnimplementedError(
    'scheduledCallRepositoryProvider must be overridden',
  );
});
