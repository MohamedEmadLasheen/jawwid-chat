import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:video_player/video_player.dart';

/// Where playback of one story video has got to.
///
/// Deliberately the same shape as [VoicePlaybackStatus] in `lib/core/audio`: the two seams
/// solve the same problem for different media, and a reader who knows one should recognise
/// the other.
enum StoryVideoState { idle, loading, playing, paused, completed, failed }

class StoryVideoStatus {
  const StoryVideoStatus({
    this.state = StoryVideoState.idle,
    this.position = Duration.zero,
    this.duration,
    this.aspectRatio,
  });

  final StoryVideoState state;
  final Duration position;

  /// Known only once the video has initialised. Until then the progress bar has nothing to
  /// measure against, which is why a video story's segment stays empty while it loads rather
  /// than animating against a guessed length.
  final Duration? duration;

  /// The video's own aspect ratio, so the surface letterboxes instead of stretching.
  final double? aspectRatio;

  bool get isPlaying => state == StoryVideoState.playing;
  bool get isLoading => state == StoryVideoState.loading;
  bool get hasFailed => state == StoryVideoState.failed;
  bool get isCompleted => state == StoryVideoState.completed;

  /// How far through, 0..1, or null when the duration is not known yet.
  double? get fraction {
    final total = duration;
    if (total == null || total.inMilliseconds <= 0) return null;
    return (position.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0);
  }

  StoryVideoStatus copyWith({
    StoryVideoState? state,
    Duration? position,
    Duration? duration,
    double? aspectRatio,
  }) {
    return StoryVideoStatus(
      state: state ?? this.state,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      aspectRatio: aspectRatio ?? this.aspectRatio,
    );
  }
}

/// The story-video playback seam. Faked in tests; nothing above it knows about video_player.
///
/// One instance is owned by the story viewer's State and disposed with it, so playback cannot
/// outlive the screen. [load] replaces whatever was playing, which is what makes paging
/// between stories safe: there is never a second controller alive.
abstract interface class StoryVideoPlayer {
  /// Prepare [url] and report progress through [status]. Does not start playback.
  ///
  /// Re-loading the url already held is a no-op, so returning to a story does not restart a
  /// video the reader is part-way through.
  Future<void> load(String url);

  Future<void> play();
  Future<void> pause();

  /// Release the current video without disposing the seam, so the next [load] starts clean.
  Future<void> stop();

  Stream<StoryVideoStatus> get status;

  /// The widget that renders the frames, or null before the video has initialised.
  ///
  /// Returning a Widget from the seam is what keeps `video_player` out of the presentation
  /// layer entirely: the viewer renders whatever this hands back and never names a platform
  /// type.
  Widget? get surface;

  Future<void> dispose();
}

/// [StoryVideoPlayer] over `video_player`.
///
/// ## Why a new controller per url rather than one reused
///
/// `VideoPlayerController` is bound to its source at construction, so switching stories means
/// a new controller. The old one is disposed FIRST, before the new one is built, so two
/// decoders are never alive at once — on a low-end phone paging quickly through a feed of
/// videos that is the difference between smooth and a crash.
///
/// ## Completion, not a timer
///
/// The story advances when `position >= duration` and the player has stopped playing, reported
/// through [status] as [StoryVideoState.completed]. Nothing here guesses a duration and
/// nothing schedules a timer: a 40-second video gets 40 seconds, and a video that stalls
/// buffering does not get skipped past.
class VideoPlayerStoryVideoPlayer implements StoryVideoPlayer {
  VideoPlayerStoryVideoPlayer();

  VideoPlayerController? _controller;
  final _statusController = StreamController<StoryVideoStatus>.broadcast();
  StoryVideoStatus _current = const StoryVideoStatus();
  String? _loadedUrl;
  bool _disposed = false;

  @override
  Stream<StoryVideoStatus> get status => _statusController.stream;

  @override
  Widget? get surface {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return null;
    return VideoPlayer(controller);
  }

  void _emit(StoryVideoStatus next) {
    _current = next;
    if (!_statusController.isClosed) _statusController.add(next);
  }

  void _onControllerValue() {
    final controller = _controller;
    if (controller == null || _disposed) return;
    final value = controller.value;

    if (value.hasError) {
      _emit(_current.copyWith(state: StoryVideoState.failed));
      return;
    }
    if (!value.isInitialized) return;

    // Completed is derived from the clock, not from an `isCompleted` flag: the platform
    // implementations do not agree on one, and position reaching duration with playback
    // stopped is the fact that actually matters.
    final finished = value.duration > Duration.zero && value.position >= value.duration;
    final next = finished
        ? StoryVideoState.completed
        : value.isBuffering
            ? StoryVideoState.loading
            : value.isPlaying
                ? StoryVideoState.playing
                : StoryVideoState.paused;

    _emit(StoryVideoStatus(
      state: next,
      position: value.position,
      duration: value.duration,
      aspectRatio: value.aspectRatio,
    ));
  }

  @override
  Future<void> load(String url) async {
    if (_disposed) return;
    // Resuming is the requirement, so re-loading the url already held is a no-op rather than
    // a seek to zero.
    if (_loadedUrl == url && _controller != null) return;

    await _release();
    if (_disposed) return;

    _emit(const StoryVideoStatus(state: StoryVideoState.loading));

    final uri = Uri.tryParse(url);
    if (uri == null) {
      _emit(_current.copyWith(state: StoryVideoState.failed));
      return;
    }

    // The URL is the short-lived signed one the Stories API minted, passed through untouched.
    // No bucket, no key, no path construction.
    final controller = VideoPlayerController.networkUrl(uri);
    _controller = controller;
    controller.addListener(_onControllerValue);

    try {
      await controller.initialize();
      if (_disposed) {
        await _release();
        return;
      }
      _loadedUrl = url;
      _emit(StoryVideoStatus(
        state: StoryVideoState.paused,
        duration: controller.value.duration,
        aspectRatio: controller.value.aspectRatio,
      ));
    } catch (_) {
      // A signed URL that lapsed while the reader was on an earlier story lands here, as does
      // a codec the device cannot decode.
      _loadedUrl = null;
      await _release();
      _emit(const StoryVideoStatus(state: StoryVideoState.failed));
    }
  }

  @override
  Future<void> play() async {
    final controller = _controller;
    if (_disposed || controller == null || !controller.value.isInitialized) return;
    try {
      // Replaying a finished video starts it again rather than doing nothing.
      if (_current.isCompleted) await controller.seekTo(Duration.zero);
      await controller.play();
    } catch (_) {
      _emit(_current.copyWith(state: StoryVideoState.failed));
    }
  }

  @override
  Future<void> pause() async {
    final controller = _controller;
    if (_disposed || controller == null || !controller.value.isInitialized) return;
    try {
      await controller.pause();
    } catch (_) {
      // A pause that fails is not worth surfacing: the reader is leaving anyway.
    }
  }

  @override
  Future<void> stop() async {
    await _release();
    _loadedUrl = null;
    if (!_disposed) _emit(const StoryVideoStatus());
  }

  /// Tear down the current controller. Listener removed BEFORE dispose, so a final value
  /// change cannot call back into a half-disposed player.
  Future<void> _release() async {
    final controller = _controller;
    _controller = null;
    if (controller == null) return;
    controller.removeListener(_onControllerValue);
    try {
      await controller.pause();
    } catch (_) {
      // Already gone.
    }
    await controller.dispose();
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _release();
    await _statusController.close();
  }
}
