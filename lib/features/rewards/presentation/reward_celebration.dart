import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../app_lock/application/app_lock_controller.dart';
import '../../calls/application/locked_call_guard.dart';
import '../application/reward_feed.dart';
import '../domain/rewards.dart';

/// PD-55: the celebration a child sees on the family's phone when their teacher
/// rewards them -- a 2.5 s burst of stars and confetti over WHATEVER is on screen
/// (a call, a chat, Settings), with one line saying what it was, and its sound
/// when this device has it on.
///
/// It is mounted once, around the whole app (app.dart), so no screen -- and no
/// frozen call file -- has to know about it. It never takes a tap: everything
/// under it keeps working while it plays. With "reduce motion" on it is a
/// gentle fade with a star, no particles; nothing flashes.
///
/// It sits outside the app lock (PD-23), so it says nothing while the lock covers
/// the app or the privacy cover hides it: a reward that arrives then is not shown
/// or heard -- not then, and not later -- and one already playing disappears.
///
/// LR-46 (#561 review, P3-9): it also sits above the call presenter, so over the
/// phone's lock screen (Android shows the app there while a call from the lock
/// screen rings or is in progress, `LockedCallGuard`) it would draw its line over
/// the call screen and over the cover that hides the app: app content on a locked
/// phone. So while the guard says the app is shown over the lock screen, nothing
/// plays and one already playing disappears. A reward that arrives then is not
/// lost, unlike under the app lock: a child answering a lesson call from the lock
/// screen is the usual case, not the exception. The latest one is kept (it carries
/// the lesson's newest tally) and plays, with its sound, once the guard says the
/// app is no longer over the lock screen -- unlocked, and back in front -- unless
/// the app lock covers the app by then, which drops it as above. Unlocked,
/// nothing changes: it plays over everything, a call included.
class RewardCelebrationHost extends ConsumerStatefulWidget {
  const RewardCelebrationHost({super.key, required this.child});

  final Widget child;

  static const duration = Duration(milliseconds: 2500);

  @override
  ConsumerState<RewardCelebrationHost> createState() => _RewardCelebrationHostState();
}

class _RewardCelebrationHostState extends ConsumerState<RewardCelebrationHost> with SingleTickerProviderStateMixin {
  late final AnimationController _burst = AnimationController(vsync: this, duration: RewardCelebrationHost.duration);
  ({int seq, RewardGiven reward})? _showing;

  /// LR-46: the latest reward that arrived while the app was shown over the lock screen.
  ({int seq, RewardGiven reward})? _pending;

  @override
  void initState() {
    super.initState();
    _burst.addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) setState(() => _showing = null);
    });
  }

  @override
  void dispose() {
    _burst.dispose();
    super.dispose();
  }

  void _celebrate(({int seq, RewardGiven reward}) next) {
    setState(() => _showing = next);
    _burst.forward(from: 0);
    // The device's choice may still be loading on the very first reward: wait for it.
    final chime = ref.read(rewardChimeProvider);
    ref.read(rewardSoundProvider.future).then((on) {
      if (on) chime.play(RewardCue.of(next.reward));
    }, onError: (Object _) {});
  }

  bool get _appLockHides {
    final lock = ref.read(appLockControllerProvider);
    return lock.covered || lock.obscured;
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockControllerProvider);
    final overLockScreen = ref.watch(lockedCallGuardProvider);
    final hidden = lock.covered || lock.obscured || overLockScreen;
    ref.listen(rewardFeedProvider, (previous, next) {
      if (next == null) {
        // A new account's feed: nothing the last one heard is shown.
        _pending = null;
        return;
      }
      if (next.seq == previous?.seq) return;
      if (_appLockHides) return;
      if (ref.read(lockedCallGuardProvider)) {
        _pending = next;
        return;
      }
      _celebrate(next);
    });
    ref.listen(lockedCallGuardProvider, (wasOver, isOver) {
      if (isOver || wasOver != true) return;
      final pending = _pending;
      _pending = null;
      if (pending == null || _appLockHides) return;
      _celebrate(pending);
    });
    final showing = hidden ? null : _showing;
    return Stack(
      children: [
        widget.child,
        if (showing != null)
          Positioned.fill(
            child: IgnorePointer(
              child: _Celebration(key: ValueKey(showing.seq), reward: showing.reward, progress: _burst, seed: showing.seq),
            ),
          ),
      ],
    );
  }
}

class _Celebration extends StatelessWidget {
  const _Celebration({super.key, required this.reward, required this.progress, required this.seed});

  final RewardGiven reward;
  final Animation<double> progress;
  final int seed;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final calm = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final line = reward.isCelebration ? l10n.rewardCelebrationLine : l10n.rewardStarLine(reward.stars);
    // PR-5: how far to the next badge -- this child's own progress, nobody else's.
    final progressLine = reward.isCelebration ? null : rewardProgress(l10n, stars: reward.stars, badge: reward.badge, nextBadgeAt: reward.nextBadgeAt);
    return AnimatedBuilder(
      animation: progress,
      builder: (context, _) {
        final t = progress.value;
        // In over the first tenth, out over the last fifth.
        final opacity = t < 0.1 ? t / 0.1 : (t > 0.8 ? (1 - t) / 0.2 : 1.0);
        return Stack(
          children: [
            if (!calm) Positioned.fill(child: CustomPaint(key: const ValueKey('reward-confetti'), painter: _ConfettiPainter(t: t, seed: seed))),
            Align(
              alignment: const Alignment(0, -0.55),
              child: Opacity(
                opacity: opacity.clamp(0.0, 1.0),
                child: Semantics(
                  liveRegion: true,
                  label: progressLine == null ? line : '$line. $progressLine',
                  child: ExcludeSemantics(
                    child: Material(
                      key: const ValueKey('reward-celebration'),
                      elevation: 6,
                      borderRadius: Radii.card,
                      color: Theme.of(context).colorScheme.surface,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing4),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(reward.sticker?.icon ?? Icons.star_rounded, color: reward.sticker?.color ?? BoardPalette.stampGold, size: 40),
                            const SizedBox(width: Spacing.spacing3),
                            Flexible(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(line, style: Theme.of(context).textTheme.titleMedium),
                                  if (progressLine != null)
                                    Text(progressLine, key: const ValueKey('reward-progress'), style: Theme.of(context).textTheme.bodyMedium),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Stars and confetti falling from the top, the same for the same [seed].
/// Slow enough that nothing flashes; gone by the end.
class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter({required this.t, required this.seed});

  final double t;
  final int seed;

  static const _colours = RewardPalette.confetti;

  @override
  void paint(Canvas canvas, Size size) {
    final random = math.Random(seed);
    final fade = t > 0.75 ? (1 - t) / 0.25 : 1.0;
    for (var i = 0; i < 48; i++) {
      final x = random.nextDouble() * size.width;
      final delay = random.nextDouble() * 0.3;
      final speed = 0.6 + random.nextDouble() * 0.6;
      final p = ((t - delay) / (1 - delay)).clamp(0.0, 1.0);
      if (p <= 0) continue;
      final y = -20 + p * speed * (size.height + 40);
      final sway = math.sin((p * 6 + i) * 1.3) * 18;
      final colour = _colours[i % _colours.length].withValues(alpha: fade.clamp(0.0, 1.0));
      final at = Offset(x + sway, y);
      if (i % 3 == 0) {
        _star(canvas, at, 9, colour);
      } else {
        canvas
          ..save()
          ..translate(at.dx, at.dy)
          ..rotate(p * 8 + i)
          ..drawRect(const Rect.fromLTWH(-5, -3, 10, 6), Paint()..color = colour)
          ..restore();
      }
    }
  }

  void _star(Canvas canvas, Offset c, double r, Color colour) {
    final path = Path();
    for (var i = 0; i < 10; i++) {
      final a = -math.pi / 2 + i * math.pi / 5;
      final rr = i.isEven ? r : r * 0.45;
      final p = c + Offset(math.cos(a) * rr, math.sin(a) * rr);
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(path..close(), Paint()..color = colour);
  }

  @override
  bool shouldRepaint(_ConfettiPainter old) => old.t != t || old.seed != seed;
}
