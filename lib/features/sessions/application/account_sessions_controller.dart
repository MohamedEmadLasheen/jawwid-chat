import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/account_sessions_repository.dart';
import '../domain/account_session.dart';

/// PD-23: the signed-in account's sessions, for "Devices & sessions".
///
/// Bound to the principal ([SessionScoped]), so one account's devices are never shown to
/// the next person to sign in on this phone.
class AccountSessionsController extends AsyncNotifier<List<AccountSession>>
    with SessionScoped<List<AccountSession>> {
  @override
  List<AccountSession> get sessionEmptyValue => const [];

  @override
  Future<List<AccountSession>> build() {
    bindToSession();
    return ref.watch(accountSessionsRepositoryProvider).list();
  }

  AccountSessionsRepository get _repository => ref.read(accountSessionsRepositoryProvider);

  /// Pull-to-refresh. Keeps the list on screen while it reloads; a failure surfaces to the
  /// caller rather than replacing the list with an error.
  Future<void> reload() async {
    final sessions = await _repository.list();
    if (ref.mounted) state = AsyncData(sessions);
  }

  /// Signs [session] out. Throws the server's refusal (an unknown id is a 404) so the screen
  /// can say so; the list is left as it was.
  ///
  /// Revoking the CURRENT session is a sign-out of this device: once the server has ended
  /// it, the local session ends through `AuthController.signOut` -- the one path that clears
  /// tokens and local state -- told that the server side is already done.
  Future<void> revoke(AccountSession session) async {
    await _repository.revoke(session.id);
    if (session.current) {
      await ref.read(authControllerProvider.notifier).signOut(serverAlreadyEnded: true);
      return;
    }
    if (!ref.mounted) return;
    final current = state.value ?? const <AccountSession>[];
    state = AsyncData([
      for (final s in current)
        if (s.id != session.id) s,
    ]);
  }

  /// Ends every other live session of this account. Returns how many the server ended.
  Future<int> revokeOthers() async {
    final revoked = await _repository.revokeOthers();
    if (ref.mounted) {
      final current = state.value ?? const <AccountSession>[];
      state = AsyncData([
        for (final s in current)
          if (s.current) s,
      ]);
    }
    return revoked;
  }
}

final accountSessionsProvider =
    AsyncNotifierProvider.autoDispose<AccountSessionsController, List<AccountSession>>(
  AccountSessionsController.new,
);
