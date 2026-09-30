import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/router.dart';
import '../application/call_controller.dart';

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
class CallPresenter extends ConsumerStatefulWidget {
  const CallPresenter({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<CallPresenter> createState() => _CallPresenterState();
}

class _CallPresenterState extends ConsumerState<CallPresenter> {
  /// True while the call route is the one we pushed, so it is pushed once per
  /// call and popped once — never twice, whichever terminal event arrives first.
  bool _onScreen = false;

  @override
  Widget build(BuildContext context) {
    // Reading the phase keeps the controller alive AND is the only thing this
    // needs: `isPresent` is false in exactly one state, `idle`.
    final phase = ref.watch(callControllerProvider.select((state) => state.phase));
    final present = phase != CallUiPhase.idle;

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
      });
    } else if (!present && _onScreen) {
      _onScreen = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final router = ref.read(routerProvider);
        // Only pop the call route, and only if it is still the top one. The user
        // may already have left it themselves.
        if (router.state.uri.path == Routes.activeCall && router.canPop()) {
          router.pop();
        }
      });
    }

    return widget.child;
  }
}
