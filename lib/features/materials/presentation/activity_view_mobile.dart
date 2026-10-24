import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'activity_view.dart';

ActivityViewFactory createActivityViewFactory() => const _WebViewActivityFactory();

class _WebViewActivityFactory implements ActivityViewFactory {
  const _WebViewActivityFactory();

  @override
  Widget build(BuildContext context, {required String url, required bool Function(Uri uri) allow}) =>
      _ActivityWebView(url: url, allow: allow);
}

class _ActivityWebView extends StatefulWidget {
  const _ActivityWebView({required this.url, required this.allow});

  final String url;
  final bool Function(Uri uri) allow;

  @override
  State<_ActivityWebView> createState() => _ActivityWebViewState();
}

class _ActivityWebViewState extends State<_ActivityWebView> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final uri = Uri.tryParse(request.url);
        // about:blank and data: frames a package builds for itself stay inside it.
        if (uri != null && (uri.scheme == 'about' || uri.scheme == 'data' || uri.scheme == 'blob')) {
          return NavigationDecision.navigate;
        }
        return uri != null && widget.allow(uri) ? NavigationDecision.navigate : NavigationDecision.prevent;
      },
    ))
    ..loadRequest(Uri.parse(widget.url));

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _controller);
}
