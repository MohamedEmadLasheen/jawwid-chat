import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_notification_repository.dart';
import '../core/data/fake_repositories.dart';
import '../core/data/http/http_conversation_repository.dart';
import '../core/data/http/http_group_repository.dart';
import '../core/data/http/http_message_repository.dart';
import '../core/data/http/http_notification_repository.dart';
import '../core/data/http/unavailable_auth_repository.dart';
import '../core/errors/app_error.dart';
import '../core/network/actor_identity.dart';
import '../core/network/api_config.dart';
import '../core/network/http_stack.dart';
import '../core/push/firebase_push_tokens.dart';
import '../core/push/push_registrar.dart';
import '../core/realtime/realtime_connection.dart';
import '../core/realtime/socket_io_realtime_client.dart';
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
  if (!ApiConfig.isConfigured) return _fakeOverrides(developmentRole);

  // Initialised here, once, and allowed to fail: a checkout without
  // google-services.json / GoogleService-Info.plist must still run, because
  // that is the state every developer clone is in until someone adds the
  // credentials. Without push, notifications still reach the parent in-app and
  // over realtime -- a degraded channel, not a broken app.
  final pushAvailable = await FirebasePushTokens.initialise();
  return _httpOverrides(debugActorId: debugActorId, pushAvailable: pushAvailable);
}

/// The real stack.
///
/// **Authentication is not wired, because no auth contract exists.**
/// [UnavailableAuthRepository] fails every auth call with a specific, terminal error rather
/// than inventing `/auth/login`. That means this build reaches the login screen and stops
/// there — which is the honest state of the integration, not a bug to route around.
///
/// The conversation, message and group repositories are fully implemented against the
/// published contract and will work the moment an actor identity is available.
List<Override> _httpOverrides({
  required String debugActorId,
  required bool pushAvailable,
}) {
  final config = ApiConfig.fromEnvironment();
  final tokenStore = SecureTokenStore();
  const auth = UnavailableAuthRepository();

  // Set only for local bring-up against the engine's documented `x-actor-id` seam, and
  // compiled out of release builds. See ActorIdentity for why this is not authentication.
  final identity = debugActorId.isEmpty
      ? const BearerTokenIdentity() as ActorIdentity
      : DebugActorHeaderIdentity(actorId: debugActorId, enabled: true);

  final session = SessionContext(fallbackActorId: debugActorId);

  // ONE transport for the whole app. Notifications consume it today; the
  // messages feature adds a listener when it consumes `message.created`, not a
  // second socket -- which would mean a second authentication, a second
  // reconnect policy and two answers to "am I online".
  final realtime = SocketIoRealtimeClient(baseUrl: config.realtimeBaseUrl);

  final client = buildApiClient(
    config: config,
    tokens: StoredTokenProvider(
      store: tokenStore,
      auth: auth,
      onEnded: session.end,
    ),
    identity: identity,
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
    realtimeClientProvider.overrideWithValue(realtime),
    // Firebase only in a build that has a backend: a fixture build has no
    // google-services.json and must still run. `pushAvailable` is decided once,
    // at startup, rather than being discovered per call.
    if (pushAvailable) pushTokensProvider.overrideWithValue(FirebasePushTokens()),
    notificationRepositoryProvider.overrideWithValue(
      HttpNotificationRepository(client: client, realtime: realtime),
    ),
    authControllerProvider.overrideWith(
      () => AuthController(
        repository: auth,
        tokens: tokenStore,
        clearLocalData: () async {},
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
    notificationRepositoryProvider
        .overrideWithValue(FakeNotificationRepository()),
    // A fixture build has no server to connect to. InertRealtimeClient is the
    // provider default, so nothing is overridden here -- stated rather than
    // silent, because "why does realtime do nothing in dev" should have an
    // answer in the file that decides it.
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
  Future<void> end(AppError error) async {
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
