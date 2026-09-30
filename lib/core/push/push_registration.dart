import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../app/providers.dart';
import '../logging/redacting_logger.dart';
import '../network/api_client.dart';
import 'push_tokens.dart';

/// Registering this device's push tokens with the server (W8-W1).
///
/// ONE RESPONSIBILITY: keep `chat.device_token` telling the truth about this
/// device while a session lasts, and stop claiming it afterwards. It does not
/// receive pushes, present a call, or take any part in the call lifecycle —
/// those remain the server's and W7's.
abstract interface class PushRegistrationApi {
  Future<void> register(PushToken token);
  Future<void> unregister(PushToken token);
}

/// `POST /notifications/devices` and `DELETE /notifications/devices/:token`.
///
/// Uses the application's single [ApiClient], so registration travels on the
/// same authenticated stack as everything else — one interceptor chain, one
/// TokenProvider, one refresh lifecycle. The server binds the token to the
/// **authenticated** actor; this never names one.
class HttpPushRegistration implements PushRegistrationApi {
  HttpPushRegistration({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<void> register(PushToken token) async {
    await _client.post<Map<String, Object?>>(
      '/notifications/devices',
      data: {
        'token': token.value,
        'platform': token.platform,
        'isVoip': token.isVoip,
      },
    );
  }

  @override
  Future<void> unregister(PushToken token) async {
    await _client.delete<Map<String, Object?>>(
      '/notifications/devices/${Uri.encodeComponent(token.value)}',
    );
  }
}

/// Keeps this device's registration in step with the session.
///
/// ## What it does, and when
///
/// * a session begins  -> ask the platform for tokens, register each one
/// * a token rotates   -> register the new one (the server upserts by token)
/// * a session ends    -> retire what this device registered
///
/// ## Why sign-out is best effort, and why that is safe
///
/// `DELETE /notifications/devices/:token` is authenticated, so it must happen
/// while the session still exists. By the time an auth state has already become
/// signed-out the bearer is gone and the request would be refused — so this
/// retires tokens on the way out and does not treat a failure as an error.
///
/// A token that survives is not a leak. `registerDevice` upserts **by token**
/// and moves it to whoever registers it next, which is the server's stated
/// design for a handed-over device: the next person to sign in on this phone
/// takes ownership of its tokens, and the previous account stops receiving
/// anything on it. A device that signs out and is never used again keeps an
/// active row until a provider rejects it as permanently invalid, which is
/// recorded as a carry-forward rather than papered over here.
///
/// ## Failure is never fatal
///
/// If registration fails the app works exactly as it does today: calls and
/// messages arrive over the realtime connection while the app is open. Push is
/// what makes a closed app ring; losing it must not take the session with it.
class PushRegistrar {
  PushRegistrar({
    required PushTokens tokens,
    required PushRegistrationApi api,
    RedactingLogger logger = const RedactingLogger(),
  })  : _tokens = tokens,
        _api = api,
        _log = logger;

  final PushTokens _tokens;
  final PushRegistrationApi _api;
  final RedactingLogger _log;

  StreamSubscription<PushToken>? _sub;

  /// What this device has registered during this session, so sign-out can
  /// retire exactly those and nothing else.
  final _registered = <PushToken>{};

  bool _started = false;

  /// Begin registering for the current session. Idempotent.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    _sub = _tokens.tokens().listen(_onToken);
    await _tokens.start();
  }

  Future<void> _onToken(PushToken token) async {
    // A rotation re-registers: the server upserts by token, so sending the same
    // one twice is a no-op and sending a new one adds a device rather than
    // replacing this phone's other channel.
    if (_registered.contains(token)) return;
    try {
      await _api.register(token);
      _registered.add(token);
      // The KIND and the platform, never the value: a token in a log is a
      // device address somebody else can address.
      _log.info('push: registered a ${token.platform}/${token.kind.name} token');
    } catch (_) {
      // Left out of `_registered`, so a later rotation or a new session tries
      // again. Push being unavailable must not break the session.
      _log.warn('push: a token could not be registered');
    }
  }

  /// Retire this device's tokens. Call while the session is still valid.
  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    _started = false;

    final retiring = List<PushToken>.of(_registered);
    _registered.clear();
    for (final token in retiring) {
      try {
        await _api.unregister(token);
      } catch (_) {
        // Best effort — see the class comment. The next sign-in on this device
        // re-binds the token to whoever that is.
        _log.warn('push: a token could not be retired');
      }
    }
  }
}

/// The registration API for this build. Overridden in `bootstrap.dart` with the
/// implementation holding the application's shared [ApiClient].
final pushRegistrationApiProvider = Provider<PushRegistrationApi>((ref) {
  throw UnimplementedError('pushRegistrationApiProvider must be overridden');
});

/// The platform token source. Overridable so tests never touch a channel.
final pushTokensProvider = Provider<PushTokens>((ref) {
  final tokens = PlatformPushTokens();
  ref.onDispose(tokens.dispose);
  return tokens;
});

/// THE SESSION-SCOPED REGISTRAR.
///
/// Watches the signed-in account id and nothing else, exactly as W3 does for the
/// realtime client and W7 for the call controller. Riverpod disposes and
/// rebuilds a provider when what it watches changes, so:
///
///   * signed out            -> no registrar, and this device claims nothing
///   * a user signs in       -> one registrar, registering this device
///   * the session ends      -> disposed, and the dispose retires the tokens
///   * a different user      -> the id CHANGED, so the previous registrar was
///                              disposed before this one existed
///
/// A build with no registration API registered — a fake build, a test — yields
/// null rather than throwing: push is not available there and nothing else
/// should notice.
final pushRegistrarProvider = Provider<PushRegistrar?>((ref) {
  final accountId = ref.watch(
    authControllerProvider.select((state) => state.user?.id),
  );
  if (accountId == null) return null;

  final PushRegistrationApi api;
  try {
    api = ref.watch(pushRegistrationApiProvider);
  } catch (error) {
    final cause = error is ProviderException ? error.exception : error;
    if (cause is UnimplementedError) return null;
    rethrow;
  }

  final registrar = PushRegistrar(
    tokens: ref.watch(pushTokensProvider),
    api: api,
    logger: ref.watch(loggerProvider),
  );

  // Registered BEFORE start, so a failure while starting still leaves something
  // that will be torn down.
  ref.onDispose(() => unawaited(registrar.stop()));
  unawaited(registrar.start());

  return registrar;
});
