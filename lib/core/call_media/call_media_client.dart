import 'dart:async';

import '../data/repositories.dart';
import '../logging/redacting_logger.dart';
import 'media_room.dart';
import 'microphone_permission.dart';

/// How far the media layer has actually got.
///
/// FOUR DIFFERENT FACTS, kept apart deliberately. `screens/call.md` and the
/// server contract both depend on the distinction, and W5/W6 will reconcile the
/// call lifecycle against real media presence — which is impossible if they are
/// collapsed into one boolean:
///
///   * an application-level accept (`POST /calls/:id/accept`) — not here at all;
///   * a room joined ([roomConnected]);
///   * our microphone published ([live]);
///   * remote audio received ([CallMediaSnapshot.remoteAudioParticipants]).
///
/// A caller that wants "can they hear me" must read [live], and "can I hear
/// them" is the remote set. Neither follows from [roomConnected].
enum CallMediaPhase {
  /// Nothing attempted.
  idle,

  /// Obtaining the token, or joining.
  connecting,

  /// In the room. NOTHING IS PUBLISHED YET — nobody can hear this device.
  roomConnected,

  /// The microphone publish is in flight.
  microphonePublishing,

  /// Microphone published and live on the server.
  live,

  /// Leaving.
  disconnecting,

  /// Left, or never arrived.
  disconnected,

  /// Gave up. [CallMediaSnapshot.failure] says why.
  failed,
}

/// One remote participant's audio, as this device sees it.
class RemoteAudio {
  const RemoteAudio({required this.participantId, required this.trackId});

  final String participantId;
  final String trackId;

  @override
  bool operator ==(Object other) =>
      other is RemoteAudio &&
      other.participantId == participantId &&
      other.trackId == trackId;

  @override
  int get hashCode => Object.hash(participantId, trackId);

  @override
  String toString() => 'RemoteAudio($participantId/$trackId)';
}

/// Everything the layer above needs, in one value.
class CallMediaSnapshot {
  const CallMediaSnapshot({
    this.phase = CallMediaPhase.idle,
    this.microphoneMuted = false,
    this.remoteAudioParticipants = const <RemoteAudio>{},
    this.failure,
  });

  final CallMediaPhase phase;

  /// MUTE IS NOT A PHASE. A muted participant is still connected and still
  /// published — the track is muted, not removed — so this is orthogonal to
  /// [phase] rather than a value inside it. Folding it in would make "muted"
  /// look like a kind of disconnection, which is exactly the confusion Phase 9
  /// of this work exists to avoid.
  final bool microphoneMuted;

  final Set<RemoteAudio> remoteAudioParticipants;

  final CallMediaFailure? failure;

  bool get hasRemoteAudio => remoteAudioParticipants.isNotEmpty;

  CallMediaSnapshot _with({
    CallMediaPhase? phase,
    bool? microphoneMuted,
    Set<RemoteAudio>? remoteAudioParticipants,
    CallMediaFailure? failure,
    bool clearFailure = false,
  }) =>
      CallMediaSnapshot(
        phase: phase ?? this.phase,
        microphoneMuted: microphoneMuted ?? this.microphoneMuted,
        remoteAudioParticipants:
            remoteAudioParticipants ?? this.remoteAudioParticipants,
        failure: clearFailure ? null : (failure ?? this.failure),
      );

  @override
  String toString() => 'CallMediaSnapshot($phase, muted: $microphoneMuted, '
      'remote: ${remoteAudioParticipants.length}'
      '${failure == null ? '' : ', failure: $failure'})';
}

/// The voice-call media client.
///
/// SCOPE. Joining a room, publishing this device's microphone, hearing other
/// people's, mute, and leaving cleanly. It does not place calls, answer them,
/// know what a call is, or draw anything: `CallRepository` owns the HTTP
/// operations, `CallRealtimeClient` owns the server's call events, and the
/// interface is a later workstream. This is media and nothing else.
///
/// AUDIO ONLY, AND THAT IS ENFORCED TWICE. The server grant permits exactly
/// `canPublishSources: ['microphone']` (W1), so LiveKit would refuse a camera or
/// screen track. The [MediaRoom] port has no method that could ask for one, so
/// nothing here can try. Two independent reasons, neither relying on the other.
///
/// THE CLIENT AUTHORIZES NOTHING. It asks [CallRepository] for a media token and
/// uses the URL and token it is handed. It never builds a room name, never
/// derives one from a conversation or call id, and never sends a grant — the
/// room is signed into the token by the server, which is why [MediaRoom.connect]
/// takes no room at all.
class CallMediaClient {
  CallMediaClient({
    required CallRepository calls,
    required MediaRoom room,
    required MicrophonePermission microphone,
    RedactingLogger logger = const RedactingLogger(),
  })  : _calls = calls,
        _room = room,
        _microphone = microphone,
        _log = logger;

  final CallRepository _calls;
  final MediaRoom _room;
  final MicrophonePermission _microphone;
  final RedactingLogger _log;

  final _snapshots = StreamController<CallMediaSnapshot>.broadcast();

  StreamSubscription<MediaRoomEvent>? _roomSub;
  CallMediaSnapshot _snapshot = const CallMediaSnapshot();
  bool _connecting = false;
  bool _disposed = false;

  /// The room is released once, not once per caller.
  ///
  /// `disconnect()` releases it, and `dispose()` after that would otherwise
  /// release it again — the client was idempotent while the ROOM was told to
  /// dispose twice, which is the SDK being torn down on top of itself.
  bool _roomReleased = false;

  Stream<CallMediaSnapshot> get snapshots => _snapshots.stream;

  CallMediaSnapshot get snapshot => _snapshot;

  /// Join the call's media room and publish this device's microphone.
  ///
  /// The order is load-bearing:
  ///
  ///   1. MICROPHONE FIRST. Asked before anything is joined, so a refusal
  ///      happens before the user is sitting in a call nobody can hear —
  ///      `screens/call.md` §7 wants the explanation "before dialling rather
  ///      than after".
  ///   2. The token, from the server.
  ///   3. The room, with the server's URL and token.
  ///   4. The publish, only once connected.
  ///
  /// Every failure leaves nothing running: the room is released on the way out,
  /// so a denied microphone cannot leave a half-joined session behind.
  ///
  /// Safe to call twice. A second call while connecting or connected does
  /// nothing rather than opening a second room.
  Future<void> connect({required String callId}) async {
    if (_disposed || _connecting) return;
    if (_snapshot.phase != CallMediaPhase.idle &&
        _snapshot.phase != CallMediaPhase.disconnected &&
        _snapshot.phase != CallMediaPhase.failed) {
      return;
    }

    _connecting = true;
    try {
      _emit(_snapshot._with(
        phase: CallMediaPhase.connecting,
        clearFailure: true,
        remoteAudioParticipants: const <RemoteAudio>{},
        microphoneMuted: false,
      ));

      final access = await _microphone.ensure();
      if (_disposed) return;
      if (access != MicrophoneAccess.granted) {
        // Nothing has been joined yet, so there is nothing to tear down — which
        // is the point of asking first.
        _fail(
          access == MicrophoneAccess.denied
              ? CallMediaFailure.microphonePermissionDenied
              : CallMediaFailure.microphoneUnavailable,
        );
        return;
      }

      final CallMediaGrant grant;
      try {
        grant = await _calls.mediaToken(callId: callId);
      } catch (error) {
        // The server refused, or the call is gone. Which of those it is belongs
        // to the caller reading the AppError, not to this layer guessing.
        _log.warn('call media: no token, not joining');
        _fail(CallMediaFailure.tokenUnavailable);
        return;
      }
      if (_disposed) return;

      // Listen before connecting: a room that reports itself connected before
      // the subscription exists would lose the event.
      await _roomSub?.cancel();
      _roomReleased = false;
      _roomSub = _room.events.listen(_onRoomEvent);

      try {
        // The server's URL and the server's token. No room name is passed
        // because there is nowhere to pass one — see MediaRoom.connect.
        await _room.connect(url: grant.serverUrl, token: grant.token);
      } catch (error) {
        _log.warn('call media: the room refused the connection');
        await _releaseRoom();
        _fail(CallMediaFailure.connectionFailed);
        return;
      }
      if (_disposed) {
        await _releaseRoom();
        return;
      }

      _emit(_snapshot._with(phase: CallMediaPhase.microphonePublishing));

      try {
        await _room.setMicrophoneEnabled(true);
      } catch (error) {
        // In the room but unable to publish. Leaving is the honest outcome: a
        // participant nobody can hear is worse than no participant.
        _log.warn('call media: the microphone could not be published');
        await _releaseRoom();
        _fail(CallMediaFailure.publishFailed);
        return;
      }

      // `live` is set by LocalMicrophonePublished, not here. The publish call
      // returning is not the server confirming the track — only the room's own
      // event is that, and conflating them is how a UI comes to say "connected"
      // while nothing is being heard.
    } finally {
      _connecting = false;
    }
  }

  /// Stop sending audio, without leaving.
  ///
  /// Idempotent: muting twice asks the room once. The participant stays
  /// connected and the publication stays — LiveKit mutes the track rather than
  /// removing it.
  Future<void> mute() => _setMuted(true);

  /// Resume sending audio. Idempotent, and does not reconnect.
  Future<void> unmute() => _setMuted(false);

  Future<void> _setMuted(bool muted) async {
    if (_disposed) return;
    // Only a live publication can be muted. Before that there is no track, and
    // pretending otherwise would report a mute state the device is not in.
    if (_snapshot.phase != CallMediaPhase.live) return;
    if (_snapshot.microphoneMuted == muted) return;

    try {
      await _room.setMicrophoneEnabled(!muted);
    } catch (error) {
      // The mute did not take. Reporting it as taken would be the worst of the
      // available lies: the user believes they are muted and is not.
      _log.warn('call media: the microphone state could not be changed');
      return;
    }
    if (_disposed) return;
    _emit(_snapshot._with(microphoneMuted: muted));
  }

  /// Leave the room and release the microphone.
  ///
  /// Idempotent, and safe after [dispose]. Clears the media state: remote audio
  /// and mute belong to a session that has ended.
  Future<void> disconnect() async {
    if (_disposed) return;
    if (_snapshot.phase == CallMediaPhase.idle ||
        _snapshot.phase == CallMediaPhase.disconnected) {
      return;
    }

    _emit(_snapshot._with(phase: CallMediaPhase.disconnecting));
    await _releaseRoom();
    _emit(const CallMediaSnapshot(phase: CallMediaPhase.disconnected));
  }

  void _onRoomEvent(MediaRoomEvent event) {
    if (_disposed) return;

    switch (event) {
      case MediaRoomConnected():
        _emit(_snapshot._with(phase: CallMediaPhase.roomConnected));

      case LocalMicrophonePublished():
        // THE ONLY EVIDENCE that this device's audio is leaving it.
        _emit(_snapshot._with(
          phase: CallMediaPhase.live,
          microphoneMuted: false,
        ));

      case RemoteAudioChanged(
          :final participantId,
          :final trackId,
          :final present,
        ):
        final audio = RemoteAudio(participantId: participantId, trackId: trackId);
        final next = {..._snapshot.remoteAudioParticipants};
        // Removal must match on the TRACK, not the participant: a participant
        // who republishes has a new track id, and dropping them by participant
        // would discard audio that is still arriving.
        present ? next.add(audio) : next.remove(audio);
        _emit(_snapshot._with(remoteAudioParticipants: next));

      case MediaRoomDisconnected(:final byServer):
        // A close we did not ask for. No reconnect is attempted here: W3 owns
        // credential and session lifecycle, and a media layer inventing its own
        // retry would be a second one.
        if (byServer) {
          _log.warn('call media: the room closed the connection');
        }
        _emit(const CallMediaSnapshot(phase: CallMediaPhase.disconnected));
    }
  }

  void _fail(CallMediaFailure failure) {
    _emit(CallMediaSnapshot(phase: CallMediaPhase.failed, failure: failure));
  }

  /// Drop the room and the subscription to it. Safe to call repeatedly, and
  /// only ever reaches the room once.
  Future<void> _releaseRoom() async {
    await _roomSub?.cancel();
    _roomSub = null;
    if (_roomReleased) return;
    _roomReleased = true;
    // disconnect BEFORE dispose: dispose on a live room is the SDK tearing down
    // a session it is still using, and the microphone is released by the
    // disconnect rather than by the object going away.
    await _room.disconnect();
    await _room.dispose();
  }

  /// Release everything, for good. Idempotent.
  ///
  /// After this, no room event can move the state: the subscription is gone and
  /// every entry point returns early.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _releaseRoom();
    _snapshot = const CallMediaSnapshot(phase: CallMediaPhase.disconnected);
    await _snapshots.close();
  }

  void _emit(CallMediaSnapshot next) {
    _snapshot = next;
    if (!_snapshots.isClosed) _snapshots.add(next);
  }
}
