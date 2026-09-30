import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_repositories.dart';
import '../core/data/http/http_auth_repository.dart';
import '../core/data/http/http_call_repository.dart';
import '../core/data/http/http_conversation_repository.dart';
import '../core/data/http/http_group_repository.dart';
import '../core/data/http/http_message_repository.dart';
import '../core/data/http/http_story_repository.dart';
import '../core/errors/app_error.dart';
import '../core/network/api_client.dart';
import '../core/network/api_config.dart';
import '../core/network/device_descriptor.dart';
import '../core/network/http_stack.dart';
import '../core/push/push_registration.dart';
import '../core/realtime/realtime_socket.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/application/session_termination.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/calls/data/account_call_history.dart';
import '../features/calls/data/http_account_call_history.dart';
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
}) async {
  return ApiConfig.isConfigured ? _httpOverrides() : _fakeOverrides(developmentRole);
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
List<Override> _httpOverrides() {
  final config = ApiConfig.fromEnvironment();
  final tokenStore = SecureTokenStore();
  final session = SessionContext();

  // The wire from the transport to the controller. `ApiClient` is what sees a revocation on
  // a background request, and a refusal seen there has to end the session as completely as
  // one seen at launch — which means reaching AuthController, not just clearing the actor id.
  final termination = SessionTermination();

  late final ApiClient client;

  final auth = HttpAuthRepository(
    // Login and refresh go over the public transport, which has no refresh interceptor to
    // re-enter. See AuthTransport for the recursion this forecloses.
    transport: buildAuthTransport(config: config),
    protected: () => client,
    device: PlatformDeviceDescriptor(),
    currentAccessToken: () async => (await tokenStore.read())?.accessToken,
  );

  final tokens = StoredTokenProvider(
    store: tokenStore,
    auth: auth,
    onEnded: (error) async {
      // The actor id goes first and unconditionally, so the transport stops naming a
      // principal even in the window before the controller has been built.
      await session.end(error);
      await termination.end(error);
    },
  );

  client = buildApiClient(config: config, tokens: tokens);

  return [
    tokenStoreProvider.overrideWithValue(tokenStore),
    authRepositoryProvider.overrideWithValue(auth),
    conversationRepositoryProvider.overrideWithValue(
      HttpConversationRepository(
        client: client,
        viewerRole: session.role,
        viewerActorId: session.actorId,
      ),
    ),
    messageRepositoryProvider.overrideWithValue(
      HttpMessageRepository(client: client, viewerActorId: session.actorId),
    ),
    groupRepositoryProvider.overrideWithValue(
      HttpGroupRepository(client: client),
    ),
    // Calling, against the routes apps/api publishes. Until this was
    // registered, reading the provider threw and the Calls tab said calling
    // was not switched on -- which was true, and is no longer.
    callRepositoryProvider.overrideWithValue(
      HttpCallRepository(client: client),
    ),
    // W8-W2. THE SAME `client`, deliberately: the account-history repository is
    // handed the application's single ApiClient rather than building one, so
    // there is exactly one interceptor chain, one TokenProvider and one refresh
    // lifecycle for this session.
    accountCallHistoryProvider.overrideWithValue(
      HttpAccountCallHistory(client: client),
    ),
    // W8-W1. THE SAME `client` again: device registration travels on the one
    // authenticated stack, so there is a single interceptor chain, a single
    // TokenProvider and a single refresh lifecycle.
    pushRegistrationApiProvider.overrideWithValue(
      HttpPushRegistration(client: client),
    ),
    // The socket shares the ONE TokenProvider built above rather than holding
    // its own. `StoredTokenProvider` single-flights its refresh, and two
    // instances over one session would refresh independently and could rotate
    // the refresh token out from under each other -- which the server reads as
    // theft and answers by revoking every session on the account.
    realtimeTokenProvider.overrideWithValue(tokens),
    realtimeSocketProvider.overrideWithValue(
      SocketIoRealtimeSocket(baseUrl: config.baseUrl),
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
        termination: termination,
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
    // The fixture build gets a realtime seam that opens nothing: a demo build
    // must not be able to reach a real socket.
    realtimeTokenProvider.overrideWithValue(const _NoRealtimeTokens()),
    realtimeSocketProvider.overrideWithValue(SilentRealtimeSocket()),
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

  /// Empty before a session exists. Nothing authenticated can run in that window: every
  /// request would be refused by the guard before an actor id mattered.
  String actorId() => _actorId ?? '';
}

/// A token provider for the fixture build: there is no session and no socket.
///
/// Every method answers "there is no session" rather than throwing, because the
/// realtime client is allowed to ASK at any time and a demo build must simply
/// never connect — not crash on the question.
class _NoRealtimeTokens implements TokenProvider {
  const _NoRealtimeTokens();

  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

typedef AppAuthState = AuthState;
