import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../data/account_call_history.dart';

/// Call history, from the backend and nowhere else.
///
/// Two states this must distinguish, because conflating them would misinform the user:
///
/// * **No calls.** The backend answered with an empty history. Nothing is wrong.
/// * **No repository is registered in this container.** Both shipped composition roots
///   DO provide one — `bootstrap.dart` overrides [callRepositoryProvider] with
///   `HttpCallRepository` for the HTTP build and `FakeCallRepository` for the fake one, and
///   `POST /calls` and `GET /calls/history/:conversationId` both exist. So this is the
///   fail-closed path for a container built without that override: the base provider
///   throws [UnimplementedError] rather than defaulting to something, which is caught here
///   and turned into a specific, honest state rather than a red error screen or, worse, an
///   empty list that would read as "you have no calls".
///
///   The description above used to say calling was not wired at all, because no call
///   endpoint had been published when this was written. M4/W3 published them and
///   registered the repository; the guard is still right, its explanation was not.
class CallsController extends AsyncNotifier<List<CallHistoryEntry>> {
  @override
  Future<List<CallHistoryEntry>> build() => _load();

  Future<List<CallHistoryEntry>> _load() async {
    final AccountCallHistoryRepository history;
    try {
      // Read for its refusal: an unregistered provider throws, and that is a
      // different fault from the one below -- a build wired wrongly, rather
      // than an endpoint that does not exist.
      history = ref.read(accountCallHistoryProvider);
    } catch (error) {
      // Riverpod wraps whatever a provider's create function throws in a
      // ProviderException, so the UnimplementedError the composition root raises
      // for an unregistered repository arrives one layer down. Unwrap before
      // deciding.
      final cause = error is ProviderException ? error.exception : error;
      if (cause is! UnimplementedError) rethrow;

      throw const AppError(
        AppErrorKind.notFound,
        code: callsNotAvailableCode,
        debugDetail: 'No account call-history repository is registered in this build.',
      );
    }

    // THE SERVER OWNS THE LIST (W8-W2).
    //
    // Until this workstream there was no endpoint this screen could honestly
    // ask: `GET /calls/history/:conversationId` is per-conversation and this is
    // the ACCOUNT's call list, so the screen reported the absence instead of
    // inventing an answer. `GET /calls/history` now answers it, scoped server-
    // side to the conversations this actor may read.
    //
    // WHAT IS DELIBERATELY NOT DONE HERE. No per-conversation fan-out, no
    // client-side merge of several histories, no client ordering, no paging
    // arithmetic, and above all no `family_id` -- a family holds conversations
    // this actor may not be in, and scope is not the client's to compute. One
    // request, and the order it comes back in is the order shown.
    final page = await history.page();
    return page.items;
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }
}

/// Distinguishes "calling is not switched on" from every other not-found.
const callsNotAvailableCode = 'calls_not_available';

final callsControllerProvider =
    AsyncNotifierProvider<CallsController, List<CallHistoryEntry>>(
  CallsController.new,
);
