import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:jawwid_chat/core/media/story_video_player.dart';

/// A [StoryVideoPlayer] standing in for the platform video decoder, and nothing more.
///
/// It fakes the SEAM, not the behaviour under test. The viewer's advance rule — "a video story
/// ends when playback completes" — is exercised by driving this fake to [completePlayback] and
/// asserting what the viewer does; the fake never decides to advance anything itself.
///
/// Lives in `test/` because `lib/` has no fake video player: the real seam is the only
/// implementation the app ships, and a build with a stub decoder would show a reader a story
/// that never plays.
class FakeStoryVideoPlayer implements StoryVideoPlayer {
  FakeStoryVideoPlayer({this.failOnLoad = false, this.duration = const Duration(seconds: 12)});

  /// When true, [load] reports [StoryVideoState.failed] instead of initialising — a lapsed
  /// signed URL, or a codec the device cannot decode.
  bool failOnLoad;

  /// The length the fake reports once initialised.
  Duration duration;

  final _controller = StreamController<StoryVideoStatus>.broadcast();
  StoryVideoStatus _current = const StoryVideoStatus();

  /// Every url handed to [load], in order.
  final List<String> loaded = [];
  int playCalls = 0;
  int pauseCalls = 0;
  int stopCalls = 0;
  int disposeCalls = 0;

  bool get isDisposed => disposeCalls > 0;

  /// True when the seam still holds a video, so a test can assert it was released.
  bool get holdsVideo => _hasVideo;
  bool _hasVideo = false;

  /// Events emitted after [dispose]. Must always be empty: a disposed seam that still talks is
  /// how a closed viewer gets its state mutated.
  final List<StoryVideoStatus> emittedAfterDispose = [];

  @override
  Stream<StoryVideoStatus> get status => _controller.stream;

  @override
  Widget? get surface => _hasVideo ? const _FakeVideoSurface() : null;

  void _emit(StoryVideoStatus next) {
    if (isDisposed) {
      emittedAfterDispose.add(next);
      return;
    }
    _current = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  @override
  Future<void> load(String url) async {
    loaded.add(url);
    _emit(const StoryVideoStatus(state: StoryVideoState.loading));
    if (failOnLoad) {
      _hasVideo = false;
      _emit(const StoryVideoStatus(state: StoryVideoState.failed));
      return;
    }
    _hasVideo = true;
    _emit(StoryVideoStatus(
      state: StoryVideoState.paused,
      duration: duration,
      aspectRatio: 16 / 9,
    ));
  }

  @override
  Future<void> play() async {
    playCalls += 1;
    if (!_hasVideo) return;
    _emit(_current.copyWith(state: StoryVideoState.playing));
  }

  @override
  Future<void> pause() async {
    pauseCalls += 1;
    if (!_hasVideo) return;
    _emit(_current.copyWith(state: StoryVideoState.paused));
  }

  @override
  Future<void> stop() async {
    stopCalls += 1;
    _hasVideo = false;
    _emit(const StoryVideoStatus());
  }

  @override
  Future<void> dispose() async {
    disposeCalls += 1;
    _hasVideo = false;
    await _controller.close();
  }

  // --- test drivers -------------------------------------------------------

  /// Report that playback reached the end. This is the ONLY thing that should make a video
  /// story advance.
  void completePlayback() => _emit(
        StoryVideoStatus(
          state: StoryVideoState.completed,
          position: duration,
          duration: duration,
          aspectRatio: 16 / 9,
        ),
      );

  /// Report progress part-way through, so the progress bar can be asserted on.
  void reportProgress(Duration position) => _emit(
        StoryVideoStatus(
          state: StoryVideoState.playing,
          position: position,
          duration: duration,
          aspectRatio: 16 / 9,
        ),
      );

  /// Report a mid-playback buffering stall.
  void reportBuffering() => _emit(_current.copyWith(state: StoryVideoState.loading));
}

/// Stands in for the platform video surface, so a test can find it without a decoder.
class _FakeVideoSurface extends StatelessWidget {
  const _FakeVideoSurface();

  @override
  Widget build(BuildContext context) =>
      const SizedBox.expand(key: ValueKey('fake-video-surface'));
}

/// The finder for the fake surface, so tests do not repeat the key.
const fakeVideoSurface = ValueKey('fake-video-surface');
