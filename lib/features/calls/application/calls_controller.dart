import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';

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
    final CallRepository repository;
    try {
      repository = ref.read(callRepositoryProvider);
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

    try {
      final page = await repository.history();
      return page.items;
    } catch (error) {
      throw ErrorMapper.map(error);
    }
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
