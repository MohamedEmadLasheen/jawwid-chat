import 'package:record/record.dart';

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
