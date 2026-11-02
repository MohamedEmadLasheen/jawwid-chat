import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/media/story_video_player.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';

/// CHATSCHED-010: a video sent in a chat plays HERE, in the app -- with a
/// seek bar -- rather than being handed to Safari, which could not play it
/// (the media route's CSP is `default-src 'none'`, right for a document and
/// wrong for a browser's media page) and which showed the signed URL in its
/// address bar. The platform player (AVPlayer, ExoPlayer) is not a browser:
/// the CSP does not apply to it, it asks the media route for byte ranges as it
/// seeks (#339), and the URL never appears on screen.
///
/// The same player seam as stories (`storyVideoPlayerFactoryProvider`): one
/// player per screen, released when the screen goes.
Future<void> showChatVideo(BuildContext context, {required String url, String? title}) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ChatVideoScreen(url: url, title: title)));

class ChatVideoScreen extends ConsumerStatefulWidget {
  const ChatVideoScreen({super.key, required this.url, this.title});

  final String url;
  final String? title;

  @override
  ConsumerState<ChatVideoScreen> createState() => _ChatVideoScreenState();
}

class _ChatVideoScreenState extends ConsumerState<ChatVideoScreen> {
  late final StoryVideoPlayer _player = ref.read(storyVideoPlayerFactoryProvider)();
  StreamSubscription<StoryVideoStatus>? _sub;
  StoryVideoStatus _status = const StoryVideoStatus();

  /// While a finger is on the seek bar, where it is (the player is told on release).
  double? _dragging;

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

  static String _clock(Duration d) =>
      '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final surface = _player.surface;
    final total = _status.duration;
    final at = _dragging != null && total != null
        ? Duration(milliseconds: (_dragging! * total.inMilliseconds).round())
        : _status.position;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title ?? l10n.attachmentVideoLabel),
      ),
      body: _status.hasFailed
          ? JawwidErrorView(title: l10n.storyVideoFailed)
          : Column(
              children: [
                Expanded(
                  child: Center(
                    child: surface == null
                        ? const CircularProgressIndicator(color: Colors.white)
                        : AspectRatio(aspectRatio: _status.aspectRatio ?? 16 / 9, child: surface),
                  ),
                ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      children: [
                        IconButton(
                          key: const ValueKey('chat-video-play'),
                          color: Colors.white,
                          iconSize: 32,
                          onPressed: () => _status.isPlaying ? _player.pause() : _player.play(),
                          icon: Icon(_status.isPlaying ? Icons.pause : Icons.play_arrow),
                        ),
                        Text(_clock(at), style: const TextStyle(color: Colors.white)),
                        Expanded(
                          child: Slider(
                            key: const ValueKey('chat-video-seek'),
                            value: (_dragging ?? _status.fraction ?? 0).clamp(0.0, 1.0),
                            onChanged: total == null ? null : (v) => setState(() => _dragging = v),
                            onChangeEnd: total == null
                                ? null
                                : (v) {
                                    setState(() => _dragging = null);
                                    unawaited(_player.seek(Duration(milliseconds: (v * total.inMilliseconds).round())));
                                  },
                          ),
                        ),
                        Text(total == null ? '--:--' : _clock(total), style: const TextStyle(color: Colors.white)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
