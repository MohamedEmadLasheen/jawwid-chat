import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

// A new window (target=_blank, window.open) is never opened: no onCreateWindow
// handler is installed, so the WebView drops it.

import '../../../app/providers.dart';
import '../data/lesson_audio.dart';
import 'activity_load_error.dart';
import 'activity_load_failure.dart';
import 'activity_view.dart';

ActivityViewFactory createActivityViewFactory() => const _WebViewActivityFactory();

class _WebViewActivityFactory implements ActivityViewFactory {
  const _WebViewActivityFactory();

  @override
  Widget build(BuildContext context,
          {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio}) =>
      _ActivityWebView(url: url, allow: allow, audio: audio);
}

class _ActivityWebView extends ConsumerStatefulWidget {
  const _ActivityWebView({required this.url, required this.allow, this.audio});

  final String url;
  final bool Function(Uri uri) allow;
  final Future<Map<String, Object?>?>? audio;

  @override
  ConsumerState<_ActivityWebView> createState() => _ActivityWebViewState();
}

class _ActivityWebViewState extends ConsumerState<_ActivityWebView> {
  /// Set when the page itself failed (TLS, the network, a 404): the view then says
  /// so and offers Try again, instead of the WebView's blank white page.
  ActivityLoadFailure? _failure;

  /// The page the main frame is on, for matching an HTTP error to it.
  late String _pageUrl = widget.url;

  void _failed(ActivityLoadFailure? failure) {
    if (failure == null || !mounted) return;
    // The kind, code and host only: never the path, its query or a token.
    ref.read(loggerProvider).warn('activity page did not load', data: failure.logData);
    setState(() => _failure = failure);
  }

  void _retry() {
    setState(() => _failure = null);
    _pageUrl = widget.url;
    unawaited(_controller.loadRequest(Uri.parse(widget.url)));
  }

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
      onPageStarted: (url) => _pageUrl = url,
      onPageFinished: (_) => unawaited(_handAudio()),
      onWebResourceError: (error) => _failed(pageLoadFailure(error, pageUrl: _pageUrl)),
      onHttpError: (error) => _failed(pageHttpFailure(error, pageUrl: _pageUrl)),
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
  Widget build(BuildContext context) =>
      _failure == null ? WebViewWidget(controller: _controller) : ActivityLoadError(onRetry: _retry);
}
