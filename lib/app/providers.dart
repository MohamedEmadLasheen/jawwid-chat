import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data/fake_backend.dart';
import '../core/data/repositories.dart';
import '../core/logging/redacting_logger.dart';
import '../core/realtime/realtime_client.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../shared/models/user_role.dart';

/// Composition root.
///
/// Everything the app depends on is reachable from here, and the repository providers are
/// deliberately left *unimplemented* rather than defaulting to the fake: a release build that
/// forgot to supply the real HTTP implementation must fail loudly at startup instead of
/// silently shipping fixture data (decision D4).
final loggerProvider = Provider<RedactingLogger>(
  (ref) => const RedactingLogger(enabled: kDebugMode),
);

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  throw UnimplementedError(
    'authRepositoryProvider must be overridden at startup — see lib/app/bootstrap.dart',
  );
});

final conversationRepositoryProvider = Provider<ConversationRepository>((ref) {
  throw UnimplementedError('conversationRepositoryProvider must be overridden');
});

final messageRepositoryProvider = Provider<MessageRepository>((ref) {
  throw UnimplementedError('messageRepositoryProvider must be overridden');
});

final groupRepositoryProvider = Provider<GroupRepository>((ref) {
  throw UnimplementedError('groupRepositoryProvider must be overridden');
});

final callRepositoryProvider = Provider<CallRepository>((ref) {
  throw UnimplementedError('callRepositoryProvider must be overridden');
});

/// The realtime transport.
///
/// Overridden at startup with a Socket.IO client when this build has a backend,
/// and with [OfflineRealtimeClient] otherwise. Defaulting to the offline one
/// here — rather than throwing as the repositories do — is deliberate: a chat
/// screen without realtime still works, it just does not update by itself, so
/// an unwired realtime client must not take the app down with it.
final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = OfflineRealtimeClient();
  ref.onDispose(client.dispose);
  return client;
});

/// Clears every cache that would outlive a session. Overridden once the sqlite layer is
/// wired; the default is a no-op so tests need not stand up a database.
final clearLocalDataProvider = Provider<Future<void> Function()>(
  (ref) => () async {},
);

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(() {
  throw UnimplementedError('authControllerProvider must be overridden');
});

/// Builds the real controller against whatever repositories are in scope.
NotifierProvider<AuthController, AuthState> buildAuthController(Ref ref) {
  return NotifierProvider<AuthController, AuthState>(
    () => AuthController(
      repository: ref.read(authRepositoryProvider),
      tokens: ref.read(tokenStoreProvider),
      clearLocalData: ref.read(clearLocalDataProvider),
      logger: ref.read(loggerProvider),
    ),
  );
}

/// The signed-in user's role, or null while unknown/signed out.
///
/// Every role-dependent branch in the UI reads this rather than caching a role of its own,
/// so a session ending takes every protected surface with it (§7).
final currentRoleProvider = Provider<UserRole?>(
  (ref) => ref.watch(authControllerProvider).user?.role,
);

/// Development-only fake backend, selected by role.
final fakeBackendProvider = Provider.family<FakeBackend, UserRole>((ref, role) {
  final backend = FakeBackend(role: role);
  ref.onDispose(backend.dispose);
  return backend;
});
