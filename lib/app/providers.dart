import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../core/audio/voice_player.dart';
import '../core/audio/voice_recorder.dart';
import '../core/data/fake_backend.dart';
import '../core/data/repositories.dart';
import '../core/logging/redacting_logger.dart';
import '../core/media/attachment_opener.dart';
import '../core/media/media_picker.dart';
import '../core/media/story_video_player.dart';
import '../core/network/api_client.dart' show TokenProvider;
import '../core/realtime/realtime_socket.dart';
import '../core/storage/secure_token_store.dart';
import '../core/time/time_zone_controller.dart' show appZoneRevisionProvider;
import '../features/auth/application/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/messages/application/chat_typing_channel.dart';
import '../features/messages/data/chat_theme_repository.dart';
import '../features/messages/data/mention_repository.dart';
import '../features/messages/data/message_marks_repository.dart';
import '../features/messages/data/message_search_repository.dart';
import '../features/messages/data/receipt_repository.dart';
import '../features/messages/data/typing_repository.dart';
import '../features/profile/data/profile_photo_repository.dart';
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

/// Overridden at startup with the ONE store the session uses; see bootstrap.dart.
///
/// Throws rather than defaulting to `SecureTokenStore()`, for the same reason
/// [authRepositoryProvider] does. A default here hands out a second store to whoever reads
/// this without an override, and "how many objects are allowed to hold the session" is
/// exactly the question the single-token-authority rule answers with *one*.
final tokenStoreProvider = Provider<TokenStore>((ref) {
  throw UnimplementedError(
    'tokenStoreProvider must be overridden at startup — see lib/app/bootstrap.dart',
  );
});

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

/// PD-11. Unlike the others this has a harmless default rather than a throw: a build
/// without a lesson server simply offers no lesson ticket.
/// PD-16: the parent's own sign-up. Overridden at startup with the HTTP implementation.
final parentSignupRepositoryProvider = Provider<ParentSignupRepository>((ref) {
  return const NoParentSignupRepository();
});

/// PD-21: finishing a password reset the academy issued. Overridden at startup with the HTTP
/// implementation.
final passwordResetRepositoryProvider = Provider<PasswordResetRepository>((ref) {
  return const NoPasswordResetRepository();
});

/// PD-25: a parent recovers their own account (forgot password / forgot e-mail). Overridden
/// at startup with the HTTP implementation; the default offers no self-service way in.
final accountRecoveryRepositoryProvider = Provider<AccountRecoveryRepository>((ref) {
  return const NoAccountRecoveryRepository();
});

final lessonRepositoryProvider = Provider<LessonRepository>((ref) {
  return const NoLessonRepository();
});

/// PD-12 S1. A harmless default like the lesson repository's: a build without a
/// supervision server offers no supervision ticket.
final supervisionRepositoryProvider = Provider<SupervisionRepository>((ref) {
  return const NoSupervisionRepository();
});

/// PD-37: Message info and the delivery cursor. A harmless default: a build
/// without the routes offers no Message info and reports no delivery.
final receiptRepositoryProvider = Provider<ReceiptRepository>((ref) {
  return const NoReceiptRepository();
});

/// PD-37: saying "typing" (over HTTP). A harmless default: a build without the
/// route says nothing.
final typingRepositoryProvider = Provider<TypingRepository>((ref) => const NoTypingRepository());

/// PD-37: who is typing, decoded from the session's realtime transport. Null by
/// default, so a screen built in isolation (a widget test, a fixture build)
/// has no live typing and needs no session; the signed-in app builds it on the
/// session's socket (bootstrap).
final chatTypingChannelProvider = Provider<ChatTypingChannel?>((ref) => null);

/// PD-37: the signed-in account's own actor id, where a screen must tell "me"
/// from others in a realtime frame (another device of mine typing). Null in a
/// build with no session -- then nobody is filtered out as "me".
final viewerActorIdProvider = Provider<String Function()?>((ref) => null);

/// Star and pin. A harmless default: a build without those routes offers neither.
final messageMarksRepositoryProvider = Provider<MessageMarksRepository>((ref) {
  return const NoMessageMarksRepository();
});

/// Chat themes (the viewer's own background per chat). A harmless default: a
/// build without the routes offers no Chat theme.
final chatThemeRepositoryProvider = Provider<ChatThemeRepository>((ref) {
  return const NoChatThemeRepository();
});

/// Message search, inside a chat and across chats. A harmless default: a build
/// without the routes offers no search.
final messageSearchRepositoryProvider = Provider<MessageSearchRepository>((ref) {
  return const NoMessageSearchRepository();
});

/// PD-36 @mentions: the @ list and "seen". A harmless default: a build without the routes
/// offers no @ list (a message still sends as plain text).
final mentionRepositoryProvider = Provider<MentionRepository>((ref) {
  return const NoMentionRepository();
});

/// Profile photos (own and, for a parent, the children's). A harmless default:
/// a build without a photo server offers no photo controls.
final profilePhotoRepositoryProvider = Provider<ProfilePhotoRepository>((ref) {
  return const NoProfilePhotoRepository();
});

/// PD-17: the parent's own payments. The default refuses (never "no payments"); both
/// composition roots override it.
final billingRepositoryProvider = Provider<BillingRepository>((ref) {
  return const NoBillingRepository();
});

/// PD-32: a parent's feedback about the teacher. A harmless default: a build without the
/// routes offers no entry.
final feedbackRepositoryProvider = Provider<FeedbackRepository>((ref) {
  return const NoFeedbackRepository();
});

/// PD-11 T4. A harmless default too: a build without a trial server offers no trial report.
final trialRepositoryProvider = Provider<TrialRepository>((ref) {
  return const NoTrialRepository();
});

final callRepositoryProvider = Provider<CallRepository>((ref) {
  throw UnimplementedError('callRepositoryProvider must be overridden');
});

/// The signed-in parent's own profile, and their children's.
///
/// Overridden by both composition roots: the HTTP one so a real parent edits real data, and
/// the development one so the screen can be worked on without a backend. Unlike stories,
/// a fixture profile is honest here -- it is the signed-in user's own, so there is no risk
/// of a fake standing in for something another person actually published.
final profileRepositoryProvider = Provider<ProfileRepository>((ref) {
  throw UnimplementedError('profileRepositoryProvider must be overridden');
});

/// Stories, read-only.
///
/// Registered by the HTTP composition root only. The development composition root
/// deliberately does NOT provide one: there is no fake story backend, because a fixture
/// story is indistinguishable on screen from a real publication and this feature's whole
/// contract is that what you see was actually published to you. A build with no
/// implementation shows no rail at all, which is honest -- see StoriesController.
final storyRepositoryProvider = Provider<StoryRepository>((ref) {
  throw UnimplementedError('storyRepositoryProvider must be overridden');
});

/// How a provider declares that its state belongs to one signed-in person.
///
/// ## Rebuilding is not enough — the value has to be thrown away
///
/// The obvious implementations do not work, and both were measured against riverpod 3.4.3
/// rather than assumed:
///
///   * `ref.watch(principalIdProvider)` rebuilds, but as a *reload*, and
///   * `ref.invalidateSelf()` rebuilds too, with or without `asReload`.
///
/// Every one of those paths ends in `AsyncValue.copyWithPrevious`, which is the whole point
/// of the design: a refresh should not blank the screen it is refreshing. So the outgoing
/// person's data stays readable through `AsyncValue.value` for as long as the incoming
/// person's request takes — which is precisely the leak, just shorter.
///
/// Nor can the state simply be set back to `AsyncLoading`: assigning it goes through the same
/// transition, so it too comes back carrying the old value. The only assignment that reliably
/// displaces the outgoing person's data is one that supplies REAL data — hence
/// [sessionEmptyValue], the value this controller holds when it belongs to nobody. Reset to
/// that, then rebuild.
///
/// That is why this is a mixin on the notifier rather than an extension on `Ref`: assigning
/// `state` needs the notifier, and nothing reachable from a bare `Ref` can do it.
mixin SessionScoped<ValueT> on AsyncNotifier<ValueT> {
  /// What this controller holds when it belongs to nobody — an empty list, for every
  /// controller that currently mixes this in.
  ///
  /// Displayed for at most the frame between the old session ending and the new load being
  /// issued, and it must be genuinely empty rather than a placeholder: it is the one thing a
  /// user could see that belongs to neither session.
  ValueT get sessionEmptyValue;

  /// Drop this controller's state the moment the authenticated principal changes.
  ///
  /// Call it FIRST in `build()`, from anything that caches one person's data: their stories,
  /// their chat list, their call history. One line is the whole declaration, and
  /// [principalIdProvider] is the single place the boundary itself is defined.
  ///
  /// `listen`, never `watch`: watching would add a dependency and rebuild this provider as a
  /// reload, which is the behaviour being avoided.
  ///
  /// ## What it does NOT do
  ///
  /// It does not clear private fields. Riverpod reuses the notifier INSTANCE across rebuilds
  /// — `build()` runs again on the same object — so a controller holding mutable state of its
  /// own must reset it at the top of `build()`, and must never assign a `late final` there,
  /// because the second build would throw.
  void bindToSession() {
    ref.listen(principalIdProvider, (previous, next) {
      if (previous == next) return;

      // Order matters. Resetting first means the rebuild's `copyWithPrevious` has only the
      // empty value to import, so nothing of the outgoing session survives into the incoming
      // one — not even for the single frame between the two.
      state = AsyncData(sessionEmptyValue);
      ref.invalidateSelf();
    });
    // PD-22: times are converted to the account's zone when they are parsed, so a change of
    // zone (a manual pick, or the phone landing in another country) reloads what this holds.
    // A reload, not a reset: it is still the same person's data.
    ref.listen(appZoneRevisionProvider, (previous, next) {
      if (previous != next) ref.invalidateSelf();
    });
  }
}

/// The teacher's professional profile. Overridden by the authenticated
/// composition root; the development root registers none, exactly as stories
/// does, so a missing wiring surfaces as "unavailable" instead of as an empty
/// profile a teacher might start typing into.
final teacherProfileRepositoryProvider = Provider<TeacherProfileRepository>((ref) {
  throw UnimplementedError('teacherProfileRepositoryProvider must be overridden');
});

/// The realtime transport, as a seam.
///
/// Overridden by the composition root, which is the only place that knows the
/// backend URL. Left throwing by default for the same reason the repositories
/// are: a build that forgot to wire it should fail loudly rather than open a
/// socket at some default address.
final realtimeSocketProvider = Provider<RealtimeSocket>((ref) {
  throw UnimplementedError('realtimeSocketProvider must be overridden');
});

/// Credentials for the realtime connection.
///
/// The SAME TokenProvider the HTTP stack uses — `StoredTokenProvider`, whose
/// refresh is already single-flighted. Deliberately the one object rather than
/// a second instance: two providers over one session would refresh
/// independently and could rotate the refresh token out from under each other.
final realtimeTokenProvider = Provider<TokenProvider>((ref) {
  throw UnimplementedError('realtimeTokenProvider must be overridden');
});

/// The device's microphone.
///
/// Unlike the repositories this has a real default, because it is a device
/// capability rather than backend data: there is no contract to be missing, and
/// a build that reached a user's phone certainly has a microphone seam. Tests
/// override it with a fake so no suite ever touches a platform channel.
final voiceRecorderProvider = Provider<VoiceRecorder>((ref) {
  final recorder = PluginVoiceRecorder();
  ref.onDispose(() => recorder.dispose());
  return recorder;
});

/// The photo library and file picker.
///
/// A device capability with a real default, like the recorder and the player
/// above: there is no contract to be missing here, only a platform channel that
/// no test may touch. Tests override it with a fake so no suite opens a system
/// picker and hangs waiting for a tap nobody will make.
final mediaPickerProvider = Provider<MediaPicker>((ref) => PluginMediaPicker());

/// Hands a document to whatever on the phone opens it. Overridden in tests so
/// no suite tries to launch an external application.
final attachmentOpenerProvider =
    Provider<AttachmentOpener>((ref) => const PluginAttachmentOpener());

/// Makes a story video player.
///
/// A FACTORY rather than an instance, because the lifecycle belongs to the story viewer: it
/// builds one in `initState` and disposes it in `dispose`, so playback cannot outlive the
/// screen and there is never a second decoder alive. A plain `Provider<StoryVideoPlayer>`
/// would tie the player to the container instead, which is how a closed viewer keeps playing.
///
/// Like the recorder and the audio player, a device capability with a real default; tests
/// override it so no suite opens a platform video session.
final storyVideoPlayerFactoryProvider = Provider<StoryVideoPlayer Function()>(
  (ref) => VideoPlayerStoryVideoPlayer.new,
);

/// Makes a player for a VOICE story -- one per story viewer, for the same reason as
/// [storyVideoPlayerFactoryProvider]: the viewer owns it and disposes it, so a closed story
/// can never keep talking. Deliberately not [voicePlayerProvider], which is the chat's shared
/// player and lives as long as the container.
final storyVoicePlayerFactoryProvider = Provider<VoicePlayer Function()>(
  (ref) => JustAudioVoicePlayer.new,
);

/// Audio playback. Like the recorder, a device capability with a real default;
/// tests override it so no suite opens a platform audio session.
final voicePlayerProvider = Provider<VoicePlayer>((ref) {
  final player = JustAudioVoicePlayer();
  ref.onDispose(() => player.dispose());
  return player;
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

/// PD-20 amendment: whether the signed-in user is the organization's super admin (who uses
/// the app with the Sales tabs). False when signed out.
final isSuperAdminProvider = Provider<bool>(
  (ref) => ref.watch(authControllerProvider).user?.isSuperAdmin ?? false,
);

/// THE SESSION BOUNDARY: the authenticated principal's id, or null when signed out.
///
/// ─────────────────────────────────────────────────────────────────────────────────────
///  THE INVARIANT, for anything added later:
///
///  User-scoped state MUST be bound to the authenticated PRINCIPAL ID — not to the role,
///  not to a screen's lifecycle, and not to someone remembering to pull-to-refresh.
///  When the principal changes, the previous principal's state must not remain observable
///  to the new one.
///
///  In practice that means: a provider that caches anything belonging to one signed-in
///  person binds itself here (`SessionScoped.bindToSession`, or the same two steps inline),
///  and never reaches a user-scoped dependency through a bare `ref.read` that leaves the
///  dependency undeclared. Both halves of that sentence have already been shipped as bugs.
/// ─────────────────────────────────────────────────────────────────────────────────────
///
/// ## What this is for
///
/// Every provider that caches data belonging to ONE signed-in person watches this, and
/// Riverpod then rebuilds it the moment the principal changes. Without it a provider's state
/// outlives the session that produced it, and the next person to sign in on the device sees
/// the previous one's data until something happens to refetch — which is exactly the leak
/// this exists to close: a teacher was shown a story addressed to `all_families`, on a feed
/// the server had correctly scoped to two stories, because the rail still held the parent's
/// three.
///
/// ## Why the ID and not the role
///
/// `currentRoleProvider` is NOT a session boundary. Parent A -> Parent B is a principal
/// change with no role change at all, so anything keyed on role alone survives it. Identity
/// is the only thing that distinguishes two people, so identity is what this carries.
///
/// ## Bind to it with [SessionScopedRef.bindToSession], never with `watch`
///
/// `ref.watch(principalIdProvider)` is the obvious move and it is WRONG here. A dependency
/// change is a *reload*: Riverpod keeps the old value on screen as `AsyncLoading(previous)`
/// while the new one is fetched, so the incoming principal would still be shown the outgoing
/// one's data for the length of a round trip. `invalidateSelf(asReload: false)` is the one
/// that discards it, which is why [SessionScopedRef.bindToSession] listens and invalidates
/// instead of watching. Both behaviours were verified against riverpod 3.4.3, not assumed.
///
/// ## A build with no auth wired yields null rather than throwing
///
/// [authControllerProvider] throws until the composition root overrides it, and this is
/// watched from deep inside feature controllers that previously had no opinion about
/// authentication at all. Propagating that would turn "this container has no auth" into a
/// broken chat list, which is a worse answer than "nobody is signed in" — and it is the same
/// judgement `pushRegistrarProvider` and `CallsController` already make for an unregistered
/// provider. Only [UnimplementedError] is swallowed; anything else is a real fault and is
/// rethrown.
final principalIdProvider = Provider<String?>((ref) {
  try {
    return ref.watch(authControllerProvider.select((state) => state.user?.id));
  } catch (error) {
    // Riverpod wraps whatever a provider's create function throws, so the composition root's
    // UnimplementedError arrives one layer down. Unwrap before deciding.
    final cause = error is ProviderException ? error.exception : error;
    if (cause is UnimplementedError) return null;
    rethrow;
  }
});

/// Development-only fake backend, selected by role.
final fakeBackendProvider = Provider.family<FakeBackend, UserRole>((ref, role) {
  final backend = FakeBackend(role: role);
  ref.onDispose(backend.dispose);
  return backend;
});
