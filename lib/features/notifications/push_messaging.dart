import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../../core/logging/redacting_logger.dart';

/// The device's push transport, as the rest of the app sees it.
///
/// An interface for the same reason `RealtimeClient` is one: the app's logic —
/// registering a token, retiring it at sign-out, routing a tap — must be
/// testable without a Firebase project, an Apple team, or a device. Those are
/// external facts about a deployment, not about whether this code is correct.
abstract interface class PushMessaging {
  /// Ask for permission, obtain a token, and begin listening.
  ///
  /// Safe to call when push is unavailable: the disabled implementation reports
  /// that and does nothing.
  Future<void> start();

  /// The current registration token, and every refresh of it.
  ///
  /// A token is not stable. It rotates when the app is restored to a new
  /// device, when data is cleared, and periodically at the platform's
  /// discretion — so this is a stream, not a getter, and the registration path
  /// listens to it rather than reading once at startup.
  Stream<String> get tokens;

  /// Notification taps, as the `data` map the server sent.
  Stream<Map<String, Object?>> get taps;

  /// A notification that STARTED the app, if this launch came from one.
  ///
  /// Separate from [taps] because it is not an event: by the time anything can
  /// subscribe, the tap has already happened. It has to be asked for.
  Future<Map<String, Object?>?> initialTap();

  /// Messages delivered while the app is in the foreground.
  ///
  /// Not shown as a banner by this app: the conversation is already on screen
  /// and updating over the socket, so a notification for it would be noise. The
  /// stream exists so a badge or an in-app cue can be driven from it.
  Stream<Map<String, Object?>> get foregroundMessages;

  Future<void> stop();
}

/// Push through Firebase Cloud Messaging, which on iOS bridges APNs.
///
/// ## What this class does NOT decide
///
/// Where a tap goes (`NotificationNavigator`), whether the recipient wanted the
/// notification (the server, before it was ever sent), and whether the person
/// may open what it names (the server, when the route resolves the
/// conversation). This is transport.
class FirebasePushMessaging implements PushMessaging {
  FirebasePushMessaging({
    FirebaseMessaging? messaging,
    RedactingLogger logger = const RedactingLogger(),
  })  : _messaging = messaging ?? FirebaseMessaging.instance,
        _logger = logger;

  final FirebaseMessaging _messaging;
  final RedactingLogger _logger;

  final _tokens = StreamController<String>.broadcast();
  final _taps = StreamController<Map<String, Object?>>.broadcast();
  final _foreground = StreamController<Map<String, Object?>>.broadcast();

  final _subscriptions = <StreamSubscription<dynamic>>[];

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<Map<String, Object?>> get taps => _taps.stream;

  @override
  Stream<Map<String, Object?>> get foregroundMessages => _foreground.stream;

  /// Whether this build can talk to Firebase at all.
  ///
  /// `Firebase.initializeApp()` needs `google-services.json` on Android and
  /// `GoogleService-Info.plist` on iOS, neither of which can be committed
  /// without a real project. A build without them degrades to no push rather
  /// than crashing on launch — an app that will not start because notifications
  /// are unconfigured is a worse failure than an app without notifications.
  static Future<bool> initialize({
    RedactingLogger logger = const RedactingLogger(),
  }) async {
    try {
      await Firebase.initializeApp();
      return true;
    } catch (_) {
      // Never the exception: it can name project identifiers.
      logger.debug('push unavailable: Firebase is not configured for this build');
      return false;
    }
  }

  @override
  Future<void> start() async {
    // iOS shows the system prompt here; Android 13+ needs POST_NOTIFICATIONS.
    // A refusal is a legitimate answer and is not retried — asking again on
    // every launch is how an app trains somebody to say no permanently.
    final settings = await _messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      _logger.debug('push permission declined');
      return;
    }

    final token = await _messaging.getToken();
    if (token != null && token.isNotEmpty) _tokens.add(token);

    _subscriptions.add(_messaging.onTokenRefresh.listen((refreshed) {
      if (refreshed.isNotEmpty) _tokens.add(refreshed);
    }));

    // A tap while the app is alive but backgrounded.
    _subscriptions.add(
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _taps.add(_dataOf(m))),
    );

    // A message arriving while the app is on screen.
    _subscriptions.add(
      FirebaseMessaging.onMessage.listen((m) => _foreground.add(_dataOf(m))),
    );
  }

  @override
  Future<Map<String, Object?>?> initialTap() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : _dataOf(message);
  }

  /// Only the `data` map is read. The title and body are for the platform to
  /// render; nothing in this app is driven by them, so a payload that carried
  /// something unexpected there cannot affect routing.
  static Map<String, Object?> _dataOf(RemoteMessage message) =>
      Map<String, Object?>.from(message.data);

  @override
  Future<void> stop() async {
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _subscriptions.clear();
    await _tokens.close();
    await _taps.close();
    await _foreground.close();
  }
}

/// Push that is not available on this build.
///
/// Used when Firebase is unconfigured, and by the fixture build. Silent rather
/// than throwing, exactly as `OfflineRealtimeClient` is: an app without push is
/// degraded, not broken, and an exception here would surface an error for
/// something the user did not ask for.
class DisabledPushMessaging implements PushMessaging {
  const DisabledPushMessaging();

  @override
  Future<void> start() async {}

  @override
  Stream<String> get tokens => const Stream.empty();

  @override
  Stream<Map<String, Object?>> get taps => const Stream.empty();

  @override
  Stream<Map<String, Object?>> get foregroundMessages => const Stream.empty();

  @override
  Future<Map<String, Object?>?> initialTap() async => null;

  @override
  Future<void> stop() async {}
}
