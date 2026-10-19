import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/audio/voice_player.dart';
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/media/story_video_player.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';
import 'story_backgrounds.dart';

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
/// A VOICE story (2026-10-17) is the same as a video in every way that matters here: it has
/// its own length, so it advances on playback completion through the [VoicePlayer] seam, and
/// its segment is real position over real duration. A TEXT story is timed like an image.
///
/// ## No caption, and one button
///
/// A story has no title and no caption (owner rule, 2026-10-17): a text story IS its words,
/// on its background; a photo, video or voice story shows no words at all. A story may carry
/// one button -- WhatsApp, a link, or "message the publisher" -- which the server resolves on
/// tap ([StoriesController.tapCta]); nothing here builds an address.
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

  /// The voice story player: owned here for the same reason as [_video].
  late final VoicePlayer _voice;
  StreamSubscription<VoicePlaybackStatus>? _voiceSub;
  VoicePlaybackStatus _voiceStatus = const VoicePlaybackStatus();

  /// True while a button tap is with the server, so a second tap does not send a second one.
  bool _ctaBusy = false;

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
    _voice = ref.read(storyVoicePlayerFactoryProvider)();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    // Order matters: stop listening before tearing anything down, so no final event can call
    // back into a half-disposed State.
    WidgetsBinding.instance.removeObserver(this);
    _cancelVideoSub();
    _cancelVoiceSub();
    _progress.removeStatusListener(_onProgressStatus);
    _progress.dispose();
    unawaited(_video.dispose());
    unawaited(_voice.dispose());
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
  bool get _currentIsVoice => _current?.mediaKind == StoryMediaKind.audio;

  void _onProgressStatus(AnimationStatus status) {
    // Images and text-only stories. A video's controller is never started, so this cannot fire
    // for one.
    if (status == AnimationStatus.completed) _advanceFrom(_index);
  }

  void _pauseCurrent() {
    _progress.stop();
    if (_currentIsVideo) unawaited(_video.pause());
    if (_currentIsVoice) unawaited(_voice.pause());
  }

  void _resumeCurrent() {
    if (_leaving || !mounted) return;
    if (_currentIsVideo) {
      if (!_videoStatus.isCompleted && !_videoStatus.hasFailed) unawaited(_video.play());
      return;
    }
    if (_currentIsVoice) {
      final state = _voiceStatus.state;
      if (state != VoicePlaybackState.completed && state != VoicePlaybackState.failed) {
        unawaited(_voice.play());
      }
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
    _cancelVoiceSub();
    if (!mounted) return;
    setState(() {
      _videoStatus = const StoryVideoStatus();
      _voiceStatus = const VoicePlaybackStatus();
    });

    // A story that lapsed while the reader was on an earlier page. Skip the round trip the
    // server would refuse and leave, so nobody stares at a picture that is already over.
    if (story.isExpiredAt(DateTime.now())) {
      _leave(refresh: true);
      return;
    }

    if (story.mediaKind == StoryMediaKind.video && story.mediaUrl != null) {
      await _voice.stop();
      await _startVideo(index, story.mediaUrl!);
    } else if (story.mediaKind == StoryMediaKind.audio && story.mediaUrl != null) {
      await _video.stop();
      await _startVoice(index, story.mediaUrl!);
    } else {
      // An image, or words only: a fixed length is the only sensible one. Release any player
      // still held from a previous story so no decoder lingers.
      await _video.stop();
      await _voice.stop();
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

  /// The same, for the voice player -- and for the same reason: never awaited.
  void _cancelVoiceSub() {
    unawaited(_voiceSub?.cancel());
    _voiceSub = null;
  }

  Future<void> _startVoice(int index, String url) async {
    _cancelVoiceSub();
    _voiceSub = _voice.status.listen((status) {
      if (!mounted) return;
      setState(() => _voiceStatus = status);
      // THE advance for a voice story: its own playback finishing, never a timer.
      if (status.state == VoicePlaybackState.completed) _advanceFrom(index);
    });

    await _voice.load(url);
    if (!mounted || _index != index || _leaving) return;
    // A note that failed to load stays failed: playing it would overwrite the failure with
    // "playing", and the reader would get a silent story instead of a retry.
    if (_voiceStatus.hasFailed) return;
    await _voice.play();
  }

  /// Retry a voice note that failed to load.
  Future<void> _retryVoice() async {
    final url = _current?.mediaUrl;
    if (url == null) return;
    final index = _index;
    _cancelVoiceSub();
    if (!mounted) return;
    setState(() => _voiceStatus = const VoicePlaybackStatus(state: VoicePlaybackState.loading));
    await _voice.stop();
    if (!mounted || _index != index || _leaving) return;
    await _startVoice(index, url);
  }

  /// The play/pause control on a voice story. A deliberate pause is a hold, like a long press.
  void _toggleVoice() {
    if (!_currentIsVoice) return;
    if (_voiceStatus.isPlaying) {
      _held = true;
      unawaited(_voice.pause());
    } else {
      _held = false;
      _resumeCurrent();
    }
  }

  /// The reader tapped the story's button.
  ///
  /// The server records the tap and answers where to go. A link or WhatsApp opens outside the
  /// app; "message the publisher" replaces this viewer with the conversation the server just
  /// opened, so Back returns to the chats rather than to a story half-way through.
  Future<void> _onCta(Story story) async {
    if (_ctaBusy || _leaving) return;
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final router = GoRouter.maybeOf(context);
    setState(() => _ctaBusy = true);
    _pauseCurrent();

    final result = await ref.read(storiesControllerProvider.notifier).tapCta(story.id);
    if (!mounted) return;
    setState(() => _ctaBusy = false);

    final error = result.error;
    if (error != null) {
      if (WireErrors.storyGone.contains(error.code)) {
        _leave(refresh: true);
        return;
      }
      messenger?.showSnackBar(SnackBar(content: Text(l10n.storyCtaFailed)));
      _resumeCurrent();
      return;
    }

    final tap = result.tap!;
    final conversationId = tap.conversationId;
    if (conversationId != null && router != null) {
      _leaving = true;
      _progress.stop();
      _cancelVideoSub();
      _cancelVoiceSub();
      unawaited(_video.pause());
      unawaited(_voice.pause());
      unawaited(router.pushReplacement(Routes.conversation(conversationId)));
      return;
    }

    final url = tap.url ?? story.cta?.url;
    final opened = url != null && await ref.read(attachmentOpenerProvider).open(url);
    if (!mounted) return;
    if (!opened) messenger?.showSnackBar(SnackBar(content: Text(l10n.storyCtaFailed)));
    // Back from WhatsApp or the browser: the story picks up where it was, unless held.
    if (!_held) _resumeCurrent();
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
      } else if (_currentIsVoice) {
        unawaited(_voice.seek(Duration.zero).then((_) => _resumeCurrent()));
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
    _cancelVoiceSub();
    unawaited(_video.pause());
    unawaited(_voice.pause());
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
                  // Which story is on screen, by id: a photo, video or voice story has no
                  // words to find it by.
                  key: ValueKey('story-page-${_stories[index].id}'),
                  story: _stories[index],
                  isCurrent: index == _index,
                  videoStatus: _videoStatus,
                  videoSurface: _video.surface,
                  onRetryVideo: _retryVideo,
                  voiceStatus: _voiceStatus,
                  onToggleVoice: _toggleVoice,
                  onRetryVoice: _retryVoice,
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
              videoFraction: _currentIsVideo
                  ? _videoStatus.fraction
                  : _currentIsVoice
                      ? _voiceFraction(_voiceStatus, _current?.mediaDuration)
                      : null,
              isVideo: _currentIsVideo || _currentIsVoice,
            ),

            // The story's one button, centred above the previous/next row. The edge tap zones
            // leave the middle free, so it is always pressable.
            if (_current?.cta case final cta?)
              PositionedDirectional(
                start: Spacing.spacing9,
                end: Spacing.spacing9,
                bottom: Spacing.spacing9,
                child: Center(
                  child: _StoryCtaButton(
                    key: ValueKey('story-cta-${_current!.id}'),
                    cta: cta,
                    busy: _ctaBusy,
                    onPressed: () => _onCta(_current!),
                  ),
                ),
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

/// A voice story's segment: real position over the real duration, or over the length the
/// upload reported while the player does not know yet. Null (an empty segment) when neither
/// is known -- an honest blank rather than a guess.
double? _voiceFraction(VoicePlaybackStatus status, Duration? hinted) {
  final total = status.duration ?? hinted;
  if (total == null || total <= Duration.zero) return null;
  if (status.state == VoicePlaybackState.completed) return 1;
  return (status.position.inMilliseconds / total.inMilliseconds).clamp(0, 1).toDouble();
}

/// One story, by kind. Never a caption: a text story is its words, and nothing else shows
/// any.
class _StoryPage extends StatelessWidget {
  const _StoryPage({
    super.key,
    required this.story,
    required this.isCurrent,
    required this.videoStatus,
    required this.videoSurface,
    required this.onRetryVideo,
    required this.voiceStatus,
    required this.onToggleVoice,
    required this.onRetryVoice,
  });

  final Story story;

  /// PageView builds the neighbours too. Only the current page may show the video surface or
  /// the live voice state: there is one player of each, and it belongs to whichever story the
  /// reader is actually on.
  final bool isCurrent;

  final StoryVideoStatus videoStatus;
  final Widget? videoSurface;
  final Future<void> Function() onRetryVideo;
  final VoicePlaybackStatus voiceStatus;
  final VoidCallback onToggleVoice;
  final Future<void> Function() onRetryVoice;

  @override
  Widget build(BuildContext context) {
    return switch (story.mediaKind) {
      StoryMediaKind.image => Center(child: _ImageStory(url: story.mediaUrl!)),
      StoryMediaKind.video => Center(
          child: isCurrent
              ? _VideoStory(status: videoStatus, surface: videoSurface, onRetry: onRetryVideo)
              // A neighbour page: no surface, no decoder, no playback.
              : const _VideoStandby(),
        ),
      StoryMediaKind.audio => _VoiceStory(
          background: story.background,
          status: isCurrent ? voiceStatus : const VoicePlaybackStatus(),
          hintedDuration: story.mediaDuration,
          onToggle: onToggleVoice,
          onRetry: onRetryVoice,
        ),
      // Words only. A legacy story whose media was purged and had no words reaches here with
      // an empty body; it shows its background rather than a blank.
      null => _TextStory(body: story.body ?? '', background: story.background),
    };
  }
}

/// A text story: its words, centred, on its background. Long words get a smaller face.
class _TextStory extends StatelessWidget {
  const _TextStory({required this.body, required this.background});

  final String body;
  final String? background;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final length = body.trim().length;
    final size = length <= 40
        ? 30.0
        : length <= 120
            ? 24.0
            : length <= 300
                ? 19.0
                : 16.0;

    return DecoratedBox(
      decoration: BoxDecoration(gradient: storyBackground(background)),
      child: Center(
        child: SingleChildScrollView(
          // Room above for the progress bar and close button, below for the button and the
          // previous/next row.
          padding: const EdgeInsetsDirectional.fromSTEB(
            Spacing.spacing6,
            Spacing.spacing9,
            Spacing.spacing6,
            Spacing.spacing9 * 2,
          ),
          child: Semantics(
            label: l10n.storyTextLabel,
            child: Text(
              body,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: StoryPalette.onStory,
                    fontSize: size,
                    fontWeight: FontWeight.w600,
                    height: 1.4,
                  ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A voice story: a large play/pause control over its background, and its time.
class _VoiceStory extends StatelessWidget {
  const _VoiceStory({
    required this.background,
    required this.status,
    required this.hintedDuration,
    required this.onToggle,
    required this.onRetry,
  });

  final String? background;
  final VoicePlaybackStatus status;
  final Duration? hintedDuration;
  final VoidCallback onToggle;
  final Future<void> Function() onRetry;

  String _clock(Duration d) {
    final m = d.inMinutes;
    final s = d.inSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final total = status.duration ?? hintedDuration;
    final shown = status.position > Duration.zero ? status.position : (total ?? Duration.zero);

    return DecoratedBox(
      decoration: BoxDecoration(gradient: storyBackground(background)),
      child: Center(
        child: status.hasFailed
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _MediaUnavailable(message: l10n.storyVoiceFailed),
                  const SizedBox(height: Spacing.spacing4),
                  FilledButton.tonalIcon(
                    onPressed: () => onRetry(),
                    icon: const Icon(Icons.refresh),
                    label: Text(l10n.storyVideoRetry),
                  ),
                ],
              )
            : Semantics(
                label: l10n.storyVoiceLabel,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox.square(
                      dimension: 96,
                      child: status.isLoading
                          ? const CircularProgressIndicator(color: StoryPalette.onStory)
                          : IconButton.filledTonal(
                              iconSize: 48,
                              onPressed: onToggle,
                              tooltip: status.isPlaying ? l10n.storyVoicePause : l10n.storyVoicePlay,
                              icon: Icon(status.isPlaying ? Icons.pause : Icons.play_arrow),
                            ),
                    ),
                    const SizedBox(height: Spacing.spacing5),
                    // Time is an LTR run in both languages.
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        _clock(shown),
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              color: StoryPalette.onStory,
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// The story's one button: white, rounded, the publisher's words or the default for its kind.
class _StoryCtaButton extends StatelessWidget {
  const _StoryCtaButton({super.key, required this.cta, required this.busy, required this.onPressed});

  final StoryCta cta;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final label = cta.label ??
        switch (cta.kind) {
          StoryCtaKind.whatsapp => l10n.storyCtaWhatsApp,
          StoryCtaKind.messagePublisher => l10n.storyCtaMessage,
          StoryCtaKind.link => l10n.storyCtaLink,
        };
    final icon = switch (cta.kind) {
      StoryCtaKind.whatsapp => Icons.chat,
      StoryCtaKind.messagePublisher => Icons.mode_comment_outlined,
      StoryCtaKind.link => Icons.open_in_new,
    };

    return FilledButton.icon(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: StoryPalette.ctaSurface,
        foregroundColor: StoryPalette.ctaForeground,
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
        shape: const StadiumBorder(),
      ),
      icon: busy
          ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(icon, size: 18),
      label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
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
