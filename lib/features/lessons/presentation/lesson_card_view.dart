import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/text_direction.dart';
import '../domain/report_vocab.dart';
import 'lesson_report_sheet.dart' show showEditReportSheet;
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
    'lesson_apology' => card.text('timing') == 'after_start'
        ? (Icons.front_hand_outlined, l10n.cardExcusedAfterTitle)
        : (Icons.front_hand_outlined, l10n.cardApologyTitle),
    'lesson_corrected' => (Icons.edit_note_outlined, l10n.cardCorrectedTitle),
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

/// A corrected lesson's outcome, as a family reads it (PD-15).
String? _outcomeLabel(L10n l10n, String? outcome, String? timing) => switch (outcome) {
      'held' => l10n.cardOutcomeHeld,
      'student_no_show' => l10n.cardOutcomeStudentNoShow,
      'student_apology' => timing == 'after_start' ? l10n.cardOutcomeExcusedAfter : l10n.cardOutcomeExcusedBefore,
      'teacher_apology' => l10n.cardOutcomeTeacherApology,
      'teacher_no_show' => l10n.cardOutcomeTeacherNoShow,
      'admin_cancelled' => l10n.cardOutcomeCancelled,
      _ => null,
    };

class _LessonCard extends ConsumerWidget {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final muted = foreground.withValues(alpha: 0.75);
    // PD-15: the teacher edits their own report from its card; the server decides
    // whether it is theirs, and the card is rewritten in place.
    final lessonId = card.lessonId ?? card.text('lessonId');
    final editable = card.kind == 'lesson_report' && lessonId != null && ref.watch(currentRoleProvider) == UserRole.teacher;
    List<String> codes(String key) => [for (final c in (card.payload[key] as List?) ?? const []) if (c is String) c];
    final topics = [for (final c in codes('coveredTopics')) topicLabel(l10n, c)];
    final tasks = [for (final c in codes('nextTasks')) taskLabel(l10n, c)];
    final level = performanceLabel(l10n, card.integer('rating'));
    final corrected = card.kind == 'lesson_corrected' ? _outcomeLabel(l10n, card.text('outcome'), card.text('apologyTiming')) : null;
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
          l10n.cardEveryWeek(weeklyLabel(context, AppClock.view(DateTime.parse(raw['nextStartsAt'] as String)))),
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
      ?corrected == null ? null : (l10n.cardCorrectedNow, corrected),
      if (card.integer('lessonNumber') case final n?) (l10n.cardLessonNumber, '$n'),
      if ([...topics, ?card.text('covered')] case final c when c.isNotEmpty) (l10n.cardCovered, c.join('، ')),
      ?level == null ? null : (l10n.cardPerformance, level),
      if (tasks.isNotEmpty) (l10n.cardNextLesson, tasks.join('، ')),
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
          if (card.flag('corrected'))
            _Footnote(text: l10n.cardReportCorrected, color: muted),
          if (editable)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                key: ValueKey('report-edit-$lessonId'),
                style: TextButton.styleFrom(foregroundColor: foreground, padding: EdgeInsets.zero),
                onPressed: () async {
                  final saved = await showEditReportSheet(context, lessonId);
                  if (saved && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.reportUpdated)));
                  }
                },
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: Text(l10n.reportEdit),
              ),
            ),
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
