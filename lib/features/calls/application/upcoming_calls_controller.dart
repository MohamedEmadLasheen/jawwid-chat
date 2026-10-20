import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../data/scheduled_call_repository.dart';
import '../domain/scheduled_call.dart';

/// The Calls tab's Upcoming section: `GET /scheduled-calls`, and nothing else.
///
/// Session-scoped for the same reason the call history is: who this person is
/// meeting, and when, must not survive into the next account on the device.
///
/// Distinguishes "nothing scheduled" (an empty list) from "this build has no
/// scheduled-call repository" ([scheduledCallsNotAvailableCode]), exactly as
/// `CallsController` does for history: an empty section must never be the
/// rendering of a build that cannot ask.
class UpcomingCallsController extends AsyncNotifier<List<ScheduledCall>>
    with SessionScoped<List<ScheduledCall>> {
  @override
  List<ScheduledCall> get sessionEmptyValue => const [];

  @override
  Future<List<ScheduledCall>> build() {
    bindToSession();
    return _load();
  }

  Future<List<ScheduledCall>> _load() => resolveScheduledCallRepository(
    () => ref.read(scheduledCallRepositoryProvider),
  ).upcoming();

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  /// Cancel one this viewer created. The server posts the cancellation card;
  /// this only reloads the list it answers from.
  Future<void> cancel(String id) async {
    await resolveScheduledCallRepository(
      () => ref.read(scheduledCallRepositoryProvider),
    ).cancel(id);
    await refresh();
  }
}

/// The registered repository, or the specific "not available" refusal.
///
/// Takes the read rather than a `Ref` so a widget's `WidgetRef` can use it too.
ScheduledCallRepository resolveScheduledCallRepository(
  ScheduledCallRepository Function() read,
) {
  try {
    return read();
  } catch (error) {
    final cause = error is ProviderException ? error.exception : error;
    if (cause is! UnimplementedError) rethrow;
    throw const AppError(
      AppErrorKind.notFound,
      code: scheduledCallsNotAvailableCode,
      debugDetail: 'No scheduled-call repository is registered in this build.',
    );
  }
}

const scheduledCallsNotAvailableCode = 'scheduled_calls_not_available';

final upcomingCallsControllerProvider =
    AsyncNotifierProvider<UpcomingCallsController, List<ScheduledCall>>(
      UpcomingCallsController.new,
    );
