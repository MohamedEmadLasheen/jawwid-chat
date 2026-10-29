import 'package:webview_flutter/webview_flutter.dart';

/// Why an activity's page did not load, as the app may log it: the kind of
/// failure, the platform's code and the host -- never the path, its query (a
/// play URL carries a token), nor the platform's description (which can quote
/// the URL).
class ActivityLoadFailure {
  const ActivityLoadFailure({required this.kind, this.code, this.host});

  /// A [WebResourceErrorType] name (`hostLookup`, `failedSslHandshake`, ...), or `http`.
  final String kind;

  /// The platform's error code, or the HTTP status.
  final int? code;

  final String? host;

  Map<String, Object?> get logData => {'kind': kind, if (code != null) 'code': code, if (host != null) 'host': host};
}

String? _host(String? url) {
  final host = url == null ? null : Uri.tryParse(url)?.host;
  return host == null || host.isEmpty ? null : host;
}

/// A failure of the page itself -- TLS, the network, a lookup -- or null for a
/// sub-resource (an image, an embedded player), which the page deals with.
ActivityLoadFailure? pageLoadFailure(WebResourceError error, {required String pageUrl}) {
  if (error.isForMainFrame == false) return null;
  return ActivityLoadFailure(kind: error.errorType?.name ?? 'unknown', code: error.errorCode, host: _host(error.url ?? pageUrl));
}

/// An HTTP error status (404, 500 ...) on the page itself, or null: a status
/// below 400, or one for another resource than the page being shown.
ActivityLoadFailure? pageHttpFailure(HttpResponseError error, {required String pageUrl}) {
  final status = error.response?.statusCode;
  final uri = error.request?.uri;
  final page = Uri.tryParse(pageUrl);
  if (status == null || status < 400 || uri == null || page == null) return null;
  final samePage = uri.scheme == page.scheme && uri.host == page.host && uri.port == page.port && uri.path == page.path;
  return samePage ? ActivityLoadFailure(kind: 'http', code: status, host: _host(pageUrl)) : null;
}
