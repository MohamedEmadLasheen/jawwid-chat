import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

// A new window (target=_blank, window.open) is never opened: no onCreateWindow
// handler is installed, so the WebView drops it.

import '../data/lesson_audio.dart';
import 'activity_view.dart';

ActivityViewFactory createActivityViewFactory() => const _WebViewActivityFactory();

class _WebViewActivityFactory implements ActivityViewFactory {
  const _WebViewActivityFactory();

  @override
  Widget build(BuildContext context,
          {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio}) =>
      _ActivityWebView(url: url, allow: allow, audio: audio);
}

class _ActivityWebView extends StatefulWidget {
  const _ActivityWebView({required this.url, required this.allow, this.audio});

  final String url;
  final bool Function(Uri uri) allow;
  final Future<Map<String, Object?>?>? audio;

  @override
  State<_ActivityWebView> createState() => _ActivityWebViewState();
}

class _ActivityWebViewState extends State<_ActivityWebView> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final uri = Uri.tryParse(request.url);
        // A frame the page embeds (a player, about:blank) is its own business;
        // the page itself never leaves its prefix or host.
        if (!request.isMainFrame) return NavigationDecision.navigate;
        return uri != null && widget.allow(uri) ? NavigationDecision.navigate : NavigationDecision.prevent;
      },
      onPageFinished: (_) => unawaited(_handAudio()),
    ))
    ..loadRequest(Uri.parse(widget.url));

  /// The audio list, injected as a `message` event the page receives from its
  /// own origin (there is no JavaScript channel back to the app). JSON is a
  /// JavaScript literal, so the data cannot become code. The lesson keeps a
  /// message that arrives before it has mounted.
  Future<void> _handAudio() async {
    final message = await widget.audio?.catchError((Object _) => null);
    if (message == null || !mounted) return;
    // To the lesson this view was opened on, and only while the page is still on it:
    // the list was fetched meanwhile, and the page may have navigated.
    final expected = lessonOriginOf(widget.url);
    final current = await _controller.currentUrl();
    if (expected == null || current == null || lessonOriginOf(current) != expected || !mounted) return;
    await _controller.runJavaScript(audioInjection(message, expected)).catchError((Object _) {});
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
