import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import 'lesson_ticket_sheet.dart';

/// PD-11 T2: a parent asks for new regular lesson times.
///
/// Only the teacher's free weekly times are offered, each shown at the weekday and
/// time it falls on in the reader's OWN clock (from its next occurrence) -- a family
/// abroad sees its own Monday 17:00, not the teacher's. The request is not a change:
/// a supervisor confirms it.
Future<bool> showScheduleChangeSheet(BuildContext context, LessonTicket ticket) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => ScheduleChangeSheet(ticket: ticket),
  );
  return sent == true;
}

/// "Monday 17:00" in the reader's locale and clock.
String weeklyLabel(BuildContext context, DateTime nextStartsAt) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  final m = MaterialLocalizations.of(context);
  return '${DateFormat.EEEE(locale).format(nextStartsAt)} ${m.formatTimeOfDay(TimeOfDay.fromDateTime(nextStartsAt))}';
}

class ScheduleChangeSheet extends ConsumerStatefulWidget {
  const ScheduleChangeSheet({super.key, required this.ticket});

  final LessonTicket ticket;

  @override
  ConsumerState<ScheduleChangeSheet> createState() => _ScheduleChangeSheetState();
}

class _ScheduleChangeSheetState extends ConsumerState<ScheduleChangeSheet> {
  List<WeeklyOption>? _options;
  Object? _loadError;
  final _picked = <WeeklyOption>{};
  final _note = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final options = await ref.read(lessonRepositoryProvider).scheduleOptions(widget.ticket.learnerId);
      if (mounted) setState(() => _options = options..sort((a, b) => a.nextStartsAt.compareTo(b.nextStartsAt)));
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  Future<void> _send() async {
    if (_picked.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final note = _note.text.trim();
      await ref.read(lessonRepositoryProvider).requestScheduleChange(
            widget.ticket.learnerId,
            _picked.toList(),
            note: note.isEmpty ? null : note,
          );
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
    final options = _options;

    Widget body;
    if (_loadError != null) {
      body = Text(l10n.ticketLoadFailed);
    } else if (options == null) {
      body = const Center(child: Padding(padding: EdgeInsets.all(Spacing.spacing5), child: CircularProgressIndicator()));
    } else if (options.isEmpty) {
      body = Text(l10n.scheduleChangeNoOptions);
    } else {
      body = Wrap(
        spacing: Spacing.spacing2,
        runSpacing: Spacing.spacing2,
        children: [
          for (final o in options)
            FilterChip(
              key: ValueKey('weekly-${o.weekday}-${o.start}'),
              label: Text(weeklyLabel(context, o.nextStartsAt)),
              selected: _picked.contains(o),
              onSelected: (on) => setState(() => on ? _picked.add(o) : _picked.remove(o)),
            ),
        ],
      );
    }

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.ticketRequestScheduleChange, style: theme.textTheme.titleLarge),
              if (widget.ticket.learnerName.isNotEmpty)
                Text(
                  l10n.ticketFor(widget.ticket.learnerName),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              const SizedBox(height: Spacing.spacing2),
              Text(l10n.scheduleChangeHint, style: theme.textTheme.bodySmall),
              const SizedBox(height: Spacing.spacing4),
              Text(l10n.scheduleChangePick, style: theme.textTheme.labelLarge),
              const SizedBox(height: Spacing.spacing2),
              body,
              const SizedBox(height: Spacing.spacing4),
              TextField(
                key: const ValueKey('schedule-change-note'),
                controller: _note,
                maxLength: 1000,
                maxLines: 3,
                minLines: 1,
                decoration: InputDecoration(labelText: l10n.reportNoteLabel, border: const OutlineInputBorder()),
              ),
              if (_error != null)
                Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              const SizedBox(height: Spacing.spacing3),
              FilledButton(
                key: const ValueKey('schedule-change-send'),
                onPressed: _picked.isEmpty || _sending ? null : _send,
                child: _sending
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(l10n.scheduleChangeSend),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
