import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/clock_time.dart';
import 'change_lesson_time_sheet.dart';
import 'lesson_ticket_sheet.dart';

/// How far ahead the child's schedule lists lessons.
const childScheduleWindow = Duration(days: 28);

/// PD-31 (7): one child's weekly times and lessons for the next four weeks -- the
/// family's own (`GET /learners/:id/schedule`, `GET /lessons?learnerId=`; the server
/// answers a parent for their own family only). Both are read together.
final childScheduleProvider =
    FutureProvider.autoDispose.family<(ChildSchedule, List<ScheduledLesson>), String>((ref, learnerId) async {
  final repo = ref.watch(lessonRepositoryProvider);
  final now = AppClock.now();
  final today = AppClock.wallClock(now.year, now.month, now.day);
  final (schedule, lessons) =
      await (repo.childSchedule(learnerId), repo.learnerLessons(learnerId, today, today.add(childScheduleWindow))).wait;
  return (schedule, [...lessons]..sort((a, b) => a.startsAt.compareTo(b.startsAt)));
});

/// The way into a child's schedule from the parent's own profile, beside Materials.
/// A build with no lesson server offers nothing.
class ChildScheduleEntry extends ConsumerWidget {
  const ChildScheduleEntry({super.key, required this.learnerId, this.childName});

  final String learnerId;
  final String? childName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(lessonRepositoryProvider) is NoLessonRepository) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    return ListTile(
      key: ValueKey('schedule-entry-$learnerId'),
      leading: const Icon(Icons.calendar_month_outlined),
      title: Text(l10n.childScheduleTitle),
      subtitle: Text(l10n.childScheduleEntrySubtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push(Routes.childSchedule(learnerId), extra: childName),
    );
  }
}

/// Read-only: the weekly times (by their next start, in the reader's clock) and each
/// lesson with where it stands. The one action is "Change lesson time".
class ChildScheduleScreen extends ConsumerWidget {
  const ChildScheduleScreen({super.key, required this.learnerId, this.childName});

  final String learnerId;
  final String? childName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final async = ref.watch(childScheduleProvider(learnerId));

    Future<void> change() async {
      final sent = await showChangeLessonTimeSheet(
        context,
        LessonTicket(kind: LessonTicketKind.changeLessonTime, learnerId: learnerId, learnerName: childName ?? ''),
      );
      if (!sent || !context.mounted) return;
      ref.invalidate(childScheduleProvider(learnerId));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.ticketSent)));
    }

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.childScheduleTitle),
            if (childName != null && childName!.isNotEmpty) Text(childName!, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(childScheduleProvider(learnerId).future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ListView(
            children: [
              Padding(
                padding: const EdgeInsets.all(Spacing.spacing6),
                child: Text(l10n.childScheduleLoadFailed, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
              ),
            ],
          ),
          data: (data) {
            final (schedule, all) = data;
            // A lesson moved away is shown once, where it now is: the replacement
            // says it was moved and from when (QA 2026-10-26).
            final lessons = [for (final l in all) if (l.outcome != 'rescheduled') l];
            final weekly = [...schedule.slots]..sort((a, b) => (a.nextStartsAt ?? DateTime(9999)).compareTo(b.nextStartsAt ?? DateTime(9999)));
            return ListView(
              padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3),
              children: [
                _Header(text: l10n.childScheduleWeekly),
                if (weekly.isEmpty)
                  _Line(text: l10n.weeklyNoCurrent)
                else
                  for (final s in weekly)
                    ListTile(
                      key: ValueKey('child-weekly-${s.weekday}-${s.start}'),
                      leading: const Icon(Icons.event_repeat_outlined),
                      title: Text(s.nextStartsAt != null ? l10n.cardEveryWeek(weeklyLabel(context, s.nextStartsAt!)) : formatWallClock(context, s.start)),
                      subtitle: s.durationMinutes > 0 ? Text(l10n.makeupLength(s.durationMinutes)) : null,
                    ),
                if (schedule.hasPendingRequest)
                  _Line(text: l10n.childSchedulePending, icon: Icons.hourglass_top_outlined),
                _Header(text: l10n.childScheduleUpcoming),
                if (lessons.isEmpty) _Line(text: l10n.childScheduleNoLessons),
                for (final l in lessons) _LessonRow(lesson: l),
                Padding(
                  padding: const EdgeInsets.all(Spacing.spacing5),
                  child: FilledButton.icon(
                    key: const ValueKey('child-schedule-change'),
                    onPressed: change,
                    icon: const Icon(Icons.edit_calendar_outlined),
                    label: Text(l10n.ticketChangeLessonTime),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Where one of the child's lessons stands, as the family reads it.
String childLessonStatus(BuildContext context, ScheduledLesson l) {
  final l10n = L10n.of(context);
  return switch (l.outcome) {
    'rescheduled' => l10n.outcomeRescheduled,
    'held' => l10n.outcomeHeld,
    'student_apology' => l10n.childLessonExcused,
    'student_no_show' => l10n.outcomeStudentNoShow,
    // A lesson moved here reads "Moved"; its previous time is a line of its own (_LessonRow).
    null when l.movedFrom != null && l.phase != 'in_progress' => l10n.outcomeRescheduled,
    null => l.kind == 'makeup'
        ? l10n.lessonKindMakeup
        : (l.phase == 'in_progress' ? l10n.phaseInProgress : l10n.phaseUpcoming),
    // A teacher's apology or absence, a cancellation, paused lessons: no lesson took place.
    _ => l10n.outcomeAdminCancelled,
  };
}

class _LessonRow extends StatelessWidget {
  const _LessonRow({required this.lesson});

  final ScheduledLesson lesson;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final moved = lesson.outcome == 'rescheduled';
    final from = lesson.movedFromStartsAt;
    return ListTile(
      key: ValueKey('child-lesson-${lesson.id}'),
      leading: Icon(lesson.kind == 'makeup' ? Icons.event_repeat_outlined : Icons.event_outlined),
      title: Text(
        lessonWhen(context, lesson.startsAt),
        style: moved ? TextStyle(decoration: TextDecoration.lineThrough, color: theme.colorScheme.onSurfaceVariant) : null,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text([?lesson.teacherName, l10n.makeupLength(lesson.durationMinutes)].join(' · ')),
          if (from != null)
            Text(
              l10n.childLessonMovedFrom(lessonWhen(context, from)),
              key: ValueKey('child-lesson-moved-from-${lesson.id}'),
              style: TextStyle(color: theme.colorScheme.onSurface, fontWeight: FontWeight.w600),
            ),
        ],
      ),
      trailing: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 160),
        child: Chip(
          key: ValueKey('child-lesson-status-${lesson.id}'),
          label: Text(childLessonStatus(context, lesson), overflow: TextOverflow.ellipsis),
          visualDensity: VisualDensity.compact,
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing1),
      child: Text(text, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.text, this.icon});

  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, Spacing.spacing2),
      child: Row(
        children: [
          if (icon != null) ...[Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant), const SizedBox(width: Spacing.spacing2)],
          Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
