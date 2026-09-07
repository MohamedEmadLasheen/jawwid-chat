import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as lk;

import '../../../core/data/repositories.dart';
import '../../../core/logging/redacting_logger.dart';
import 'call_media.dart';

/// The real media layer: LiveKit.
///
/// ## What this class is responsible for, and what it is not
///
/// It carries audio. It does not decide anything. Every input it needs — the
/// server URL, the room, the identity, whether this participant may publish —
/// arrives inside a [CallGrant] the server minted seconds earlier, and none of
/// it is derivable here. The class cannot name a room, cannot mint or extend a
/// token, and cannot grant itself publish rights, because the room and the
/// grants are inside the token's SIGNED payload.
///
/// That is the whole reason the token is short-lived and re-minted on every
/// join: a permission revoked mid-call takes effect the next time this client
/// asks for a token, and this class has no way to avoid asking.
///
/// ## Audio only
///
/// The product is voice calling. No camera is ever requested — which is a
/// privacy property, not just a scope one: an app that asks for camera
/// permission it never uses trains people to grant it.
class LiveKitCallMedia implements CallMedia {
  LiveKitCallMedia({RedactingLogger logger = const RedactingLogger()})
      : _logger = logger;

  final RedactingLogger _logger;

  final _state = StreamController<MediaState>.broadcast();
  final _participants = StreamController<List<MediaParticipant>>.broadcast();

  lk.Room? _room;
  lk.EventsListener<lk.RoomEvent>? _events;
  MediaState _current = MediaState.idle;

  @override
  MediaState get currentState => _current;

  @override
  Stream<MediaState> get state => _state.stream;

  @override
  Stream<List<MediaParticipant>> get participants => _participants.stream;

  @override
  Future<void> connect(CallGrant grant) async {
    // A second connect on a live room would leave the first one publishing a
    // microphone nobody is listening to. Tearing down first is cheaper than
    // reasoning about two rooms.
    await disconnect();
    _emit(MediaState.connecting);

    final room = lk.Room(
      roomOptions: const lk.RoomOptions(
        // No camera, ever. See the class comment.
        adaptiveStream: false,
        dynacast: true,
      ),
    );
    _room = room;

    final events = room.createListener();
    _events = events;
    _wire(events, room);

    try {
      await room.connect(
        grant.serverUrl,
        grant.token,
        connectOptions: const lk.ConnectOptions(
          // The server publishes a TCP fallback port precisely because a parent
          // on a restrictive mobile network cannot establish UDP media at all,
          // and that is the commonest real-world failure.
          rtcConfiguration: lk.RTCConfiguration(
            iceTransportPolicy: lk.RTCIceTransportPolicy.all,
          ),
        ),
      );

      // Publishing is attempted only AFTER the room is connected. Enabling the
      // microphone first would hold the audio session open through a failed
      // connection, which on iOS ducks other audio for a call that never
      // happened.
      await room.localParticipant?.setMicrophoneEnabled(true);

      _emit(MediaState.connected);
      _publishParticipants(room);
    } catch (error) {
      // Never the error object: a LiveKit connection error can echo the URL
      // with the access token in its query string.
      _logger.debug('livekit connect failed');
      _emit(MediaState.failed);
      await disconnect();
      rethrow;
    }
  }

  void _wire(lk.EventsListener<lk.RoomEvent> events, lk.Room room) {
    events
      ..on<lk.RoomDisconnectedEvent>((_) {
        // The room is gone. Whether the CALL is over is the server's answer,
        // not this one — the controller reconciles rather than assuming.
        _emit(MediaState.disconnected);
      })
      ..on<lk.RoomReconnectingEvent>((_) => _emit(MediaState.reconnecting))
      ..on<lk.RoomReconnectedEvent>((_) {
        _emit(MediaState.connected);
        _publishParticipants(room);
      })
      ..on<lk.ParticipantConnectedEvent>((_) => _publishParticipants(room))
      ..on<lk.ParticipantDisconnectedEvent>((_) => _publishParticipants(room))
      ..on<lk.ActiveSpeakersChangedEvent>((_) => _publishParticipants(room))
      ..on<lk.TrackSubscribedEvent>((_) => _publishParticipants(room))
      ..on<lk.TrackUnsubscribedEvent>((_) => _publishParticipants(room));
  }

  void _publishParticipants(lk.Room room) {
    if (_participants.isClosed) return;
    _participants.add([
      for (final remote in room.remoteParticipants.values)
        MediaParticipant(
          // The identity the SERVER put in the token: an actor id. Never a name
          // the client chose, and never a phone number — no such value reaches
          // this app.
          identity: remote.identity,
          isSpeaking: remote.isSpeaking,
        ),
    ]);
  }

  @override
  Future<void> setMuted(bool muted) async {
    // Local only. Mute is not a call state and the server is not told: it is
    // this device's microphone, and a mute that round-tripped would be a
    // control that stops working when the network does.
    await _room?.localParticipant?.setMicrophoneEnabled(!muted);
  }

  @override
  Future<void> disconnect() async {
    final room = _room;
    final events = _events;
    _room = null;
    _events = null;
    if (room == null) return;

    // Ordered: stop listening, then leave, then release. Disposing the room
    // while its listener is live delivers a disconnect event into a closed
    // controller.
    await events?.dispose();
    try {
      await room.disconnect();
    } catch (_) {
      // Already gone, or the transport died first. Nothing to recover; the
      // release below is what actually matters.
    }
    await room.dispose();
    _emit(MediaState.disconnected);
  }

  void _emit(MediaState next) {
    _current = next;
    if (!_state.isClosed) _state.add(next);
  }

  @override
  Future<void> dispose() async {
    await disconnect();
    await _state.close();
    await _participants.close();
  }
}
