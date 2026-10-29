import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../core/data/fake_backend.dart';
import '../core/data/fake_repositories.dart';
import '../core/data/http/http_account_recovery_repository.dart';
import '../core/data/http/http_auth_repository.dart';
import '../core/data/http/http_billing_repository.dart';
import '../core/data/http/http_call_repository.dart';
import '../core/data/http/http_conversation_repository.dart';
import '../core/data/http/http_feedback_repository.dart';
import '../core/data/http/http_group_repository.dart';
import '../core/data/http/http_lesson_repository.dart';
import '../core/data/http/http_message_repository.dart';
import '../core/data/http/http_parent_signup_repository.dart';
import '../core/data/http/http_password_reset_repository.dart';
import '../core/data/http/http_profile_repository.dart';
import '../core/data/http/http_sales_payments_repository.dart';
import '../core/data/http/http_story_repository.dart';
import '../core/data/http/http_supervision_repository.dart';
import '../core/data/http/http_task_repository.dart';
import '../core/data/http/http_teacher_profile_repository.dart';
import '../core/data/http/http_trial_repository.dart';
import '../core/errors/app_error.dart';
import '../core/network/api_client.dart';
import '../core/network/api_config.dart';
import '../core/network/device_descriptor.dart';
import '../core/network/http_stack.dart';
import '../core/push/push_registration.dart';
import '../core/realtime/realtime_socket.dart';
import '../core/storage/browser_token_store.dart';
import '../core/storage/secure_token_store.dart';
import '../core/storage/token_store_factory.dart';
import '../core/time/time_zone_api.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/application/session_termination.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/calls/data/account_call_history.dart';
import '../features/calls/data/fake_scheduled_call_repository.dart';
import '../features/calls/data/http_account_call_history.dart';
import '../features/calls/data/http_scheduled_call_repository.dart';
import '../features/calls/data/scheduled_call_repository.dart';
import '../features/materials/data/materials_repository.dart';
import '../features/messages/application/chat_typing_channel.dart';
import '../features/messages/data/chat_theme_repository.dart';
import '../features/messages/data/mention_repository.dart';
import '../features/messages/data/message_marks_repository.dart';
import '../features/messages/data/message_search_repository.dart';
import '../features/messages/data/receipt_repository.dart';
import '../features/messages/data/typing_repository.dart';
import '../features/notifications/data/notifications_repository.dart';
import '../features/profile/data/profile_photo_repository.dart';
import '../features/sales_payments/data/sales_payments_repository.dart';
import '../features/sessions/data/account_sessions_repository.dart';
import '../features/settings/application/locale_preference.dart';
import '../features/settings/data/parent_notice_repository.dart';
import '../features/tasks/application/task_signal_channel.dart';
import '../features/whiteboards/data/board_draft_files.dart';
import '../features/whiteboards/data/quran_text_repository.dart';
import '../features/whiteboards/data/whiteboards_repository.dart';
import '../shared/models/user_role.dart';
import 'app.dart';
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
///
/// The fixture build signs in as [developmentRole]; when not given it is read from
/// `--dart-define=JAWWID_DEV_ROLE=parent|teacher|sales` (PD-20 added `sales`), parent if unset.
Future<List<Override>> bootstrap({
  UserRole? developmentRole,
}) async {
  if (ApiConfig.isConfigured) return _httpOverrides();

  // A release build with no backend is a build that would run on fixtures: real
  // screens, invented families, invented messages, and no way for anyone holding
  // the phone to tell. `ApiConfig` already promises an unconfigured build "fails
  // loudly at startup instead" -- this is where that promise is kept, because the
  // selection happens here and not there.
  //
  // Debug and profile still get the fixtures: developing without a backend and
  // running widget tests are the reasons they exist.
  if (kReleaseMode) {
    throw StateError(
      'JAWWID_API_BASE_URL is not set in a release build. Build with '
      '--dart-define=JAWWID_API_BASE_URL=https://…  Refusing to start on '
      'fixture data: see docs/mobile/http-integration.md',
    );
  }

  developmentRole ??= UserRole.tryParse(const String.fromEnvironment('JAWWID_DEV_ROLE')) ?? UserRole.parent;
  return _fakeOverrides(developmentRole);
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
  // The Keychain / Keystore on a phone; sessionStorage / localStorage in the PD-28 browser.
  final tokenStore = platformTokenStore();
  final session = SessionContext();

  // The wire from the transport to the controller. `ApiClient` is what sees a revocation on
  // a background request, and a refusal seen there has to end the session as completely as
  // one seen at launch — which means reaching AuthController, not just clearing the actor id.
  final termination = SessionTermination();

  late final ApiClient client;

  // Login, refresh and the parent's sign-up go over the public transport, which has no
  // refresh interceptor to re-enter. See AuthTransport for the recursion this forecloses.
  final publicTransport = buildAuthTransport(config: config);

  final auth = HttpAuthRepository(
    transport: publicTransport,
    protected: () => client,
    device: PlatformDeviceDescriptor(),
    currentAccessToken: () async => (await tokenStore.read())?.accessToken,
  );

  final tokens = StoredTokenProvider(
    store: tokenStore,
    auth: auth,
    // PD-28: a browser's tabs can share one refresh token ("keep me signed in"); each refresh
    // then runs under one Web Lock, so no two tabs present the same token. A phone has one
    // process and needs none.
    exclusive: tokenStore is BrowserTokenStore ? tokenStore.exclusive : null,
    onEnded: (error) async {
      // The actor id goes first and unconditionally, so the transport stops naming a
      // principal even in the window before the controller has been built.
      await session.end(error);
      await termination.end(error);
    },
  );

  client = buildApiClient(config: config, tokens: tokens);

  return [
    // The language choice survives a restart (see PersistedLocaleController).
    localeOverrideProvider.overrideWith(PersistedLocaleController.new),
    tokenStoreProvider.overrideWithValue(tokenStore),
    authRepositoryProvider.overrideWithValue(auth),
    parentSignupRepositoryProvider.overrideWithValue(
      HttpParentSignupRepository(transport: publicTransport),
    ),
    passwordResetRepositoryProvider.overrideWithValue(
      HttpPasswordResetRepository(transport: publicTransport),
    ),
    accountRecoveryRepositoryProvider.overrideWithValue(
      HttpAccountRecoveryRepository(transport: publicTransport),
    ),
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
    lessonRepositoryProvider.overrideWithValue(
      HttpLessonRepository(client: client),
    ),
    taskRepositoryProvider.overrideWithValue(
      HttpTaskRepository(client: client),
    ),
    supervisionRepositoryProvider.overrideWithValue(
      HttpSupervisionRepository(client: client),
    ),
    messageMarksRepositoryProvider.overrideWithValue(
      HttpMessageMarksRepository(client: client, viewerActorId: session.actorId),
    ),
    // PD-37: Message info, and "me" for realtime frames (another device of mine).
    receiptRepositoryProvider.overrideWithValue(HttpReceiptRepository(client: client)),
    typingRepositoryProvider.overrideWithValue(HttpTypingRepository(client: client)),
    viewerActorIdProvider.overrideWithValue(session.actorId),
    profilePhotoRepositoryProvider.overrideWithValue(
      HttpProfilePhotoRepository(client: client),
    ),
    chatThemeRepositoryProvider.overrideWithValue(
      HttpChatThemeRepository(client: client),
    ),
    messageSearchRepositoryProvider.overrideWithValue(
      HttpMessageSearchRepository(client: client, viewerActorId: session.actorId),
    ),
    // PD-36: the @ list and "seen".
    mentionRepositoryProvider.overrideWithValue(HttpMentionRepository(client: client)),
    trialRepositoryProvider.overrideWithValue(
      HttpTrialRepository(client: client),
    ),
    billingRepositoryProvider.overrideWithValue(
      HttpBillingRepository(client: client),
    ),
    // PD-29: the child's Materials page and the report's practice and map.
    materialsRepositoryProvider.overrideWithValue(
      HttpMaterialsRepository(client: client),
    ),
    // PD-48: the parent's lesson-audio notice (acknowledged once).
    parentNoticeRepositoryProvider.overrideWithValue(
      HttpParentNoticeRepository(client: client),
    ),
    // PD-32: a parent's feedback about the teacher.
    feedbackRepositoryProvider.overrideWithValue(
      HttpFeedbackRepository(client: client),
    ),
    // PD-39: the teacher's boards (the whiteboard).
    whiteboardsRepositoryProvider.overrideWithValue(
      HttpWhiteboardsRepository(client: client),
    ),
    // PD-39 PR-3: the verified Quran text (the shared dataset), for verses on a board.
    quranTextRepositoryProvider.overrideWithValue(
      HttpQuranTextRepository(client: client),
    ),
    // PD-20: Sales' Payments (search, a family's instalments, record / void).
    salesPaymentsRepositoryProvider.overrideWithValue(
      HttpSalesPaymentsRepository(client: client),
    ),
    profileRepositoryProvider.overrideWithValue(
      HttpProfileRepository(client: client),
    ),
    // PD-23: Devices & sessions. The SAME client -- the one that refreshes through the one
    // token provider -- never the public transport and never a second refresher.
    accountSessionsRepositoryProvider.overrideWithValue(
      HttpAccountSessionsRepository(client: client),
    ),
    // PD-34: the account's own Notification Center, over the same one client.
    notificationsRepositoryProvider.overrideWithValue(
      HttpNotificationsRepository(client: client),
    ),
    // Stories are read-only here. The development composition root below registers no
    // implementation on purpose -- a fixture story is indistinguishable on screen from a real
    // publication, and this feature's contract is that what a reader sees was genuinely
    // published to them.
    storyRepositoryProvider.overrideWithValue(
      HttpStoryRepository(client: client),
    ),
    teacherProfileRepositoryProvider.overrideWithValue(
      HttpTeacherProfileRepository(client: client),
    ),

    // --- Calling, realtime and push (the communication branch) -------------
    //
    // THE SAME `client` and THE SAME `tokens`, deliberately. Every one of these
    // travels on the application's single authenticated stack, so there is one
    // interceptor chain, one TokenProvider and one refresh lifecycle for the
    // session. A second provider over one session would refresh independently
    // and could rotate the refresh token out from under the first -- which
    // `AuthService.handleRefreshReuse` reads as theft and answers by revoking
    // every live session on the account.
    callRepositoryProvider.overrideWithValue(
      HttpCallRepository(client: client),
    ),
    accountCallHistoryProvider.overrideWithValue(
      // Named after the OTHER participant, so the viewer's own id is read per call.
      HttpAccountCallHistory(client: client, viewerActorId: session.actorId),
    ),
    // PD-13: scheduled calls and call links, on the same client.
    scheduledCallRepositoryProvider.overrideWithValue(
      HttpScheduledCallRepository(client: client),
    ),
    pushRegistrationApiProvider.overrideWithValue(
      HttpPushRegistration(client: client),
    ),
    // PD-22: the account's time zone, on the same client.
    timeZoneApiProvider.overrideWithValue(
      HttpTimeZoneApi(client: client),
    ),
    // The socket authenticates with a token from this same provider. It does
    // NOT name an actor: `handshake.auth.token` is verified server-side by the
    // same verifier the HTTP guard uses, and the actor is derived from it. The
    // retired `x-actor-id` seam is not reintroduced here in any form.
    realtimeTokenProvider.overrideWithValue(tokens),
    // PD-37: typing, decoded from the session's one socket (listen only).
    chatTypingChannelProvider.overrideWith((ref) {
      final channel = ChatTypingChannel(ref.watch(realtimeSocketProvider));
      ref.onDispose(channel.dispose);
      return channel;
    }),
    // PD-47 PR-4: task.changed, decoded from the same socket (listen only).
    taskSignalChannelProvider.overrideWith((ref) {
      final channel = TaskSignalChannel(ref.watch(realtimeSocketProvider));
      ref.onDispose(channel.dispose);
      return channel;
    }),
    // ONE SOCKET PER SESSION. The transport is keyed on the signed-in account
    // exactly as `callRealtimeClientProvider` is, so a session that ends tears
    // its socket down and the next session gets a fresh one. It used to be a
    // single app-lifetime value: the first sign-out disposed it for good
    // (`dispose()` is terminal), and every later session's `connect()` returned
    // on `_disposed` without opening anything -- realtime silently dead until
    // the app was restarted.
    realtimeSocketProvider.overrideWith((ref) {
      ref.watch(authControllerProvider.select((state) => state.user?.id));
      final socket = SocketIoRealtimeSocket(baseUrl: config.baseUrl);
      ref.onDispose(socket.dispose);
      return socket;
    }),
    authControllerProvider.overrideWith(
      () => AuthController(
        repository: auth,
        tokens: tokenStore,
        // PD-39: board drafts are a device's copy of a teacher's unsaved pages; a
        // shared device keeps nobody's after sign-out.
        clearLocalData: () => platformBoardDraftStore().clearAll(),
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
  final calls = FakeCallRepository(backend);

  return [
    localeOverrideProvider.overrideWith(PersistedLocaleController.new),
    tokenStoreProvider.overrideWithValue(tokens),
    authRepositoryProvider.overrideWithValue(authRepository),
    conversationRepositoryProvider
        .overrideWithValue(FakeConversationRepository(backend)),
    messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
    groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
    callRepositoryProvider.overrideWithValue(calls),
    // In memory; a Join starts its call through the fixture call repository.
    scheduledCallRepositoryProvider.overrideWithValue(
      FakeScheduledCallRepository(
        startCall: (conversationId) async =>
            (await calls.start(conversationId: conversationId)).callId,
      ),
    ),
    // The fixture build has no server: a transport that opens nothing, so the
    // session's realtime client runs its ordinary lifecycle instead of throwing
    // on an unoverridden provider.
    realtimeSocketProvider.overrideWith((ref) {
      ref.watch(authControllerProvider.select((state) => state.user?.id));
      final socket = SilentRealtimeSocket();
      ref.onDispose(socket.dispose);
      return socket;
    }),
    realtimeTokenProvider.overrideWithValue(const _NoRealtimeTokens()),
    // A fixture profile is honest here, unlike a fixture story: it is the signed-in user's
    // OWN, so nothing fake stands in for something another person actually published.
    profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
    // PD-23: an in-memory list of this account's devices, so the screen can be worked on.
    accountSessionsRepositoryProvider.overrideWithValue(FakeAccountSessionsRepository()),
    // PD-34: in memory, the fixture account's OWN Notification Center.
    notificationsRepositoryProvider.overrideWithValue(FakeNotificationsRepository()),
    // The fixture parent has billed nothing: an honest empty answer about their OWN account.
    billingRepositoryProvider.overrideWithValue(const FakeBillingRepository()),
    // PD-32: in memory, the fixture parent's OWN feedback.
    feedbackRepositoryProvider.overrideWithValue(FakeFeedbackRepository()),
    // PD-39: boards in memory, for trying the Boards tab without an API.
    whiteboardsRepositoryProvider.overrideWithValue(FakeWhiteboardsRepository()),
    // A Sales seat can join a fixture trial group (PD-20).
    trialRepositoryProvider.overrideWithValue(FakeTrialRepository(backend)),
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

typedef AppAuthState = AuthState;

/// Realtime credentials for the fixture build: there is no server to present
/// a token to, so there is none. The client reports `unauthorized` and stays
/// quiet, which is exactly what a build with no backend should do.
class _NoRealtimeTokens implements TokenProvider {
  const _NoRealtimeTokens();

  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
