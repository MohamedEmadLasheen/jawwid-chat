import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/media/story_video_player.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';

/// The full-screen story viewer.
///
/// ## How a story ends, and why the two kinds differ
///
/// An IMAGE has no intrinsic length, so it gets a fixed one: [imageDuration], driven by an
/// [AnimationController] that also draws the progress segment.
///
/// A VIDEO has its own length, so it is never given a timer. It advances when playback
/// actually COMPLETES, reported by the [StoryVideoPlayer] seam, and its progress segment is
/// drawn from real position over real duration. A fixed timer would be wrong in both
/// directions: it would cut a 40-second video short, and it would skip past one that stalled
/// buffering.
///
/// There is deliberately no [Timer] anywhere in this file. An AnimationController and a stream
/// subscription both die with the State; a timer is how a closed viewer keeps ticking and
/// pushes a route onto a widget tree that has moved on.
///
/// ## Every advance goes through one gate
///
/// [_advanceFrom] refuses to act unless the story asking is still the current one, the viewer
/// is still mounted, and it is not already leaving. That single check is what makes a late
/// callback — a video completing just after the reader tapped next, an animation finishing as
/// the route pops — harmless rather than a double advance.
///
/// ## What it never does
///
/// It does not decide whether a story may be read. It renders the feed the server returned
/// and, when the server refuses a view, it leaves the story and refetches. The only
/// clock-reading it does is to stop sitting on a story whose `expiresAt` has passed — which
/// saves a request the server would refuse anyway, and is not a substitute for that refusal.
class StoryViewerScreen extends ConsumerStatefulWidget {
  const StoryViewerScreen({super.key, required this.storyId});

  /// The story the reader tapped. The rest of the feed is read from the controller, so the
  /// viewer pages through exactly what the rail showed, in the same order.
  final String storyId;

  /// How long an IMAGE story stays on screen. A video's length is its own.
  static const imageDuration = Duration(seconds: 5);

  /// Fraction of the width each edge tap zone occupies, leaving the middle to the page.
  static const tapZoneFraction = 0.28;

  @override
  ConsumerState<StoryViewerScreen> createState() => _StoryViewerScreenState();
}

class _StoryViewerScreenState extends ConsumerState<StoryViewerScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final PageController _pages;
  late final AnimationController _progress;

  /// Owned here, so playback cannot outlive this screen. Built from a factory provider rather
  /// than read as a shared instance for exactly that reason.
  late final StoryVideoPlayer _video;
  StreamSubscription<StoryVideoStatus>? _videoSub;
  StoryVideoStatus _videoStatus = const StoryVideoStatus();

  /// The stories this viewer opened with.
  ///
  /// Captured ONCE, the first time the feed has an answer, and never re-read after that. A
  /// feed that refreshed underneath a reader mid-story would renumber the pages they are
  /// looking at and jump them somewhere else; the refreshed list is what the rail shows when
  /// they come back.
  ///
  /// Captured on first DATA rather than in [initState], because the feed may not be loaded
  /// yet. Opening from the rail it always is — the rail only has rings to tap once it is. But
  /// `/stories/:id` is a real route, so a notification or a saved link can land here on a cold
  /// start with the feed still in flight; reading it in initState then found an empty list and
  /// told the reader the story was gone, which was a lie about a story that was about to
  /// arrive.
  List<Story> _stories = const [];
  bool _captured = false;
  int _index = 0;
  bool _leaving = false;

  /// True while the reader is holding the screen, so a lifecycle resume knows not to override
  /// a deliberate pause.
  bool _held = false;

  @override
  void initState() {
    super.initState();
    _pages = PageController();
    _progress = AnimationController(vsync: this, duration: StoryViewerScreen.imageDuration)
      ..addStatusListener(_onProgressStatus);
    _video = ref.read(storyVideoPlayerFactoryProvider)();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    // Order matters: stop listening before tearing anything down, so no final event can call
    // back into a half-disposed State.
    WidgetsBinding.instance.removeObserver(this);
    _cancelVideoSub();
    _progress.removeStatusListener(_onProgressStatus);
    _progress.dispose();
    unawaited(_video.dispose());
    _pages.dispose();
    super.dispose();
  }

  /// Backgrounding the app stops the story. A video playing behind a locked screen, and a
  /// progress bar that advanced three stories while the reader was in another app, are the same
  /// bug: the story continued with nobody watching.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        if (!_held) _resumeCurrent();
      case AppLifecycleState.inactive:
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        _pauseCurrent();
    }
  }

  Story? get _current => _index >= 0 && _index < _stories.length ? _stories[_index] : null;
  bool get _currentIsVideo => _current?.mediaKind == StoryMediaKind.video;

  void _onProgressStatus(AnimationStatus status) {
    // Images and text-only stories. A video's controller is never started, so this cannot fire
    // for one.
    if (status == AnimationStatus.completed) _advanceFrom(_index);
  }

  void _pauseCurrent() {
    _progress.stop();
    if (_currentIsVideo) unawaited(_video.pause());
  }

  void _resumeCurrent() {
    if (_leaving || !mounted) return;
    if (_currentIsVideo) {
      if (!_videoStatus.isCompleted && !_videoStatus.hasFailed) unawaited(_video.play());
      return;
    }
    if (!_progress.isAnimating && _progress.value < 1) _progress.forward();
  }

  /// Take the feed as it stands, and start on the requested story.
  ///
  /// Called from `build` and so must not call setState: the fields it sets are read by the
  /// same build pass. The side effects that CANNOT happen during build — jumping the page
  /// controller, recording the view, leaving — are deferred to after the frame.
  void _capture(List<Story> stories) {
    _captured = true;
    _stories = stories;
    final found = stories.indexWhere((s) => s.id == widget.storyId);
    _index = found < 0 ? 0 : found;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (stories.isEmpty || found < 0) {
        _leave();
        return;
      }
      // ONE entry point per story. `jumpToPage` fires `onPageChanged`, which enters the story
      // itself -- so calling `_enter` here as well entered it twice: two video loads, two view
      // requests, and two live subscriptions of which only the second was ever cancelled.
      // Entering from the jump when there is one, and directly only when there is not.
      if (_index != 0 && _pages.hasClients) {
        _pages.jumpToPage(_index);
      } else {
        _enter(_index);
      }
    });
  }

  /// Arrive on a story: reset whatever was running, start the right mechanism, record the view.
  Future<void> _enter(int index) async {
    final story = index >= 0 && index < _stories.length ? _stories[index] : null;
    if (story == null) return;

    // Leave the previous story cleanly, whichever kind it was.
    _progress
      ..stop()
      ..value = 0;
    // NOT awaited, and that is load-bearing. `StreamSubscription.cancel()` on a broadcast
    // stream returns a future that does not complete until the stream itself closes -- which
    // here is when the player is disposed, i.e. when the viewer is torn down. Awaiting it
    // stalled this method forever: the next story never started its clock and never recorded
    // its view. Nothing downstream needs the cancel to have finished; dropping the reference
    // is what stops the events reaching us.
    _cancelVideoSub();
    if (!mounted) return;
    setState(() => _videoStatus = const StoryVideoStatus());

    // A story that lapsed while the reader was on an earlier page. Skip the round trip the
    // server would refuse and leave, so nobody stares at a picture that is already over.
    if (story.isExpiredAt(DateTime.now())) {
      _leave(refresh: true);
      return;
    }

    if (story.mediaKind == StoryMediaKind.video && story.mediaUrl != null) {
      await _startVideo(index, story.mediaUrl!);
    } else {
      // An image, or words only: a fixed length is the only sensible one. Release any video
      // still held from a previous story so no decoder lingers.
      await _video.stop();
      if (!mounted || _index != index || _leaving) return;
      _progress.forward();
    }

    // Viewed on ARRIVAL, not on feed load: the rail showing a story is not the reader having
    // opened it. The server is idempotent, so a re-entry costs nothing.
    final failure = await ref.read(storiesControllerProvider.notifier).markViewed(story.id);
    if (!mounted) return;
    if (failure != null) {
      // Expired, deleted, or never theirs. The story is gone; leave and let the rail rebuild
      // from a fresh feed.
      _leave(refresh: true);
    }
  }

  /// Drop the current subscription without waiting for it. See [_enter] for why.
  void _cancelVideoSub() {
    unawaited(_videoSub?.cancel());
    _videoSub = null;
  }

  Future<void> _startVideo(int index, String url) async {
    // Belt and braces against a leaked listener: whoever calls this has usually cancelled
    // already, but a second live subscription would double every advance it reports.
    _cancelVideoSub();
    _videoSub = _video.status.listen((status) {
      if (!mounted) return;
      setState(() => _videoStatus = status);
      // THE advance for a video: its own playback finishing, never a timer.
      if (status.isCompleted) _advanceFrom(index);
    });

    await _video.load(url);
    if (!mounted || _index != index || _leaving) return;
    await _video.play();
  }

  /// Retry a video that failed to initialise — a lapsed signature, a stalled network.
  Future<void> _retryVideo() async {
    final story = _current;
    final url = story?.mediaUrl;
    if (url == null) return;
    final index = _index;

    _cancelVideoSub();
    if (!mounted) return;
    setState(() => _videoStatus = const StoryVideoStatus(state: StoryVideoState.loading));
    await _video.stop();
    if (!mounted || _index != index || _leaving) return;
    await _startVideo(index, url);
  }

  /// The single gate every automatic advance passes through.
  ///
  /// `from` is the story that asked. If it is no longer the current one the request is stale —
  /// a video completing just after the reader tapped next, an animation finishing as the route
  /// pops — and is dropped rather than skipping a story or advancing twice.
  void _advanceFrom(int from) {
    if (!mounted || _leaving || from != _index) return;
    _next();
  }

  void _next() {
    if (_leaving) return;
    if (_index >= _stories.length - 1) {
      _leave();
      return;
    }
    _pauseCurrent();
    _pages.nextPage(duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
  }

  void _previous() {
    if (_leaving) return;
    if (_index == 0) {
      // Restart the current story rather than leaving. Leaving on a back-tap at the first
      // story is how a reader loses their place by mistiming a tap.
      if (_currentIsVideo) {
        unawaited(_retryVideo());
      } else {
        _progress
          ..stop()
          ..value = 0
          ..forward();
      }
      return;
    }
    _pauseCurrent();
    _pages.previousPage(duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
  }

  /// Close the viewer. `refresh` when the reason was the server refusing a story, so the rail
  /// comes back without it.
  void _leave({bool refresh = false}) {
    if (_leaving) return;
    _leaving = true;
    _progress.stop();
    _cancelVideoSub();
    unawaited(_video.pause());
    if (refresh) {
      // Fire and forget: the rail rebuilds when it lands, and nothing here waits on it.
      ref.read(storiesControllerProvider.notifier).refresh();
    }
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    if (!_captured) {
      switch (ref.watch(storiesControllerProvider)) {
        case AsyncData(:final value):
          _capture(value);
        case AsyncLoading():
          // A cold start straight onto this route. Wait for the feed rather than declaring
          // the story missing.
          return Scaffold(
            backgroundColor: tokens.colorMediaSurface,
            body: Center(
              child: CircularProgressIndicator(color: tokens.colorMediaOnSurfaceMuted),
            ),
          );
        case _:
          // The feed failed, or no story backend is registered. Either way there is nothing
          // to show and no point retrying from here.
          return _UnavailableScaffold(message: l10n.storyUnavailable, onClose: _leave);
      }
    }

    if (_stories.isEmpty) {
      return _UnavailableScaffold(message: l10n.storyUnavailable, onClose: _leave);
    }

    return Scaffold(
      backgroundColor: tokens.colorMediaSurface,
      body: SafeArea(
        child: Stack(
          children: [
            // Long-press anywhere holds the story, the way every reader already expects.
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onLongPressStart: (_) {
                _held = true;
                _pauseCurrent();
              },
              onLongPressEnd: (_) {
                _held = false;
                _resumeCurrent();
              },
              child: PageView.builder(
                controller: _pages,
                itemCount: _stories.length,
                onPageChanged: (index) {
                  setState(() => _index = index);
                  _enter(index);
                },
                itemBuilder: (context, index) => _StoryPage(
                  story: _stories[index],
                  isCurrent: index == _index,
                  videoStatus: _videoStatus,
                  videoSurface: _video.surface,
                  onRetryVideo: _retryVideo,
                ),
              ),
            ),

            // Tap zones along the two EDGES, not two full-width halves.
            //
            // Halves were the first version and they were wrong: an invisible pane covering
            // the whole screen swallows every tap meant for the page, so a control inside the
            // story could not be pressed at all. A test caught it. Edges also mean a tap on a
            // caption does not advance the story, which is what a reader expects when they are
            // still reading it.
            //
            // Not full-height either: the bottom strip belongs to the page and to the
            // previous/next controls.
            Positioned.fill(
              bottom: Spacing.spacing9,
              child: Row(
                children: [
                  SizedBox(
                    width: MediaQuery.sizeOf(context).width * StoryViewerScreen.tapZoneFraction,
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: _previous,
                      // Not a button to a screen reader: the same navigation is available
                      // through the labelled controls, and announcing two invisible strips of
                      // the screen would be noise.
                      child: const SizedBox.expand(),
                    ),
                  ),
                  const Spacer(),
                  SizedBox(
                    width: MediaQuery.sizeOf(context).width * StoryViewerScreen.tapZoneFraction,
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: _next,
                      child: const SizedBox.expand(),
                    ),
                  ),
                ],
              ),
            ),

            _ProgressBar(
              count: _stories.length,
              index: _index,
              animation: _progress,
              // A video's segment is drawn from real position over real duration. Null while
              // it is still loading, so the bar stays empty rather than animating against a
              // length nobody knows yet.
              videoFraction: _currentIsVideo ? _videoStatus.fraction : null,
              isVideo: _currentIsVideo,
            ),

            PositionedDirectional(
              top: Spacing.spacing5,
              end: Spacing.spacing3,
              child: Semantics(
                button: true,
                label: l10n.storyClose,
                child: IconButton(
                  icon: const Icon(Icons.close),
                  color: tokens.colorMediaOnSurface,
                  tooltip: l10n.storyClose,
                  onPressed: _leave,
                ),
              ),
            ),

            // Explicit previous/next controls, because tap zones are invisible and a reader
            // using a screen reader or a switch device has no way to find them.
            PositionedDirectional(
              bottom: Spacing.spacing4,
              start: Spacing.spacing3,
              child: Semantics(
                button: true,
                label: l10n.storyPrevious,
                child: IconButton(
                  icon: const Icon(Icons.chevron_left),
                  color: tokens.colorMediaOnSurface,
                  tooltip: l10n.storyPrevious,
                  onPressed: _previous,
                ),
              ),
            ),
            PositionedDirectional(
              bottom: Spacing.spacing4,
              end: Spacing.spacing3,
              child: Semantics(
                button: true,
                label: l10n.storyNext,
                child: IconButton(
                  icon: const Icon(Icons.chevron_right),
                  color: tokens.colorMediaOnSurface,
                  tooltip: l10n.storyNext,
                  onPressed: _next,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One story: its media if it has any, and its words.
class _StoryPage extends StatelessWidget {
  const _StoryPage({
    required this.story,
    required this.isCurrent,
    required this.videoStatus,
    required this.videoSurface,
    required this.onRetryVideo,
  });

  final Story story;

  /// PageView builds the neighbours too. Only the current page may show the video surface:
  /// there is one player, and it belongs to whichever story the reader is actually on.
  final bool isCurrent;

  final StoryVideoStatus videoStatus;
  final Widget? videoSurface;
  final Future<void> Function() onRetryVideo;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Column(
      children: [
        Expanded(
          child: Center(
            child: switch (story.mediaKind) {
              StoryMediaKind.image => _ImageStory(url: story.mediaUrl!),
              StoryMediaKind.video => isCurrent
                  ? _VideoStory(
                      status: videoStatus,
                      surface: videoSurface,
                      onRetry: onRetryVideo,
                    )
                  // A neighbour page: no surface, no decoder, no playback.
                  : const _VideoStandby(),
              null => const SizedBox.shrink(),
            },
          ),
        ),
        if (story.title != null || story.body != null)
          Container(
            width: double.infinity,
            // Directional, not physical: the caption block must mirror in Arabic.
            padding: const EdgeInsetsDirectional.fromSTEB(
              Spacing.spacing5,
              Spacing.spacing4,
              Spacing.spacing5,
              Spacing.spacing9,
            ),
            color: tokens.colorMediaScrimStrong,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (story.title != null)
                  Text(
                    story.title!,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: tokens.colorMediaOnSurface,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                if (story.title != null && story.body != null)
                  const SizedBox(height: Spacing.spacing2),
                if (story.body != null)
                  Text(
                    story.body!,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: tokens.colorMediaOnSurface),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// An image story.
///
/// `BoxFit.contain` rather than `cover`: a publication is composed, and cropping somebody's
/// announcement to fill a phone is how the important half ends up off-screen. It also means
/// an unusual aspect ratio letterboxes instead of blowing out the layout.
class _ImageStory extends StatelessWidget {
  const _ImageStory({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Image.network(
      url,
      fit: BoxFit.contain,
      semanticLabel: l10n.storyImageLabel,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Center(
          child: CircularProgressIndicator(
            color: tokens.colorMediaOnSurfaceMuted,
            value: progress.expectedTotalBytes == null
                ? null
                : progress.cumulativeBytesLoaded / progress.expectedTotalBytes!,
          ),
        );
      },
      // A signed URL that lapsed mid-view lands here, as does an object that has been purged.
      // Both are the same thing to a reader: the picture is not coming.
      errorBuilder: (context, error, stack) => _MediaUnavailable(message: l10n.storyMediaFailed),
    );
  }
}

/// A video story, playing inline.
///
/// The frames come from the [StoryVideoPlayer] seam, so this widget names no platform type and
/// holds no controller. It renders whichever state the seam reports: loading, playing, held,
/// or failed with a retry.
class _VideoStory extends StatelessWidget {
  const _VideoStory({
    required this.status,
    required this.surface,
    required this.onRetry,
  });

  final StoryVideoStatus status;
  final Widget? surface;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    if (status.hasFailed) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _MediaUnavailable(message: l10n.storyVideoFailed),
          const SizedBox(height: Spacing.spacing4),
          FilledButton.tonalIcon(
            onPressed: () => onRetry(),
            icon: const Icon(Icons.refresh),
            label: Text(l10n.storyVideoRetry),
          ),
        ],
      );
    }

    final view = surface;
    if (view == null) {
      return Center(
        child: CircularProgressIndicator(color: tokens.colorMediaOnSurfaceMuted),
      );
    }

    return Semantics(
      label: l10n.storyVideoLabel,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // The video's own ratio, so it letterboxes rather than stretching.
          AspectRatio(
            aspectRatio: status.aspectRatio ?? 16 / 9,
            child: view,
          ),
          // Buffering mid-playback: the frames stay, the spinner sits over them.
          if (status.isLoading)
            CircularProgressIndicator(color: tokens.colorMediaOnSurfaceMuted),
          // Held by the reader, or paused by the app going to the background.
          if (status.state == StoryVideoState.paused && status.position > Duration.zero)
            Icon(Icons.pause_circle_filled, size: 56, color: tokens.colorMediaOnSurface),
        ],
      ),
    );
  }
}

/// A video story that is NOT the current page. Deliberately inert: no surface, no decoder.
class _VideoStandby extends StatelessWidget {
  const _VideoStandby();

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    return Icon(Icons.movie_outlined, size: 64, color: tokens.colorMediaOnSurfaceMuted);
  }
}

class _MediaUnavailable extends StatelessWidget {
  const _MediaUnavailable({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.image_not_supported_outlined,
            size: 48, color: tokens.colorMediaOnSurfaceMuted),
        const SizedBox(height: Spacing.spacing3),
        Text(
          message,
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: tokens.colorMediaOnSurfaceMuted),
        ),
      ],
    );
  }
}

/// One segment per story: filled behind, live on the current one, empty ahead.
///
/// The current segment is drawn from whichever clock owns this story — the image animation, or
/// the video's real position. Two mechanisms, one bar.
class _ProgressBar extends StatelessWidget {
  const _ProgressBar({
    required this.count,
    required this.index,
    required this.animation,
    required this.videoFraction,
    required this.isVideo,
  });

  final int count;
  final int index;
  final Animation<double> animation;
  final double? videoFraction;
  final bool isVideo;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    Widget segment(int i) {
      if (i != index) {
        return LinearProgressIndicator(
          value: i < index ? 1 : 0,
          minHeight: 3,
          backgroundColor: tokens.colorMediaOnSurfaceMuted,
          color: tokens.colorMediaOnSurface,
        );
      }
      if (isVideo) {
        // Zero while the duration is unknown: an empty segment is honest, a moving one would
        // be pretending to measure something.
        return LinearProgressIndicator(
          value: videoFraction ?? 0,
          minHeight: 3,
          backgroundColor: tokens.colorMediaOnSurfaceMuted,
          color: tokens.colorMediaOnSurface,
        );
      }
      return AnimatedBuilder(
        animation: animation,
        builder: (context, _) => LinearProgressIndicator(
          value: animation.value,
          minHeight: 3,
          backgroundColor: tokens.colorMediaOnSurfaceMuted,
          color: tokens.colorMediaOnSurface,
        ),
      );
    }

    return PositionedDirectional(
      top: Spacing.spacing3,
      start: Spacing.spacing3,
      end: Spacing.spacing3,
      child: ExcludeSemantics(
        // Decorative: the same information reaches a screen reader through the rail's
        // viewed/unviewed labels and the previous/next buttons.
        child: Row(
          children: [
            for (var i = 0; i < count; i++)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.all(Radii.radiusFull),
                    child: segment(i),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Shown when the viewer was opened for a story that is no longer in the feed — a deep link
/// to something that has since expired, most likely.
class _UnavailableScaffold extends StatelessWidget {
  const _UnavailableScaffold({required this.message, required this.onClose});

  final String message;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Scaffold(
      backgroundColor: tokens.colorMediaSurface,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _MediaUnavailable(message: message),
              const SizedBox(height: Spacing.spacing4),
              TextButton(onPressed: onClose, child: Text(l10n.storyClose)),
            ],
          ),
        ),
      ),
    );
  }
}
