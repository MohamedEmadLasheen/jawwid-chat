import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

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
  Widget build(BuildContext context, {required String url, required String sandbox, required bool Function(Uri uri) allow}) =>
      _ActivityFrame(url: url, sandbox: sandbox);
}

class _ActivityFrame extends StatefulWidget {
  const _ActivityFrame({required this.url, required this.sandbox});

  final String url;
  final String sandbox;

  @override
  State<_ActivityFrame> createState() => _ActivityFrameState();
}

class _ActivityFrameState extends State<_ActivityFrame> {
  static int _next = 0;
  late final String _viewType = 'pd29-activity-${_next++}';

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int _) {
      final frame = web.HTMLIFrameElement()
        ..src = widget.url
        ..referrerPolicy = 'no-referrer'
        ..allow = 'autoplay; fullscreen';
      frame.setAttribute('sandbox', widget.sandbox);
      frame.style
        ..border = '0'
        ..width = '100%'
        ..height = '100%';
      return frame;
    });
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewType);
}
