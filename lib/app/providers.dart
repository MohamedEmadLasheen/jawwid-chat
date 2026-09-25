import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/audio/voice_player.dart';
import '../core/audio/voice_recorder.dart';
import '../core/data/fake_backend.dart';
import '../core/data/repositories.dart';
import '../core/logging/redacting_logger.dart';
import '../core/media/attachment_opener.dart';
import '../core/media/media_picker.dart';
import '../core/network/api_client.dart' show TokenProvider;
import '../core/realtime/realtime_socket.dart';
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

/// Development-only fake backend, selected by role.
final fakeBackendProvider = Provider.family<FakeBackend, UserRole>((ref, role) {
  final backend = FakeBackend(role: role);
  ref.onDispose(backend.dispose);
  return backend;
});
