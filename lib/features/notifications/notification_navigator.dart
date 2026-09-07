import 'dart:async';

import '../../core/logging/redacting_logger.dart';
import 'push_payload.dart';

/// Takes a notification tap to the right screen, at the right moment.
///
/// ## The three moments, which are three different problems
///
/// * **Warm.** The app is on screen. Navigate now.
/// * **Background.** The app is alive but not foreground. Navigate on the way
///   back; by the time the tap is delivered a navigator exists.
/// * **Cold.** The tap STARTED the process. There is no navigator, no session,
///   and no router — the platform hands the payload to `main()` before any of
///   that exists.
///
/// The cold case is why this class holds state rather than being a function.
/// A tap that arrives before the app can act on it is HELD, and released when
/// the app says it is ready. Navigating immediately would mean calling into a
/// router that does not exist yet; dropping it would mean the notification that
/// reopened the app after three days lands on the chat list, which reads as the
/// app having ignored the tap.
///
/// ## It holds exactly one
///
/// Not a queue. If three notifications are tapped before the app is ready —
/// which happens, because a tap can be delivered while the splash screen is
/// still deciding whether there is a session — the user is going to one place,
/// and it is the last thing they chose. A queue would navigate through the
/// others on the way, flashing screens nobody asked for.
class NotificationNavigator {
  NotificationNavigator({
    required Future<void> Function(String location) go,
    required bool Function() isSignedIn,
    RedactingLogger logger = const RedactingLogger(),
  })  : _go = go,
        _isSignedIn = isSignedIn,
        _logger = logger;

  final Future<void> Function(String location) _go;
  final bool Function() _isSignedIn;
  final RedactingLogger _logger;

  String? _pending;
  bool _ready = false;

  /// A notification was tapped. Safe at any moment in the app's life.
  Future<void> onTapped(Map<String, Object?> data) async {
    final destination = PushPayload.destinationOf(data);

    final location = switch (destination) {
      OpenConversation() => destination.location,
      OpenIncomingCall() => destination.location,
      // A notification with no in-app destination still OPENS the app, which is
      // what the user asked for by tapping it. It is not an error and is not
      // shown as one.
      OpenNowhere(:final reason) => _ignored(reason),
    };
    if (location == null) return;

    if (!_ready) {
      // Cold start. Held until the app has a router and has decided whether
      // there is a session.
      _pending = location;
      return;
    }
    await _navigate(location);
  }

  /// The app has a router and a resolved session. Release anything held.
  Future<void> onReady() async {
    _ready = true;
    final location = _pending;
    _pending = null;
    if (location != null) await _navigate(location);
  }

  /// Discard anything held. Called when a session ends: a notification tapped
  /// by the previous user must not navigate the next one into their thread.
  void clear() => _pending = null;

  Future<void> _navigate(String location) async {
    if (!_isSignedIn()) {
      // Signed out. The router's own redirect would send this to sign-in
      // anyway, but holding it is better than bouncing: the person taps a
      // notification, signs in, and arrives where they were going.
      _pending = location;
      _logger.debug('notification destination held until a session exists');
      return;
    }

    // The location names a conversation id that CAME FROM THE NETWORK. It is a
    // destination, not an entitlement: the route resolves the conversation from
    // the backend, which runs the same authorization every other read does, so
    // an id this device is not entitled to fails there rather than opening a
    // thread. Nothing is rendered from what the notification said.
    await _go(location);
  }

  String? _ignored(String reason) {
    _logger.debug('notification carried no destination: $reason');
    return null;
  }
}
