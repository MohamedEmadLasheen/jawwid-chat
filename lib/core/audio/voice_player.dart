import 'dart:async';

import 'package:just_audio/just_audio.dart';

/// Where playback of one voice note has got to.
enum VoicePlaybackState { idle, loading, playing, paused, completed, failed }

class VoicePlaybackStatus {
  const VoicePlaybackStatus({
    this.state = VoicePlaybackState.idle,
    this.position = Duration.zero,
    this.duration,
  });

  final VoicePlaybackState state;
  final Duration position;

  /// The decoded duration once known. Until then the UI shows the duration the
  /// backend stored, so a list of voice notes renders without decoding one.
  final Duration? duration;

  bool get isPlaying => state == VoicePlaybackState.playing;
  bool get isLoading => state == VoicePlaybackState.loading;
  bool get hasFailed => state == VoicePlaybackState.failed;

  VoicePlaybackStatus copyWith({
    VoicePlaybackState? state,
    Duration? position,
    Duration? duration,
  }) {
    return VoicePlaybackStatus(
      state: state ?? this.state,
      position: position ?? this.position,
      duration: duration ?? this.duration,
    );
  }
}

/// The playback seam. Faked in tests; nothing above it knows about just_audio.
abstract interface class VoicePlayer {
  /// Load [url] without starting playback. Safe to call repeatedly for the same
  /// url — a reload would restart a note the user is part-way through.
  Future<void> load(String url);

  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> stop();

  Stream<VoicePlaybackStatus> get status;

  Future<void> dispose();
}

/// [VoicePlayer] over just_audio.
///
/// The source is set from a URL, so the platform player streams it with range
/// requests and starts on the first buffered chunk rather than pulling the whole
/// file — which is the point of the range support on the storage route.
class JustAudioVoicePlayer implements VoicePlayer {
  JustAudioVoicePlayer({AudioPlayer? player}) : _player = player ?? AudioPlayer() {
    _subscriptions.addAll([
      _player.playerStateStream.listen(_onPlayerState, onError: _onError),
      _player.positionStream.listen((position) => _emit(_current.copyWith(position: position))),
      _player.durationStream.listen((duration) {
        if (duration != null) _emit(_current.copyWith(duration: duration));
      }),
    ]);
  }

  final AudioPlayer _player;
  final _controller = StreamController<VoicePlaybackStatus>.broadcast();
  final _subscriptions = <StreamSubscription<Object?>>[];

  VoicePlaybackStatus _current = const VoicePlaybackStatus();
  String? _loadedUrl;

  @override
  Stream<VoicePlaybackStatus> get status => _controller.stream;

  void _emit(VoicePlaybackStatus next) {
    _current = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  void _onError(Object error, StackTrace _) =>
      _emit(_current.copyWith(state: VoicePlaybackState.failed));

  void _onPlayerState(PlayerState state) {
    final next = switch (state.processingState) {
      ProcessingState.idle => VoicePlaybackState.idle,
      ProcessingState.loading || ProcessingState.buffering => VoicePlaybackState.loading,
      // Completed keeps the position at the end so the bar reads "finished"
      // rather than snapping back to zero under the user.
      ProcessingState.completed => VoicePlaybackState.completed,
      ProcessingState.ready =>
        state.playing ? VoicePlaybackState.playing : VoicePlaybackState.paused,
    };
    _emit(_current.copyWith(state: next));
  }

  @override
  Future<void> load(String url) async {
    // Resuming is the requirement, so re-loading the url the player already
    // holds must be a no-op rather than a seek to zero.
    if (_loadedUrl == url) return;

    _emit(const VoicePlaybackStatus(state: VoicePlaybackState.loading));
    try {
      // A draft under review is still a file on disk; only a sent note has a
      // signed URL. Both are played by the same widget, so the branch lives here
      // rather than in the UI.
      if (url.startsWith('http://') || url.startsWith('https://')) {
        await _player.setUrl(url);
      } else {
        await _player.setFilePath(url);
      }
      _loadedUrl = url;
      _emit(_current.copyWith(state: VoicePlaybackState.paused, position: Duration.zero));
    } catch (_) {
      // A signed URL that expired while the message sat on screen lands here.
      _loadedUrl = null;
      _emit(_current.copyWith(state: VoicePlaybackState.failed));
    }
  }

  @override
  Future<void> play() async {
    await _guard(() async {
      // Replaying a finished note starts it again rather than doing nothing.
      if (_current.state == VoicePlaybackState.completed) await _player.seek(Duration.zero);
      await _player.play();
    });
  }

  @override
  Future<void> pause() => _guard(_player.pause);

  @override
  Future<void> seek(Duration position) => _guard(() => _player.seek(position));

  @override
  Future<void> stop() async {
    await _guard(_player.stop);
    _loadedUrl = null;
    _emit(const VoicePlaybackStatus());
  }

  /// Every transport call goes through here.
  ///
  /// These are invoked straight from button callbacks, so an exception escaping
  /// one is an unhandled error in the widget tree rather than something the user
  /// can act on. A platform failure becomes a visible "could not be played"
  /// instead.
  Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
    } catch (_) {
      _emit(_current.copyWith(state: VoicePlaybackState.failed));
    }
  }

  @override
  Future<void> dispose() async {
    // Each step is independent: a subscription that fails to cancel must not
    // leave the platform audio session open behind it.
    for (final subscription in _subscriptions) {
      try {
        await subscription.cancel();
      } catch (_) {
        // Nothing useful to do while tearing down.
      }
    }
    _subscriptions.clear();
    try {
      await _controller.close();
    } catch (_) {
      // As above.
    }
    await _player.dispose();
  }
}
