import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../app_lock/application/app_lock_controller.dart';
import '../application/reward_feed.dart';
import '../domain/rewards.dart';

/// PD-55: the celebration a child sees on the family's phone when their teacher
/// rewards them -- a 2.5 s burst of stars and confetti over WHATEVER is on screen
/// (a call, a chat, Settings), with one line saying what it was, and the chime
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
      if (on) chime.play();
    }, onError: (Object _) {});
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockControllerProvider);
    final hidden = lock.covered || lock.obscured;
    ref.listen(rewardFeedProvider, (previous, next) {
      if (next == null || next.seq == previous?.seq) return;
      if (ref.read(appLockControllerProvider).covered || ref.read(appLockControllerProvider).obscured) return;
      _celebrate(next);
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
                  label: line,
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
                            Flexible(child: Text(line, style: Theme.of(context).textTheme.titleMedium)),
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
