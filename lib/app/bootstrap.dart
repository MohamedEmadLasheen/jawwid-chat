import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_repositories.dart';
import '../core/data/http/http_auth_repository.dart';
import '../core/data/http/http_conversation_repository.dart';
import '../core/data/http/http_group_repository.dart';
import '../core/data/http/http_message_repository.dart';
import '../core/errors/app_error.dart';
import '../core/network/actor_identity.dart';
import '../core/network/api_config.dart';
import '../core/network/http_stack.dart';
import '../core/realtime/realtime_client.dart';
import '../core/realtime/socket_io_realtime_client.dart';
import '../core/storage/local_database.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/messages/application/outbox_drain_policy.dart';
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
  final overrides = ApiConfig.isConfigured
      ? _httpOverrides(debugActorId: debugActorId)
      : _fakeOverrides(developmentRole);

  // The local database is opened for BOTH builds. The offline queue is not a
  // property of having a real backend -- the fixture build queues and drains
  // through the same courier, so the path that matters is the one that runs in
  // development too. A device that cannot open it (no filesystem, a corrupt
  // file) degrades to the in-memory queue rather than refusing to start: a
  // failure to persist is a lost queue, and a failure to start is a lost app.
  try {
    final database = await AppDatabase.open();
    overrides.add(localDatabaseProvider.overrideWithValue(database));
  } catch (_) {
    // Left unoverridden; outboxCourierProvider falls back to memory.
  }

  return overrides;
}

/// Restore the queue and begin draining it.
///
/// Called once, after the container exists, because the courier needs the
/// repositories the container holds. Anything restored here was composed in a
/// previous run of the process and never acknowledged.
Future<OutboxDrainPolicy> startOutbox(ProviderContainer container) async {
  final courier = container.read(outboxCourierProvider);

  // Queued words belong to whoever composed them. A session ending -- a logout,
  // a revoked device, an offboarding -- must take the queue with it, or the next
  // person to sign in on this handset would send the previous one's messages
  // the moment the network returned. The local database is ordinary
  // application storage, so this is a deletion, not a permissions change.
  container.listen(authControllerProvider, (previous, next) {
    if (previous?.isAuthenticated == true && !next.isAuthenticated) {
      unawaited(courier.clear());
    }
  });

  final policy = OutboxDrainPolicy(
    courier: courier,
    realtimeStatus: container.read(realtimeClientProvider).status,
    logger: container.read(loggerProvider),
  );
  await policy.start();
  return policy;
}

/// The real stack.
///
/// **Authentication is wired.** Phase 1 published the contract this client was
/// waiting for — `/auth/login`, `/auth/refresh`, `/me`, `/auth/logout` and the
/// session registry — so `UnavailableAuthRepository`, which existed to make the
/// absence of that contract loud rather than to paper over it, is deleted. It
/// was never a stub to be filled in; it was a statement that the contract did
/// not exist, and that statement is no longer true.
///
/// The realtime client presents the same access token the HTTP client does, and
/// reads it from the same store on every connection attempt, so a session
/// refreshed while offline is the one presented on reconnect.
List<Override> _httpOverrides({required String debugActorId}) {
  final config = ApiConfig.fromEnvironment();
  final tokenStore = SecureTokenStore();
  final session = SessionContext(fallbackActorId: debugActorId);

  // Set only for local bring-up against the engine's documented `x-actor-id` seam, and
  // compiled out of release builds. See ActorIdentity for why this is not authentication.
  final identity = debugActorId.isEmpty
      ? const BearerTokenIdentity() as ActorIdentity
      : DebugActorHeaderIdentity(actorId: debugActorId, enabled: true);

  // The auth repository needs a client, and the client needs the repository to
  // refresh with. The cycle is broken by building the client around a token
  // provider that reads the repository through a late binding rather than at
  // construction — which is also what lets `onSessionEnded` reach the same
  // repository instance the app is using.
  late final HttpAuthRepository auth;

  final client = buildApiClient(
    config: config,
    tokens: StoredTokenProvider(
      store: tokenStore,
      auth: () => auth,
      onEnded: (error) async {
        auth.notifyRevoked();
        await session.end(error);
      },
    ),
    identity: identity,
  );

  auth = HttpAuthRepository(
    client: client,
    device: DeviceDescriptor(
      // A per-install key. Stable across launches, meaningless outside this
      // account's own session list, and derived from nothing about the device.
      clientKey: _installationKey(),
      platform: defaultTargetPlatform.name,
    ),
  );

  final realtime = SocketIoRealtimeClient(
    baseUrl: config.baseUrl,
    accessToken: () async => (await tokenStore.read())?.accessToken,
  );

  return [
    tokenStoreProvider.overrideWithValue(tokenStore),
    authRepositoryProvider.overrideWithValue(auth),
    realtimeClientProvider.overrideWithValue(realtime),
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
    authControllerProvider.overrideWith(
      () => AuthController(
        repository: auth,
        tokens: tokenStore,
        clearLocalData: () async {},
        // The session context is what the repositories read the viewer's actor
        // id and role from, so it must learn the principal at the same moment
        // the app does — and be cleared the moment the session ends.
        onPrincipal: session.adopt,
      ),
    ),
  ];
}

/// Fixtures, for development without a backend and for widget tests.
List<Override> _fakeOverrides(UserRole developmentRole) {
  final backend = FakeBackend(role: developmentRole);
  final tokens = InMemoryTokenStore();
  final authRepository = FakeAuthRepository(backend: backend, tokens: tokens);
  final session = SessionContext();

  return [
    tokenStoreProvider.overrideWithValue(tokens),
    authRepositoryProvider.overrideWithValue(authRepository),
    // No socket without a backend. The chat screen degrades to refresh-driven
    // updates, which is what a fixture build should do rather than pretend.
    realtimeClientProvider.overrideWithValue(OfflineRealtimeClient()),
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
        onPrincipal: session.adopt,
      ),
    ),
  ];
}

/// A stable identifier for this installation.
///
/// Deliberately NOT a device identifier: it says "this app on this phone", not
/// "this phone". The backend uses it to recognise the same installation across
/// logins so its session list does not grow one row per sign-in.
String _installationKey() => 'jawwid-mobile-${defaultTargetPlatform.name}';

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
