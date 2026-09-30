import 'dart:async';

/// What a media room tells the client about itself.
///
/// Deliberately four facts and no more. Everything the LiveKit SDK exposes
/// beyond these — video, screen share, data, simulcast, quality metrics — is
/// absent because this product has no use for it and a port that offered it
/// would invite one.
sealed class MediaRoomEvent {
  const MediaRoomEvent();
}

/// The room accepted us. Nothing is published yet.
class MediaRoomConnected extends MediaRoomEvent {
  const MediaRoomConnected();
}

/// The room ended, for any reason — our own disconnect, the server's, or the
/// network's. [byServer] separates a close we did not ask for.
class MediaRoomDisconnected extends MediaRoomEvent {
  const MediaRoomDisconnected({this.byServer = false});

  final bool byServer;
}

/// Our microphone track is published and live on the server.
///
/// This is the only honest evidence that audio is leaving the device, and it is
/// why it is a separate event from [MediaRoomConnected]. An application-level
/// accept, a room join and a published microphone are three different facts.
class LocalMicrophonePublished extends MediaRoomEvent {
  const LocalMicrophonePublished();
}

/// A remote participant's audio arrived, or went away.
class RemoteAudioChanged extends MediaRoomEvent {
  const RemoteAudioChanged({
    required this.participantId,
    required this.trackId,
    required this.present,
  });

  final String participantId;
  final String trackId;

  /// True when the track was subscribed, false when it went away.
  final bool present;
}

/// THE MEDIA SEAM.
///
/// Everything above this interface is Jawwid's and is tested without a
/// microphone, a socket or a device; everything below it is `livekit_client`.
/// Same arrangement as `lib/core/realtime/realtime_socket.dart` and
/// `lib/core/audio` — the only reason the permission, failure and cleanup paths
/// can be covered at all.
///
/// NARROW ON PURPOSE. There is no camera method, no screen-share method, and no
/// way to name a room. W1 restricted the server-issued grant to
/// `canPublishSources: ['microphone']`, so LiveKit would refuse anything else;
/// this port refuses to ask. A capability absent from the interface cannot be
/// reached by mistake later.
abstract interface class MediaRoom {
  Stream<MediaRoomEvent> get events;

  /// Join, with the server's URL and the server's token.
  ///
  /// THE ROOM IS INSIDE THE TOKEN. There is no room parameter here, and there
  /// must never be one: the room a participant lands in is signed into the
  /// grant server-side, so a client cannot choose, guess or derive it.
  Future<void> connect({required String url, required String token});

  /// Publish the microphone, or mute an existing publication.
  ///
  /// `false` MUTES — it does not unpublish and does not leave the room. A muted
  /// participant is still a participant.
  Future<void> setMicrophoneEnabled(bool enabled);

  Future<void> disconnect();

  /// Release the room and every listener. Idempotent.
  Future<void> dispose();
}

/// Why the media layer could not do what was asked.
///
/// The interface branches on these rather than on an exception type, because
/// each needs a different thing said: a denied microphone is a settings trip, an
/// unavailable token is a retry, and a refused connection is neither.
enum CallMediaFailure {
  /// The media token could not be obtained. The server refused, or the call is
  /// gone — [CallMediaClient] does not reinterpret which.
  tokenUnavailable,

  /// Microphone permission was refused.
  microphonePermissionDenied,

  /// No microphone, or the platform cannot capture.
  microphoneUnavailable,

  /// The room refused or could not be reached.
  connectionFailed,

  /// The publish itself failed after joining.
  publishFailed,
}

class CallMediaException implements Exception {
  const CallMediaException(this.reason, {this.detail});

  final CallMediaFailure reason;

  /// Diagnostic only. Never a token, a URL or a room name.
  final String? detail;

  @override
  String toString() => detail == null
      ? 'CallMediaException($reason)'
      : 'CallMediaException($reason): $detail';
}
