import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/trial.dart';
import '../../lessons/presentation/lesson_ticket_sheet.dart' show lessonWhen;

/// What "+" may offer the teacher in their trial group: one report per started trial.
/// Prefetched while that chat is open; asked for in no other conversation type.
final trialTicketsProvider = FutureProvider.autoDispose.family<List<TrialTicket>, String>((ref, conversationId) {
  return ref.watch(trialRepositoryProvider).tickets(conversationId);
});

/// Open the trial report for one trial. Resolves true when it was sent; its card then
/// arrives in the trial group through the ordinary message path.
Future<bool> showTrialReportSheet(BuildContext context, TrialTicket ticket) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => TrialReportForm(ticket: ticket),
  );
  return sent == true;
}

/// Built to be finished in seconds, like the lesson report: did the prospect attend,
/// and if so what was covered. Rating and note are optional. Whether the family
/// subscribed is Sales' fact, recorded elsewhere -- never asked of the teacher.
class TrialReportForm extends ConsumerStatefulWidget {
  const TrialReportForm({super.key, required this.ticket});

  final TrialTicket ticket;

  @override
  ConsumerState<TrialReportForm> createState() => _TrialReportFormState();
}

class _TrialReportFormState extends ConsumerState<TrialReportForm> {
  final _covered = TextEditingController();
  final _note = TextEditingController();
  bool _attended = true;
  int? _rating;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _covered.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _covered.dispose();
    _note.dispose();
    super.dispose();
  }

  bool get _complete => !_attended || _covered.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_complete || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    final note = _note.text.trim().isEmpty ? null : _note.text.trim();
    try {
      await ref.read(trialRepositoryProvider).reportAttendance(
            widget.ticket.trialId,
            _attended
                ? TrialAttendanceDraft.attended(covered: _covered.text.trim(), rating: _rating, note: note)
                : TrialAttendanceDraft.absent(note: note),
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final l10n = L10n.of(context);
      setState(() {
        _sending = false;
        // Closed from elsewhere (cancelled by Sales, recorded by the department) while open.
        _error = e is AppError && (e.code == 'COMM.LESSON_STATE' || e.code == 'COMM.LESSON_NOT_FOUND')
            ? l10n.ticketNoLongerAllowed
            : l10n.ticketFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    InputDecoration deco(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder());

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.trialReportTitle, style: theme.textTheme.titleLarge),
              const SizedBox(height: Spacing.spacing2),
              Text(
                '${widget.ticket.prospectName} · ${lessonWhen(context, widget.ticket.startsAt)}',
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: Spacing.spacing4),
              SegmentedButton<bool>(
                key: const ValueKey('trial-attended'),
                segments: [
                  ButtonSegment(value: true, label: Text(l10n.trialAttended), icon: const Icon(Icons.check_circle_outline)),
                  ButtonSegment(value: false, label: Text(l10n.trialDidNotAttend), icon: const Icon(Icons.event_busy_outlined)),
                ],
                selected: {_attended},
                onSelectionChanged: (s) => setState(() => _attended = s.first),
              ),
              const SizedBox(height: Spacing.spacing4),
              if (_attended) ...[
                TextField(
                  key: const ValueKey('trial-covered'),
                  controller: _covered,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 1000,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: deco(l10n.trialCovered),
                ),
                Text(l10n.trialRating, style: theme.textTheme.labelLarge),
                const SizedBox(height: Spacing.spacing2),
                Wrap(
                  spacing: Spacing.spacing2,
                  children: [
                    for (var n = 1; n <= 5; n++)
                      ChoiceChip(
                        key: ValueKey('trial-rating-$n'),
                        label: Text('$n'),
                        selected: _rating == n,
                        onSelected: (on) => setState(() => _rating = on ? n : null),
                      ),
                  ],
                ),
                const SizedBox(height: Spacing.spacing4),
              ],
              TextField(
                key: const ValueKey('trial-note'),
                controller: _note,
                minLines: 1,
                maxLines: 3,
                maxLength: 2000,
                decoration: deco(l10n.trialNote),
              ),
              if (_error != null) ...[
                const SizedBox(height: Spacing.spacing2),
                Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: Spacing.spacing3),
              FilledButton(
                key: const ValueKey('trial-submit'),
                onPressed: _complete && !_sending ? _submit : null,
                child: _sending
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(l10n.formSend),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
