/// Where the app talks to, and how patiently.
///
/// The base URL is supplied at build time (`--dart-define=JAWWID_API_BASE_URL=...`) and has
/// **no default**. A mobile client that ships with a hardcoded fallback host is a client that
/// will one day point at the wrong environment, so an unconfigured build is required to fail
/// loudly at startup instead.
class ApiConfig {
  const ApiConfig({
    required this.baseUrl,
    this.connectTimeout = const Duration(seconds: 10),
    // Generous relative to connect: the parent audience is on slow mobile networks, and a
    // response that is merely slow is not a failure worth surfacing (§47).
    this.receiveTimeout = const Duration(seconds: 30),
    this.sendTimeout = const Duration(seconds: 30),
  });

  static const _baseUrlKey = 'JAWWID_API_BASE_URL';

  final String baseUrl;
  final Duration connectTimeout;
  final Duration receiveTimeout;
  final Duration sendTimeout;

  /// True when this build was given a backend to talk to.
  static bool get isConfigured => const bool.hasEnvironment(_baseUrlKey);

  static String get configuredBaseUrl =>
      const String.fromEnvironment(_baseUrlKey);

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
    return ApiConfig(baseUrl: configuredBaseUrl);
  }
}
