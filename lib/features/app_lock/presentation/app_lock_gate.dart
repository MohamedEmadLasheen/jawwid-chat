import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/push/push_permission_explainer.dart';
import '../../legal/application/legal_gate_state.dart';
import '../../settings/data/parent_notice_repository.dart';
import '../application/app_lock_call_bypass.dart';
import '../application/app_lock_controller.dart';
import 'app_lock_screen.dart';

/// PD-23: the app lock, laid over EVERYTHING the router renders.
///
/// It wraps `MaterialApp.router`'s output (see `app.dart`), so no protected route -- and no
/// dialog or sheet a route opened -- can render above an unlocked check. The router's tree
/// stays mounted underneath: a lock is a screen over the session, not the end of it, so
/// realtime, the call controller and every half-typed draft keep running.
///
/// While covered, the app underneath is excluded from semantics and focus, so neither a
/// screen reader nor a hardware keyboard can reach it.
///
/// ## The one exception: a call
///
/// A call rings and can be answered without unlocking (WhatsApp behaviour). While
/// [appLockCallBypassProvider] is true -- a call is up AND the call screen is the route on
/// top -- nothing is laid over the app. The lock state itself is untouched, so leaving the
/// call screen for anything else brings the lock straight back.
///
/// It also reports the app lifecycle to the controller: the background timeout and the
/// app-switcher privacy cover are both driven from here.
class AppLockGate extends ConsumerStatefulWidget {
  const AppLockGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    ref.read(appLockControllerProvider.notifier).onLifecycle(state);
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockControllerProvider);
    final callOnScreen = lock.covered && ref.watch(appLockCallBypassProvider);
    final covered = lock.covered && !callOnScreen;
    // PARENT-001: one first-run dialog at a time -- the lesson-audio notice first.
    final noticeBusy = ref.watch(lessonAudioNoticeBusyProvider);
    // PD-58: nor over the Terms of Use gate -- the offer comes once the terms are accepted.
    final legalGateShown = ref.watch(legalGateShownProvider);
    // LR-11: nor over the notification explanation. It may open before the offer is
    // known (lock settings are read asynchronously); the offer follows its answer.
    final explainerUp = ref.watch(pushExplainerProvider) == PushExplainerPhase.onScreen;

    return Stack(
      fit: StackFit.expand,
      children: [
        ExcludeSemantics(
          excluding: covered,
          child: ExcludeFocus(excluding: covered, child: widget.child),
        ),
        if (covered)
          lock.phase == AppLockPhase.locked
              // Its own navigator: the gate sits above the router's, and the lock screen's
              // sign-out confirmation needs somewhere to open.
              ? HeroControllerScope.none(
                  child: Navigator(
                    pages: const [MaterialPage<void>(child: AppLockScreen())],
                    onDidRemovePage: (_) {},
                  ),
                )
              : const AppLockPrivacyCover(),
        if (lock.offerVisible && !covered && !noticeBusy && !legalGateShown && !explainerUp) const AppLockOffer(),
        if (lock.obscured) const AppLockPrivacyCover(),
      ],
    );
  }
}
