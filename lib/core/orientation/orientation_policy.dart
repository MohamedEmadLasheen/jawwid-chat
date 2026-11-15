import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// LR-39: which way up the app may be held.
///
/// The screens are designed for portrait and were never checked in landscape, so
/// the app asks to be held portrait (iOS and Android alike). The one exception is
/// the whiteboard's full-screen mode, which PD-55 rev2 promises in landscape: it
/// opens landscape while it is up and on top, and closes it again on the way out.
///
/// These are preferences, not guarantees: iOS ignores them for an iPad app that
/// supports multitasking, and Android 16+ ignores them on large screens, so a
/// tablet may still turn every screen. The phone is what this policy is for.
///
/// `Info.plist` and the Android manifest still allow landscape on purpose:
/// without that, the full-screen board could not turn at all.
const List<DeviceOrientation> kAppOrientations = [DeviceOrientation.portraitUp];

/// The full-screen board: portrait or either landscape (never upside down).
const List<DeviceOrientation> kBoardFullScreenOrientations = [
  DeviceOrientation.portraitUp,
  DeviceOrientation.landscapeLeft,
  DeviceOrientation.landscapeRight,
];

/// Hold the app in portrait. A browser keeps its own orientation.
Future<void> lockAppOrientation() async {
  if (kIsWeb) return;
  await SystemChrome.setPreferredOrientations(kAppOrientations);
}

/// Let the full-screen board turn to landscape.
Future<void> allowBoardFullScreenOrientations() async {
  if (kIsWeb) return;
  await SystemChrome.setPreferredOrientations(kBoardFullScreenOrientations);
}

/// Keeps the full-screen board's landscape to the board itself. The router registers
/// it (router.dart `observers`). While a board is full screen ([boardRoute] set by the
/// board), whatever lands on top decides: another page (an incoming call, a
/// conversation from a notification) is held portrait, even when it opens above one of
/// the board's sheets; the board itself may turn; a popup (a sheet, a menu, a dialog)
/// changes nothing, so the board's tools keep landscape.
class OrientationRouteObserver extends NavigatorObserver {
  /// The route of the board that is full screen now, or null.
  Route<dynamic>? boardRoute;

  void _topIs(Route<dynamic>? top) {
    final board = boardRoute;
    if (board == null || top == null) return;
    if (identical(top, board)) {
      unawaited(allowBoardFullScreenOrientations());
    } else if (top is PageRoute<dynamic>) {
      unawaited(lockAppOrientation());
    }
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _topIs(route);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _topIs(previousRoute);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    if (newRoute != null && newRoute.isCurrent) _topIs(newRoute);
  }
}

/// The one observer the app's router uses (and the tests' navigators).
final OrientationRouteObserver orientationObserver = OrientationRouteObserver();
