import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'push_permission_explainer.dart';
import 'push_registration.dart';
import 'push_tokens.dart';

/// LR-11b: what the OS says about this app's notifications, and the one way back
/// when they are off.
///
/// #557 (explain-first) only answers "can the system prompt still be shown?". This
/// adds the status a person needs to see, and recovery:
///
///  * a Settings row that always works ("Notifications on this device: On / Off",
///    then Allow or Open settings), re-read whenever the app comes back to the
///    foreground (the person may have just changed it in the phone's Settings);
///  * on Android 13+, asking again after one denial, while the OS still allows it;
///  * the FIRST ask from that row goes through #557's explanation, the same dialog,
///    never a second card or prompt. Nothing here asks at launch: every ask follows
///    a tap.
///
/// The native half answers on #557's channel (`jawwid/push_tokens`), extended with
/// `permissionStatus` and `openNotificationSettings`, rather than a new channel.
enum NotificationPermissionStatus {
  /// Notifications are allowed.
  granted,

  /// Never asked: the first ask is #557's explanation, then the system prompt.
  notDetermined,

  /// Refused once, and the OS can still ask again (Android 13+ only).
  denied,

  /// Off, and only the phone's Settings can turn them on (iOS after any refusal,
  /// Android after a second refusal, or notifications switched off in Settings).
  blocked,

  /// The native side answered, but not with a status this build knows. Open
  /// settings still works.
  unknown,

  /// No native side at all (the web portal, a unit test): there is nothing to show.
  unsupported,
}

/// The native answer, as a status. Anything unexpected is [NotificationPermissionStatus.unknown].
NotificationPermissionStatus parseNotificationPermissionStatus(Object? raw) => switch (raw) {
      'granted' => NotificationPermissionStatus.granted,
      'notDetermined' => NotificationPermissionStatus.notDetermined,
      'denied' => NotificationPermissionStatus.denied,
      'blocked' => NotificationPermissionStatus.blocked,
      _ => NotificationPermissionStatus.unknown,
    };

/// What a tap on the Settings row does in each status.
enum NotificationPermissionAction {
  /// #557's explanation, then (on Continue) the system prompt.
  explainThenAsk,

  /// The system prompt again, straight away: the person has already had the
  /// explanation and has just tapped "Allow".
  askAgain,

  /// The phone's notification settings for this app.
  openSettings,

  /// Nothing (no native side).
  none,
}

NotificationPermissionAction notificationPermissionActionFor(NotificationPermissionStatus status) =>
    switch (status) {
      NotificationPermissionStatus.notDetermined => NotificationPermissionAction.explainThenAsk,
      NotificationPermissionStatus.denied => NotificationPermissionAction.askAgain,
      NotificationPermissionStatus.granted ||
      NotificationPermissionStatus.blocked ||
      NotificationPermissionStatus.unknown =>
        NotificationPermissionAction.openSettings,
      NotificationPermissionStatus.unsupported => NotificationPermissionAction.none,
    };

/// The native status and settings screen. Asking itself stays `PushTokens.start`.
abstract interface class NotificationPermissionPlatform {
  Future<NotificationPermissionStatus> status();

  /// Opens the phone's notification settings for this app. Whether anything opened.
  Future<bool> openSettings();
}

/// [NotificationPermissionPlatform] over #557's push channel.
class PlatformNotificationPermission implements NotificationPermissionPlatform {
  PlatformNotificationPermission({MethodChannel? channel})
      // Invoking only: the channel's handler (tokens) stays PlatformPushTokens'.
      : _channel = channel ?? const MethodChannel(PlatformPushTokens.channelName);

  final MethodChannel _channel;

  @override
  Future<NotificationPermissionStatus> status() async {
    if (kIsWeb) return NotificationPermissionStatus.unsupported;
    try {
      return parseNotificationPermissionStatus(await _channel.invokeMethod<Object?>('permissionStatus'));
    } on MissingPluginException {
      return NotificationPermissionStatus.unsupported;
    } on PlatformException {
      return NotificationPermissionStatus.unknown;
    }
  }

  @override
  Future<bool> openSettings() async {
    if (kIsWeb) return false;
    try {
      return await _channel.invokeMethod<bool>('openNotificationSettings') ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }
}

final notificationPermissionPlatformProvider = Provider<NotificationPermissionPlatform>(
  (ref) => PlatformNotificationPermission(),
);

/// How long a status read may take before the row shows anyway, neutral
/// ([NotificationPermissionStatus.unknown]: no On/Off, Open settings). The next
/// resume or tap reads again.
const notificationPermissionReadTimeout = Duration(seconds: 2);

/// The current status. Null until first read.
class NotificationPermissionController extends Notifier<NotificationPermissionStatus?> {
  /// The tap being handled, if any: a second tap meanwhile does nothing. A token,
  /// not a flag, so [dialogAbandoned] can hand the row back while that tap is still
  /// stuck on a dialog that will never answer, and the stuck tap, if it ever ends,
  /// does not clear a newer one.
  Object? _activation;

  @override
  NotificationPermissionStatus? build() => null;

  /// Re-reads the status from the OS: on first show, on resume, after a tap.
  Future<NotificationPermissionStatus> refresh() async {
    var next = await ref
        .read(notificationPermissionPlatformProvider)
        .status()
        .timeout(notificationPermissionReadTimeout, onTimeout: () => NotificationPermissionStatus.unknown);
    if (next == NotificationPermissionStatus.notDetermined && await _continuedOnAndroid()) {
      next = NotificationPermissionStatus.blocked;
    }
    if (ref.mounted) state = next;
    return next;
  }

  /// The upgrade path on Android. The native side tells "never asked" from
  /// "refused twice" only by its own saved first request, which builds before
  /// LR-11b never saved. #557's explanation remembers a Continue on this device,
  /// and a Continue was always followed by the system prompt; so with that record,
  /// "never asked" really means "asked, and no longer askable" -- blocked. iOS
  /// knows "never asked" itself and is trusted as it is. An unreadable store
  /// keeps the native answer.
  Future<bool> _continuedOnAndroid() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android || !ref.mounted) return false;
    try {
      return await ref.read(pushExplainerStoreProvider).continued();
    } catch (_) {
      return false;
    }
  }

  /// The row was removed while its explanation dialog was still open (its whole
  /// navigator went, e.g. a forced sign-out): that dialog's answer may never come.
  /// Hands the explanation back, as #557's host does, so the next session's
  /// explanation still shows, and frees the row for its next tap. A late answer
  /// from that dialog is then ignored.
  void dialogAbandoned() {
    _activation = null;
    if (!ref.mounted) return;
    ref.read(pushExplainerProvider.notifier).releaseFromSettings();
  }

  /// The Settings row was tapped. [showExplainer] shows #557's explanation dialog
  /// and completes with Continue (true), Not now (false) or null (removed).
  Future<void> activate(Future<bool?> Function() showExplainer) async {
    if (_activation != null) return;
    final activation = _activation = Object();
    try {
      final status = state ?? await refresh();
      if (!ref.mounted) return;
      switch (notificationPermissionActionFor(status)) {
        case NotificationPermissionAction.openSettings:
          await ref.read(notificationPermissionPlatformProvider).openSettings();
        case NotificationPermissionAction.askAgain:
          await ref.read(pushTokensProvider).start();
        case NotificationPermissionAction.explainThenAsk:
          final ask = await ref.read(pushExplainerProvider.notifier).askFromSettings(showExplainer);
          if (ask && ref.mounted) await ref.read(pushTokensProvider).start();
        case NotificationPermissionAction.none:
          return;
      }
      // The system prompt or the Settings app may still be on screen: the resume
      // re-read catches the final answer; this catches an immediate one.
      if (ref.mounted) await refresh();
    } finally {
      if (identical(_activation, activation)) _activation = null;
    }
  }
}

final notificationPermissionProvider =
    NotifierProvider<NotificationPermissionController, NotificationPermissionStatus?>(
  NotificationPermissionController.new,
);
