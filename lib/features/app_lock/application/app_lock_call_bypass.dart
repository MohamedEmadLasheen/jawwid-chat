import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/router.dart';
import '../../calls/application/call_controller.dart';

/// True while a call is on this device AND the call screen is the one showing.
///
/// THE LOCK MUST NOT STAND BETWEEN SOMEBODY AND A RINGING CALL. Like WhatsApp, a call rings
/// and can be answered -- and talked through -- without unlocking: the app lock gate stops
/// covering the app for exactly as long as this is true.
///
/// It is deliberately TWO conditions, not one. A call in progress is not a key to the app:
/// the moment the user leaves the call screen for a chat (Back, or "Message" after the call)
/// the route is no longer the call's, this turns false, and the lock is back over whatever
/// they navigated to. Nothing beneath the call screen is reachable while locked.
///
/// The call screen is pushed by `CallPresenter` from the same phase this reads; how a call
/// reaches that phase (realtime `call.incoming`, a CallKit answer from a cold start) is the
/// call controller's business and is untouched by the lock.
final appLockCallBypassProvider = Provider<bool>((ref) {
  final inCall = ref.watch(
    callControllerProvider.select((state) => state.phase != CallUiPhase.idle),
  );
  if (!inCall) return false;

  final router = ref.watch(routerProvider);
  final delegate = router.routerDelegate;
  void onRouteChanged() {
    // Deferred: a route can change while a frame is being built, and a provider must not be
    // invalidated in the middle of one. A microtask still lands before the next frame.
    scheduleMicrotask(() {
      if (ref.mounted) ref.invalidateSelf();
    });
  }

  delegate.addListener(onRouteChanged);
  ref.onDispose(() => delegate.removeListener(onRouteChanged));

  // Read the way CallPresenter reads it, so the two can never disagree about which screen
  // is the call's.
  return router.state.uri.path == Routes.activeCall;
});
