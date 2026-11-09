import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/call_native/call_native_providers.dart';
import '../../../core/call_native/device_keyguard.dart';
import 'call_controller.dart';

/// LR-46 P2-1: over the phone's lock screen, the app is the call and nothing else.
///
/// Android shows the app over the lock screen while a call from the lock screen rings or
/// is in progress, so the call can be answered without unlocking. Without this guard that
/// was the WHOLE app: the call route sits on top of whatever was open, and Back, Close or
/// "Message" uncovered the chats beneath it on a locked phone.
///
/// Now, while the phone is locked:
///  * Back, Close and opening the conversation from the call screen go through [leave]:
///    the person unlocks first (Android's own prompt), and only then does the app navigate.
///    Cancelled: the call screen stays; if the call is over, the app goes behind the lock
///    screen instead.
///  * A call that ends is not popped to reveal the route beneath (CallPresenter): the app
///    goes behind the lock screen, and the call route is taken down once unlocked.
///  * Anything else that takes the app off the call screen is covered (CallPresenter) and
///    put back on the call.
///
/// The state is the phone's lock as last seen: refreshed when a call screen is shown, when
/// the app comes back to the front, and on every [leave] that finds it locked. Unlocked as
/// last seen, everything is exactly as before: no prompt, no wait.
class LockedCallGuard extends Notifier<bool> {
  @override
  bool build() => false;

  DeviceKeyguard get _keyguard => ref.read(deviceKeyguardProvider);

  bool _leaving = false;

  /// True while [leave] waits on the lock screen: the call route is on its way out through
  /// the guard, and nothing else should take it down meanwhile.
  bool get leaving => _leaving;

  /// Ask the phone whether it is locked, and remember the answer.
  Future<bool> refresh() async {
    final locked = await _keyguard.isLocked();
    if (ref.mounted) state = locked;
    return locked;
  }

  /// Take the app off the call screen with [navigate] -- unlocking first if the phone is
  /// locked. Returns whether it navigated.
  Future<bool> leave(void Function() navigate) async {
    if (_leaving) return false;
    if (!state) {
      // Unlocked as last seen: unchanged, and at once.
      navigate();
      return true;
    }
    _leaving = true;
    try {
      if (await refresh()) {
        final unlocked = await _keyguard.requestUnlock();
        if (!unlocked) {
          // Cancelled or refused: nothing beneath the call is shown. A call that is over
          // has nothing left on the call screen, so the lock screen comes back instead.
          if (_callOver()) await _keyguard.returnToLockScreen();
          return false;
        }
        if (ref.mounted) state = false;
      }
      navigate();
      return true;
    } finally {
      _leaving = false;
    }
  }

  /// The call is over and the phone is locked: go behind the lock screen.
  Future<void> returnToLockScreen() => _keyguard.returnToLockScreen();

  bool _callOver() {
    if (!ref.mounted) return true;
    final call = ref.read(callControllerProvider);
    return call.phase == CallUiPhase.idle || call.isTerminal;
  }
}

/// See [LockedCallGuard]. True: the phone was locked when last asked.
final lockedCallGuardProvider = NotifierProvider<LockedCallGuard, bool>(LockedCallGuard.new);
