import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/data/repositories.dart';
import '../../core/logging/redacting_logger.dart';
import 'push_messaging.dart';

/// Keeps the backend's idea of this device in step with the platform's.
///
/// ## The two failure modes this exists to avoid
///
/// **A token that is never registered.** The token arrives asynchronously, and
/// it rotates — on restore to a new device, on cleared data, and periodically
/// at the platform's discretion. Reading it once at startup would work until
/// the first rotation and then silently stop, which presents as "notifications
/// used to work". So this listens to the stream rather than taking a snapshot.
///
/// **A token that outlives its account.** A push token identifies a DEVICE, not
/// a person. Left registered after a sign-out it keeps delivering one account's
/// notifications — including message previews — to whoever signs in next on the
/// same handset. Retiring it is therefore part of signing out, not a
/// housekeeping task, and it is the reason [forget] exists as a distinct step
/// from [stop].
class PushRegistrar {
  PushRegistrar({
    required PushMessaging messaging,
    required NotificationRepository Function() repository,
    required bool Function() isSignedIn,
    String platform = '',
    RedactingLogger logger = const RedactingLogger(),
  })  : _messaging = messaging,
        _repository = repository,
        _isSignedIn = isSignedIn,
        _platform = platform.isEmpty ? defaultTargetPlatform.name : platform,
        _logger = logger;

  final PushMessaging _messaging;
  final NotificationRepository Function() _repository;
  final bool Function() _isSignedIn;
  final String _platform;
  final RedactingLogger _logger;

  StreamSubscription<String>? _subscription;

  /// The token currently registered, so sign-out knows what to retire.
  String? _registered;

  /// A token that arrived before there was a session to attach it to.
  String? _pending;

  Future<void> start() async {
    _subscription = _messaging.tokens.listen((token) => unawaited(_offer(token)));
    await _messaging.start();
  }

  /// A session began. Register anything that arrived while there was none.
  ///
  /// A token frequently arrives BEFORE sign-in — the platform hands it over at
  /// launch, and the user may still be at the login screen. Registering it then
  /// would attach the device to no account, or worse to the previous one.
  Future<void> onSignedIn() async {
    final token = _pending;
    if (token != null) await _offer(token);
  }

  Future<void> _offer(String token) async {
    if (!_isSignedIn()) {
      _pending = token;
      return;
    }
    if (_registered == token) return;

    // A rotation replaces: retire the previous token before claiming the new
    // one, or the account accumulates dead registrations that every future
    // notification spends an attempt on.
    final previous = _registered;
    if (previous != null && previous != token) {
      await _retire(previous);
    }

    try {
      await _repository().registerDevice(token: token, platform: _platform);
      _registered = token;
      _pending = null;
      // A count and a platform, never the token: it is a routing capability for
      // somebody's device.
      _logger.debug('push token registered for $_platform');
    } catch (_) {
      // Not fatal and not surfaced. The token is kept as pending so the next
      // sign-in or refresh retries it; failing loudly here would show an error
      // for something the user did not do.
      _pending = token;
    }
  }

  /// The session ended. The backend must stop sending to this device.
  Future<void> forget() async {
    final token = _registered;
    _registered = null;
    _pending = null;
    if (token != null) await _retire(token);
  }

  Future<void> _retire(String token) async {
    try {
      await _repository().unregisterDevice(token);
    } catch (_) {
      // The server also retires a token the provider rejects, so a missed
      // de-registration is recovered rather than permanent. Still worth not
      // throwing out of a sign-out.
      _logger.debug('push token de-registration failed; server-side cleanup will catch it');
    }
  }

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }
}
