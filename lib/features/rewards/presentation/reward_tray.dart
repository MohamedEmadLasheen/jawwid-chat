import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../whiteboards/domain/board_elements.dart';
import '../../whiteboards/presentation/board_painter.dart';
import '../data/rewards_repository.dart';
import '../domain/rewards.dart';

/// PD-55: the teacher's lessons on now, for the tray's "For". Asked each time the
/// tray opens; an error or rewards being off is no lessons.
final rewardLessonsNowProvider = FutureProvider.autoDispose<List<RewardLesson>>((ref) async {
  try {
    return await ref.watch(rewardsRepositoryProvider).lessonsNow();
  } on Object {
    return const [];
  }
});

/// Places a stamp on the board -- in view -- and returns its id.
typedef PlaceStamp = String Function({required StampKind stamp, String? text, required Color color});

/// PD-55 (plan §3 B1): stars, stickers and praise stamps, placed on the board
/// with one tap and -- when a learner is chosen -- recorded for that child
/// (one star each), with a Celebrate the family sees live. With no lesson on,
/// the tray still decorates the board and says rewards count during a lesson.
/// General praise only; no emoji; nothing ever compares children.
class RewardTray extends ConsumerStatefulWidget {
  const RewardTray({super.key, required this.place, this.boardId, this.random});

  final PlaceStamp place;
  final String? boardId;

  /// The source of client event ids (a seam for tests).
  final math.Random? random;

  @override
  ConsumerState<RewardTray> createState() => _RewardTrayState();
}

class _RewardTrayState extends ConsumerState<RewardTray> {
  /// Learner ids chosen; empty means "nobody": decorate only.
  Set<String>? _for;
  final _ownWords = TextEditingController();
  late final math.Random _random = widget.random ?? math.Random.secure();

  @override
  void dispose() {
    _ownWords.dispose();
    super.dispose();
  }

  String _newId() {
    String hex(int bytes) => List.generate(bytes, (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final v = hex(16).split('');
    v[12] = '4';
    v[16] = '89ab'[_random.nextInt(4)];
    final h = v.join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  /// Places (unless a celebration) and records for every chosen learner.
  Future<void> _give(RewardGift gift, {StampKind? stamp, String? text, Color? color}) async {
    if (stamp != null) widget.place(stamp: stamp, text: text, color: color ?? BoardPalette.stampGold);
    final lessons = ref.read(rewardLessonsNowProvider).value ?? const [];
    final chosen = _chosen(lessons);
    if (chosen.isEmpty) return;
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final repo = ref.read(rewardsRepositoryProvider);
    final given = <({String learnerId, String eventId})>[];
    var failed = false;
    for (final lesson in chosen) {
      try {
        final r = await repo.give(learnerId: lesson.learnerId, lessonId: lesson.lessonId, gift: gift, clientEventId: _newId(), boardId: widget.boardId);
        given.add((learnerId: lesson.learnerId, eventId: r.eventId));
      } on Object {
        failed = true;
      }
    }
    ref.invalidate(rewardLessonsNowProvider);
    if (!mounted || messenger == null) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(failed ? l10n.rewardTrayFailed : l10n.rewardTraySent),
        action: gift is CelebrationGift || given.isEmpty
            ? null
            : SnackBarAction(
                key: const ValueKey('reward-undo'),
                label: l10n.rewardTrayUndo,
                onPressed: () {
                  for (final g in given) {
                    unawaited(repo.undo(learnerId: g.learnerId, eventId: g.eventId).then((_) {}, onError: (Object _) {}));
                  }
                  ref.invalidate(rewardLessonsNowProvider);
                },
              ),
      ),
    );
  }

  List<RewardLesson> _chosen(List<RewardLesson> lessons) {
    final ids = _for ?? (lessons.length == 1 ? {lessons.single.learnerId} : const <String>{});
    return [for (final l in lessons) if (ids.contains(l.learnerId)) l];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final arabic = lookupL10n(const Locale('ar'));
    final english = lookupL10n(const Locale('en'));
    final lessons = ref.watch(rewardLessonsNowProvider).value ?? const [];
    final chosen = _chosen(lessons).map((l) => l.learnerId).toSet();
    final theme = Theme.of(context);

    Widget section(String title, List<Widget> children) => Padding(
      padding: const EdgeInsets.only(top: Spacing.spacing3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.labelLarge),
          const SizedBox(height: Spacing.spacing2),
          Wrap(spacing: Spacing.spacing2, runSpacing: Spacing.spacing2, children: children),
        ],
      ),
    );

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.rewardTrayTitle, style: theme.textTheme.titleLarge),
            if (lessons.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing2),
                child: Text(l10n.rewardTrayNoLesson, key: const ValueKey('reward-no-lesson'), style: theme.textTheme.bodyMedium),
              )
            else
              section(l10n.rewardTrayFor, [
                for (final lesson in lessons)
                  FilterChip(
                    key: ValueKey('reward-for-${lesson.learnerId}'),
                    label: Text(lesson.learnerName),
                    avatar: lesson.stars > 0 ? Text('★${lesson.stars}', style: const TextStyle(color: BoardPalette.stampGold)) : null,
                    selected: chosen.contains(lesson.learnerId),
                    onSelected: (on) => setState(() {
                      final next = {...chosen};
                      on ? next.add(lesson.learnerId) : next.remove(lesson.learnerId);
                      _for = next;
                    }),
                  ),
                if (lessons.length > 1)
                  FilterChip(
                    key: const ValueKey('reward-for-everyone'),
                    label: Text(l10n.rewardTrayEveryone),
                    selected: chosen.length == lessons.length,
                    onSelected: (on) => setState(() => _for = on ? {for (final l in lessons) l.learnerId} : <String>{}),
                  ),
              ]),
            section(l10n.rewardTrayStar, [
              _RewardButton(
                key: const ValueKey('reward-star'),
                label: l10n.rewardTrayStar,
                child: const Icon(Icons.star_rounded, color: BoardPalette.stampGold, size: 36),
                onTap: () => _give(const StarGift(), stamp: StampKind.star),
              ),
            ]),
            section(l10n.rewardTrayStickers, [
              for (final s in Sticker.values.where((s) => s != Sticker.star))
                _RewardButton(
                  key: ValueKey('reward-sticker-${s.wire}'),
                  label: s.wire,
                  child: Icon(s.icon, color: s.color, size: 36),
                  onTap: () => _give(StickerGift(s), stamp: _stampFor(s), color: s.color),
                ),
            ]),
            section(l10n.rewardTrayPraise, [
              for (final p in Praise.values)
                _RewardButton(
                  key: ValueKey('reward-praise-${p.wire}'),
                  label: p.words(arabic, english),
                  child: Text(p.words(arabic, english), style: const TextStyle(fontFamily: kBoardFont, fontWeight: FontWeight.w700, color: BoardPalette.stampGreen)),
                  onTap: () => _give(PraiseGift(praise: p), stamp: StampKind.praise, text: p.words(arabic, english), color: BoardPalette.stampGreen),
                ),
            ]),
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing3),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('reward-own-words'),
                      controller: _ownWords,
                      maxLength: kRewardPraiseMaxLength,
                      decoration: InputDecoration(hintText: l10n.rewardTrayOwnWords, counterText: ''),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('reward-own-words-add'),
                    constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                    tooltip: l10n.rewardTrayPraise,
                    onPressed: () {
                      final words = _ownWords.text.trim();
                      if (words.isEmpty) return;
                      _ownWords.clear();
                      unawaited(_give(PraiseGift(text: words), stamp: StampKind.praise, text: words, color: BoardPalette.stampGreen));
                    },
                    icon: const Icon(Icons.add_comment_outlined),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Spacing.spacing4),
            FilledButton.icon(
              key: const ValueKey('reward-celebrate'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: chosen.isEmpty ? null : () => _give(const CelebrationGift()),
              icon: const Icon(Icons.celebration_rounded),
              label: Text(l10n.rewardTrayCelebrate),
            ),
          ],
        ),
      ),
    );
  }

  static StampKind _stampFor(Sticker s) => switch (s) {
    Sticker.star => StampKind.star,
    Sticker.medal => StampKind.medal,
    Sticker.trophy => StampKind.trophy,
    Sticker.rocket => StampKind.rocket,
    Sticker.sun => StampKind.sun,
    Sticker.rainbow => StampKind.rainbow,
    Sticker.crown => StampKind.crown,
    Sticker.balloon => StampKind.balloon,
    Sticker.heart => StampKind.heart,
    Sticker.thumbsUp => StampKind.thumbsUp,
    Sticker.check => StampKind.check,
  };
}

/// One reward: at least 56 px square, labelled for screen readers.
class _RewardButton extends StatelessWidget {
  const _RewardButton({super.key, required this.label, required this.child, required this.onTap});

  final String label;
  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: ExcludeSemantics(
      child: Material(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: Radii.card,
        child: InkWell(
          borderRadius: Radii.card,
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            child: Padding(padding: const EdgeInsets.all(Spacing.spacing2), child: Center(child: child)),
          ),
        ),
      ),
    ),
  );
}
