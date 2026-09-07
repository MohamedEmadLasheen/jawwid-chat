import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data/fake_backend.dart';
import '../core/data/repositories.dart';
import '../core/logging/redacting_logger.dart';
import '../core/realtime/realtime_client.dart';
import '../core/storage/local_database.dart';
import '../core/storage/secure_token_store.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/calls/application/call_controller.dart';
import '../features/calls/data/call_media.dart';
import '../features/calls/domain/call_session.dart';
import '../features/messages/application/outbox_courier.dart';
import '../features/notifications/push_messaging.dart';
import '../features/messages/data/outbox_store.dart';
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

/// The app's outgoing message queue.
///
/// APPLICATION-scoped, and that is the whole point. It used to be a field on
/// the chat screen's notifier, which Riverpod disposes when the user leaves the
/// conversation — so a message composed offline survived exactly as long as the
/// screen it was typed on. It is overridden at startup with a courier backed by
/// the local database; the default here is backed by memory, so a test or a
/// fixture build gets working ordering and retry rules without a filesystem.
final outboxCourierProvider = Provider<OutboxCourier>((ref) {
  final database = ref.read(localDatabaseProvider);
  final courier = OutboxCourier(
    messages: ref.read(messageRepositoryProvider),
    // No database means no persistence, not no queue: an app that cannot open
    // its local storage must still be able to send.
    store: database == null ? InMemoryOutboxStore() : SqliteOutboxStore(database),
  );
  ref.onDispose(() => unawaited(courier.dispose()));
  return courier;
});

/// Device push tokens against the backend.
///
/// Throws when unimplemented, like every other repository: a release build that
/// forgot to supply it must fail loudly rather than silently not registering.
/// It is never reached on a build without push, because a disabled transport
/// yields no tokens and the registrar only touches the repository when one
/// arrives.
final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  throw UnimplementedError('notificationRepositoryProvider must be overridden');
});

/// The device's push transport.
///
/// Defaults to DISABLED rather than throwing, exactly as the realtime client
/// does: an app without push is degraded, not broken, and a widget test must
/// not have to stand up Firebase to render a chat screen. Overridden at startup
/// when this build has a Firebase configuration.
final pushMessagingProvider = Provider<PushMessaging>(
  (ref) => const DisabledPushMessaging(),
);

/// The app's local database, or null when this build has none.
///
/// Null rather than throwing, for the same reason `realtimeClientProvider`
/// defaults to an offline client: a widget test does not have a filesystem and
/// must not have to stand one up to render a chat screen.
final localDatabaseProvider = Provider<AppDatabase?>((ref) => null);

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

// ---------------------------------------------------------------------------------------
// Phase 5 -- calls, stories and broadcast.
// ---------------------------------------------------------------------------------------

/// Stories, READ-ONLY on this client.
///
/// [UserRole] is `parent | teacher` and nothing else -- this app cannot
/// authenticate as an admin or a manager, by construction. Publishing a story
/// and composing a broadcast are therefore not features that belong here: they
/// live in the operations console (`apps/admin-web`), which is the surface
/// those roles sign in to.
///
/// So there is no `broadcastRepositoryProvider` on this client at all. A
/// broadcast reaches a parent as an ORDINARY MESSAGE in their conversation,
/// through the messaging engine that has carried every other message since
/// Phase 2 -- which is why nothing here has to know broadcasts exist.
final storyRepositoryProvider = Provider<StoryRepository>((ref) {
  throw UnimplementedError('storyRepositoryProvider must be overridden');
});

/// The call screen's state.
///
/// A single controller for the whole app rather than one per conversation: a
/// device is in at most one call, and modelling it per conversation is how two
/// ring screens end up on top of each other.
final callControllerProvider =
    NotifierProvider<CallController, CallSession>(() {
  throw UnimplementedError('callControllerProvider must be overridden');
});

/// The media transport.
///
/// Left unimplemented rather than defaulting to [SilentCallMedia], for the same
/// reason the repositories are: a release build that forgot to supply the real
/// LiveKit implementation must fail loudly at startup instead of silently
/// shipping calls that carry no audio (decision D4).
final callMediaProvider = Provider<CallMedia>((ref) {
  throw UnimplementedError('callMediaProvider must be overridden');
});

NotifierProvider<CallController, CallSession> buildCallController(Ref ref) {
  return NotifierProvider<CallController, CallSession>(
    () => CallController(
      calls: ref.read(callRepositoryProvider),
      realtime: ref.read(realtimeClientProvider),
      media: ref.read(callMediaProvider),
    ),
  );
}

/// The reader's story feed. Server-filtered; there is no unfiltered variant.
final storyFeedProvider = FutureProvider<List<Story>>(
  (ref) => ref.watch(storyRepositoryProvider).feed(),
);

/// Call history for one conversation, read fresh from the server.
///
/// A family-scoped provider rather than one global list: the server authorizes
/// call history per conversation, because that is the scope it can decide in a
/// single check, and mirroring that here keeps the client from assuming a
/// cross-conversation view it is not entitled to.
final conversationCallsProvider =
    FutureProvider.family<List<CallView>, String>(
  (ref, conversationId) =>
      ref.watch(callRepositoryProvider).conversationHistory(conversationId),
);

/// The reader's story feed. Server-filtered; there is no unfiltered variant.
final storyFeedProviderRefresh = Provider<void Function()>(
  (ref) => () => ref.invalidate(storyFeedProvider),
);
