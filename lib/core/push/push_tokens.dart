import 'dart:async';

import 'package:flutter/services.dart';

/// Which push channel a token belongs to.
///
/// The distinction is not cosmetic. On iOS a PushKit (`voip`) token obliges the
/// app to report an incoming call to CallKit almost immediately, and the server
/// routes call notifications to it and NOTHING else for exactly that reason
/// (`call-push-routing.ts`). A standard token takes ordinary notifications.
enum PushTokenKind { standard, voip }

/// One device token, as the platform reported it.
class PushToken {
  const PushToken({
    required this.value,
    required this.platform,
    required this.kind,
  });

  /// The opaque device address. Never logged, never rendered.
  final String value;

  /// `ios` or `android`, matching `chat.device_token.platform`.
  final String platform;

  final PushTokenKind kind;

  bool get isVoip => kind == PushTokenKind.voip;

  @override
  bool operator ==(Object other) =>
      other is PushToken &&
      other.value == value &&
      other.platform == platform &&
      other.kind == kind;

  @override
  int get hashCode => Object.hash(value, platform, kind);

  /// Deliberately says nothing about the value. A token in a crash report or a
  /// log is a device address somebody else can address.
  @override
  String toString() => 'PushToken($platform/${kind.name})';
}

/// THE PUSH-TOKEN SEAM.
///
/// Above this interface is Jawwid's, and is tested without a device, an APNs
/// environment or a Firebase project; below it is `PKPushRegistry`,
/// `UIApplication.registerForRemoteNotifications` and FCM. The same arrangement
/// as `RealtimeSocket`, `MediaRoom` and `VoiceRecorder`, and the only reason the
/// registration, rotation and sign-out paths can be covered at all.
///
/// NARROW ON PURPOSE. It reports tokens. It does not receive pushes, present a
/// call, or know what a call is: a push that arrives is handled by the native
/// layer W8-W3 will build, and the call itself still arrives over the existing
/// realtime connection. Nothing here may grow a method that answers a call.
abstract interface class PushTokens {
  /// Ask the platform to register for push, if it has not already.
  ///
  /// Safe to call repeatedly. Returns when the request has been made — a token
  /// arrives on [tokens] afterwards, and may never arrive at all (a simulator,
  /// a denied permission, an unconfigured Firebase project).
  Future<void> start();

  /// Every token this device holds, and every rotation afterwards.
  ///
  /// A broadcast stream: tokens are re-issued by the platform at times nobody
  /// controls, and a rotation that nobody was listening for is a phone that
  /// stops ringing.
  Stream<PushToken> tokens();
}

/// [PushTokens] over the platform channel the native side answers.
///
/// WHAT IS NOT VERIFIED. No real token has ever crossed this channel. In a VM or
/// a simulator the native side reports nothing and this stream stays empty,
/// which is what the tests above the seam exercise. Real APNs, PushKit and FCM
/// delivery is W8-W4's and is claimed nowhere in this file.
class PlatformPushTokens implements PushTokens {
  PlatformPushTokens({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(channelName) {
    _channel.setMethodCallHandler(_onCall);
  }

  /// Shared with `AppDelegate.swift` and `MainActivity.kt`. One string, three
  /// places, and a mismatch is a silent no-op — so it is a constant, not a
  /// literal repeated in each.
  static const channelName = 'jawwid/push_tokens';

  final MethodChannel _channel;
  final _tokens = StreamController<PushToken>.broadcast();

  @override
  Future<void> start() async {
    try {
      await _channel.invokeMethod<void>('start');
    } on PlatformException {
      // A platform that cannot register is not a fault to crash on: the app
      // works without push, it simply will not ring while closed.
    } on MissingPluginException {
      // No native side at all — a unit test, or a platform W8-W1 did not wire.
    }
  }

  @override
  Stream<PushToken> tokens() => _tokens.stream;

  Future<void> _onCall(MethodCall call) async {
    if (call.method != 'onToken') return;
    final args = call.arguments;
    if (args is! Map) return;

    final value = args['token'];
    final platform = args['platform'];
    final kind = args['kind'];
    // A half-formed token is dropped rather than registered: a device address
    // the server cannot use would fail every push and eventually deactivate
    // itself, which looks exactly like a phone that has stopped working.
    if (value is! String || value.isEmpty) return;
    if (platform is! String || platform.isEmpty) return;

    if (_tokens.isClosed) return;
    _tokens.add(
      PushToken(
        value: value,
        platform: platform,
        kind: kind == 'voip' ? PushTokenKind.voip : PushTokenKind.standard,
      ),
    );
  }

  Future<void> dispose() async {
    if (!_tokens.isClosed) await _tokens.close();
  }
}
