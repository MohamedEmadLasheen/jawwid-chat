import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';

/// The teacher's own lessons for the next two weeks (and today's earlier ones), straight
/// from `GET /lessons` -- the server answers a teacher with their own lessons only.
final myScheduleProvider = FutureProvider.autoDispose<List<ScheduledLesson>>((ref) {
  final now = DateTime.now();
  final from = DateTime(now.year, now.month, now.day);
  return ref.watch(lessonRepositoryProvider).myLessons(from, from.add(const Duration(days: 14)));
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

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabSchedule)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(myScheduleProvider.future),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => _Message(text: l10n.scheduleLoadFailed),
          data: (lessons) => lessons.isEmpty ? _Message(text: l10n.scheduleEmpty) : _ScheduleList(lessons: lessons),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    // Scrollable so pull-to-refresh still works on an empty or failed schedule.
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.all(Spacing.spacing6),
          child: Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
        ),
      ],
    );
  }
}

class _ScheduleList extends StatelessWidget {
  const _ScheduleList({required this.lessons});

  final List<ScheduledLesson> lessons;

  @override
  Widget build(BuildContext context) {
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final sorted = [...lessons]..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    final items = <Widget>[];
    DateTime? day;
    for (final l in sorted) {
      final d = DateTime(l.startsAt.year, l.startsAt.month, l.startsAt.day);
      if (d != day) {
        day = d;
        items.add(Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing1),
          child: Text(m.formatFullDate(d), style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
        ));
      }
      items.add(_LessonRow(lesson: l));
    }
    return ListView(children: items);
  }
}

class _LessonRow extends StatelessWidget {
  const _LessonRow({required this.lesson});

  final ScheduledLesson lesson;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final status = _status(l10n, lesson);
    final time =
        '${m.formatTimeOfDay(TimeOfDay.fromDateTime(lesson.startsAt))} – ${m.formatTimeOfDay(TimeOfDay.fromDateTime(lesson.endsAt))}';

    return ListTile(
      key: ValueKey('schedule-${lesson.id}'),
      leading: Icon(lesson.kind == 'makeup' ? Icons.event_repeat_outlined : Icons.event_outlined),
      title: Text(lesson.learnerName),
      subtitle: Text([time, if (lesson.kind == 'makeup') l10n.lessonKindMakeup].join(' · ')),
      trailing: Chip(
        label: Text(status.$1),
        backgroundColor: status.$2 ? theme.colorScheme.errorContainer : null,
        labelStyle: status.$2 ? TextStyle(color: theme.colorScheme.onErrorContainer) : null,
        visualDensity: VisualDensity.compact,
      ),
    );
  }

  /// The label, and whether it asks the teacher for something.
  static (String, bool) _status(L10n l10n, ScheduledLesson l) => switch (l.outcome) {
        'held' => (l10n.outcomeHeld, false),
        'student_apology' => (l10n.outcomeStudentApology, false),
        'teacher_apology' => (l10n.outcomeTeacherApology, false),
        'admin_cancelled' => (l10n.outcomeAdminCancelled, false),
        'student_no_show' => (l10n.outcomeStudentNoShow, false),
        'teacher_no_show' => (l10n.outcomeTeacherNoShow, false),
        'rescheduled' => (l10n.outcomeRescheduled, false),
        _ => switch (l.phase) {
            'in_progress' => (l10n.phaseInProgress, false),
            'awaiting_close' => (l10n.phaseAwaitingClose, true),
            'overdue' => (l10n.phaseOverdue, true),
            _ => (l10n.phaseUpcoming, false),
          },
      };
}
