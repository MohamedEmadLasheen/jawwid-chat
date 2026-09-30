import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as lk;

import 'media_room.dart';

/// [MediaRoom] over `livekit_client`.
///
/// THE ONLY FILE IN THIS PROJECT THAT IMPORTS THE SDK. Everything else speaks
/// [MediaRoom], which is what lets the client's lifecycle — permission refusal,
/// publish failure, remote-track churn, disconnect — be tested without a device.
///
/// AUDIO ONLY. `setCameraEnabled` and `setScreenShareEnabled` exist on
/// `LocalParticipant` and are never called; there is no method here that could.
/// W1 also restricted the server grant to `canPublishSources: ['microphone']`,
/// so LiveKit would refuse them even if something did.
///
/// WHAT IS NOT VERIFIED. This adapter has never joined a real room. The SDK
/// imports and a `Room` constructs in a plain VM test, and that is the whole of
/// it: joining, capturing a microphone, publishing, and hearing anybody needs a
/// device with a microphone and a second participant. See the W4 closeout.
class LiveKitMediaRoom implements MediaRoom {
  LiveKitMediaRoom({lk.Room? room}) : _room = room ?? lk.Room();

  final lk.Room _room;
  final _events = StreamController<MediaRoomEvent>.broadcast();

  lk.EventsListener<lk.RoomEvent>? _listener;
  bool _disposed = false;

  @override
  Stream<MediaRoomEvent> get events => _events.stream;

  @override
  Future<void> connect({required String url, required String token}) async {
    if (_disposed) return;
    _attach();
    // The room is inside the token. There is no third argument, which is what
    // makes "the client cannot choose a room" a property of the SDK's API
    // rather than a rule this code has to remember.
    await _room.connect(url, token);
  }

  void _attach() {
    if (_listener != null) return;
    final listener = _room.createListener();
    _listener = listener;

    listener
      ..on<lk.RoomConnectedEvent>((_) => _emit(const MediaRoomConnected()))
      ..on<lk.RoomDisconnectedEvent>((event) => _emit(
            MediaRoomDisconnected(
              // The SDK's reason enum is richer than this port needs. What the
              // caller acts on is only whether WE asked for the close.
              byServer: event.reason != lk.DisconnectReason.clientInitiated,
            ),
          ))
      ..on<lk.LocalTrackPublishedEvent>((event) {
        if (event.publication.source == lk.TrackSource.microphone) {
          _emit(const LocalMicrophonePublished());
        }
      })
      ..on<lk.TrackSubscribedEvent>((event) => _remoteAudio(event.publication,
          event.participant.identity, present: true))
      ..on<lk.TrackUnsubscribedEvent>((event) => _remoteAudio(event.publication,
          event.participant.identity, present: false));
  }

  void _remoteAudio(
    lk.TrackPublication publication,
    String participantId, {
    required bool present,
  }) {
    // AUDIO ONLY, on the way in as well as out. A video track arriving — which
    // the grant should prevent — is ignored rather than reported as audio.
    if (publication.kind != lk.TrackType.AUDIO) return;
    _emit(RemoteAudioChanged(
      participantId: participantId,
      trackId: publication.sid,
      present: present,
    ));
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    if (_disposed) return;
    final local = _room.localParticipant;
    if (local == null) {
      throw const CallMediaException(
        CallMediaFailure.publishFailed,
        detail: 'no local participant; the room is not connected',
      );
    }
    // `false` mutes an existing publication rather than unpublishing it, and
    // `true` publishes or unmutes. Verified against
    // LocalParticipant.setSourceEnabled in livekit_client 2.13.0.
    await local.setMicrophoneEnabled(enabled);
  }

  @override
  Future<void> disconnect() async {
    if (_disposed) return;
    await _room.disconnect();
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    // Listeners first: a disconnect firing during teardown would otherwise push
    // an event onto a controller that is about to close.
    await _listener?.dispose();
    _listener = null;
    await _room.dispose();
    await _events.close();
  }

  void _emit(MediaRoomEvent event) {
    if (!_events.isClosed) _events.add(event);
  }
}
