import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/work_task.dart';
import '../../../shared/utils/app_clock.dart';
import '../../lessons/presentation/lesson_ticket_sheet.dart';
import '../../lessons/presentation/teacher_schedule_screen.dart';

/// PD-47: the person's own open tasks, most urgent first, in the server's order.
final myTasksProvider = FutureProvider.autoDispose<TaskList>((ref) {
  return ref.watch(taskRepositoryProvider).myTasks();
});

/// What the task says: a person's words, or ours for a task its source raised.
String taskTitle(BuildContext context, WorkTask t) {
  final l10n = L10n.of(context);
  if (t.sourceType == null) return t.title;
  final learner = t.titleParams['learnerName'] is String ? t.titleParams['learnerName'] as String : '';
  final at = AppClock.parse(t.titleParams['startsAt']);
  final when = at == null ? '' : lessonWhen(context, at);
  return switch (t.sourceType) {
    'lesson_report' => l10n.taskTitleLessonReport(learner, when),
    'report_correction' => l10n.taskTitleReportCorrection(learner, when),
    _ => t.title.isNotEmpty ? t.title : l10n.taskTitleFromAcademy,
  };
}

/// The one state a teacher reads on a row, or null when it is simply open.
String? taskState(L10n l10n, WorkTask t) {
  if (t.withdrawn) return l10n.taskStateWithdrawn;
  if (t.awaitingDecision) return l10n.taskStateAwaiting;
  if (t.instructions != null) return l10n.taskStateReturned;
  return null;
}

/// PD-47 priority amendment §4: never colour alone -- an icon, the level's word and,
/// when something raised it, why. Read-only on the phone; the server computed it.
/// Its pairs are the theme's own status pairs, measured in both themes
/// (test/design/theme_contrast_test.dart): danger, the strong accent on its subtle
/// ground (the gold rule), success.
class TaskLevelChip extends StatelessWidget {
  const TaskLevelChip({super.key, required this.task});

  final WorkTask task;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (fg, bg, icon, word) = switch (task.level) {
      TaskLevel.high => (tokens.colorStatusDangerFg, tokens.colorStatusDangerBg, Icons.warning_amber_rounded, l10n.taskLevelHigh),
      TaskLevel.medium => (tokens.colorAccentStrong, tokens.colorAccentSubtle, Icons.schedule, l10n.taskLevelMedium),
      TaskLevel.low => (tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg, Icons.keyboard_arrow_down, l10n.taskLevelLow),
    };
    final reason = switch (task.reason) {
      TaskReason.manual => null,
      TaskReason.overdue => l10n.taskReasonOverdue,
      TaskReason.dueSoon => l10n.taskReasonDueSoon,
      TaskReason.source => l10n.taskReasonSource,
    };
    final text = reason == null ? word : '$word · $reason';
    return Semantics(
      label: text,
      excludeSemantics: true,
      child: Container(
        key: ValueKey('task-level-${task.id}'),
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing2, Spacing.spacing1, Spacing.spacing2, Spacing.spacing1),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: fg),
            const SizedBox(width: Spacing.spacing1),
            Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

/// The To do list under the Schedule's "To do (N)".
class TodoList extends ConsumerWidget {
  const TodoList({super.key, required this.tasks, this.header});

  final List<WorkTask> tasks;
  final Widget? header;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return ListView(
      children: [
        ?header,
        if (tasks.isEmpty)
          Padding(
            padding: const EdgeInsets.all(Spacing.spacing6),
            child: Text(l10n.todoEmpty, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
          ),
        for (final t in tasks) _TaskRow(task: t),
      ],
    );
  }
}

class _TaskRow extends ConsumerWidget {
  const _TaskRow({required this.task});

  final WorkTask task;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final state = taskState(l10n, task);
    final due = task.dueAt == null ? l10n.taskNoDue : l10n.taskDue(lessonWhen(context, task.dueAt!));
    return ListTile(
      key: ValueKey('task-${task.id}'),
      title: Text(taskTitle(context, task)),
      subtitle: Padding(
        padding: const EdgeInsetsDirectional.only(top: Spacing.spacing1),
        child: Wrap(
          spacing: Spacing.spacing2,
          runSpacing: Spacing.spacing1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TaskLevelChip(task: task),
            if (task.financial) _FinanceTag(),
            Text(due, style: theme.textTheme.bodySmall),
            if (task.overdue && task.reason != TaskReason.overdue) const _OverdueMark(),
            if (state != null) Text('· $state', style: theme.textTheme.bodySmall),
          ],
        ),
      ),
      onTap: () => openTaskSheet(context, ref, task.id),
    );
  }
}

/// Overdue in a word and an icon, never by colour alone (also on a task a person set High) --
/// unless the level's own reason already says it.
class _OverdueMark extends StatelessWidget {
  const _OverdueMark();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = theme.colorScheme.error;
    return Row(
      key: const ValueKey('task-overdue'),
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.warning_amber_rounded, size: 14, color: color),
        const SizedBox(width: Spacing.spacing1),
        Text(L10n.of(context).taskReasonOverdue, style: theme.textTheme.bodySmall?.copyWith(color: color, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _FinanceTag extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final label = L10n.of(context).taskFinance;
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing2, Spacing.spacing1, Spacing.spacing2, Spacing.spacing1),
        decoration: BoxDecoration(color: tokens.colorStatusNeutralBg, borderRadius: BorderRadius.circular(8)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.payments_outlined, size: 16, color: tokens.colorStatusNeutralFg),
            const SizedBox(width: Spacing.spacing1),
            Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: tokens.colorStatusNeutralFg)),
          ],
        ),
      ),
    );
  }
}

/// A task, opened: what it is and exactly what the server lets the teacher do with it
/// now (`GET /tasks/:id` `actions`), read fresh on the tap.
Future<void> openTaskSheet(BuildContext context, WidgetRef ref, String taskId) async {
  final l10n = L10n.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final WorkTask task;
  try {
    task = await ref.read(taskRepositoryProvider).task(taskId);
  } on AppError {
    messenger.showSnackBar(SnackBar(content: Text(l10n.todoLoadFailed)));
    return;
  } on FormatException {
    // A reply this build cannot read: said as a failure, never a crash.
    messenger.showSnackBar(SnackBar(content: Text(l10n.todoLoadFailed)));
    return;
  }
  if (!context.mounted) return;
  final outcome = await showModalBottomSheet<_SheetOutcome>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheet) => _TaskSheet(task: task),
  );
  if (outcome == null || !context.mounted) return;
  if (outcome == _SheetOutcome.openLesson && task.lessonId != null) {
    await openLessonActions(context, ref, lessonId: task.lessonId!, title: taskTitle(context, task), subtitle: '');
  }
  ref.invalidate(myTasksProvider);
  final note = switch (outcome) {
    _SheetOutcome.done => l10n.taskDoneSnack,
    _SheetOutcome.notMine => l10n.taskNotMineSent,
    _SheetOutcome.commented => l10n.taskCommentSent,
    _SheetOutcome.openLesson => null,
  };
  if (note != null) messenger.showSnackBar(SnackBar(content: Text(note)));
}

enum _SheetOutcome { done, notMine, commented, openLesson }

class _TaskSheet extends ConsumerStatefulWidget {
  const _TaskSheet({required this.task});

  final WorkTask task;

  @override
  ConsumerState<_TaskSheet> createState() => _TaskSheetState();
}

class _TaskSheetState extends ConsumerState<_TaskSheet> {
  final _comment = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() act, _SheetOutcome outcome) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await act();
      if (mounted) Navigator.of(context).pop(outcome);
    } on AppError {
      if (mounted) setState(() => _error = L10n.of(context).taskActionFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _notMine() async {
    final reason = await showDialog<String>(context: context, builder: (_) => const _NotMineDialog());
    if (reason == null || reason.trim().isEmpty) return;
    await _run(() => ref.read(taskRepositoryProvider).outOfScope(widget.task.id, reason.trim()), _SheetOutcome.notMine);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final t = widget.task;
    final repo = ref.read(taskRepositoryProvider);
    final can = t.actions;
    final lessonTask = (t.sourceType == 'lesson_report' || t.sourceType == 'report_correction') && t.lessonId != null && !t.withdrawn;
    return SafeArea(
      child: Padding(
        padding: EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5 + MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(taskTitle(context, t), style: theme.textTheme.titleMedium),
              const SizedBox(height: Spacing.spacing2),
              Wrap(spacing: Spacing.spacing2, runSpacing: Spacing.spacing1, children: [TaskLevelChip(task: t), if (t.financial) _FinanceTag()]),
              const SizedBox(height: Spacing.spacing2),
              Text(
                [
                  t.dueAt == null ? l10n.taskNoDue : l10n.taskDue(lessonWhen(context, t.dueAt!)),
                  if (t.createdByName != null) l10n.taskGivenBy(t.createdByName!),
                ].join(' · '),
                style: theme.textTheme.bodySmall,
              ),
              if (t.overdue && t.reason != TaskReason.overdue) const Padding(padding: EdgeInsets.only(top: Spacing.spacing1), child: Align(alignment: AlignmentDirectional.centerStart, child: _OverdueMark())),
              if (t.instructions != null && !t.awaitingDecision)
                Card(
                  key: const ValueKey('task-instructions'),
                  margin: const EdgeInsets.only(top: Spacing.spacing3),
                  child: Padding(
                    padding: const EdgeInsets.all(Spacing.spacing3),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l10n.taskInstructions, style: theme.textTheme.labelLarge),
                      Text(t.instructions!),
                    ]),
                  ),
                ),
              if (t.withdrawn) Padding(padding: const EdgeInsets.only(top: Spacing.spacing3), child: Text(l10n.taskWithdrawnNotice)),
              if (t.body != null) Padding(padding: const EdgeInsets.only(top: Spacing.spacing3), child: Text(t.body!)),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: Spacing.spacing3), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
              const SizedBox(height: Spacing.spacing4),
              if (lessonTask)
                FilledButton(
                  key: const ValueKey('task-open-lesson'),
                  onPressed: _busy ? null : () => Navigator.of(context).pop(_SheetOutcome.openLesson),
                  child: Text(l10n.taskOpenLesson),
                ),
              if (can.contains(TaskAction.complete))
                FilledButton(
                  key: const ValueKey('task-complete'),
                  onPressed: _busy ? null : () => _run(() => repo.complete(t.id), _SheetOutcome.done),
                  child: Text(l10n.taskMarkDone),
                ),
              if (can.contains(TaskAction.acknowledge))
                FilledButton(
                  key: const ValueKey('task-acknowledge'),
                  onPressed: _busy ? null : () => _run(() => repo.acknowledge(t.id), _SheetOutcome.done),
                  child: Text(l10n.taskAcknowledge),
                ),
              if (can.contains(TaskAction.outOfScope))
                OutlinedButton(key: const ValueKey('task-not-mine'), onPressed: _busy ? null : _notMine, child: Text(l10n.taskNotMine)),
              if (can.contains(TaskAction.comment)) ...[
                const SizedBox(height: Spacing.spacing3),
                TextField(
                  key: const ValueKey('task-comment-field'),
                  controller: _comment,
                  maxLength: 2000,
                  minLines: 1,
                  maxLines: 4,
                  decoration: InputDecoration(labelText: l10n.taskComment),
                  onChanged: (_) => setState(() {}),
                ),
                TextButton(
                  key: const ValueKey('task-comment-send'),
                  onPressed: _busy || _comment.text.trim().isEmpty
                      ? null
                      : () => _run(() => repo.comment(t.id, _comment.text.trim()), _SheetOutcome.commented),
                  child: Text(l10n.taskSend),
                ),
              ],
            ].map((w) => w is FilledButton || w is OutlinedButton ? Padding(padding: const EdgeInsets.only(bottom: Spacing.spacing2), child: SizedBox(height: 48, child: w)) : w).toList(),
          ),
        ),
      ),
    );
  }
}

class _NotMineDialog extends StatefulWidget {
  const _NotMineDialog();

  @override
  State<_NotMineDialog> createState() => _NotMineDialogState();
}

class _NotMineDialogState extends State<_NotMineDialog> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return AlertDialog(
      title: Text(l10n.taskNotMine),
      content: TextField(
        key: const ValueKey('task-not-mine-field'),
        controller: _text,
        autofocus: true,
        maxLength: 2000,
        minLines: 2,
        maxLines: 5,
        decoration: InputDecoration(helperText: l10n.taskNotMineHint, helperMaxLines: 3),
        onChanged: (_) => setState(() {}),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.cancelAction)),
        FilledButton(
          key: const ValueKey('task-not-mine-send'),
          onPressed: _text.text.trim().isEmpty ? null : () => Navigator.of(context).pop(_text.text),
          child: Text(l10n.taskSend),
        ),
      ],
    );
  }
}
