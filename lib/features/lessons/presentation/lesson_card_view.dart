import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/clock_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../../materials/data/materials_repository.dart';
import '../domain/report_vocab.dart';
import 'lesson_report_sheet.dart' show showEditReportSheet;
import 'lesson_ticket_sheet.dart' show lessonWhen, weeklyLabel;

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
    'lesson_moved' => (Icons.event_repeat_outlined, l10n.cardMovedTitle),
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
    // PD-30: a child's lessons paused for payment (the group: no reason), why and where
    // to pay (the family's direct chat), and back on. Grace and renewal-request cards
    // keep the server's plain text.
    'lessons_paused' => (Icons.pause_circle_outline, l10n.cardLessonsPausedTitle),
    'subscription_locked' => (Icons.pause_circle_outline, l10n.cardSubscriptionLockedTitle),
    'subscription_unlocked' => (Icons.play_circle_outline, l10n.cardSubscriptionUnlockedTitle),
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

/// PD-15: a lesson's internal reason (`outcomeNote`) -- a supervisor's excuse, a
/// teacher's apology -- for a staff or teacher reader. The card payload never carries it;
/// the server's `GET /lessons/:id` decides who reads it. Null on any failure: a missing
/// note is never an error on a chat card. Bound to the principal so one account's note
/// is never served to the next. NEVER watched for a parent (see [_LessonCard]).
final lessonOutcomeNoteProvider = FutureProvider.autoDispose.family<String?, String>((ref, lessonId) async {
  ref.watch(principalIdProvider);
  try {
    return await ref.watch(lessonRepositoryProvider).outcomeNote(lessonId);
  } catch (_) {
    return null;
  }
});

/// A lesson's weekday, date and time -- "Sat, Oct 31, 2026 · 6:30 PM" / "السبت، ٣١
/// أكتوبر ٢٠٢٦ · ٦:٣٠ م" -- in the reader's locale; [t] is already in the reader's zone
/// ([MessageCard.time]).
String _dayWhen(BuildContext context, DateTime t) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  return '${DateFormat.yMMMEd(locale).format(t)} · ${formatClockTime(context, TimeOfDay.fromDateTime(t))}';
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
    final lockReasons = codes('reasons');
    final tasks = [for (final c in codes('nextTasks')) taskLabel(l10n, c)];
    final level = performanceLabel(l10n, card.integer('rating'));
    final corrected = card.kind == 'lesson_corrected' ? _outcomeLabel(l10n, card.text('outcome'), card.text('apologyTiming')) : null;
    final learner = card.text('learnerName');
    final makeupCard = card.kind == 'lesson_makeup_booked';
    // A make-up card's own time is its main line ("Make-up lesson"), with the lesson it
    // replaces beneath; the header then names the child only.
    final starts = makeupCard ? null : card.time('startsAt');
    final makeupStarts = makeupCard ? card.time('startsAt') : card.time('makeupStartsAt');
    final missedStarts = makeupCard ? card.time('missedStartsAt') : null;
    // PD-15: the internal reason, for staff and the teacher -- never fetched, never shown
    // for a parent (or an unknown role). The family's own apology reason is on the card.
    // The role is read only for a card that could carry such a reason.
    final staffNoteCard = lessonId != null &&
        switch (card.kind) {
          'lesson_apology' => card.text('reason') == null,
          'lesson_teacher_apology' => true,
          'lesson_cancelled' => card.text('outcome') == 'teacher_no_show',
          _ => false,
        };
    final role = staffNoteCard ? ref.watch(currentRoleProvider) : null;
    final wantsStaffNote = staffNoteCard && role != null && role != UserRole.parent;
    final staffNote = wantsStaffNote ? ref.watch(lessonOutcomeNoteProvider(lessonId)).value : null;
    final rating = card.integer('rating');
    // PD-31: a moved lesson reads "previous -> new", both in the reader's own clock.
    final previous = card.kind == 'lesson_moved' ? card.time('previousStartsAt') : null;
    final movedBy = card.kind == 'lesson_moved'
        ? switch (card.text('movedBy')) {
            'family' => l10n.cardMovedByFamily,
            'teacher' => l10n.cardMovedByTeacher,
            'staff' => l10n.cardMovedByStaff,
            _ => null,
          }
        : null;

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
    // PD-29: the report's practice this week -- ayah ranges (named from the surah list)
    // and library items. The list is fetched only for a card that carries practice.
    final practiceRaw = [for (final p in (card.payload['practice'] as List?) ?? const []) if (p is Map) p];
    final surahs = practiceRaw.isEmpty ? null : ref.watch(surahsProvider).value;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final practice = <String>[
      for (final p in practiceRaw)
        if (p['kind'] == 'item' && p['title'] is String)
          p['title'] as String
        else if (p['surah'] is num)
          () {
            final n = (p['surah'] as num).toInt();
            final s = surahs?.where((x) => x.number == n).firstOrNull;
            final name = s == null ? '$n' : s.name(arabic);
            final whole = s != null && p['ayahFrom'] == 1 && p['ayahTo'] == s.ayahCount;
            return whole ? l10n.materialsWholeSurah(name) : l10n.materialsAyahRange(name, '${p['ayahFrom']}', '${p['ayahTo']}');
          }(),
    ];
    final rows = <(String, String)>[
      if (makeupStarts != null) (l10n.cardMakeupLesson, _dayWhen(context, makeupStarts)),
      if (missedStarts != null) (l10n.cardMakeupInsteadOf, _dayWhen(context, missedStarts)),
      if (previous != null && starts != null)
        ('', l10n.changeTimeSummary(lessonWhen(context, previous), lessonWhen(context, starts))),
      ?action == null ? null : (l10n.cardMakeupResolvedTitle, action),
      if (card.kind == 'learner_transferred' && card.text('teacherName') != null)
        ('', l10n.cardTransferredBody(card.text('teacherName')!)),
      if (card.kind == 'learner_handover' && card.text('fromTeacherName') != null)
        (l10n.cardHandoverFrom, card.text('fromTeacherName')!),
      if (card.kind == 'learner_handover' && card.text('handoverNote') != null)
        (l10n.cardHandoverNote, card.text('handoverNote')!),
      if (card.kind == 'learner_suspended' && day('returnOn') != null) ('', l10n.cardPausedUntil(day('returnOn')!)),
      if (card.kind == 'learner_return_soon' && day('returnOn') != null) ('', l10n.cardReturnOn(day('returnOn')!)),
      if (card.kind == 'subscription_locked') ...[
        if (lockReasons.contains('balance')) ('', l10n.subscriptionLessonsUsedUp),
        if (lockReasons.contains('overdue') && day('overdueSince') != null)
          ('', l10n.subscriptionOverdueSince(card.text('instalmentLabel') ?? '', day('overdueSince')!)),
        ('', l10n.cardSubscriptionLockedHint),
      ],
      for (final w in weekly) ('', w),
      ?corrected == null ? null : (l10n.cardCorrectedNow, corrected),
      if (card.integer('lessonNumber') case final n?)
        (l10n.cardLessonNumber, switch (card.integer('lessonTotal')) {
          final total? => l10n.cardLessonNumberOf(n, total),
          null => '$n',
        }),
      if ([...topics, ?card.text('covered')] case final c when c.isNotEmpty) (l10n.cardCovered, c.join('، ')),
      ?level == null ? null : (l10n.cardPerformance, level),
      if (tasks.isNotEmpty) (l10n.cardNextLesson, tasks.join('، ')),
      if (card.text('homework') case final v?) (l10n.cardHomework, v),
      if (practice.isNotEmpty) (l10n.materialsTabPractice, practice.join('، ')),
      if (card.text('reason') case final v?) (l10n.cardReason, v),
      if (staffNote != null && staffNote.trim().isNotEmpty) (l10n.cardStaffReason, staffNote),
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
                        '${formatClockTime(context, TimeOfDay.fromDateTime(starts))}',
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
          if (movedBy != null) _Footnote(text: movedBy, color: muted),
          // Owed until booked: every read of the card carries its live make-up (makeupStartsAt).
          if (card.flag('makeupOwed') && makeupStarts == null)
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
