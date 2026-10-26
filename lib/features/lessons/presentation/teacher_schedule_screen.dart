import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/app_clock.dart';
import 'lesson_ticket_sheet.dart';

/// How far back the Schedule looks for a lesson still owed its report -- the server's
/// REPORT_LOOKBACK_DAYS, so the Schedule and "+" agree on what is owed.
const scheduleReportLookback = Duration(days: 60);

/// The teacher's own lessons for the next two weeks (and today's earlier ones), plus
/// every earlier lesson still owed a report, straight from `GET /lessons` -- the server
/// answers a teacher with their own lessons only. A past lesson that is closed is not
/// shown: the Schedule is what is coming and what is owed.
final myScheduleProvider = FutureProvider.autoDispose<List<ScheduledLesson>>((ref) async {
  final now = AppClock.now();
  final today = AppClock.wallClock(now.year, now.month, now.day);
  final lessons = await ref.watch(lessonRepositoryProvider).myLessons(today.subtract(scheduleReportLookback), today.add(const Duration(days: 14)));
  return [
    for (final l in lessons)
      if (!l.startsAt.isBefore(today) || l.needsReport) l,
  ];
});

/// All lessons, or only the ones still owed a report.
enum ScheduleFilter { all, needsReport }

class ScheduleFilterController extends Notifier<ScheduleFilter> {
  @override
  ScheduleFilter build() => ScheduleFilter.all;

  void set(ScheduleFilter filter) => state = filter;
}

final scheduleFilterProvider = NotifierProvider<ScheduleFilterController, ScheduleFilter>(ScheduleFilterController.new);

/// "Other unreported lessons (N)" under "+": the Schedule tab, showing only what is owed.
void openScheduleNeedingReport(BuildContext context, WidgetRef ref) {
  ref.read(scheduleFilterProvider.notifier).set(ScheduleFilter.needsReport);
  context.go(Routes.schedule);
}

/// Tap a lesson on the Schedule: what may be done with it now -- write its report,
/// say you can't teach it -- or, when nothing may, what happened to it. The actions
/// are the server's (`GET /lessons/:id` `acts`), read fresh on the tap, and open the
/// same forms "+" opens. Resolves true when something was sent.
Future<bool> openScheduledLesson(BuildContext context, WidgetRef ref, ScheduledLesson lesson) async {
  final l10n = L10n.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final List<LessonTicket> offered;
  try {
    offered = await ref.read(lessonRepositoryProvider).lessonTickets(lesson.id);
  } on AppError {
    messenger.showSnackBar(SnackBar(content: Text(l10n.scheduleLessonLoadFailed)));
    return false;
  }
  if (!context.mounted) return false;
  // PD-15: the absence is inside the report entry, exactly as under "+".
  final hasReport = offered.any((t) => t.kind == LessonTicketKind.report);
  final tickets = [
    for (final t in offered)
      if (!(hasReport && t.kind == LessonTicketKind.absence)) t,
  ];
  // One thing to do: do it. Otherwise say what may be done, or what happened.
  final LessonTicket? picked = tickets.length == 1
      ? tickets.single
      : await showModalBottomSheet<LessonTicket>(
          context: context,
          useRootNavigator: true,
          showDragHandle: true,
          builder: (sheet) {
            final theme = Theme.of(sheet);
            return SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ListTile(
                    title: Text(lesson.learnerName, style: theme.textTheme.titleMedium),
                    subtitle: Text('${lessonWhen(sheet, lesson.startsAt)} · ${scheduleStatus(l10n, lesson).$1}'),
                  ),
                  const Divider(),
                  if (tickets.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(Spacing.spacing5),
                      child: Text(l10n.scheduleLessonNoActions, style: theme.textTheme.bodyMedium),
                    ),
                  for (final t in tickets)
                    ListTile(
                      key: ValueKey('schedule-act-${t.kind.name}'),
                      leading: Icon(lessonTicketIcon(t.kind)),
                      title: Text(lessonTicketLabel(l10n, t.kind)),
                      onTap: () => Navigator.of(sheet).pop(t),
                    ),
                ],
              ),
            );
          },
        );
  if (picked == null || !context.mounted) return false;
  final sent = await openLessonTicket(context, picked);
  if (sent) {
    ref.invalidate(myScheduleProvider);
    ref.invalidate(myWorkloadProvider);
    messenger.showSnackBar(SnackBar(content: Text(l10n.ticketSent)));
  }
  return sent;
}

/// The teacher's own month (`GET /stats/me`).
final myWorkloadProvider = FutureProvider.autoDispose<TeacherWorkload>((ref) {
  return ref.watch(lessonRepositoryProvider).myWorkload();
});

/// PD-9/PD-10: the teacher's Schedule tab -- their own schedule and nothing else from
/// the Teacher File. One list, grouped by day in the teacher's own calendar; each lesson
/// says where it stands, so "Needs report" is visible without opening a chat. Reports
/// themselves are written where the family reads them: in the chat, under "+".
class TeacherScheduleScreen extends ConsumerWidget {
  const TeacherScheduleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final async = ref.watch(myScheduleProvider);
    final filter = ref.watch(scheduleFilterProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabSchedule)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(myScheduleProvider.future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => _Message(text: l10n.scheduleLoadFailed),
          data: (lessons) {
            final owed = lessons.where((l) => l.needsReport).length;
            final shown = filter == ScheduleFilter.needsReport ? lessons.where((l) => l.needsReport).toList() : lessons;
            return _ScheduleList(
              lessons: shown,
              header: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _WorkloadSummary(),
                  _FilterBar(filter: filter, owed: owed),
                  if (shown.isEmpty) _Message(text: l10n.scheduleEmpty, scrollable: false),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.scrollable = true});

  final String text;
  final bool scrollable;

  @override
  Widget build(BuildContext context) {
    final message = Padding(
      padding: const EdgeInsets.all(Spacing.spacing6),
      child: Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
    );
    // Scrollable so pull-to-refresh still works on a failed schedule.
    return scrollable ? ListView(children: [message]) : message;
  }
}

/// All lessons, or only the ones still owed a report -- with how many there are.
class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.filter, required this.owed});

  final ScheduleFilter filter;
  final int owed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    void pick(ScheduleFilter f) => ref.read(scheduleFilterProvider.notifier).set(f);
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
      child: Wrap(
        spacing: Spacing.spacing3,
        children: [
          ChoiceChip(key: const ValueKey('schedule-filter-all'), label: Text(l10n.scheduleFilterAll), selected: filter == ScheduleFilter.all, onSelected: (_) => pick(ScheduleFilter.all)),
          ChoiceChip(
            key: const ValueKey('schedule-filter-needs-report'),
            label: Text(l10n.scheduleFilterNeedsReport(owed)),
            selected: filter == ScheduleFilter.needsReport,
            onSelected: (_) => pick(ScheduleFilter.needsReport),
          ),
        ],
      ),
    );
  }
}

class _ScheduleList extends StatelessWidget {
  const _ScheduleList({required this.lessons, this.header});

  final List<ScheduledLesson> lessons;
  final Widget? header;

  @override
  Widget build(BuildContext context) {
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final sorted = [...lessons]..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    final items = <Widget>[?header];
    // Earlier days hold only lessons still owed a report: one section on top, newest
    // first, before the days to come.
    final now = AppClock.now();
    final today = DateTime(now.year, now.month, now.day);
    final owed = [
      for (final l in sorted.reversed)
        if (l.startsAt.isBefore(today)) l,
    ];
    if (owed.isNotEmpty) {
      items.add(
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing1),
          child: Text(L10n.of(context).scheduleNeedsReportHeader, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.error)),
        ),
      );
      for (final l in owed) {
        items.add(_LessonRow(lesson: l, withDate: true));
      }
    }
    DateTime? day;
    for (final l in sorted.where((l) => !l.startsAt.isBefore(today))) {
      final d = DateTime(l.startsAt.year, l.startsAt.month, l.startsAt.day);
      if (d != day) {
        day = d;
        items.add(
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing1),
            child: Text(m.formatFullDate(d), style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
          ),
        );
      }
      items.add(_LessonRow(lesson: l));
    }
    return ListView(children: items);
  }
}

class _LessonRow extends ConsumerWidget {
  const _LessonRow({required this.lesson, this.withDate = false});

  final ScheduledLesson lesson;

  /// In the "still owed a report" section, rows are not under a day heading.
  final bool withDate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final status = scheduleStatus(l10n, lesson);
    final time = '${m.formatTimeOfDay(TimeOfDay.fromDateTime(lesson.startsAt))} – ${m.formatTimeOfDay(TimeOfDay.fromDateTime(lesson.endsAt))}';

    return ListTile(
      key: ValueKey('schedule-${lesson.id}'),
      leading: Icon(lesson.kind == 'makeup' ? Icons.event_repeat_outlined : Icons.event_outlined),
      title: Text(lesson.learnerName),
      subtitle: Text([if (withDate) m.formatMediumDate(lesson.startsAt), time, if (lesson.kind == 'makeup') l10n.lessonKindMakeup].join(' · ')),
      trailing: Chip(
        label: Text(status.$1),
        backgroundColor: status.$2 ? theme.colorScheme.errorContainer : null,
        labelStyle: status.$2 ? TextStyle(color: theme.colorScheme.onErrorContainer) : null,
        visualDensity: VisualDensity.compact,
      ),
      onTap: () => openScheduledLesson(context, ref, lesson),
    );
  }
}

/// A lesson's status on the Schedule, and whether it asks the teacher for something.
(String, bool) scheduleStatus(L10n l10n, ScheduledLesson l) => switch (l.outcome) {
  'held' => (l10n.outcomeHeld, false),
  'student_apology' => (l10n.outcomeStudentApology, false),
  'teacher_apology' => (l10n.outcomeTeacherApology, false),
  'admin_cancelled' => (l10n.outcomeAdminCancelled, false),
  'student_no_show' => (l10n.outcomeStudentNoShow, false),
  'teacher_no_show' => (l10n.outcomeTeacherNoShow, false),
  'rescheduled' => (l10n.outcomeRescheduled, false),
  // PD-30: held by the system while the child's group is locked for payment. No amount,
  // no reason beyond that.
  'suspended' => (l.suspendedFor == 'payment' ? l10n.outcomeSuspendedPayment : l10n.outcomeSuspended, false),
  _ => switch (l.phase) {
    'in_progress' => (l10n.phaseInProgress, false),
    'awaiting_close' => (l10n.phaseAwaitingClose, true),
    'overdue' => (l10n.phaseOverdue, true),
    _ => (l10n.phaseUpcoming, false),
  },
};

/// The teacher's month at a glance: lessons held and hours, reports still owed,
/// how many reports went in on time and (PD-31) how many lessons they moved. Nothing
/// if the server has no answer.
class _WorkloadSummary extends ConsumerWidget {
  const _WorkloadSummary();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final w = ref.watch(myWorkloadProvider).value;
    if (w == null) return const SizedBox.shrink();
    final hours = (w.heldMinutes / 60).toStringAsFixed(w.heldMinutes % 60 == 0 ? 0 : 1);
    return Card(
      key: const ValueKey('workload-summary'),
      margin: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.workloadTitle, style: theme.textTheme.labelLarge),
            const SizedBox(height: Spacing.spacing1),
            Text(l10n.workloadHeld(w.heldLessons, hours), style: theme.textTheme.titleMedium),
            if (w.unreported > 0) Text(l10n.workloadNeedsReport(w.unreported), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
            if (w.reportsOnTimeRate != null) Text(l10n.workloadOnTime('${(w.reportsOnTimeRate! * 100).round()}%'), style: theme.textTheme.bodySmall),
            // PD-31: a fact about the month, not a violation -- neutral, like the line above.
            if ((w.movesByTeacher ?? 0) > 0)
              Text(l10n.workloadMoved(w.movesByTeacher!), key: const ValueKey('workload-moved'), style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
