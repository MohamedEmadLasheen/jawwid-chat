import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/audio/voice_player.dart';
import '../../../core/media/story_video_player.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/materials.dart';
import '../data/materials_repository.dart';
import 'activity_view.dart';

/// PD-29: open one library item. The server's `open` is the access decision and
/// returns a short-lived URL with the one presentation to use:
///
///  * frame-isolated (an uploaded package) -> full screen behind
///    [ActivityViewFactory], pinned to its play prefix; never handed to the
///    browser (its URL carries a play token);
///  * frame-site (a lesson of the lessons site, an allowlisted link) -> full
///    screen behind [ActivityViewFactory], pinned to its host;
///  * browser (any other link) -> handed to the browser, never embedded;
///  * file: audio and video in-app, a picture full screen, a PDF handed to the
///    phone (the attachment rule).
///
/// With [learnerId] the opening is recorded for that child (their "Opened this week").
Future<void> openMaterial(BuildContext context, String itemId, {required String title, String? learnerId}) {
  return Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(
    builder: (_) => MaterialPlayerScreen(title: title, load: (repo) => repo.open(itemId, learnerId: learnerId)),
  ));
}

/// Play a surah's recitation from the academy's authorized source.
Future<void> playRecitation(BuildContext context, int surah, {required String title}) {
  return Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(
    builder: (_) => MaterialPlayerScreen(
      title: title,
      load: (repo) async => OpenedMaterial(kind: 'audio', mode: 'file', presentation: MaterialPresentation.file, url: await repo.recitation(surah)),
    ),
  ));
}

class MaterialPlayerScreen extends ConsumerStatefulWidget {
  const MaterialPlayerScreen({super.key, required this.title, required this.load});

  final String title;
  final Future<OpenedMaterial> Function(MaterialsRepository repo) load;

  @override
  ConsumerState<MaterialPlayerScreen> createState() => _MaterialPlayerScreenState();
}

class _MaterialPlayerScreenState extends ConsumerState<MaterialPlayerScreen> {
  OpenedMaterial? _opened;
  Object? _error;
  bool _handedOver = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    try {
      final opened = await widget.load(ref.read(materialsRepositoryProvider));
      if (!mounted) return;
      final handOver = opened.presentation == MaterialPresentation.browser
          || (opened.presentation == MaterialPresentation.file && opened.kind == 'pdf');
      if (handOver) {
        // A link off the frame allowlist goes to the browser; a document to
        // whatever on the phone opens documents.
        final ok = await ref.read(attachmentOpenerProvider).open(opened.url);
        if (!mounted) return;
        if (ok) {
          Navigator.of(context).pop();
          return;
        }
        setState(() => _handedOver = true);
        return;
      }
      setState(() => _opened = opened);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final opened = _opened;
    // A lesson may be opened in the browser too; a package never (its play token).
    final mayOpenOutside = opened != null && opened.presentation == MaterialPresentation.frameSite;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (mayOpenOutside)
            IconButton(
              tooltip: l10n.materialsOpenExternally,
              icon: const Icon(Icons.open_in_browser),
              onPressed: () => ref.read(attachmentOpenerProvider).open(opened.url),
            ),
        ],
      ),
      body: switch ((opened, _error, _handedOver)) {
        (_, final Object _, _) => JawwidErrorView(title: l10n.materialsUnavailable),
        (_, _, true) => JawwidErrorView(title: l10n.materialsCannotOpen),
        (null, _, _) => const JawwidLoadingView(),
        (final OpenedMaterial o, _, _) when o.presentation == MaterialPresentation.frameIsolated => ref
            .watch(activityViewFactoryProvider)
            .build(context, url: o.url, sandbox: sandboxIsolated, allow: activityAllowance(o.url, isPackage: true)),
        (final OpenedMaterial o, _, _) when o.presentation == MaterialPresentation.frameSite => ref
            .watch(activityViewFactoryProvider)
            .build(context, url: o.url, sandbox: sandboxSite, allow: activityAllowance(o.url, isPackage: false)),
        (final OpenedMaterial o, _, _) when o.kind == 'audio' => _AudioBody(url: o.url),
        (final OpenedMaterial o, _, _) when o.kind == 'video' => _VideoBody(url: o.url),
        (final OpenedMaterial o, _, _) when o.kind == 'image' => InteractiveViewer(
            child: Center(
              child: Image.network(o.url, errorBuilder: (_, _, _) => JawwidErrorView(title: l10n.materialsPlayFailed)),
            ),
          ),
        (_, _, _) => JawwidErrorView(title: l10n.materialsCannotOpen),
      },
    );
  }
}

/// An audio item or a recitation: play / pause and a position slider. The
/// player belongs to this screen and is disposed with it.
class _AudioBody extends ConsumerStatefulWidget {
  const _AudioBody({required this.url});

  final String url;

  @override
  ConsumerState<_AudioBody> createState() => _AudioBodyState();
}

class _AudioBodyState extends ConsumerState<_AudioBody> {
  late final VoicePlayer _player = ref.read(storyVoicePlayerFactoryProvider)();
  StreamSubscription<VoicePlaybackStatus>? _sub;
  VoicePlaybackStatus _status = const VoicePlaybackStatus();

  @override
  void initState() {
    super.initState();
    _sub = _player.status.listen((s) {
      if (mounted) setState(() => _status = s);
    });
    unawaited(_player.load(widget.url).then((_) => _player.play()).catchError((_) {}));
  }

  @override
  void dispose() {
    // Not awaited: cancelling a broadcast subscription can wait for the stream to close.
    unawaited(_sub?.cancel());
    unawaited(_player.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    if (_status.hasFailed) return JawwidErrorView(title: l10n.materialsPlayFailed);
    final total = _status.duration ?? Duration.zero;
    final position = _status.position > total ? total : _status.position;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.headphones_outlined, size: 72),
            const SizedBox(height: Spacing.spacing5),
            Slider(
              value: total.inMilliseconds == 0 ? 0 : position.inMilliseconds / total.inMilliseconds,
              onChanged: total.inMilliseconds == 0
                  ? null
                  : (v) => _player.seek(Duration(milliseconds: (v * total.inMilliseconds).round())),
            ),
            IconButton.filled(
              key: const ValueKey('material-audio-toggle'),
              iconSize: 40,
              onPressed: _status.isLoading ? null : () => _status.isPlaying ? _player.pause() : _player.play(),
              icon: Icon(_status.isPlaying ? Icons.pause : Icons.play_arrow),
            ),
          ],
        ),
      ),
    );
  }
}

class _VideoBody extends ConsumerStatefulWidget {
  const _VideoBody({required this.url});

  final String url;

  @override
  ConsumerState<_VideoBody> createState() => _VideoBodyState();
}

class _VideoBodyState extends ConsumerState<_VideoBody> {
  late final StoryVideoPlayer _player = ref.read(storyVideoPlayerFactoryProvider)();
  StreamSubscription<StoryVideoStatus>? _sub;
  StoryVideoStatus _status = const StoryVideoStatus();

  @override
  void initState() {
    super.initState();
    _sub = _player.status.listen((s) {
      if (mounted) setState(() => _status = s);
    });
    unawaited(_player.load(widget.url).then((_) => _player.play()).catchError((_) {}));
  }

  @override
  void dispose() {
    unawaited(_sub?.cancel());
    unawaited(_player.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    if (_status.hasFailed) return JawwidErrorView(title: l10n.materialsPlayFailed);
    final surface = _player.surface;
    return Column(
      children: [
        Expanded(
          child: Center(
            child: surface == null
                ? const CircularProgressIndicator()
                : AspectRatio(aspectRatio: _status.aspectRatio ?? 16 / 9, child: surface),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(Spacing.spacing4),
          child: IconButton.filled(
            iconSize: 36,
            onPressed: () => _status.isPlaying ? _player.pause() : _player.play(),
            icon: Icon(_status.isPlaying ? Icons.pause : Icons.play_arrow),
          ),
        ),
      ],
    );
  }
}
