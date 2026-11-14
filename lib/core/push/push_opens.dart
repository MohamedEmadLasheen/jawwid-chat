import 'dart:async';

import 'package:flutter/services.dart';

/// A tap on an ordinary push notification (PD-32 amendment, 2026-11-03).
///
/// What the native side hands over when the person taps a notification the system drew:
/// the push's routing data, and nothing else. It is read defensively -- only the known
/// keys, only values shaped like ids -- because a payload is data from outside the app,
/// and an id here is a pointer, never a permission: every screen it opens re-reads the
/// item through the signed-in account's own authorized route.
///
/// A CALL is never routed here. Calls keep their own path (PushKit and CallKit on iOS,
/// the realtime connection everywhere); [isCall] makes the coordinator ignore one that
/// arrives anyway.
class PushOpen {
  const PushOpen({
    required this.eventType,
    this.notificationId,
    this.actionKind,
    this.feedbackId,
    this.conversationId,
    this.learnerId,
    this.lessonId,
    this.taskId,
  });

  /// The server's event type (`feedback_replied`, `message_published`, ...).
  final String eventType;

  /// The delivery's id, for `POST /notifications/:id/opened`.
  final String? notificationId;

  /// The Notification Center entry's button kind (`open_feedback`, ...), when it has one.
  final String? actionKind;
  final String? feedbackId;
  final String? conversationId;
  final String? learnerId;
  final String? lessonId;
  final String? taskId;

  /// Matches the server's `CALL_EVENT_TYPES` (call-push-routing.ts).
  static const callEventTypes = {'call_started', 'group_call_started'};

  bool get isCall => callEventTypes.contains(eventType);

  static final _id = RegExp(r'^[0-9A-Za-z-]{1,64}$');
  static final _kind = RegExp(r'^[a-z][a-z0-9_]{0,39}$');

  /// Null when [raw] is not a push this app sent: no event type, or not a map.
  static PushOpen? fromPlatform(Object? raw) {
    if (raw is! Map) return null;
    String? id(String key) {
      final v = raw[key];
      return v is String && _id.hasMatch(v) ? v : null;
    }

    final eventType = raw['eventType'];
    if (eventType is! String || !_kind.hasMatch(eventType)) return null;
    final kind = raw['actionKind'];
    return PushOpen(
      eventType: eventType,
      notificationId: id('notificationId'),
      actionKind: kind is String && _kind.hasMatch(kind) ? kind : null,
      feedbackId: id('feedbackId'),
      conversationId: id('conversationId'),
      learnerId: id('learnerId'),
      lessonId: id('lessonId'),
      taskId: id('taskId'),
    );
  }
}

/// THE PUSH-OPEN SEAM, beside [PushTokens] and as narrow.
///
/// Above it is Jawwid's, tested without a device; below it is
/// `UNUserNotificationCenterDelegate` (iOS) and the notification's tap intent (Android).
abstract interface class PushOpens {
  /// Tell the native side Dart is listening. Taps that arrived before -- the one that
  /// launched a closed app -- are delivered now, once.
  Future<void> start();

  /// Every tap, in order.
  Stream<PushOpen> opens();

  /// Remove this app's notifications from the tray / Notification Center (sign-out: the
  /// next person on this phone does not see the previous account's).
  Future<void> clearDelivered();
}

/// [PushOpens] over the `jawwid/push_opens` channel the native side answers.
class PlatformPushOpens implements PushOpens {
  PlatformPushOpens({MethodChannel? channel}) : _channel = channel ?? const MethodChannel(channelName) {
    _channel.setMethodCallHandler(_handle);
  }

  /// Shared with `AppDelegate.swift` and `MainActivity.kt`.
  static const channelName = 'jawwid/push_opens';

  final MethodChannel _channel;
  final _opens = StreamController<PushOpen>.broadcast();

  Future<Object?> _handle(MethodCall call) async {
    if (call.method != 'onOpen') return null;
    final open = PushOpen.fromPlatform(call.arguments);
    if (open != null) _opens.add(open);
    return null;
  }

  @override
  Future<void> start() async {
    try {
      await _channel.invokeMethod<void>('listen');
    } on MissingPluginException {
      // A platform with no native side (the web build, a test): no taps to deliver.
    } on PlatformException {
      // Never fatal: the app works without push.
    }
  }

  @override
  Stream<PushOpen> opens() => _opens.stream;

  @override
  Future<void> clearDelivered() async {
    try {
      await _channel.invokeMethod<void>('clearDelivered');
    } on MissingPluginException {
      // Nothing native to clear.
    } on PlatformException {
      // Never fatal.
    }
  }

  void dispose() {
    _channel.setMethodCallHandler(null);
    unawaited(_opens.close());
  }
}
