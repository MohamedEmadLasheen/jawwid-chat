import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/call_media/audio_route.dart';
import '../../../core/call_media/call_media_client.dart';
import '../../../core/call_media/livekit_media_room.dart';
import '../../../core/call_media/media_room.dart';
import '../../../core/call_media/microphone_permission.dart';

/// Construction of the W4 media layer, which W4 deliberately left unwired.
///
/// W4 built [CallMediaClient], [LiveKitMediaRoom], [RecordMicrophonePermission]
/// and the ports around them, and constructed none of them: it was a foundation,
/// and nothing had a call to join. W7 is the first thing that does, so the wiring
/// lives here.
///
/// IN A W7 FILE, NOT THE COMPOSITION ROOT. `lib/app/providers.dart` and
/// `bootstrap.dart` belong to W3 and are CLOSED, so nothing here edits them.
/// These providers READ the root's [callRepositoryProvider] and
/// [loggerProvider] as dependencies, which is what a later step is supposed to
/// do with a closed contract.
///
/// EVERY SEAM IS OVERRIDABLE. Each platform-touching thing is behind its own
/// provider so a test can replace it without a device, a microphone or a
/// network. That is the whole reason W4 defined ports instead of calling the SDK
/// directly.

/// A FACTORY, not a room.
///
/// A [MediaRoom] wraps one LiveKit `Room`, and a disposed room cannot be
/// reused — so a second call needs a second room. Handing out a factory makes
/// that explicit; a single shared instance would work exactly once and then fail
/// in a way that looked like a network problem.
final mediaRoomFactoryProvider = Provider<MediaRoom Function()>(
  (ref) => LiveKitMediaRoom.new,
);

/// The microphone-permission port (W4), over the `record` plugin already here.
final microphonePermissionProvider = Provider<MicrophonePermission>(
  (ref) => RecordMicrophonePermission(),
);

/// Where call audio comes out (W7's own seam — see [AudioRoute]).
final audioRouteProvider = Provider<AudioRoute>((ref) => LiveKitAudioRoute());

/// Builds one media client for one call.
typedef CallMediaClientFactory = CallMediaClient Function();

/// A fresh [CallMediaClient] per call, with a fresh room.
///
/// The controller owns the instance it is handed and disposes it when the call
/// reaches a terminal state, so a client never outlives its call and a room is
/// never shared between two of them.
final callMediaClientFactoryProvider = Provider<CallMediaClientFactory>((ref) {
  final calls = ref.watch(callRepositoryProvider);
  final newRoom = ref.watch(mediaRoomFactoryProvider);
  final microphone = ref.watch(microphonePermissionProvider);
  final logger = ref.watch(loggerProvider);

  return () => CallMediaClient(
        calls: calls,
        room: newRoom(),
        microphone: microphone,
        logger: logger,
      );
});
