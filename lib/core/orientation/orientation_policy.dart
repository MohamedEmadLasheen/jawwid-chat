import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';

/// LR-39: which way up the app may be held.
///
/// The screens are designed for portrait and were never checked in landscape, so the app is held
/// portrait on phones (iOS and Android alike). The one exception is the
/// whiteboard's full-screen mode, which PD-55 rev2 promises in landscape on a
/// phone: it opens landscape while it is up and closes it again on the way out.
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
