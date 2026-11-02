import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../data/rewards_repository.dart';

/// PD-55 PR-5: on the lesson report card the family reads -- "★ 7 stars · Amazing
/// effort · ممتاز, Lovely reading!". Nothing at all when there are no stars (a
/// lesson is never shown as zero), and never anything about another child.
class LessonRewardsRow extends ConsumerWidget {
  const LessonRewardsRow({super.key, required this.lessonId, this.color});

  final String lessonId;
  final Color? color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rewards = ref.watch(lessonRewardsProvider(lessonId)).value;
    if (rewards == null || rewards.stars <= 0) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final arabic = lookupL10n(const Locale('ar')), english = lookupL10n(const Locale('en'));
    final words = [
      for (final p in rewards.praise)
        if (p.praise != null) p.praise!.words(arabic, english) else if (p.text != null) p.text!,
    ];
    final parts = [
      l10n.rewardReportStars(rewards.stars),
      ?rewards.badge?.label(l10n),
      if (words.isNotEmpty) words.join('، '),
    ];
    return Padding(
      key: ValueKey('lesson-rewards-$lessonId'),
      padding: const EdgeInsets.only(top: Spacing.spacing2),
      child: Row(
        children: [
          const Icon(Icons.star_rounded, color: BoardPalette.stampGold, size: 20),
          const SizedBox(width: Spacing.spacing1),
          Flexible(child: Text(parts.join(' · '), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: color))),
        ],
      ),
    );
  }
}
