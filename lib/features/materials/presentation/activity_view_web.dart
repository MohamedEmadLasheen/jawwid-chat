import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import '../data/lesson_audio.dart';
import 'activity_view.dart';

/// In a browser (PD-28's web build) an activity plays in an <iframe> with the
/// exact sandbox the server's presentation calls for:
///   a package  -> "allow-scripts allow-forms" (never same-origin; its URL carries
///                 a play token, so it is never a top-level tab)
///   a lesson   -> "allow-scripts allow-same-origin allow-forms" (its own origin)
/// with no referrer, and no camera, microphone or geolocation. The page's CSP
/// (frame-src) names exactly the origins that may be framed.
ActivityViewFactory createActivityViewFactory() => const _IframeActivityFactory();

class _IframeActivityFactory implements ActivityViewFactory {
  const _IframeActivityFactory();

  @override
  Widget build(BuildContext context,
          {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio}) =>
      _ActivityFrame(url: url, sandbox: sandbox, audio: audio);
}

class _ActivityFrame extends StatefulWidget {
  const _ActivityFrame({required this.url, required this.sandbox, this.audio});

  final String url;
  final String sandbox;
  final Future<Map<String, Object?>?>? audio;

  @override
  State<_ActivityFrame> createState() => _ActivityFrameState();
}

class _ActivityFrameState extends State<_ActivityFrame> {
  static int _next = 0;
  late final String _viewType = 'pd29-activity-${_next++}';
  web.HTMLIFrameElement? _frame;
  Map<String, Object?>? _message;
  JSFunction? _onReady;
  bool _disposed = false;

  /// The audio list, to the frame's window and the lesson's exact origin only.
  void _post() {
    final frame = _frame;
    final message = _message;
    if (_disposed || frame == null || message == null) return;
    frame.contentWindow?.postMessage(message.jsify(), Uri.parse(widget.url).origin.toJS);
  }

  @override
  void initState() {
    super.initState();
    final audio = widget.audio;
    if (audio != null) {
      audio.then((m) {
        _message = m;
        _post();
      }, onError: (Object _) {});
      // The lesson says it is ready: hand it the list again (it may have loaded first).
      _onReady = ((web.MessageEvent e) {
        final data = e.data.dartify();
        final fromFrame = e.source != null && e.source!.strictEquals(_frame?.contentWindow).toDart;
        // A Quran lesson says ready with its surah, a letters lesson (PD-48) with its lesson key.
        if (fromFrame && e.origin == Uri.parse(widget.url).origin && readyFor(data, widget.url)) _post();
      }).toJS;
      web.window.addEventListener('message', _onReady);
    }
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int _) {
      final frame = _frame = web.HTMLIFrameElement()
        ..src = widget.url
        ..referrerPolicy = 'no-referrer'
        ..allow = 'autoplay; fullscreen';
      frame.setAttribute('sandbox', widget.sandbox);
      frame.addEventListener('load', ((web.Event _) => _post()).toJS);
      frame.style
        ..border = '0'
        ..width = '100%'
        ..height = '100%';
      return frame;
    });
  }

  @override
  void dispose() {
    _disposed = true;
    if (_onReady != null) web.window.removeEventListener('message', _onReady);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewType);
}
