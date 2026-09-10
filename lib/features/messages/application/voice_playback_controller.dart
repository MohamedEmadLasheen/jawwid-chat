import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/audio/voice_player.dart';

/// Which voice note the conversation is currently playing, and where it is.
class VoicePlaybackSession {
  const VoicePlaybackSession({
    this.attachmentId,
    this.status = const VoicePlaybackStatus(),
  });

  /// The note the single player is loaded with. Null when nothing is loaded.
  final String? attachmentId;
  final VoicePlaybackStatus status;

  bool isCurrent(String id) => attachmentId == id;

  /// State for one bubble. A note that is not the loaded one is idle by
  /// definition, which is what keeps every other bubble from re-rendering as
  /// the position of this one advances.
  VoicePlaybackStatus statusFor(String id) =>
      isCurrent(id) ? status : const VoicePlaybackStatus();

  VoicePlaybackSession copyWith({String? attachmentId, VoicePlaybackStatus? status}) =>
      VoicePlaybackSession(
        attachmentId: attachmentId ?? this.attachmentId,
        status: status ?? this.status,
      );
}

/// One player for the whole conversation.
///
/// Deliberately not one player per bubble. A thread can hold hundreds of voice
/// notes, and giving each its own platform audio session would allocate hundreds
/// of decoders to play at most one. It also gives the behaviour users expect for
/// free: starting a second note stops the first, because there is only one.
///
/// Pausing keeps the position, so pressing play again resumes rather than
/// restarting — the resume requirement is a property of holding the player
/// across taps rather than logic layered on top.
class VoicePlaybackController extends Notifier<VoicePlaybackSession> {
  VoicePlaybackController(this.conversationId);

  final String conversationId;

  late final VoicePlayer _player;
  StreamSubscription<VoicePlaybackStatus>? _subscription;

  @override
  VoicePlaybackSession build() {
    _player = ref.read(voicePlayerProvider);

    _subscription = _player.status.listen((status) {
      if (!ref.mounted) return;
      state = state.copyWith(status: status);
    });

    ref.onDispose(() {
      unawaited(_subscription?.cancel());
      // Leaving the conversation stops the audio. Playback continuing behind a
      // screen the user has left is never what they asked for.
      unawaited(_player.stop());
    });

    return const VoicePlaybackSession();
  }

  /// Play this note, or pause it if it is the one already playing.
  Future<void> toggle({required String attachmentId, required String url}) async {
    if (state.isCurrent(attachmentId)) {
      if (state.status.isPlaying) {
        await _player.pause();
      } else {
        await _player.play();
      }
      return;
    }

    // A different note: swap the player over. Position resets because this is a
    // different recording, not a resume.
    state = VoicePlaybackSession(
      attachmentId: attachmentId,
      status: const VoicePlaybackStatus(state: VoicePlaybackState.loading),
    );
    await _player.load(url);
    if (!ref.mounted) return;
    // An expired signed URL or an unplayable file fails here. Playing anyway
    // would replace the failure with a "playing" state that never advances,
    // which reads to the user as the app hanging rather than as an error.
    if (state.status.hasFailed) return;
    await _player.play();
  }

  /// Scrub within the loaded note. Ignored for any other, so a stray drag on a
  /// bubble that is not playing cannot move the one that is.
  Future<void> seek(String attachmentId, Duration position) async {
    if (!state.isCurrent(attachmentId)) return;
    await _player.seek(position);
  }
}

final voicePlaybackProvider =
    NotifierProvider.family<VoicePlaybackController, VoicePlaybackSession, String>(
  VoicePlaybackController.new,
);
