import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/media/attachment_opener.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';

/// The full-screen story viewer.
///
/// ## How it advances
///
/// One [AnimationController] drives both the progress bar and the auto-advance, and there is
/// deliberately no [Timer] anywhere in this file. A controller is disposed with the State, so
/// it cannot outlive the screen; a stray timer is exactly how a closed viewer keeps ticking
/// and pushes a route onto a widget tree that has moved on.
///
/// Images advance on their own. A video does NOT: this client cannot play one (see
/// [_VideoStoryPanel]), so it has no idea when playback would finish, and auto-advancing past
/// a video the reader is about to open would be worse than waiting.
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

  /// How long an image story stays on screen before advancing.
  static const imageDuration = Duration(seconds: 5);

  /// Fraction of the width each edge tap zone occupies, leaving the middle to the page.
  static const tapZoneFraction = 0.28;

  @override
  ConsumerState<StoryViewerScreen> createState() => _StoryViewerScreenState();
}

class _StoryViewerScreenState extends ConsumerState<StoryViewerScreen>
    with SingleTickerProviderStateMixin {
  late final PageController _pages;
  late final AnimationController _progress;

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

  @override
  void initState() {
    super.initState();
    _pages = PageController();
    _progress = AnimationController(vsync: this, duration: StoryViewerScreen.imageDuration)
      ..addStatusListener(_onProgressStatus);
  }

  /// Take the feed as it stands, and start on the requested story.
  ///
  /// Called from `build` and so must not call setState: the fields it sets are read by the
  /// same build pass. The side effects that CANNOT happen during build -- jumping the page
  /// controller, recording the view, leaving -- are deferred to after the frame.
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
      if (_index != 0 && _pages.hasClients) _pages.jumpToPage(_index);
      _enter(_index);
    });
  }

  @override
  void dispose() {
    _progress.removeStatusListener(_onProgressStatus);
    _progress.dispose();
    _pages.dispose();
    super.dispose();
  }

  void _onProgressStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) _next();
  }

  /// Arrive on a story: record the view, and start the clock if it is an image.
  Future<void> _enter(int index) async {
    final story = index < _stories.length ? _stories[index] : null;
    if (story == null) return;

    _progress.stop();
    _progress.value = 0;

    // A story that lapsed while the reader was on an earlier page. Skip the round trip the
    // server would refuse and leave, so nobody stares at a picture that is already over.
    if (story.isExpiredAt(DateTime.now())) {
      _leave(refresh: true);
      return;
    }

    if (story.mediaKind == StoryMediaKind.image || !story.hasMedia) {
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

  void _next() {
    if (_index >= _stories.length - 1) {
      _leave();
      return;
    }
    _pages.nextPage(duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
  }

  void _previous() {
    if (_index == 0) {
      // Restart the current story rather than leaving. Leaving on a back-tap at the first
      // story is how a reader loses their place by mistiming a tap.
      _progress
        ..stop()
        ..value = 0
        ..forward();
      return;
    }
    _pages.previousPage(duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
  }

  /// Close the viewer. `refresh` when the reason was the server refusing a story, so the rail
  /// comes back without it.
  void _leave({bool refresh = false}) {
    if (_leaving) return;
    _leaving = true;
    _progress.stop();
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
              onLongPressStart: (_) => _progress.stop(),
              onLongPressEnd: (_) {
                if (!_progress.isAnimating && _progress.value < 1) _progress.forward();
              },
              child: PageView.builder(
                controller: _pages,
                itemCount: _stories.length,
                onPageChanged: (index) {
                  setState(() => _index = index);
                  _enter(index);
                },
                itemBuilder: (context, index) => _StoryPage(story: _stories[index]),
              ),
            ),

            // Tap zones along the two EDGES, not two full-width halves.
            //
            // Halves were the first version and they were wrong: an invisible pane covering
            // the whole screen swallows every tap meant for the page, so the "open video"
            // button could not be pressed at all. A test caught it. Edges also mean a tap on
            // a caption does not advance the story, which is what a reader expects when they
            // are still reading it.
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
  const _StoryPage({required this.story});

  final Story story;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Column(
      children: [
        Expanded(
          child: Center(
            child: switch (story.mediaKind) {
              StoryMediaKind.image => _ImageStory(url: story.mediaUrl!),
              StoryMediaKind.video => _VideoStoryPanel(url: story.mediaUrl!),
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

/// A video story.
///
/// THIS APP HAS NO VIDEO PLAYER, and this panel is the honest consequence rather than a
/// placeholder. `MessageKind.video` is grouped with `MessageKind.file` everywhere in this
/// client — the chat labels it as an attachment, the media screen files it under Files, and
/// `MediaViewer` renders photos only. Story video follows the same established convention:
/// hand it to whatever on the phone plays video, through the same [AttachmentOpener] seam
/// attachments already use.
///
/// It is not a dead control: the button works, and when nothing on the device can open the
/// URL the opener says so and the reader is told. Adding `video_player` would mean a new
/// dependency, iOS and Android platform configuration and a new media architecture for one
/// story kind — which belongs in its own change, with its own tests, not smuggled in here.
class _VideoStoryPanel extends ConsumerStatefulWidget {
  const _VideoStoryPanel({required this.url});

  final String url;

  @override
  ConsumerState<_VideoStoryPanel> createState() => _VideoStoryPanelState();
}

class _VideoStoryPanelState extends ConsumerState<_VideoStoryPanel> {
  bool _opening = false;
  bool _failed = false;

  Future<void> _open() async {
    if (_opening) return;
    setState(() {
      _opening = true;
      _failed = false;
    });
    bool ok = false;
    try {
      ok = await ref.read(attachmentOpenerProvider).open(widget.url);
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    setState(() {
      _opening = false;
      _failed = !ok;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.play_circle_outline, size: 64, color: tokens.colorMediaOnSurfaceMuted),
        const SizedBox(height: Spacing.spacing4),
        Text(
          l10n.storyVideoTitle,
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: tokens.colorMediaOnSurface),
        ),
        const SizedBox(height: Spacing.spacing3),
        FilledButton.tonalIcon(
          onPressed: _opening ? null : _open,
          icon: const Icon(Icons.open_in_new),
          label: Text(l10n.storyVideoOpen),
        ),
        if (_failed)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing3),
            child: Text(
              l10n.storyVideoOpenFailed,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: tokens.colorMediaOnSurfaceMuted),
            ),
          ),
      ],
    );
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

/// One segment per story: filled behind, animating on the current one, empty ahead.
class _ProgressBar extends StatelessWidget {
  const _ProgressBar({
    required this.count,
    required this.index,
    required this.animation,
  });

  final int count;
  final int index;
  final Animation<double> animation;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

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
                    child: i == index
                        ? AnimatedBuilder(
                            animation: animation,
                            builder: (context, _) => LinearProgressIndicator(
                              value: animation.value,
                              minHeight: 3,
                              backgroundColor: tokens.colorMediaOnSurfaceMuted,
                              color: tokens.colorMediaOnSurface,
                            ),
                          )
                        : LinearProgressIndicator(
                            value: i < index ? 1 : 0,
                            minHeight: 3,
                            backgroundColor: tokens.colorMediaOnSurfaceMuted,
                            color: tokens.colorMediaOnSurface,
                          ),
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
