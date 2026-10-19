import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/text_direction.dart';
import '../../lessons/presentation/lesson_ticket_sheet.dart' show lessonWhen;

/// PD-11 T4: a trial card, drawn inside its message bubble in the trial group.
///
/// Returns null for a kind this build does not know, so the bubble falls back to the
/// plain-text body the server always sends. The decision card carries the result only:
/// why a family did not subscribe is Sales' and never reaches this group.
Widget? trialCardView(BuildContext context, MessageCard card, Color foreground) {
  final l10n = L10n.of(context);
  final head = switch (card.kind) {
    'trial_booked' => (Icons.event_available_outlined, l10n.cardTrialBookedTitle),
    'trial_cancelled' => (Icons.event_busy_outlined, l10n.cardTrialCancelledTitle),
    'trial_report' => (Icons.menu_book_outlined, l10n.cardTrialReportTitle),
    'trial_no_show' => (Icons.person_off_outlined, l10n.cardTrialNoShowTitle),
    'trial_decision' => card.text('result') == 'subscribed'
        ? (Icons.celebration_outlined, l10n.cardTrialSubscribedTitle)
        : (Icons.info_outline, l10n.cardTrialNotSubscribedTitle),
    _ => null,
  };
  if (head == null) return null;
  return _TrialCard(icon: head.$1, title: head.$2, card: card, foreground: foreground);
}

class _TrialCard extends StatelessWidget {
  const _TrialCard({required this.icon, required this.title, required this.card, required this.foreground});

  final IconData icon;
  final String title;
  final MessageCard card;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final muted = foreground.withValues(alpha: 0.75);
    final startsAt = card.time('startsAt')?.toLocal();
    final subtitle = [
      ?card.text('prospectName'),
      if (startsAt != null) lessonWhen(context, startsAt),
    ].join(' · ');
    final rows = <(String, String)>[
      if (card.kind == 'trial_booked')
        if (card.text('level') case final v?) (l10n.cardTrialLevel, v),
      if (card.text('covered') case final v?) (l10n.trialCovered, v),
      if (card.integer('rating') case final v?) (l10n.trialRating, '$v/5'),
      if (card.text('reason') case final v?) (l10n.cardReason, v),
      if (card.text('note') case final v?) (l10n.cardNote, v),
    ];

    return Semantics(
      container: true,
      label: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: foreground),
              const SizedBox(width: Spacing.spacing2),
              Flexible(
                child: Text(title, style: theme.textTheme.titleSmall?.copyWith(color: foreground, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          if (subtitle.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing1),
              child: ContentText(subtitle, style: theme.textTheme.labelMedium?.copyWith(color: muted)),
            ),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: theme.textTheme.labelSmall?.copyWith(color: muted)),
                  ContentText(value, style: theme.textTheme.bodyMedium?.copyWith(color: foreground)),
                ],
              ),
            ),
          if (card.kind == 'trial_decision' && card.text('result') == 'subscribed')
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(l10n.cardTrialAwaitingCore, style: theme.textTheme.labelSmall?.copyWith(color: muted, fontStyle: FontStyle.italic)),
            ),
        ],
      ),
    );
  }
}
