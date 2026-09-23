import 'dart:async';

/// A push that arrived on this device.
///
/// Carries only what the backend puts in an FCM data payload: routing ids, no
/// message content. The title and body a parent reads come from the notification
/// row, fetched after the app opens and after the backend has re-authorized the
/// read — which is why a push cannot leak anything even if the device is
/// compromised or the notification sits on a lock screen.
class PushPayload {
  const PushPayload({required this.data});

  final Map<String, String> data;

  String? get notificationId => data['notificationId'];
  String? get type => data['type'];
  String? get category => data['category'];
  String? get conversationId => data['conversationId'];
  String? get announcementId => data['announcementId'];
  String? get learnerId => data['learnerId'];

  /// The route the server minted, if it sent one. Still validated before use —
  /// a push payload is the least trustworthy place a route can come from.
  String? get deeplink => data['deeplink'];

  bool get isEmpty => notificationId == null && deeplink == null;
}

/// Whether the user has agreed to be notified.
enum PushPermission { granted, denied, provisional, notDetermined }

/// PLATFORM SEAM for push messaging.
///
/// The app never imports a Firebase type outside the one implementation of this
/// interface — the same rule `lib/core/audio` follows for the microphone, and
/// for the same reason: no test may touch a platform channel, and swapping the
/// provider must not mean touching the notification feature.
///
/// Everything here is device-side. The backend half (which token gets a push,
/// which failures kill a token, what the payload may contain) is
/// `FcmPushProvider` and `DeliveryService`, and neither knows this file exists.
abstract interface class PushTokens {
  /// Ask for permission. On Android 13+ and on iOS this shows the OS prompt.
  ///
  /// Called at a moment the parent can understand — after sign-in, when the
  /// first notification would matter — never on first launch before they know
  /// what the app is, because a denied prompt is expensive to recover from.
  Future<PushPermission> requestPermission();

  Future<PushPermission> currentPermission();

  /// This device's token, or null when permission was refused or FCM is
  /// unavailable (a device with no Play Services, a simulator with no APNs).
  Future<String?> token();

  /// FCM rotates tokens: on reinstall, on restore to a new device, and
  /// occasionally on its own. A rotation that is not reported leaves the backend
  /// pushing to an address that no longer exists, which looks exactly like a
  /// parent who stopped getting notifications for no reason.
  Stream<String> get tokenRefreshes;

  /// A push that arrived while the app was in the foreground.
  ///
  /// The OS does NOT display these — a foreground push is delivered to the app
  /// and nothing else — which is correct here: the realtime channel has already
  /// updated the screen, and a banner over a conversation the parent is reading
  /// is noise.
  Stream<PushPayload> get onForegroundMessage;

  /// The parent tapped a notification while the app was backgrounded.
  Stream<PushPayload> get onNotificationOpened;

  /// The push that launched a terminated app, if that is how it started.
  ///
  /// Read once at startup. This is the case a notification system is judged on:
  /// the app was closed, the parent tapped, and the app must open on the thing
  /// they tapped rather than on the chat list.
  Future<PushPayload?> initialMessage();

  /// Release the token on sign-out, so a shared device stops receiving the
  /// previous account's notifications.
  Future<void> delete();
}

/// A [PushTokens] that has no device.
///
/// The default, and what every test uses. Like `InertRealtimeClient` it is a
/// real implementation rather than a throwing stub: "this device cannot do push"
/// is a state the app must handle on a de-Googled Android or an iOS simulator,
/// so it should be the state the tests run in.
class InertPushTokens implements PushTokens {
  InertPushTokens({this.availableToken});

  /// Set to simulate a device that does have a token.
  String? availableToken;

  final _refreshes = StreamController<String>.broadcast();
  final _foreground = StreamController<PushPayload>.broadcast();
  final _opened = StreamController<PushPayload>.broadcast();

  PushPermission permission = PushPermission.notDetermined;
  PushPayload? launchPayload;
  bool deleted = false;

  @override
  Future<PushPermission> requestPermission() async => permission;

  @override
  Future<PushPermission> currentPermission() async => permission;

  @override
  Future<String?> token() async => availableToken;

  @override
  Stream<String> get tokenRefreshes => _refreshes.stream;

  @override
  Stream<PushPayload> get onForegroundMessage => _foreground.stream;

  @override
  Stream<PushPayload> get onNotificationOpened => _opened.stream;

  @override
  Future<PushPayload?> initialMessage() async => launchPayload;

  @override
  Future<void> delete() async {
    deleted = true;
    availableToken = null;
  }

  // -- test drivers ---------------------------------------------------------

  void rotateToken(String token) {
    availableToken = token;
    _refreshes.add(token);
  }

  void arriveInForeground(PushPayload payload) => _foreground.add(payload);

  void tap(PushPayload payload) => _opened.add(payload);

  void dispose() {
    _refreshes.close();
    _foreground.close();
    _opened.close();
  }
}
