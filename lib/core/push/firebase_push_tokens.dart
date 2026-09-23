import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../logging/redacting_logger.dart';
import 'push_tokens.dart';

/// [PushTokens] over Firebase Cloud Messaging.
///
/// THE ONLY FILE IN THE APP THAT IMPORTS FIREBASE. Everything else talks to the
/// [PushTokens] interface, so no test touches a platform channel and swapping
/// provider means replacing one class.
///
/// BOTH PLATFORMS, ONE TRANSPORT. This app targets Android and iOS (there is no
/// web target); FCM serves iOS through its own APNs bridge, so a second push
/// integration for iOS would be a second set of credentials, a second token
/// table and a second set of failure modes for no gain.
///
/// FAILURE IS NORMAL AND MUST NOT BE FATAL. A de-Googled Android, an iOS
/// simulator with no APNs, a parent who declined the prompt, a network that is
/// down at launch: every one of these yields no token, and every one of them
/// must leave the app working. A notification with no push still reaches the
/// parent in-app and still counts towards the badge — losing the push is a
/// degraded channel, losing the app is a broken product.
class FirebasePushTokens implements PushTokens {
  FirebasePushTokens({
    FirebaseMessaging? messaging,
    RedactingLogger logger = const RedactingLogger(),
  })  : _messaging = messaging,
        _logger = logger;

  FirebaseMessaging? _messaging;
  final RedactingLogger _logger;

  FirebaseMessaging get _fcm => _messaging ??= FirebaseMessaging.instance;

  /// Initialise Firebase, and report whether push is available at all.
  ///
  /// Returns false rather than throwing when the platform configuration is
  /// missing — a build without `google-services.json` or
  /// `GoogleService-Info.plist` must still run, because that is the state every
  /// developer checkout is in until someone adds the credentials.
  static Future<bool> initialise({RedactingLogger logger = const RedactingLogger()}) async {
    try {
      await Firebase.initializeApp();
      return true;
    } catch (_) {
      // Never log the error: a Firebase init failure can echo the options,
      // which carry the project's API key.
      logger.debug('push is unavailable on this device: Firebase did not initialise');
      return false;
    }
  }

  @override
  Future<PushPermission> requestPermission() async {
    try {
      final settings = await _fcm.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        // Not requested: critical alerts need an Apple entitlement this product
        // has not applied for, and provisional authorization would deliver
        // notifications silently to the notification centre — which for a
        // missed call or a cancelled class is indistinguishable from not
        // sending one.
        provisional: false,
      );
      return _map(settings.authorizationStatus);
    } catch (_) {
      return PushPermission.denied;
    }
  }

  @override
  Future<PushPermission> currentPermission() async {
    try {
      return _map((await _fcm.getNotificationSettings()).authorizationStatus);
    } catch (_) {
      return PushPermission.notDetermined;
    }
  }

  @override
  Future<String?> token() async {
    try {
      // iOS hands out an APNs token before an FCM one exists. Asking for the
      // FCM token too early returns null, and a null treated as "this device
      // cannot receive push" would silently disable notifications for every
      // iPhone that launched a fraction too fast.
      if (Platform.isIOS) {
        final apns = await _fcm.getAPNSToken();
        if (apns == null) {
          _logger.debug('APNs token not ready; push registration deferred');
          return null;
        }
      }
      return await _fcm.getToken();
    } catch (_) {
      return null;
    }
  }

  @override
  Stream<String> get tokenRefreshes => _fcm.onTokenRefresh;

  @override
  Stream<PushPayload> get onForegroundMessage =>
      FirebaseMessaging.onMessage.map(_payload);

  @override
  Stream<PushPayload> get onNotificationOpened =>
      FirebaseMessaging.onMessageOpenedApp.map(_payload);

  @override
  Future<PushPayload?> initialMessage() async {
    try {
      final message = await _fcm.getInitialMessage();
      return message == null ? null : _payload(message);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> delete() async {
    try {
      // Invalidates the token at FCM as well as locally, so a shared or
      // handed-down device stops receiving the previous account's notifications
      // even before the backend's own deactivation reaches it.
      await _fcm.deleteToken();
    } catch (_) {
      // A token that could not be deleted is still unregistered server-side by
      // the sign-out path, which is the authority on where a push is sent.
    }
  }

  static PushPayload _payload(RemoteMessage message) => PushPayload(
        // Only `data`. `notification` is what the OS drew on the lock screen and
        // is not routing information; reading it here would invite the app to
        // display content the backend deliberately kept out of the payload.
        data: message.data.map((key, value) => MapEntry(key, '$value')),
      );

  static PushPermission _map(AuthorizationStatus status) => switch (status) {
        AuthorizationStatus.authorized => PushPermission.granted,
        AuthorizationStatus.provisional => PushPermission.provisional,
        AuthorizationStatus.denied => PushPermission.denied,
        _ => PushPermission.notDetermined,
      };
}
