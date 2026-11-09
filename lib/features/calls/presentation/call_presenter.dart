import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../design/tokens.dart';
import '../application/call_controller.dart';
import '../application/locked_call_guard.dart';

/// Puts a call on screen, wherever the user happens to be (W7).
///
/// WHY IT HAS TO BE APP-WIDE. An incoming call arrives while somebody is reading a
/// conversation, on the Calls tab, or in Settings. A listener that lived on one of
/// those screens would only notice a call while that screen was mounted, which is
/// the one thing a ringing phone cannot depend on.
///
/// IT ALSO INSTANTIATES THE CONTROLLER. `CallController.build` opens the
/// subscription to the session's realtime client, and a Riverpod provider is not
/// built until something reads it — so without this, nothing would be listening
/// for `call.incoming` at all. That is why this wraps the router's output rather
/// than sitting inside the tab shell, which only covers three of the routes.
///
/// THE ROUTER COMES FROM THE PROVIDER, NOT THE CONTEXT. Measured, not assumed:
/// this wraps `MaterialApp.router`'s `builder`, which sits ABOVE the router's own
/// inherited scope, so `GoRouter.of(context)` throws "No GoRouter found in
/// context" there. `routerProvider` is the same instance the app is built with,
/// and reading it works from anywhere.
///
/// IT DOES NOT DECIDE ANYTHING. No lifecycle, no authorization, no media: it reads
/// a phase and pushes a route. Everything else is [CallController]'s, and the
/// lifecycle behind that is the server's (W6).
///
/// OVER THE PHONE'S LOCK SCREEN IT IS THE CALL AND NOTHING ELSE (LR-46 P2-1,
/// [LockedCallGuard]). Android shows the app over the lock screen while a call from
/// it rings or is in progress. Then:
///  * a call that ends does not pop to reveal the route beneath: the app goes behind
///    the lock screen, and the call route comes down once the phone is unlocked;
///  * any route but the call's is covered and the call put back on top, whatever
///    navigated there (Back, Close and "Message" ask to unlock first, see
///    `CallRouteScreen`; this catches everything else, a deep link included).
/// On an unlocked phone none of this applies and nothing changes.
class CallPresenter extends ConsumerStatefulWidget {
  const CallPresenter({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<CallPresenter> createState() => _CallPresenterState();
}

class _CallPresenterState extends ConsumerState<CallPresenter> with WidgetsBindingObserver {
  /// True while the call route is the one we pushed, so it is pushed once per
  /// call and popped once — never twice, whichever terminal event arrives first.
  bool _onScreen = false;

  /// The router whose route changes rebuild this (for the lock-screen cover).
  GoRouter? _router;

  /// One put-back at a time.
  bool _enforcing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _router?.routerDelegate.removeListener(_onRouteChanged);
    super.dispose();
  }

  void _onRouteChanged() {
    // Deferred, as the app lock's bypass does: a route can change while a frame is being
    // built. A microtask still lands before the next frame.
    scheduleMicrotask(() {
      if (mounted) setState(() {});
    });
  }

  void _follow(GoRouter router) {
    if (identical(router, _router)) return;
    _router?.routerDelegate.removeListener(_onRouteChanged);
    _router = router;
    router.routerDelegate.addListener(_onRouteChanged);
  }

  /// Back in front: the phone may have been locked or unlocked meanwhile.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_onResumed());
  }

  Future<void> _onResumed() async {
    final guard = ref.read(lockedCallGuardProvider.notifier);
    final locked = await guard.refresh();
    if (!mounted || locked) return;
    // A call that ended while the phone was locked left its route up (see [_takeDown]):
    // now unlocked, it comes down.
    if (ref.read(callControllerProvider).phase == CallUiPhase.idle && !guard.leaving) {
      final router = ref.read(routerProvider);
      if (topRoutePath(router) == Routes.activeCall && router.canPop()) router.pop();
    }
  }

  /// The call is over: take its route down -- unless the phone is locked, where
  /// that would show what was open before the call.
  Future<void> _takeDown() async {
    final guard = ref.read(lockedCallGuardProvider.notifier);
    // Close or "Message" is already taking the route down, through the guard.
    if (guard.leaving) return;
    final router = ref.read(routerProvider);
    // Only pop the call route, and only if it is still the top one. The user
    // may already have left it themselves.
    if (topRoutePath(router) != Routes.activeCall) return;
    if (ref.read(lockedCallGuardProvider)) {
      if (await guard.refresh()) {
        await guard.returnToLockScreen();
        return;
      }
      if (!mounted || guard.leaving) return;
      if (ref.read(callControllerProvider).phase != CallUiPhase.idle) return;
      if (topRoutePath(router) != Routes.activeCall) return;
    }
    if (router.canPop()) router.pop();
  }

  /// Off the call screen on a locked phone: put the call back on top.
  Future<void> _enforceCallOnly() async {
    if (_enforcing) return;
    _enforcing = true;
    try {
      final guard = ref.read(lockedCallGuardProvider.notifier);
      // An unlock prompt is up: its outcome decides first. Waited for, not given up on
      // (review of #561, P3-6): cancelled with a route pushed meanwhile, the live call
      // must still be put back, or the cover would hide its controls.
      while (true) {
        await guard.settled;
        if (!mounted) return;
        // Not over the lock screen after all (unlocked by the guard or the person, or no
        // call holds the lock screen): the cover lifts.
        if (!await guard.refresh()) return;
        if (!mounted) return;
        if (!guard.leaving) break;
      }
      final router = ref.read(routerProvider);
      if (topRoutePath(router) == Routes.activeCall) return;
      // A call is up: it is the one screen over the lock screen. No call (a ring Dart has
      // not heard of yet, or one that just ended): the cover stays until the phone is
      // unlocked, and Android's own ring window takes the app off the lock screen.
      if (ref.read(callControllerProvider).phase != CallUiPhase.idle) {
        unawaited(router.push(Routes.activeCall));
      }
    } finally {
      _enforcing = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Reading the phase keeps the controller alive AND is the only thing this
    // needs: `isPresent` is false in exactly one state, `idle`.
    final phase = ref.watch(callControllerProvider.select((state) => state.phase));
    final present = phase != CallUiPhase.idle;
    final locked = ref.watch(lockedCallGuardProvider);
    final router = ref.watch(routerProvider);
    _follow(router);

    if (present && !_onScreen) {
      _onScreen = true;
      // After the frame: pushing a route during build is not allowed, and an
      // incoming call arrives whenever the server says so.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final router = ref.read(routerProvider);
        if (router.state.uri.path != Routes.activeCall) {
          router.push(Routes.activeCall);
        }
        // LR-46: is this call over the phone's lock screen?
        unawaited(ref.read(lockedCallGuardProvider.notifier).refresh());
      });
    } else if (!present && _onScreen) {
      _onScreen = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_takeDown());
      });
    }

    // LR-46: shown over the lock screen as last seen (native: locked AND a call holds the
    // lock screen, never a locked phone alone -- review of #561, P1), and the call is not
    // the route on top.
    final top = locked ? topRoutePath(router) : null;
    final covered = top != null && top != Routes.activeCall;
    if (covered) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_enforceCallOnly());
      });
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        ExcludeSemantics(
          excluding: covered,
          child: ExcludeFocus(excluding: covered, child: widget.child),
        ),
        if (covered) const _LockScreenCover(),
      ],
    );
  }
}

/// What shows instead of the app over a locked phone, away from the call: nothing of it.
class _LockScreenCover extends StatelessWidget {
  const _LockScreenCover();

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    return AbsorbPointer(
      key: const ValueKey('locked-call-cover'),
      child: ColoredBox(
        color: tokens.colorMediaSurface,
        child: Center(
          child: Icon(Icons.lock,
              color: tokens.colorMediaOnSurfaceMuted, size: 48, textDirection: TextDirection.ltr),
        ),
      ),
    );
  }
}
