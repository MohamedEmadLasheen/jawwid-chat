import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/supervision.dart';
import '../../../shared/utils/text_direction.dart';

/// PD-12: a certificate or leave card, drawn inside its message bubble.
///
/// Returns null for a kind this build does not know, so the bubble falls back to the
/// plain-text body the server always sends alongside. A certificate's file is the
/// message's ordinary attachment and is drawn by the bubble above this card, so it opens
/// through the same signed media route as any other file.
Widget? supervisionCardView(BuildContext context, MessageCard card, Color foreground) {
  final l10n = L10n.of(context);
  final head = switch (card.kind) {
    'certificate_requested' => (Icons.workspace_premium_outlined, l10n.cardCertificateRequestedTitle),
    'certificate_issued' => (Icons.workspace_premium, l10n.cardCertificateIssuedTitle),
    'certificate_declined' => (Icons.info_outline, l10n.cardCertificateDeclinedTitle),
    'leave_requested' => (Icons.beach_access_outlined, l10n.cardLeaveRequestedTitle),
    'leave_approved' => (Icons.check_circle_outline, l10n.cardLeaveApprovedTitle),
    'leave_declined' => (Icons.cancel_outlined, l10n.cardLeaveDeclinedTitle),
    'leave_withdrawn' => (Icons.undo, l10n.cardLeaveWithdrawnTitle),
    'leave_cancelled' => (Icons.undo, l10n.cardLeaveCancelledTitle),
    // PD-12 S2: a confirmed step of the discipline ladder.
    'discipline_warning' => (Icons.warning_amber_rounded, l10n.cardDisciplineWarningTitle),
    'discipline_deduction' => (
        Icons.remove_circle_outline,
        card.integer('step') == 2 ? l10n.cardDisciplineDeduction2Title : l10n.cardDisciplineDeduction1Title,
      ),
    'discipline_suspension' => (
        Icons.block,
        card.text('kind') == 'permanent' ? l10n.cardDisciplinePermanentTitle : l10n.cardDisciplineTemporaryTitle,
      ),
    _ => null,
  };
  if (head == null) return null;
  return _SupervisionCard(icon: head.$1, title: head.$2, card: card, foreground: foreground);
}

class _SupervisionCard extends StatelessWidget {
  const _SupervisionCard({
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
    final isCertificate = card.kind.startsWith('certificate_');
    final isDiscipline = card.kind.startsWith('discipline_');

    final subtitle = isCertificate
        ? card.text('learnerName')
        : isDiscipline
            ? _dates(context, from: 'startsOn', to: 'endsOn')
            : _dates(context);
    final rows = <(String, String)>[
      if (isDiscipline) ...[
        (l10n.cardViolation, _violation(context)),
      ] else if (isCertificate) ...[
        if (card.text('title') case final v?) (l10n.certificateTitleField, v),
        if (card.text('achievement') case final v?) (l10n.cardAchievement, v),
        if (card.text('grade') case final v?) (l10n.cardGrade, v),
      ] else ...[
        if (card.integer('days') case final v?) (l10n.cardDays, '$v'),
        if (card.integer('daysReturned') case final v?) (l10n.cardDaysReturned, '$v'),
        if (card.integer('balance') case final v?) (l10n.cardBalance, '$v'),
      ],
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
                  style: theme.textTheme.titleSmall?.copyWith(color: foreground, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          if (subtitle != null)
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
          if (card.kind == 'discipline_warning' && card.integer('step') != null)
            _Foot(text: l10n.cardViolationStep('${card.integer('step')}'), color: muted),
          if (card.kind == 'discipline_deduction') _Foot(text: l10n.cardPayrollNote, color: muted),
          if (card.kind == 'certificate_issued')
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(
                l10n.cardCongratulations,
                style: theme.textTheme.labelSmall?.copyWith(color: muted, fontStyle: FontStyle.italic),
              ),
            ),
        ],
      ),
    );
  }

  /// What the violation was, whose lesson, which day -- as the server recorded it.
  String _violation(BuildContext context) {
    final l10n = L10n.of(context);
    final what = switch (card.text('violationKind')) {
      'late' => l10n.cardViolationLate('${card.integer('lateMinutes') ?? ''}'),
      'teacher_no_show' => l10n.cardViolationNoShow,
      'absence' => l10n.cardViolationAbsence,
      'complaint' => l10n.cardViolationComplaint,
      _ => l10n.cardViolationApology,
    };
    final day = parseCalendarDay(card.payload['lessonDay']);
    return [
      what,
      ?card.text('learnerName'),
      if (day != null) MaterialLocalizations.of(context).formatMediumDate(DateTime(day.year, day.month, day.day)),
    ].join(' — ');
  }

  /// A leave's (or a suspension's) dates are calendar days: the same day in every time zone.
  String? _dates(BuildContext context, {String from = 'firstDay', String to = 'lastDay'}) {
    final first = parseCalendarDay(card.payload[from]);
    final last = parseCalendarDay(card.payload[to]);
    if (first == null || last == null) return null;
    final m = MaterialLocalizations.of(context);
    String day(DateTime d) => m.formatMediumDate(DateTime(d.year, d.month, d.day));
    return first == last ? day(first) : '${day(first)} – ${day(last)}';
  }
}

class _Foot extends StatelessWidget {
  const _Foot({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: Spacing.spacing2),
      child: Text(text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontStyle: FontStyle.italic)),
    );
  }
}
