import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'call_presentation.dart';

/// The system call screen for this build (W8-W3).
///
/// Overridable so no test touches a method channel, and so a build without a
/// native call layer -- a fixture build, a platform W8-W3 has not reached --
/// simply has none rather than failing.
///
/// It is NOT session-scoped. CallKit reports a call before this app knows
/// whether it has a session at all: on a cold VoIP wake the screen is already
/// up when Dart starts. Tying the seam to `authControllerProvider` would mean
/// the one path that needs it most had no way to take the screen back down.
final callPresentationProvider = Provider<CallPresentation?>((ref) {
  final presentation = PlatformCallPresentation();
  ref.onDispose(presentation.dispose);
  return presentation;
});
