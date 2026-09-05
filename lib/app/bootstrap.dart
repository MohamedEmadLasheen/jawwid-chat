import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_repositories.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../shared/models/user_role.dart';
import 'providers.dart';

/// Wires the composition root.
///
/// Today this binds the **fake** backend, because no AI #1 / AI #2 contract has been
/// published yet (decision D4). Swapping to the real backend is a change to this function
/// alone — every provider below is an interface, so no screen, controller, or test changes.
///
/// See `docs/mobile/backend-dependencies.md` for what the real implementation needs.
Future<List<Override>> bootstrap({UserRole developmentRole = UserRole.parent}) async {
  final backend = FakeBackend(role: developmentRole);
  final tokens = InMemoryTokenStore();

  final authRepository = FakeAuthRepository(backend: backend, tokens: tokens);

  return [
    tokenStoreProvider.overrideWithValue(tokens),
    authRepositoryProvider.overrideWithValue(authRepository),
    conversationRepositoryProvider
        .overrideWithValue(FakeConversationRepository(backend)),
    messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
    groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
    callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
    authControllerProvider.overrideWith(
      () => AuthController(
        repository: authRepository,
        tokens: tokens,
        clearLocalData: () async {},
      ),
    ),
  ];
}

/// Re-exported so `main.dart` need not know the state type.
typedef AppAuthState = AuthState;
