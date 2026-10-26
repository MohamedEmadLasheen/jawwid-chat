import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../tokens.dart';

/// PD-32: the small "Trial" pill on a trial group, wherever the group is named -- the
/// chat list row, the chat header and Group info.
///
/// One widget so the three places cannot drift apart. The colour pair is its own
/// ([JawwidTokens.trialBadgeFg] on [JawwidTokens.trialBadgeBg]) and the word is always
/// written out, so the label never depends on colour alone (§53).
class TrialBadge extends StatelessWidget {
  const TrialBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final label = L10n.of(context).trialBadge;

    return DecoratedBox(
      key: const ValueKey('trial-badge'),
      decoration: BoxDecoration(
        color: tokens.trialBadgeBg,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing3,
          vertical: Spacing.spacing1,
        ),
        child: Text(
          label,
          maxLines: 1,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: tokens.trialBadgeFg,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}
