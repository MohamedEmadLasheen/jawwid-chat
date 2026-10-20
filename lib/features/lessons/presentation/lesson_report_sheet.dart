import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../domain/report_vocab.dart';
import 'lesson_ticket_sheet.dart';

/// PD-15: the "+" menu shows ONE "Lesson report" entry per lesson. The server offers
/// `report` and `absence` as two tickets; the absence is reached from inside the
/// report entry ("Student did not attend"), so it is dropped from the menu wherever
/// the same lesson also has a report ticket.
List<LessonTicket> menuLessonTickets(List<LessonTicket> tickets) {
  final reported = {for (final t in tickets) if (t.kind == LessonTicketKind.report) t.lessonId};
  return [
    for (final t in tickets)
      if (!(t.kind == LessonTicketKind.absence && reported.contains(t.lessonId))) t,
  ];
}

/// "Lesson report": what happened -- Student attended (the quick report) or Student
/// did not attend (an absence, announced to the group). Resolves true when sent.
Future<bool> showLessonReportEntry(BuildContext context, LessonTicket ticket) async {
  final l10n = L10n.of(context);
  final attended = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.ticketReport, style: Theme.of(sheet).textTheme.titleLarge),
            if (ticket.startsAt != null)
              Text(
                [if (ticket.learnerName.isNotEmpty) ticket.learnerName, lessonWhen(sheet, ticket.startsAt!)].join(' · '),
                style: Theme.of(sheet).textTheme.bodyMedium?.copyWith(color: Theme.of(sheet).colorScheme.onSurfaceVariant),
              ),
            const SizedBox(height: Spacing.spacing3),
            Text(l10n.ticketReportChoose, style: Theme.of(sheet).textTheme.labelLarge),
            const SizedBox(height: Spacing.spacing3),
            FilledButton.icon(
              key: const ValueKey('report-attended'),
              onPressed: () => Navigator.of(sheet).pop(true),
              icon: const Icon(Icons.check_circle_outline),
              label: Text(l10n.ticketReportAttended),
            ),
            const SizedBox(height: Spacing.spacing2),
            OutlinedButton.icon(
              key: const ValueKey('report-not-attended'),
              onPressed: () => Navigator.of(sheet).pop(false),
              icon: const Icon(Icons.event_busy_outlined),
              label: Text(l10n.ticketReportNotAttended),
            ),
          ],
        ),
      ),
    ),
  );
  if (attended == null || !context.mounted) return false;
  if (!attended) {
    return showLessonTicketSheet(
      context,
      LessonTicket(
        kind: LessonTicketKind.absence,
        lessonId: ticket.lessonId,
        startsAt: ticket.startsAt,
        endsAt: ticket.endsAt,
        learnerId: ticket.learnerId,
        learnerName: ticket.learnerName,
      ),
    );
  }
  return _showReportForm(context, ticket: ticket);
}

/// The teacher edits their own report from its card. The card is rewritten in place.
Future<bool> showEditReportSheet(BuildContext context, String lessonId) {
  return _showReportForm(context, editLessonId: lessonId);
}

Future<bool> _showReportForm(BuildContext context, {LessonTicket? ticket, String? editLessonId}) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => QuickReportForm(ticket: ticket, editLessonId: editLessonId),
  );
  return sent == true;
}

/// The quick report: the lesson number (suggested), what was covered and what is
/// needed next as chips, the performance as one of five levels, short optional text,
/// and a note only supervisors read. Built to be finished in seconds.
class QuickReportForm extends ConsumerStatefulWidget {
  const QuickReportForm({super.key, this.ticket, this.editLessonId})
      : assert(ticket != null || editLessonId != null);

  /// A new report for this ticket's lesson...
  final LessonTicket? ticket;

  /// ...or an edit of this lesson's report.
  final String? editLessonId;

  @override
  ConsumerState<QuickReportForm> createState() => _QuickReportFormState();
}

class _QuickReportFormState extends ConsumerState<QuickReportForm> {
  final _number = TextEditingController();
  final _covered = TextEditingController();
  final _homework = TextEditingController();
  final _note = TextEditingController();
  final _topics = <String>{};
  final _tasks = <String>{};
  int? _level;
  bool _loading = false;
  bool _sending = false;
  bool _touched = false;
  String? _error;

  bool get _editing => widget.editLessonId != null;
  String get _lessonId => widget.editLessonId ?? widget.ticket!.lessonId!;

  @override
  void initState() {
    super.initState();
    _covered.addListener(() => setState(() {}));
    final suggested = widget.ticket?.suggestedLessonNumber;
    if (suggested != null) _number.text = '$suggested';
    if (_editing) _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await ref.read(lessonRepositoryProvider).reportFor(_lessonId);
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (r == null) {
          _error = L10n.of(context).ticketNoLongerAllowed;
          return;
        }
        _number.text = r.lessonNumber?.toString() ?? '';
        _topics.addAll(r.coveredTopics);
        _covered.text = r.covered ?? '';
        _level = r.rating;
        _tasks.addAll(r.nextTasks);
        _homework.text = r.homework ?? '';
        _note.text = r.note ?? '';
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = ticketErrorText(L10n.of(context), e);
        });
      }
    }
  }

  @override
  void dispose() {
    _number.dispose();
    _covered.dispose();
    _homework.dispose();
    _note.dispose();
    super.dispose();
  }

  String? _optional(TextEditingController c) {
    final t = c.text.trim();
    return t.isEmpty ? null : t;
  }

  LessonReportDraft get _draft => LessonReportDraft(
        lessonNumber: int.tryParse(_number.text.trim()),
        coveredTopics: [for (final c in coveredTopicCodes) if (_topics.contains(c)) c],
        covered: _optional(_covered),
        rating: _level,
        nextTasks: [for (final c in nextTaskCodes) if (_tasks.contains(c)) c],
        homework: _optional(_homework),
        note: _optional(_note),
      );

  Future<void> _submit() async {
    setState(() => _touched = true);
    final draft = _draft;
    if (!draft.isComplete || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    final repo = ref.read(lessonRepositoryProvider);
    try {
      if (_editing) {
        await repo.editReport(_lessonId, draft);
      } else {
        await repo.report(_lessonId, draft);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = ticketErrorText(L10n.of(context), e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final missing = _touched && !_draft.isComplete;

    Widget heading(String text) => Padding(
          padding: const EdgeInsets.only(top: Spacing.spacing4, bottom: Spacing.spacing2),
          child: Text(text, style: theme.textTheme.labelLarge),
        );

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_editing ? l10n.reportEdit : l10n.ticketReportAttended, style: theme.textTheme.titleLarge),
              if (widget.ticket?.startsAt != null)
                Text(
                  [
                    if (widget.ticket!.learnerName.isNotEmpty) widget.ticket!.learnerName,
                    lessonWhen(context, widget.ticket!.startsAt!),
                  ].join(' · '),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              if (_loading)
                const Padding(padding: EdgeInsets.all(Spacing.spacing5), child: Center(child: CircularProgressIndicator()))
              else ...[
                const SizedBox(height: Spacing.spacing3),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: SizedBox(
                    width: 160,
                    child: TextField(
                      key: const ValueKey('report-lesson-number'),
                      controller: _number,
                      keyboardType: TextInputType.number,
                      maxLength: 4,
                      decoration: InputDecoration(labelText: l10n.reportLessonNumberLabel, border: const OutlineInputBorder(), counterText: ''),
                    ),
                  ),
                ),
                heading(l10n.reportTopicsLabel),
                Wrap(
                  spacing: Spacing.spacing2,
                  runSpacing: Spacing.spacing2,
                  children: [
                    for (final code in coveredTopicCodes)
                      FilterChip(
                        key: ValueKey('report-topic-$code'),
                        label: Text(topicLabel(l10n, code)),
                        selected: _topics.contains(code),
                        onSelected: (on) => setState(() => on ? _topics.add(code) : _topics.remove(code)),
                      ),
                  ],
                ),
                const SizedBox(height: Spacing.spacing2),
                TextField(
                  key: const ValueKey('report-covered'),
                  controller: _covered,
                  maxLength: 1000,
                  decoration: InputDecoration(labelText: l10n.reportDetailsLabel, border: const OutlineInputBorder()),
                ),
                if (missing)
                  Text(l10n.reportNeedsCovered, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
                heading(l10n.reportPerformanceLabel),
                Wrap(
                  spacing: Spacing.spacing2,
                  runSpacing: Spacing.spacing2,
                  children: [
                    for (final level in performanceLevels)
                      ChoiceChip(
                        key: ValueKey('report-level-$level'),
                        label: Text(performanceLabel(l10n, level)!),
                        selected: _level == level,
                        onSelected: (_) => setState(() => _level = _level == level ? null : level),
                      ),
                  ],
                ),
                heading(l10n.reportNextLabel),
                Wrap(
                  spacing: Spacing.spacing2,
                  runSpacing: Spacing.spacing2,
                  children: [
                    for (final code in nextTaskCodes)
                      FilterChip(
                        key: ValueKey('report-task-$code'),
                        label: Text(taskLabel(l10n, code)),
                        selected: _tasks.contains(code),
                        onSelected: (on) => setState(() => on ? _tasks.add(code) : _tasks.remove(code)),
                      ),
                  ],
                ),
                const SizedBox(height: Spacing.spacing2),
                TextField(
                  key: const ValueKey('report-homework'),
                  controller: _homework,
                  maxLength: 500,
                  decoration: InputDecoration(labelText: l10n.reportHomeworkDetailsLabel, border: const OutlineInputBorder()),
                ),
                const SizedBox(height: Spacing.spacing2),
                TextField(
                  key: const ValueKey('report-note'),
                  controller: _note,
                  maxLength: 2000,
                  minLines: 1,
                  maxLines: 3,
                  decoration: InputDecoration(labelText: l10n.reportPrivateNoteLabel, border: const OutlineInputBorder()),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: Spacing.spacing2),
                Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: Spacing.spacing3),
              FilledButton(
                key: const ValueKey('report-submit'),
                onPressed: _sending || _loading ? null : _submit,
                child: _sending
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(l10n.ticketSubmit),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
