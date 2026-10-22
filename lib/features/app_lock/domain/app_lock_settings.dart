/// PD-23: how long the app may sit in the background before it asks to be unlocked again.
enum AppLockTimeout {
  immediately(Duration.zero, 'immediately'),
  oneMinute(Duration(minutes: 1), '1m'),
  fifteenMinutes(Duration(minutes: 15), '15m'),
  oneHour(Duration(hours: 1), '1h');

  const AppLockTimeout(this.duration, this.wire);

  final Duration duration;

  /// Stored as a word, never as an index, so reordering this enum cannot silently change
  /// anybody's setting.
  final String wire;

  /// The owner's default.
  static const fallback = AppLockTimeout.oneMinute;

  static AppLockTimeout parse(Object? raw) {
    for (final value in values) {
      if (value.wire == raw) return value;
    }
    return fallback;
  }
}

/// One account's app-lock preference on THIS device.
///
/// Not a secret and not a credential: it says whether to ask for Face ID / a fingerprint /
/// the passcode before showing the app. The session's tokens are untouched by it -- the lock
/// is a screen over the session, so background refresh, push and answering a call keep
/// working while it is up.
class AppLockSettings {
  const AppLockSettings({
    this.enabled = false,
    this.timeout = AppLockTimeout.fallback,
    this.offerAnswered = false,
  });

  /// Nothing chosen yet: off, one minute, never offered.
  static const initial = AppLockSettings();

  final bool enabled;
  final AppLockTimeout timeout;

  /// The one-time "lock the app?" offer has been answered (either way) on this device for
  /// this account, so it is never shown again.
  final bool offerAnswered;

  AppLockSettings copyWith({bool? enabled, AppLockTimeout? timeout, bool? offerAnswered}) =>
      AppLockSettings(
        enabled: enabled ?? this.enabled,
        timeout: timeout ?? this.timeout,
        offerAnswered: offerAnswered ?? this.offerAnswered,
      );

  Map<String, Object?> toJson() => {
        'enabled': enabled,
        'timeout': timeout.wire,
        'offerAnswered': offerAnswered,
      };

  /// Anything unreadable falls back to the safe reading of that field: not enabled (a lock
  /// the user never chose would be a lock-out), the default timeout, not yet offered.
  static AppLockSettings fromJson(Map<String, Object?> json) => AppLockSettings(
        enabled: json['enabled'] == true,
        timeout: AppLockTimeout.parse(json['timeout']),
        offerAnswered: json['offerAnswered'] == true,
      );

  @override
  bool operator ==(Object other) =>
      other is AppLockSettings &&
      other.enabled == enabled &&
      other.timeout == timeout &&
      other.offerAnswered == offerAnswered;

  @override
  int get hashCode => Object.hash(enabled, timeout, offerAnswered);

  @override
  String toString() =>
      'AppLockSettings(enabled: $enabled, timeout: ${timeout.wire}, offerAnswered: $offerAnswered)';
}
