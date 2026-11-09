/// LR-46 P2-1: the phone's own lock screen, as the call screen needs to know it.
///
/// Android shows the app over the lock screen while a call from the lock screen rings or
/// is in progress (MainActivity, `LockScreenCall`). Over the lock screen the app must be
/// the call and nothing else: whoever holds a locked phone may answer it, not read the
/// chats. So before anything takes the app off the call screen, the person unlocks.
///
/// Spoken on the call channel (`jawwid/call_native`) by [PlatformCallPresentation]. A
/// platform with no such half (iOS, whose CallKit screen is the system's; a test; a
/// browser) is never locked here, and everything stays as it was.
abstract interface class DeviceKeyguard {
  /// Whether the app is shown over the phone's lock screen: the phone is locked AND a call
  /// holds the lock screen (review of #561, P1). A locked phone alone is not enough: with
  /// no such call the app is not over the lock screen, and nothing may be covered.
  /// False where the platform has no such half.
  Future<bool> isLocked();

  /// Ask the person to unlock (Android's own prompt). True once unlocked, or when the
  /// phone was not locked; false on cancel or failure. Once unlocked, Android stops
  /// showing the app over the lock screen for the call (review of #561, P2-2).
  Future<bool> requestUnlock();

  /// The call is over and the phone still locked: go behind the lock screen, so what was
  /// open before the call is not shown. A no-op on an unlocked phone.
  Future<void> returnToLockScreen();
}

/// No lock screen to respect: everything as it was.
class NoDeviceKeyguard implements DeviceKeyguard {
  const NoDeviceKeyguard();

  @override
  Future<bool> isLocked() async => false;

  @override
  Future<bool> requestUnlock() async => true;

  @override
  Future<void> returnToLockScreen() async {}
}
