import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/text_direction.dart';
import 'schedule_change_sheet.dart' show weeklyLabel;

/// PD-11: a ticket's card, drawn inside its message bubble.
///
/// Returns null for a card kind this build does not know, so the bubble falls back
/// to the plain-text body the server always sends alongside -- a new kind is never
/// an empty bubble.
Widget? lessonCardView(BuildContext context, MessageCard card, Color foreground) {
  final l10n = L10n.of(context);
  final title = switch (card.kind) {
    'lesson_report' => (Icons.menu_book_outlined, l10n.cardReportTitle),
    'lesson_absence' => (Icons.event_busy_outlined, l10n.cardAbsenceTitle),
    'lesson_apology' => (Icons.front_hand_outlined, l10n.cardApologyTitle),
    'lesson_teacher_apology' => (Icons.front_hand_outlined, l10n.cardTeacherApologyTitle),
    'lesson_cancelled' => card.text('outcome') == 'teacher_no_show'
        ? (Icons.person_off_outlined, l10n.cardTeacherAbsentTitle)
        : (Icons.event_busy_outlined, l10n.cardCancelledTitle),
    'lesson_late_apology' => (Icons.schedule_outlined, l10n.cardLateApologyTitle),
    'lesson_ruling' => card.text('decision') == 'excused'
        ? (Icons.check_circle_outline, l10n.cardRulingExcusedTitle)
        : (Icons.info_outline, l10n.cardRulingCreditedTitle),
    'lesson_makeup_booked' => (Icons.event_available_outlined, l10n.cardMakeupBookedTitle),
    'lesson_makeup_resolved' => (Icons.task_alt_outlined, l10n.cardMakeupResolvedTitle),
    'schedule_change_requested' => (Icons.edit_calendar_outlined, l10n.cardScheduleRequestedTitle),
    'schedule_change_decided' => card.text('decision') == 'approved'
        ? (Icons.event_repeat_outlined, l10n.cardScheduleApprovedTitle)
        : (Icons.info_outline, l10n.cardScheduleRejectedTitle),
    'learner_transferred' => (Icons.swap_horiz, l10n.cardTransferredTitle),
    'learner_handover' => (Icons.person_add_alt_outlined, l10n.cardHandoverTitle),
    'learner_suspended' => card.text('kind') == 'temporary'
        ? (Icons.pause_circle_outline, l10n.cardPausedTitle)
        : (Icons.stop_circle_outlined, l10n.cardStoppedTitle),
    'learner_return_soon' => (Icons.notifications_active_outlined, l10n.cardReturnSoonTitle),
    'learner_resumed' => (Icons.play_circle_outline, l10n.cardResumedTitle),
    'teacher_bonus' => (Icons.military_tech_outlined, l10n.cardBonusTitle),
    _ => null,
  };
  if (title == null) return null;
  return _LessonCard(
    icon: title.$1,
    title: title.$2,
    card: card,
    foreground: foreground,
  );
}

class _LessonCard extends StatelessWidget {
  const _LessonCard({
    required this.icon,
    required this.title,
    required this.card,
    required this.foreground,
  });

  final IconData icon;
  final String title;
  final MessageCard card;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final muted = foreground.withValues(alpha: 0.75);
    final learner = card.text('learnerName');
    final starts = card.time('startsAt');
    final rating = card.integer('rating');

    final action = switch (card.text('action')) {
      'substitute_teacher' => l10n.cardMakeupActionSubstitute,
      'family_credit' => l10n.cardMakeupActionCredit,
      'package_extension' => l10n.cardMakeupActionExtension,
      'waived' => l10n.cardMakeupActionWaived,
      _ => null,
    };
    // A requested change lists the asked-for times in the reader's own clock.
    final weekly = <String>[
      for (final raw in (card.payload['slots'] as List?) ?? const [])
        if (raw is Map && raw['nextStartsAt'] is String && DateTime.tryParse(raw['nextStartsAt'] as String) != null)
          l10n.cardEveryWeek(weeklyLabel(context, DateTime.parse(raw['nextStartsAt'] as String).toLocal())),
    ];
    // Dates the server sends as calendar days (YYYY-MM-DD), shown in the reader's format.
    String? day(String key) {
      final raw = card.text(key);
      final parsed = raw == null ? null : DateTime.tryParse(raw);
      return parsed == null ? null : MaterialLocalizations.of(context).formatMediumDate(parsed);
    }
    final rows = <(String, String)>[
      ?action == null ? null : (l10n.cardMakeupResolvedTitle, action),
      if (card.kind == 'learner_transferred' && card.text('teacherName') != null)
        ('', l10n.cardTransferredBody(card.text('teacherName')!)),
      if (card.kind == 'learner_handover' && card.text('fromTeacherName') != null)
        (l10n.cardHandoverFrom, card.text('fromTeacherName')!),
      if (card.kind == 'learner_handover' && card.text('handoverNote') != null)
        (l10n.cardHandoverNote, card.text('handoverNote')!),
      if (card.kind == 'learner_suspended' && day('returnOn') != null) ('', l10n.cardPausedUntil(day('returnOn')!)),
      if (card.kind == 'learner_return_soon' && day('returnOn') != null) ('', l10n.cardReturnOn(day('returnOn')!)),
      for (final w in weekly) ('', w),
      if (card.text('covered') case final v?) (l10n.cardCovered, v),
      if (card.text('homework') case final v?) (l10n.cardHomework, v),
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
                child: Text(
                  title,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (learner != null || starts != null)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing1),
              child: Text(
                [
                  ?learner,
                  if (starts != null)
                    '${MaterialLocalizations.of(context).formatMediumDate(starts)} · '
                        '${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(starts))}',
                ].join(' — '),
                style: theme.textTheme.labelMedium?.copyWith(color: muted),
              ),
            ),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (label.isNotEmpty) Text(label, style: theme.textTheme.labelSmall?.copyWith(color: muted)),
                  ContentText(value, style: theme.textTheme.bodyMedium?.copyWith(color: foreground)),
                ],
              ),
            ),
          if (rating != null && rating >= 1 && rating <= 5)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Semantics(
                label: '${l10n.cardRating}: $rating/5',
                excludeSemantics: true,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 1; i <= 5; i++)
                      Icon(i <= rating ? Icons.star : Icons.star_border, size: 18, color: foreground),
                  ],
                ),
              ),
            ),
          if (card.kind == 'lesson_late_apology' || card.kind == 'schedule_change_requested')
            _Footnote(text: l10n.cardUnderReview, color: muted),
          if (card.flag('makeupOwed'))
            _Footnote(text: l10n.cardMakeupOwed, color: muted),
        ],
      ),
    );
  }
}

class _Footnote extends StatelessWidget {
  const _Footnote({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: Spacing.spacing2),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontStyle: FontStyle.italic),
      ),
    );
  }
}
