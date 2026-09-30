import 'package:livekit_client/livekit_client.dart' as lk;

/// Where the call's audio comes out.
///
/// W7-OWNED, AND DELIBERATELY NOT PART OF [MediaRoom]. `MediaRoom` is W4 and is
/// CLOSED: it exposes `connect`, `setMicrophoneEnabled`, `disconnect` and
/// `dispose`, and has no audio-route method. Speaker control is a W7 requirement
/// (`screens/call.md` §1, "secondary: mute · speaker"), so it arrives as its own
/// port here rather than by widening a closed contract. The two are different
/// questions anyway — one is about a room, this is about a device — which is the
/// same reason [MicrophonePermission] is separate from [MediaRoom].
///
/// NO NEW DEPENDENCY. `livekit_client` is already in this project for W4, and
/// the routing lives in the same SDK.
///
/// A SEAM SO THE LAYER ABOVE IS TESTABLE. Nothing above this can be tested
/// against a real speaker; a fake implementation lets the call controller's
/// behaviour be proven without a device, exactly as W4's ports do.
abstract interface class AudioRoute {
  /// Whether this platform can move audio between earpiece and speaker at all.
  ///
  /// False on desktop and web. The interface uses this to decide whether to
  /// OFFER the control, because a button that silently does nothing is worse
  /// than no button.
  bool get canSwitch;

  /// Whether loudspeaker output is currently preferred.
  bool get speakerPreferred;

  /// Ask for loudspeaker output, or for the default route.
  ///
  /// "Preferred" and not "forced": a wired or Bluetooth headset still wins,
  /// which is what a user who has just plugged one in expects. Forcing the
  /// speaker over a connected headset is a surprise nobody asked for.
  Future<void> setSpeakerPreferred(bool preferred);
}

/// [AudioRoute] over the LiveKit SDK already in this project.
///
/// THE NON-DEPRECATED API, checked against the installed version rather than
/// remembered. In `livekit_client` 2.13.0 `Hardware.setSpeakerphoneOn` and
/// `Hardware.speakerOn` are both `@Deprecated` in favour of
/// `AudioManager.instance` — `setSpeakerOutputPreferred`,
/// `isSpeakerOutputPreferred` and `canSwitchSpeakerphone`. This uses those.
///
/// WHAT IS NOT VERIFIED. No real device has ever changed route through this.
/// `AudioManager.canSwitchSpeakerphone` is false off iOS/Android, so in a plain
/// VM test this reports "cannot switch" and does nothing, which is the whole of
/// what the tests here prove. Hearing audio move from earpiece to speaker needs
/// a phone. See the W7 closeout.
class LiveKitAudioRoute implements AudioRoute {
  LiveKitAudioRoute({lk.AudioManager? manager})
      : _manager = manager ?? lk.AudioManager.instance;

  final lk.AudioManager _manager;

  @override
  bool get canSwitch => _manager.canSwitchSpeakerphone;

  @override
  bool get speakerPreferred => _manager.isSpeakerOutputPreferred;

  @override
  Future<void> setSpeakerPreferred(bool preferred) async {
    // Asking on a platform that cannot switch logs a warning inside the SDK and
    // changes nothing. Returning early keeps that out of the logs entirely: the
    // caller has already been told `canSwitch` is false.
    if (!_manager.canSwitchSpeakerphone) return;
    await _manager.setSpeakerOutputPreferred(preferred);
  }
}
