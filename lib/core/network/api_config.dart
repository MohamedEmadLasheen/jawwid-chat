/// Where the app talks to, and how patiently.
///
/// The base URL is supplied at build time (`--dart-define=JAWWID_API_BASE_URL=...`) and has
/// **no default**. A mobile client that ships with a hardcoded fallback host is a client that
/// will one day point at the wrong environment, so an unconfigured build is required to fail
/// loudly at startup instead.
///
/// The REALTIME url is separate, because Socket.IO reads a trailing path as a
/// **namespace**: handing it the API base made this client ask for the namespace
/// `/api/v1`, which the gateway does not serve, and every connection failed with
/// "Invalid namespace". It defaults to the API base's origin — the same host
/// without the path — so an existing build command keeps working unchanged, and
/// `--dart-define=JAWWID_REALTIME_URL=...` overrides it when the socket lives
/// somewhere else. This mirrors Admin Web, which has always kept
/// `VITE_API_BASE_URL` and `VITE_REALTIME_URL` apart.
class ApiConfig {
  const ApiConfig({
    required this.baseUrl,
    this.realtimeUrlOverride,
    this.connectTimeout = const Duration(seconds: 10),
    // Generous relative to connect: the parent audience is on slow mobile networks, and a
    // response that is merely slow is not a failure worth surfacing (§47).
    this.receiveTimeout = const Duration(seconds: 30),
    this.sendTimeout = const Duration(seconds: 30),
  });

  static const _baseUrlKey = 'JAWWID_API_BASE_URL';
  static const _realtimeUrlKey = 'JAWWID_REALTIME_URL';

  final String baseUrl;

  /// Set only when this build named a realtime host explicitly. Null means
  /// "derive it from [baseUrl]", which is the case for every current build.
  final String? realtimeUrlOverride;

  final Duration connectTimeout;
  final Duration receiveTimeout;
  final Duration sendTimeout;

  /// True when this build was given a backend to talk to.
  static bool get isConfigured => const bool.hasEnvironment(_baseUrlKey);

  static String get configuredBaseUrl =>
      const String.fromEnvironment(_baseUrlKey);

  static String get configuredRealtimeUrl =>
      const String.fromEnvironment(_realtimeUrlKey);

  /// Where the SOCKET connects: the override when one was supplied, otherwise
  /// the API base's origin.
  String get realtimeUrl => realtimeUrlOverride ?? _originOf(baseUrl);

  /// [baseUrl] without its path.
  ///
  /// Deliberately built from parts rather than with `Uri.origin`, which throws
  /// for anything that is not http/https. A malformed base is returned
  /// unchanged: the socket then fails exactly as it does today, rather than
  /// this getter taking the app down at construction time.
  static String _originOf(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasAuthority) return url;
    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
    ).toString();
  }

  /// Read the build-time configuration.
  ///
  /// Throws when unconfigured rather than falling back, so a misconfigured build cannot
  /// silently run against nothing.
  factory ApiConfig.fromEnvironment() {
    if (!isConfigured || configuredBaseUrl.isEmpty) {
      throw StateError(
        'JAWWID_API_BASE_URL is not set. Build with '
        '--dart-define=JAWWID_API_BASE_URL=https://…  (no default is provided '
        'on purpose; see docs/mobile/http-integration.md)',
      );
    }
    return ApiConfig(
      baseUrl: configuredBaseUrl,
      realtimeUrlOverride:
          configuredRealtimeUrl.isEmpty ? null : configuredRealtimeUrl,
    );
  }
}
