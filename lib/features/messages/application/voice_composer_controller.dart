import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/audio/voice_recorder.dart';
import '../../../core/data/repositories.dart';

/// Where the composer's recording flow has got to.
///
/// [starting] exists as its own stage rather than being folded into [recording]
/// because the permission prompt and the capture session both happen inside it:
/// without it, a second press while the OS dialog is up would start a second
/// recording.
enum VoiceComposerStage { idle, starting, recording, review }

class VoiceComposerState {
  const VoiceComposerState({
    this.stage = VoiceComposerStage.idle,
    this.elapsed = Duration.zero,
    this.amplitude = 0,
    this.draft,
    this.failure,
  });

  final VoiceComposerStage stage;
  final Duration elapsed;

  /// 0..1 input level, for the recording indicator.
  final double amplitude;

  /// The finished recording, awaiting send or discard.
  final PendingVoiceNote? draft;

  /// Why the last attempt did not produce a recording. Cleared on the next try.
  final VoiceRecorderFailure? failure;

  bool get isRecording => stage == VoiceComposerStage.recording;
  bool get isBusy => stage == VoiceComposerStage.starting;
  bool get isReviewing => stage == VoiceComposerStage.review && draft != null;

  /// True while the composer owns the input row.
  bool get isActive => stage != VoiceComposerStage.idle;

  VoiceComposerState copyWith({
    VoiceComposerStage? stage,
    Duration? elapsed,
    double? amplitude,
    PendingVoiceNote? draft,
    VoiceRecorderFailure? failure,
    bool clearDraft = false,
    bool clearFailure = false,
  }) {
    return VoiceComposerState(
      stage: stage ?? this.stage,
      elapsed: elapsed ?? this.elapsed,
      amplitude: amplitude ?? this.amplitude,
      draft: clearDraft ? null : (draft ?? this.draft),
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }
}

/// Drives record → review → send/discard for one chat screen.
///
/// The properties that matter, because each one is a bug that shows up only on
/// a real device:
///
/// * **A recording can never be started twice.** Every entry point checks the
///   stage first, so a double tap, or a tap while the permission dialog is open,
///   is a no-op rather than a second capture session.
/// * **Cancelling deletes the file.** An abandoned recording must not survive on
///   disk; the user believed they discarded it.
/// * **Every failure is a named reason**, not an exception, so the UI can say
///   the right thing for a denial, an unsupported device and a mis-tap.
class VoiceComposerController extends Notifier<VoiceComposerState> {
  VoiceComposerController(this.conversationId);

  /// Scopes the recording to one chat, so leaving it discards the draft rather
  /// than carrying a half-recorded note into the next conversation.
  final String conversationId;

  /// Client-side ceiling. Comfortably under the backend's voice-note limit, and
  /// low enough that a recording left running by accident cannot produce a file
  /// the sender would not want to send.
  static const maxDuration = Duration(minutes: 5);

  static const _tick = Duration(milliseconds: 100);

  late final VoiceRecorder _recorder;

  Timer? _ticker;
  StreamSubscription<double>? _amplitude;
  DateTime? _startedAt;

  @override
  VoiceComposerState build() {
    _recorder = ref.read(voiceRecorderProvider);
    ref.onDispose(() {
      _ticker?.cancel();
      unawaited(_amplitude?.cancel());
      // Leaving the screen mid-recording discards it: an unfinished note the
      // user navigated away from was never a message.
      unawaited(_recorder.cancel());
    });
    return const VoiceComposerState();
  }

  bool get _alive => ref.mounted;

  /// Begin recording, requesting permission if it is not already granted.
  Future<void> start() async {
    // The double-start guard. Everything else here assumes it held.
    if (state.stage != VoiceComposerStage.idle) return;

    state = state.copyWith(
      stage: VoiceComposerStage.starting,
      elapsed: Duration.zero,
      amplitude: 0,
      clearFailure: true,
      clearDraft: true,
    );

    try {
      if (!await _recorder.isSupported()) {
        return _fail(VoiceRecorderFailure.unsupported);
      }
      if (!await _recorder.hasPermission() && !await _recorder.requestPermission()) {
        return _fail(VoiceRecorderFailure.permissionDenied);
      }
      await _recorder.start();
    } on VoiceRecorderException catch (error) {
      return _fail(error.reason);
    } catch (_) {
      return _fail(VoiceRecorderFailure.failed);
    }

    if (!_alive) {
      // The screen closed while permission was being decided.
      await _recorder.cancel();
      return;
    }

    _startedAt = DateTime.now();
    state = state.copyWith(stage: VoiceComposerStage.recording, elapsed: Duration.zero);

    _ticker = Timer.periodic(_tick, (_) => _onTick());
    _amplitude = _recorder.amplitude.listen(
      (level) {
        if (_alive && state.isRecording) state = state.copyWith(amplitude: level);
      },
      // A silent meter is a cosmetic loss; it must not take the recording down.
      onError: (Object _) {},
    );
  }

  void _onTick() {
    final startedAt = _startedAt;
    if (!_alive || startedAt == null) return;

    final elapsed = DateTime.now().difference(startedAt);
    if (elapsed >= maxDuration) {
      unawaited(stop());
      return;
    }
    state = state.copyWith(elapsed: elapsed);
  }

  /// Finish recording and move to review. A too-short or empty capture is
  /// reported rather than silently becoming a message.
  Future<void> stop() async {
    if (!state.isRecording) return;
    _teardownMeters();

    try {
      final audio = await _recorder.stop();
      if (!_alive) return;
      state = state.copyWith(
        stage: VoiceComposerStage.review,
        elapsed: audio.duration,
        amplitude: 0,
        draft: PendingVoiceNote(
          filePath: audio.path,
          mimeType: audio.mimeType,
          byteSize: audio.byteSize,
          duration: audio.duration,
        ),
      );
    } on VoiceRecorderException catch (error) {
      _fail(error.reason);
    } catch (_) {
      _fail(VoiceRecorderFailure.failed);
    }
  }

  /// Abandon the recording or the draft, deleting the file either way.
  Future<void> cancel() async {
    if (state.stage == VoiceComposerStage.idle) return;
    _teardownMeters();
    await _recorder.cancel();
    if (!_alive) return;
    state = const VoiceComposerState();
  }

  /// Hand the reviewed draft to the caller and return to idle.
  ///
  /// Returns null when there is nothing to send, so a double tap on send cannot
  /// enqueue the same recording twice.
  PendingVoiceNote? takeDraft() {
    final draft = state.draft;
    if (draft == null) return null;
    state = const VoiceComposerState();
    return draft;
  }

  /// Dismiss an error message without starting a new recording.
  void acknowledgeFailure() {
    if (state.failure == null) return;
    state = state.copyWith(clearFailure: true);
  }

  /// Stop the timer and the level meter.
  ///
  /// Deliberately synchronous. The amplitude subscription is cancelled without
  /// being awaited: tearing down a cosmetic meter must never sit between the
  /// user pressing stop and the recording actually stopping.
  void _teardownMeters() {
    _ticker?.cancel();
    _ticker = null;

    final amplitude = _amplitude;
    _amplitude = null;
    if (amplitude != null) unawaited(amplitude.cancel());

    _startedAt = null;
  }

  void _fail(VoiceRecorderFailure reason) {
    _teardownMeters();
    if (!_alive) return;
    state = VoiceComposerState(failure: reason);
  }
}

/// One per conversation: leaving a chat abandons whatever was being recorded in it.
final voiceComposerProvider =
    NotifierProvider.family<VoiceComposerController, VoiceComposerState, String>(
  VoiceComposerController.new,
);
