import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_repositories.dart';
import '../core/data/http/http_auth_repository.dart';
import '../core/data/http/http_conversation_repository.dart';
import '../core/data/http/http_group_repository.dart';
import '../core/data/http/http_message_repository.dart';
import '../core/data/http/http_story_repository.dart';
import '../core/errors/app_error.dart';
import '../core/network/actor_identity.dart';
import '../core/network/api_client.dart';
import '../core/network/api_config.dart';
import '../core/network/device_descriptor.dart';
import '../core/network/http_stack.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../shared/models/user_role.dart';
import 'providers.dart';

/// Which data source this build talks to.
enum DataSource {
  /// Real HTTP against a running Jawwid Chat backend. Selected automatically when
  /// `JAWWID_API_BASE_URL` is defined at build time.
  http,

  /// In-memory fixtures. Development and tests only — never a release build.
  fake,
}

/// Wires the composition root.
///
/// Selection is by build-time configuration, not by a runtime flag: a build either was given
/// a backend or it was not, and there is no way to flip a shipped app into fixture mode.
Future<List<Override>> bootstrap({
  UserRole developmentRole = UserRole.parent,
  String debugActorId = '',
}) async {
  return ApiConfig.isConfigured
      ? _httpOverrides(debugActorId: debugActorId)
      : _fakeOverrides(developmentRole);
}

/// The real stack.
///
/// ## One session authority
///
/// Exactly one [SecureTokenStore], one [StoredTokenProvider] and one [ApiClient] are built
/// here, and everything authenticated shares them. Realtime and push registration, when they
/// arrive, take the same `tokens` instance — they must not build their own.
///
/// The reason is `POST /auth/refresh`: it rotates, and `AuthService.handleRefreshReuse`
/// reads a replayed refresh token as theft and revokes **every live session on the account**.
/// A second refresher on this device is therefore not a wasted request; it is a sign-out on
/// every device the user owns.
///
/// ## How the knot is tied
///
/// The repository needs the client (for `/me` and `/auth/logout`), the client needs the
/// token provider, and the token provider needs the repository (to perform the exchange).
/// `late final` plus a closure resolves that at call time rather than construction time.
/// The alternative — giving the repository its own client — is the exact duplication the
/// paragraph above forbids.
List<Override> _httpOverrides({required String debugActorId}) {
  final config = ApiConfig.fromEnvironment();
  final tokenStore = SecureTokenStore();
  final session = SessionContext(fallbackActorId: debugActorId);

  late final ApiClient client;

  final auth = HttpAuthRepository(
    // Login and refresh go over the public transport, which has no refresh interceptor to
    // re-enter. See AuthTransport for the recursion this forecloses.
    transport: buildAuthTransport(config: config),
    protected: () => client,
    device: PlatformDeviceDescriptor(),
  );

  final tokens = StoredTokenProvider(
    store: tokenStore,
    auth: auth,
    onEnded: session.end,
  );

  client = buildApiClient(
    config: config,
    tokens: tokens,
    identity: const BearerTokenIdentity(),
  );

  return [
    tokenStoreProvider.overrideWithValue(tokenStore),
    authRepositoryProvider.overrideWithValue(auth),
    conversationRepositoryProvider.overrideWithValue(
      HttpConversationRepository(client: client, viewerRole: session.role),
    ),
    messageRepositoryProvider.overrideWithValue(
      HttpMessageRepository(client: client, viewerActorId: session.actorId),
    ),
    groupRepositoryProvider.overrideWithValue(
      HttpGroupRepository(client: client),
    ),
    // Stories are read-only here. The development composition root below registers no
    // implementation on purpose -- a fixture story is indistinguishable on screen from a real
    // publication, and this feature's contract is that what a reader sees was genuinely
    // published to them.
    storyRepositoryProvider.overrideWithValue(
      HttpStoryRepository(client: client),
    ),
    authControllerProvider.overrideWith(
      () => AuthController(
        repository: auth,
        tokens: tokenStore,
        clearLocalData: () async {},
        // The transport layer needs the principal too: ownership is decided by actor id and
        // approval policy by role. Before this existed, `actorId()` returned '' and `role()`
        // silently defaulted to parent, so a signed-in teacher saw their own messages as
        // somebody else's.
        onPrincipal: (principal) =>
            session.adopt(role: principal.role, actorId: principal.id),
        onSessionCleared: session.clear,
      ),
    ),
  ];
}

/// Fixtures, for development without a backend and for widget tests.
List<Override> _fakeOverrides(UserRole developmentRole) {
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

/// The authenticated principal, as far as the transport layer needs it.
///
/// The repositories need the viewer's role (approval policy is per role) and actor id
/// (ownership is decided by id, never by role). Both come from the session once auth exists.
/// Holding them here rather than reaching into a provider keeps the transport free of any
/// dependency on Riverpod, which is what makes it testable without a container.
class SessionContext {
  SessionContext({this.fallbackActorId = ''});

  /// Used only by the debug bring-up seam, where the actor id *is* the identity.
  final String fallbackActorId;

  UserRole? _role;
  String? _actorId;

  void adopt({required UserRole role, required String actorId}) {
    _role = role;
    _actorId = actorId;
  }

  /// Cleared when the backend ends the session, so no stale identity can outlive it.
  Future<void> end(AppError error) => clear();

  /// Same, for an ordinary sign-out, where there is no error to report.
  Future<void> clear() async {
    _role = null;
    _actorId = null;
  }

  /// Defaults to parent before a session exists. Safe because every call that would use it
  /// fails at the auth layer first — and because the parent policy is the *stricter* of the
  /// two for approvals, so an accidental read cannot under-restrict the composer.
  UserRole role() => _role ?? UserRole.parent;

  String actorId() => _actorId ?? fallbackActorId;
}

typedef AppAuthState = AuthState;
