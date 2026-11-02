import 'dart:async';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/providers.dart';
import '../../../core/realtime/realtime_socket.dart';
import '../../../shared/models/user_role.dart';
import '../domain/rewards.dart';

/// PD-55: `learner.reward_given` on this session's socket -- the family's
/// celebration, and the teacher's own other devices. The server sends it to
/// the learner's family's live contacts and the teacher only, each to their
/// own actor room: arriving here means it is ours to show.
const rewardGivenEvent = 'learner.reward_given';

/// The latest reward this session heard, numbered so two identical ones are two
/// celebrations. Null until one arrives.
class RewardFeed extends Notifier<({int seq, RewardGiven reward})?> {
  StreamSubscription<RealtimeFrame>? _frames;
  int _seq = 0;

  @override
  ({int seq, RewardGiven reward})? build() {
    // A new account is a new feed: nothing heard by the last one is shown.
    ref.watch(authControllerProvider.select((s) => s.user?.id));
    RealtimeSocket socket;
    try {
      socket = ref.watch(realtimeSocketProvider);
    } catch (_) {
      return null; // a build with no realtime seam: no live rewards
    }
    _frames = socket.frames.listen((frame) {
      if (frame.event != rewardGivenEvent) return;
      final reward = RewardGiven.fromPayload(frame.payload);
      if (reward != null) state = (seq: ++_seq, reward: reward);
    });
    // Never awaited (dart-await-subscription-cancel-hangs).
    ref.onDispose(() => unawaited(_frames?.cancel()));
    return null;
  }
}

final rewardFeedProvider = NotifierProvider<RewardFeed, ({int seq, RewardGiven reward})?>(RewardFeed.new);

// -- the sounds ----------------------------------------------------------------------

/// PD-55: which sound a reward plays (assets/sounds/LICENSE.md: our own, CC0).
enum RewardCue {
  /// A star or a sticker: two bright bell notes.
  encouragement('assets/sounds/reward_encouragement.wav'),

  /// A praise stamp: a short round of applause.
  applause('assets/sounds/reward_applause.wav'),

  /// A celebration: a little fanfare.
  celebration('assets/sounds/reward_celebration.wav');

  const RewardCue(this.asset);
  final String asset;

  static RewardCue of(RewardGiven reward) => switch (reward.kind) {
    'celebration' => celebration,
    'praise' => applause,
    _ => encouragement,
  };
}

/// Where the "play reward sounds" choice is kept, per device.
abstract interface class RewardSoundStore {
  Future<bool?> read();
  Future<void> write(bool on);
}

class SharedPreferencesRewardSoundStore implements RewardSoundStore {
  const SharedPreferencesRewardSoundStore();

  static const _key = 'jawwid.rewards.sound';

  @override
  Future<bool?> read() async => (await SharedPreferences.getInstance()).getBool(_key);

  @override
  Future<void> write(bool on) async => (await SharedPreferences.getInstance()).setBool(_key, on);
}

final rewardSoundStoreProvider = Provider<RewardSoundStore>((ref) => const SharedPreferencesRewardSoundStore());

/// Whether reward sounds play on this device. Until the person chooses: ON on a
/// family's phone, OFF for a teacher and in the browser (the teacher portal) --
/// the child hears it, the teacher's class does not (plan §3 B2).
class RewardSound extends AsyncNotifier<bool> {
  @override
  Future<bool> build() async {
    final role = ref.watch(currentRoleProvider);
    final fallback = !kIsWeb && role == UserRole.parent;
    try {
      return await ref.read(rewardSoundStoreProvider).read() ?? fallback;
    } on Object {
      return fallback;
    }
  }

  Future<void> set(bool on) async {
    state = AsyncData(on);
    try {
      await ref.read(rewardSoundStoreProvider).write(on);
    } on Object {
      // The choice holds for this launch; storage heals on the next.
    }
  }
}

final rewardSoundProvider = AsyncNotifierProvider<RewardSound, bool>(RewardSound.new);

/// Plays a reward's sound. A seam, so a test hears nothing.
abstract interface class RewardChime {
  Future<void> play(RewardCue cue);
}

/// just_audio, made to stay quiet when the phone is: it never takes over the
/// app's audio session (so an iPhone's silent switch -- the default
/// session -- silences it, and a call's session is left alone), and on Android
/// it plays as a notification sound, which the ringer's silent mode silences.
class JustAudioRewardChime implements RewardChime {
  AudioPlayer? _player;

  @override
  Future<void> play(RewardCue cue) async {
    try {
      final player = _player ??= AudioPlayer(handleInterruptions: false, handleAudioSessionActivation: false, androidApplyAudioAttributes: false);
      await player.setAndroidAudioAttributes(
        const AndroidAudioAttributes(contentType: AndroidAudioContentType.sonification, usage: AndroidAudioUsage.notificationEvent),
      );
      await player.setAsset(cue.asset);
      await player.seek(Duration.zero);
      unawaited(player.play());
    } on Object {
      // A sound that cannot play is not a failure: the celebration is still seen.
    }
  }
}

final rewardChimeProvider = Provider<RewardChime>((ref) {
  final chime = JustAudioRewardChime();
  return chime;
});
