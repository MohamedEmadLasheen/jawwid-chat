import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';

/// Call history, from the backend and nowhere else.
///
/// Two states this must distinguish, because conflating them would misinform the user:
///
/// * **No calls.** The backend answered with an empty history. Nothing is wrong.
/// * **Calling is not wired.** No implementation of [CallRepository] is registered in this
///   build — the HTTP composition root does not provide one, because no call endpoint has
///   been published. Reading the provider throws [UnimplementedError],
///   which is caught here and turned into a specific, honest state rather than a red error
///   screen or, worse, an empty list that would read as "you have no calls".
class CallsController extends AsyncNotifier<List<CallHistoryEntry>> {
  @override
  Future<List<CallHistoryEntry>> build() => _load();

  Future<List<CallHistoryEntry>> _load() async {
    try {
      // Read for its refusal: an unregistered provider throws, and that is a
      // different fault from the one below -- a build wired wrongly, rather
      // than an endpoint that does not exist.
      ref.read(callRepositoryProvider);
    } catch (error) {
      // Riverpod wraps whatever a provider's create function throws in a
      // ProviderException, so the UnimplementedError the composition root raises for an
      // unregistered repository arrives one layer down. Unwrap before deciding.
      final cause = error is ProviderException ? error.exception : error;
      if (cause is! UnimplementedError) rethrow;

      throw const AppError(
        AppErrorKind.notFound,
        code: callsNotAvailableCode,
        debugDetail: 'No CallRepository is registered in this build.',
      );
    }

    // THERE IS NO GLOBAL CALL HISTORY ON THE SERVER.
    //
    // `GET /calls/history/:conversationId` is the only history endpoint: it
    // takes a conversation and returns that conversation's calls, unpaginated.
    // This screen is the ACCOUNT's call list and has no conversation to ask
    // about, so there is nothing it can honestly request.
    //
    // Until 2026-09-24 the gap was hidden rather than absent. The repository
    // declared a global `history({cursor})` that no route answered, and this
    // screen reported "calling is not wired" for the unrelated reason that the
    // HTTP build registered no repository. A repository now exists and matches
    // the real API, so the absence is stated instead of implied.
    //
    // Building the list client-side -- every conversation fetched and their
    // histories merged -- is deliberately not done: N+1 requests for one
    // screen, with ordering and paging invented by the client rather than
    // given by the server. Carry-forward for the call-history workstream,
    // which owns the endpoint that would answer this.
    throw const AppError(
      AppErrorKind.notFound,
      code: callsNotAvailableCode,
      debugDetail:
          'No global call-history endpoint exists; /calls/history is per-conversation.',
    );
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
