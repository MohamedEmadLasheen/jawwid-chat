import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/clock_time.dart';
import 'change_lesson_time_sheet.dart';
import 'lesson_report_sheet.dart';
import 'makeup_sheet.dart';

/// The tickets "+" may offer in one conversation. Prefetched while the chat is open so
/// the menu opens instantly; invalidated after every submission, because a ticket
/// changes which tickets remain.
final lessonTicketsProvider =
    FutureProvider.autoDispose.family<List<LessonTicket>, String>((ref, conversationId) {
  return ref.watch(lessonRepositoryProvider).tickets(conversationId);
});

/// The label of a ticket in the "+" menu.
String lessonTicketLabel(L10n l10n, LessonTicketKind kind) => switch (kind) {
      LessonTicketKind.report => l10n.ticketWriteReport,
      LessonTicketKind.absence => l10n.ticketAbsence,
      LessonTicketKind.apology => l10n.ticketApology,
      LessonTicketKind.teacherApology => l10n.ticketTeacherApology,
      LessonTicketKind.lateApology => l10n.ticketLateApology,
      LessonTicketKind.bookMakeup => l10n.ticketBookMakeup,
      LessonTicketKind.changeLessonTime => l10n.ticketChangeLessonTime,
    };

IconData lessonTicketIcon(LessonTicketKind kind) => switch (kind) {
      LessonTicketKind.report => Icons.menu_book_outlined,
      LessonTicketKind.absence => Icons.event_busy_outlined,
      LessonTicketKind.apology || LessonTicketKind.teacherApology => Icons.front_hand_outlined,
      LessonTicketKind.lateApology => Icons.schedule_outlined,
      LessonTicketKind.bookMakeup => Icons.event_available_outlined,
      LessonTicketKind.changeLessonTime => Icons.edit_calendar_outlined,
    };

/// Which lesson a ticket is about, in the reader's own calendar and clock.
String lessonWhen(BuildContext context, DateTime startsAt) {
  final m = MaterialLocalizations.of(context);
  return '${m.formatMediumDate(startsAt)} · ${formatClockTime(context, TimeOfDay.fromDateTime(startsAt))}';
}

/// A regular weekly time, "Monday 17:00", in the reader's locale and clock -- from its
/// next start, so a family abroad sees its own weekday and time, not the teacher's.
String weeklyLabel(BuildContext context, DateTime nextStartsAt) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  return '${DateFormat.EEEE(locale).format(nextStartsAt)} ${formatClockTime(context, TimeOfDay.fromDateTime(nextStartsAt))}';
}

/// Open whichever sheet a ticket needs. Resolves true when something was sent.
Future<bool> openLessonTicket(BuildContext context, LessonTicket ticket) {
  return switch (ticket.kind) {
    // PD-15: one entry -- Student attended (the quick report) or did not attend.
    LessonTicketKind.report => showLessonReportEntry(context, ticket),
    LessonTicketKind.bookMakeup => showMakeupSheet(context, ticket),
    LessonTicketKind.changeLessonTime => showChangeLessonTimeSheet(context, ticket),
    _ => showLessonTicketSheet(context, ticket),
  };
}

/// Open an absence or apology form. Resolves true when it was sent. (A report has its
/// own quick form: lesson_report_sheet.dart.)
///
/// The server decides again on submit, so a ticket that stopped being allowed while
/// the form was open (another device closed the lesson) is refused with its own
/// message rather than silently dropped.
Future<bool> showLessonTicketSheet(BuildContext context, LessonTicket ticket) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => LessonTicketForm(ticket: ticket),
  );
  return sent == true;
}

class LessonTicketForm extends ConsumerStatefulWidget {
  const LessonTicketForm({super.key, required this.ticket});

  final LessonTicket ticket;

  @override
  ConsumerState<LessonTicketForm> createState() => _LessonTicketFormState();
}

class _LessonTicketFormState extends ConsumerState<LessonTicketForm> {
  final _main = TextEditingController();
  bool _sending = false;
  String? _error;

  LessonTicketKind get _kind => widget.ticket.kind;

  @override
  void initState() {
    super.initState();
    _main.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _main.dispose();
    super.dispose();
  }

  /// The one field a ticket cannot be sent without -- none for an absence.
  bool get _canSend => !_sending && (_kind == LessonTicketKind.absence || _main.text.trim().isNotEmpty);

  String? _optional(TextEditingController c) {
    final t = c.text.trim();
    return t.isEmpty ? null : t;
  }

  Future<void> _submit() async {
    if (!_canSend) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    final repo = ref.read(lessonRepositoryProvider);
    final id = widget.ticket.lessonId!;
    try {
      switch (_kind) {
        case LessonTicketKind.report:
          return; // the quick report (showLessonReportEntry)
        case LessonTicketKind.absence:
          await repo.absence(id, note: _optional(_main));
        case LessonTicketKind.apology || LessonTicketKind.teacherApology || LessonTicketKind.lateApology:
          await repo.apologise(id, _kind, _main.text.trim());
        case LessonTicketKind.bookMakeup || LessonTicketKind.changeLessonTime:
          return; // their own sheets (openLessonTicket)
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final l10n = L10n.of(context);
      final code = e is AppError ? e.code : null;
      setState(() {
        _sending = false;
        _error = code != null && (code == 'COMM.LESSON_STATE' || code == 'COMM.LESSON_NOT_FOUND')
            ? l10n.ticketNoLongerAllowed
            : l10n.ticketFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final hint = switch (_kind) {
      LessonTicketKind.absence => l10n.ticketAbsenceConfirm,
      LessonTicketKind.lateApology => l10n.ticketLateApologyHint,
      LessonTicketKind.teacherApology => l10n.ticketTeacherApologyHint,
      _ => null,
    };

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(lessonTicketLabel(l10n, _kind), style: theme.textTheme.titleLarge),
              const SizedBox(height: Spacing.spacing1),
              if (widget.ticket.startsAt != null)
                Text(
                  l10n.ticketLessonAt(lessonWhen(context, widget.ticket.startsAt!)),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              if (hint != null) ...[
                const SizedBox(height: Spacing.spacing3),
                Text(hint, style: theme.textTheme.bodySmall),
              ],
              const SizedBox(height: Spacing.spacing4),
              TextField(
                key: const ValueKey('lesson-ticket-main'),
                controller: _main,
                autofocus: _kind != LessonTicketKind.absence,
                minLines: 2,
                maxLines: 5,
                maxLength: 1000,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  labelText: switch (_kind) {
                    LessonTicketKind.absence => l10n.reportNoteLabel,
                    _ => l10n.ticketReasonLabel,
                  },
                  border: const OutlineInputBorder(),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: Spacing.spacing2),
                Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: Spacing.spacing3),
              FilledButton(
                key: const ValueKey('lesson-ticket-submit'),
                onPressed: _canSend ? _submit : null,
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

/// What a refused or failed ticket says: "no longer allowed" for a state the server
/// refused (another device acted first), "try again" for anything else.
String ticketErrorText(L10n l10n, Object error) {
  final code = error is AppError ? error.code : null;
  return code == 'COMM.LESSON_STATE' || code == 'COMM.LESSON_NOT_FOUND' ? l10n.ticketNoLongerAllowed : l10n.ticketFailed;
}
