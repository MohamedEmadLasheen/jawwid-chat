import 'package:flutter/foundation.dart';
import 'package:record/record.dart';
import 'package:url_launcher/url_launcher.dart';

/// Whether this device will let us capture audio.
enum MicrophoneAccess {
  granted,

  /// Refused. Whether refused once or refused for good is not distinguishable
  /// through this implementation — see [MicrophonePermission].
  denied,

  /// No capture device, or the platform cannot record at all.
  unavailable,
}

/// The microphone-permission seam.
///
/// Separate from [MediaRoom] because it is a device question, not a room
/// question, and because a test must be able to drive a denial without a
/// platform dialog that nothing will ever tap.
///
/// WHY IT EXISTS AT ALL, when LiveKit prompts by itself: `setMicrophoneEnabled`
/// asks WebRTC to capture, which surfaces the OS prompt and then throws if the
/// user refuses. That works, but it means the refusal arrives AFTER a room has
/// been joined and a publish attempted — the user is in a call that cannot hear
/// them. Asking first lets the failure happen before any of that, which is also
/// what `screens/call.md` §7 asks for: the explanation comes "before dialling
/// rather than after".
///
/// A KNOWN LIMIT. `permanently denied` — the state that needs a trip to
/// Settings rather than another prompt — is NOT represented, because nothing
/// here can tell it apart from an ordinary refusal. The `record` package
/// answers a single boolean. Distinguishing the two needs a permission plugin
/// (`permission_handler`), which is a dependency decision rather than something
/// to slip in; an enum value that no implementation can ever return would look
/// like coverage and provide none. Recorded as carry-forward.
abstract interface class MicrophonePermission {
  /// Prompt if necessary, and report what we ended up with.
  Future<MicrophoneAccess> ensure();
}

/// [MicrophonePermission] over the `record` plugin already in this project.
///
/// Reused rather than adding a second permission mechanism: `record` is here for
/// voice messages, it asks the platform for the same microphone, and its
/// `hasPermission()` prompts when permission has not yet been decided.
class RecordMicrophonePermission implements MicrophonePermission {
  RecordMicrophonePermission({AudioRecorder? recorder})
      : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  @override
  Future<MicrophoneAccess> ensure() async {
    try {
      final granted = await _recorder.hasPermission();
      return granted ? MicrophoneAccess.granted : MicrophoneAccess.denied;
    } catch (_) {
      // A platform that cannot answer cannot capture. Failing closed here is
      // the difference between "no audio" and a call that looks connected and
      // is silent.
      return MicrophoneAccess.unavailable;
    }
  }
}

/// LR-26: the way back from a refused microphone. Opens this app's own page in
/// the system Settings, where the microphone can be allowed again.
///
/// THE SEAM. No test reaches a platform; the call screen asks [canOpen] before
/// it offers the button, so a platform without a way there shows the words
/// alone ("allow it in Settings, then try again") rather than a dead button.
abstract interface class MicrophoneSettings {
  /// Whether [open] can work on this platform at all.
  bool get canOpen;

  /// True when Settings was opened. False when it could not be.
  Future<bool> open();
}

/// [MicrophoneSettings] over `url_launcher`, already a dependency.
///
/// iOS ONLY. `app-settings:` is `UIApplication.openSettingsURLString`, the
/// documented way to this app's own Settings page, and needs no native code.
/// Android has no URL for its "App info" page: that needs an
/// `ACTION_APPLICATION_DETAILS_SETTINGS` intent from `MainActivity.kt`, a native
/// change outside LR-26 (carry-forward). `permission_handler` would also do it,
/// and is a dependency decision. Until then Android shows the instruction
/// without the button. The web portal has no Settings page to open.
///
/// iOS TERMINATES THE APP when a privacy permission is changed in Settings, so
/// coming back is a fresh launch: the failed call screen is gone and the
/// person calls again. Nothing here tries to restore it (no restart recovery).
///
/// WHAT IS NOT VERIFIED: that iOS opens the page, and whether a call still
/// ringing reappears after the restart (LR-08). No device run was made for
/// this change; the first proof is a QA build (SB-38).
class PlatformMicrophoneSettings implements MicrophoneSettings {
  PlatformMicrophoneSettings({
    Future<bool> Function(Uri uri)? launch,
    bool? isIOS,
  })  : _launch = launch ?? launchUrl,
        _isIOS = isIOS ?? (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS);

  static final Uri appSettings = Uri.parse('app-settings:');

  final Future<bool> Function(Uri uri) _launch;
  final bool _isIOS;

  @override
  bool get canOpen => _isIOS;

  @override
  Future<bool> open() async {
    if (!canOpen) return false;
    try {
      return await _launch(appSettings);
    } catch (_) {
      return false;
    }
  }
}
