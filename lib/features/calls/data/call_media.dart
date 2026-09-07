import 'dart:async';

import '../../../core/data/repositories.dart';

/// What the media layer is doing, independently of what the CALL is doing.
///
/// Deliberately separate from [CallStatus], which is the server's view of the
/// call, and from `CallPhase`, which is the screen's. A call can be `active`
/// server-side while this device is still negotiating, or has lost its
/// connection entirely — and a UI that conflated the two would tell a parent
/// they are connected while they cannot hear anybody.
enum MediaState {
  idle,
  connecting,
  connected,

  /// The transport dropped and the SDK is re-establishing it. Distinct from
  /// [disconnected] because the call is not over — the user should be told the
  /// audio is interrupted, not that the call ended.
  reconnecting,
  disconnected,
  failed,
}

/// A remote participant we are hearing.
class MediaParticipant {
  const MediaParticipant({required this.identity, this.isSpeaking = false});

  /// The server-resolved actor id. LiveKit carries it as the participant
  /// identity because the API put it in the token; it is never client-chosen.
  final String identity;
  final bool isSpeaking;
}

/// THE MEDIA SEAM.
///
/// Everything about carrying audio lives behind this interface, for the same
/// reason `ObjectStorage` and `MediaTokenIssuer` are seams on the server: the
/// call controller's job is the call's LIFECYCLE, and a controller that
/// imported LiveKit directly could not be tested without a media stack.
///
/// Note what this interface cannot express. There is no `join(room)` — only
/// [connect] with a [CallGrant] the server minted. The client cannot name a
/// room, cannot extend a token, and cannot decide it is allowed to publish.
/// Authorization is not represented here at all, because none of it happens
/// here.
abstract interface class CallMedia {
  /// Attach to the room named inside the grant, and start publishing the
  /// microphone.
  Future<void> connect(CallGrant grant);

  /// Leave the room and release the microphone and audio session.
  Future<void> disconnect();

  /// Stop or resume sending audio. Local only — it never tells the server.
  Future<void> setMuted(bool muted);

  Stream<MediaState> get state;

  /// Who we can currently hear.
  Stream<List<MediaParticipant>> get participants;

  MediaState get currentState;

  Future<void> dispose();
}

/// A [CallMedia] that carries no audio.
///
/// Used by widget tests and by the fixture build, which has no backend to mint
/// a token and no server to connect to. It is SILENT rather than throwing: a
/// fixture build should render the call screen, and an exception here would
/// surface an error for something the developer did not ask for.
///
/// It is deliberately NOT the production default. `bootstrap.dart` wires the
/// real implementation for every build that talks to a backend, so shipping
/// this by accident would take a deliberate edit rather than a forgotten one.
class SilentCallMedia implements CallMedia {
  final _state = StreamController<MediaState>.broadcast();
  final _participants = StreamController<List<MediaParticipant>>.broadcast();
  MediaState _current = MediaState.idle;

  @override
  MediaState get currentState => _current;

  @override
  Stream<MediaState> get state => _state.stream;

  @override
  Stream<List<MediaParticipant>> get participants => _participants.stream;

  @override
  Future<void> connect(CallGrant grant) async {
    _emit(MediaState.connecting);
    _emit(MediaState.connected);
  }

  @override
  Future<void> disconnect() async => _emit(MediaState.disconnected);

  @override
  Future<void> setMuted(bool muted) async {}

  void _emit(MediaState next) {
    _current = next;
    if (!_state.isClosed) _state.add(next);
  }

  @override
  Future<void> dispose() async {
    await _state.close();
    await _participants.close();
  }
}
