import 'dart:developer' as developer;

/// Logging that cannot leak secrets, even by accident.
///
/// §56 forbids logging access tokens, refresh tokens, passwords, private phone numbers, and
/// message content. Relying on every call site to remember that does not survive contact
/// with a deadline, so redaction happens here, on the way out, for every message.
///
/// This is a safety net rather than a licence: call sites should still avoid passing
/// sensitive values at all.
class RedactingLogger {
  const RedactingLogger({this.enabled = true, this.name = 'jawwid'});

  final bool enabled;
  final String name;

  static const _mask = '[redacted]';

  /// Keys whose *values* are dropped wherever they appear in structured data.
  static const _sensitiveKeys = <String>{
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'token',
    'authorization',
    'password',
    'secret',
    'api_key',
    'apikey',
    'push_token',
    'pushtoken',
    'phone',
    'phone_number',
    'phonenumber',
    'msisdn',
    'body',
    'message',
    'text',
  };

  /// Bearer tokens and JWTs appearing inline in free text.
  static final _bearer = RegExp(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', caseSensitive: false);
  static final _jwt = RegExp(r'\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*');

  /// Phone-number-shaped runs of digits, including the Egyptian +20 / 01… forms the product
  /// will encounter. Deliberately greedy: a false positive costs a redacted log line, a
  /// false negative costs a privacy incident (§5).
  static final _phone = RegExp(r'(?:\+|00)\d[\d\s\-().]{6,}\d|\b0\d{9,}\b');

  void debug(String message, {Map<String, Object?>? data}) =>
      _emit(500, message, data);

  void info(String message, {Map<String, Object?>? data}) =>
      _emit(800, message, data);

  void warn(String message, {Map<String, Object?>? data}) =>
      _emit(900, message, data);

  /// Errors are logged by *classification*, never by dumping a server payload or a stack
  /// trace into user-reachable output (§37).
  void error(String message, {Map<String, Object?>? data, Object? cause}) {
    _emit(1000, message, {
      ...?data,
      if (cause != null) 'cause': cause.runtimeType.toString(),
    });
  }

  void _emit(int level, String message, Map<String, Object?>? data) {
    if (!enabled) return;

    final safeMessage = redactText(message);
    final safeData = data == null ? '' : ' ${redactMap(data)}';
    developer.log('$safeMessage$safeData', name: name, level: level);
  }

  /// Strip token- and phone-shaped substrings from free text.
  static String redactText(String input) {
    return input
        .replaceAll(_bearer, _mask)
        .replaceAll(_jwt, _mask)
        .replaceAll(_phone, _mask);
  }

  /// Redact a structured payload by key, recursively.
  static Map<String, Object?> redactMap(Map<String, Object?> input) {
    final out = <String, Object?>{};
    input.forEach((key, value) {
      out[key] = _sensitiveKeys.contains(key.toLowerCase())
          ? _mask
          : _redactValue(value);
    });
    return out;
  }

  static Object? _redactValue(Object? value) => switch (value) {
        final String s => redactText(s),
        final Map<String, Object?> m => redactMap(m),
        final Iterable<Object?> list => list.map(_redactValue).toList(),
        _ => value,
      };
}
