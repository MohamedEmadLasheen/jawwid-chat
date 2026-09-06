import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// One request as the server saw it.
class RecordedRequest {
  RecordedRequest({
    required this.method,
    required this.path,
    required this.query,
    required this.headers,
    required this.body,
  });

  final String method;
  final String path;
  final Map<String, String> query;
  final Map<String, String> headers;
  final Object? body;

  Map<String, Object?> get json => (body as Map?)?.cast<String, Object?>() ?? {};
}

/// A scripted reply.
class Reply {
  const Reply(this.status, this.body, {this.delay = Duration.zero});

  const Reply.ok(Object? body) : this(200, body);

  /// The engine's error envelope: `{ error: { code, message } }`.
  factory Reply.commError(int status, String code) => Reply(status, {
        'error': {'code': code, 'message': 'refused'},
      });

  final int status;
  final Object? body;
  final Duration delay;
}

/// A real HTTP server on loopback, used to verify the client speaks the documented protocol.
///
/// This is a **test double for the transport**, not a substitute backend: it asserts what the
/// client sends and hands back the exact response shapes
/// `apps/api/src/communication/api/*.controller.ts` returns. It proves the wire format is
/// right; it proves nothing about whether the real server behaves this way.
class TestServer {
  TestServer._(this._server);

  final HttpServer _server;
  final List<RecordedRequest> requests = [];

  /// `'METHOD /path'` → reply. A queue lets one route answer differently on each call, which
  /// is how retry and idempotency are exercised.
  final Map<String, List<Reply>> _routes = {};

  /// Routes whose reply depends on the request, so the server can echo back what it was
  /// sent — which is what the real engine does with `clientMessageId`.
  final Map<String, Reply Function(RecordedRequest)> _dynamicRoutes = {};

  String get baseUrl => 'http://127.0.0.1:${_server.port}';

  static Future<TestServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final testServer = TestServer._(server);
    unawaited(testServer._listen());
    return testServer;
  }

  Future<void> stop() => _server.close(force: true);

  /// Answer `method path` with [replies] in order; the last one repeats.
  void on(String method, String path, List<Reply> replies) {
    _routes['${method.toUpperCase()} $path'] = List.of(replies);
  }

  /// Answer `method path` by computing a reply from the request.
  void onRequest(
    String method,
    String path,
    Reply Function(RecordedRequest request) build,
  ) {
    _dynamicRoutes['${method.toUpperCase()} $path'] = build;
  }

  RecordedRequest? lastRequestTo(String method, String path) {
    final matches = requests.where(
      (r) => r.method == method.toUpperCase() && r.path == path,
    );
    return matches.isEmpty ? null : matches.last;
  }

  int countOf(String method, String path) => requests
      .where((r) => r.method == method.toUpperCase() && r.path == path)
      .length;

  Future<void> _listen() async {
    await for (final request in _server) {
      Object? body;
      final raw = await utf8.decoder.bind(request).join();
      if (raw.isNotEmpty) {
        try {
          body = jsonDecode(raw);
        } catch (_) {
          body = raw;
        }
      }

      final headers = <String, String>{};
      request.headers.forEach((name, values) => headers[name] = values.join(','));

      requests.add(
        RecordedRequest(
          method: request.method,
          path: request.uri.path,
          query: request.uri.queryParameters,
          headers: headers,
          body: body,
        ),
      );

      final key = '${request.method} ${request.uri.path}';
      final dynamicRoute = _dynamicRoutes[key];
      final queued = _routes[key];

      final reply = dynamicRoute != null
          ? dynamicRoute(requests.last)
          : queued == null || queued.isEmpty
          ? const Reply(404, {
              'error': {'code': 'test.no_route', 'message': 'unrouted'},
            })
          : (queued.length == 1 ? queued.first : queued.removeAt(0));

      if (reply.delay > Duration.zero) await Future<void>.delayed(reply.delay);

      request.response.statusCode = reply.status;
      request.response.headers.contentType = ContentType.json;

      // A String body is written verbatim, so a malformed payload can be simulated.
      final payload = reply.body;
      request.response.write(
        payload is String ? payload : jsonEncode(payload ?? {}),
      );
      await request.response.close();
    }
  }
}
