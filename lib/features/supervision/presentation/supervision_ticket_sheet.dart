import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/searchable_picker.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/supervision.dart';

/// What "+" may offer in a teacher's supervision conversation. Prefetched while the chat
/// is open so the menu opens instantly; only ever asked for in that conversation type.
final supervisionTicketsProvider =
    FutureProvider.autoDispose.family<SupervisionTickets, String>((ref, conversationId) {
  return ref.watch(supervisionRepositoryProvider).tickets(conversationId);
});

/// The teacher's own leave for the current year (the server picks the year).
final myLeaveProvider = FutureProvider.autoDispose<LeaveSummary>((ref) {
  return ref.watch(supervisionRepositoryProvider).myLeave();
});

String supervisionTicketLabel(L10n l10n, SupervisionTicketKind kind) => switch (kind) {
      SupervisionTicketKind.certificate => l10n.ticketCertificate,
      SupervisionTicketKind.leave => l10n.ticketLeave,
    };

IconData supervisionTicketIcon(SupervisionTicketKind kind) => switch (kind) {
      SupervisionTicketKind.certificate => Icons.workspace_premium_outlined,
      SupervisionTicketKind.leave => Icons.beach_access_outlined,
    };

/// Open a supervision ticket's form. Resolves true when it was sent; its card then
/// arrives in the conversation through the ordinary message path.
Future<bool> showSupervisionTicketSheet(
  BuildContext context,
  SupervisionTicketKind kind, {
  List<SupervisionLearner> learners = const [],
}) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => switch (kind) {
      SupervisionTicketKind.certificate => CertificateRequestForm(learners: learners),
      SupervisionTicketKind.leave => const LeaveRequestForm(),
    },
  );
  return sent == true;
}

/// Shared frame: title, hint, fields, an error line and one Send button.
class _Sheet extends StatelessWidget {
  const _Sheet({
    required this.title,
    required this.hint,
    required this.children,
    required this.error,
    required this.sending,
    required this.onSend,
    required this.submitKey,
  });

  final String title;
  final String hint;
  final List<Widget> children;
  final String? error;
  final bool sending;
  final VoidCallback? onSend;
  final Key submitKey;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: theme.textTheme.titleLarge),
              const SizedBox(height: Spacing.spacing2),
              Text(hint, style: theme.textTheme.bodySmall),
              const SizedBox(height: Spacing.spacing4),
              ...children,
              if (error != null) ...[
                const SizedBox(height: Spacing.spacing2),
                Text(error!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: Spacing.spacing3),
              FilledButton(
                key: submitKey,
                onPressed: onSend,
                child: sending
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

/// A date field that opens the platform date picker. Shows the date in the reader's
/// own calendar; sends only year, month and day.
class _DateField extends StatelessWidget {
  const _DateField({
    required this.fieldKey,
    required this.label,
    required this.value,
    required this.first,
    required this.last,
    required this.onPicked,
  });

  final Key fieldKey;
  final String label;
  final DateTime? value;
  final DateTime first;
  final DateTime last;
  final ValueChanged<DateTime> onPicked;

  @override
  Widget build(BuildContext context) {
    final m = MaterialLocalizations.of(context);
    return InkWell(
      key: fieldKey,
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? (DateTime.now().isBefore(first) ? first : DateTime.now()),
          firstDate: first,
          lastDate: last,
        );
        if (picked != null) onPicked(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        child: Text(value == null ? '' : m.formatMediumDate(value!)),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

class CertificateRequestForm extends ConsumerStatefulWidget {
  const CertificateRequestForm({super.key, required this.learners});

  /// The server's list of the teacher's learners; never assembled on the client.
  final List<SupervisionLearner> learners;

  @override
  ConsumerState<CertificateRequestForm> createState() => _CertificateRequestFormState();
}

class _CertificateRequestFormState extends ConsumerState<CertificateRequestForm> {
  final _title = TextEditingController();
  final _achievement = TextEditingController();
  final _grade = TextEditingController();
  final _printedName = TextEditingController();
  final _note = TextEditingController();
  String? _learnerId;
  DateTime? _achievedOn;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.learners.length == 1) _selectLearner(widget.learners.single.id);
    for (final c in [_title, _achievement, _printedName]) {
      c.addListener(() => setState(() {}));
    }
  }

  void _selectLearner(String? id) {
    _learnerId = id;
    // The printed name starts as the learner's name; the teacher corrects it if needed.
    final learner = widget.learners.where((l) => l.id == id).firstOrNull;
    if (learner != null && _printedName.text.trim().isEmpty) _printedName.text = learner.name;
  }

  @override
  void dispose() {
    for (final c in [_title, _achievement, _grade, _printedName, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _complete =>
      _learnerId != null &&
      _achievedOn != null &&
      _title.text.trim().isNotEmpty &&
      _achievement.text.trim().isNotEmpty &&
      _printedName.text.trim().isNotEmpty;

  String? _optional(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  Future<void> _submit() async {
    if (!_complete || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(supervisionRepositoryProvider).requestCertificate(CertificateDraft(
            learnerId: _learnerId!,
            title: _title.text.trim(),
            achievement: _achievement.text.trim(),
            achievedOn: _achievedOn!,
            printedName: _printedName.text.trim(),
            grade: _optional(_grade),
            note: _optional(_note),
          ));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final l10n = L10n.of(context);
      setState(() {
        _sending = false;
        _error = e is AppError && e.code == 'COMM.CERTIFICATE_NOT_FOUND' ? l10n.ticketNoLongerAllowed : l10n.ticketFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final today = DateTime.now();
    InputDecoration deco(String label, {String? hint}) =>
        InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder());

    return _Sheet(
      title: l10n.certificateFormTitle,
      hint: l10n.certificateFormHint,
      error: _error,
      sending: _sending,
      submitKey: const ValueKey('certificate-submit'),
      onSend: _complete && !_sending ? _submit : null,
      children: [
        SearchablePickerField<String>(
          key: const ValueKey('certificate-learner'),
          value: _learnerId,
          label: l10n.certificateStudent,
          decoration: deco(l10n.certificateStudent),
          options: [for (final l in widget.learners) PickerOption(value: l.id, label: l.name)],
          onChanged: (id) => setState(() => _selectLearner(id)),
        ),
        const SizedBox(height: Spacing.spacing3),
        TextField(
          key: const ValueKey('certificate-title'),
          controller: _title,
          maxLength: 120,
          decoration: deco(l10n.certificateTitleField, hint: l10n.certificateTitleHint),
        ),
        TextField(
          key: const ValueKey('certificate-achievement'),
          controller: _achievement,
          minLines: 2,
          maxLines: 4,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: deco(l10n.certificateAchievement),
        ),
        _DateField(
          fieldKey: const ValueKey('certificate-date'),
          label: l10n.certificateAchievedOn,
          value: _achievedOn,
          first: DateTime(today.year - 5),
          last: today,
          onPicked: (d) => setState(() => _achievedOn = d),
        ),
        const SizedBox(height: Spacing.spacing4),
        TextField(
          key: const ValueKey('certificate-grade'),
          controller: _grade,
          maxLength: 60,
          decoration: deco(l10n.certificateGrade),
        ),
        TextField(
          key: const ValueKey('certificate-printed-name'),
          controller: _printedName,
          maxLength: 120,
          decoration: deco(l10n.certificatePrintedName),
        ),
        TextField(
          key: const ValueKey('certificate-note'),
          controller: _note,
          maxLength: 1000,
          maxLines: 3,
          minLines: 1,
          decoration: deco(l10n.certificateNote),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

class LeaveRequestForm extends ConsumerStatefulWidget {
  const LeaveRequestForm({super.key});

  @override
  ConsumerState<LeaveRequestForm> createState() => _LeaveRequestFormState();
}

class _LeaveRequestFormState extends ConsumerState<LeaveRequestForm> {
  final _reason = TextEditingController();
  DateTime? _first;
  DateTime? _last;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _reason.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  /// Why the dates cannot be sent as they are, or null. The server decides again.
  String? _datesProblem(L10n l10n) {
    if (_first == null || _last == null) return null;
    if (_last!.isBefore(_first!)) return l10n.leaveLastBeforeFirst;
    if (_first!.year != _last!.year) return l10n.leaveSameYear;
    return null;
  }

  int get _days => _first == null || _last == null
      ? 0
      : DateTime.utc(_last!.year, _last!.month, _last!.day)
              .difference(DateTime.utc(_first!.year, _first!.month, _first!.day))
              .inDays +
          1;

  bool _complete(L10n l10n) =>
      _first != null && _last != null && _datesProblem(l10n) == null && _reason.text.trim().isNotEmpty;

  Future<void> _submit() async {
    final l10n = L10n.of(context);
    if (!_complete(l10n) || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(supervisionRepositoryProvider).requestLeave(
            firstDay: _first!,
            lastDay: _last!,
            reason: _reason.text.trim(),
          );
      ref.invalidate(myLeaveProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = e is AppError && e.code == 'COMM.LEAVE_STATE' ? l10n.leaveNotAllowed : l10n.ticketFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final problem = _datesProblem(l10n);
    // The balance is the server's; the form only shows it.
    final balance = ref.watch(myLeaveProvider).value?.balance;

    return _Sheet(
      title: l10n.leaveFormTitle,
      hint: l10n.leaveFormHint,
      error: _error ?? problem,
      sending: _sending,
      submitKey: const ValueKey('leave-submit'),
      onSend: _complete(l10n) && !_sending ? _submit : null,
      children: [
        if (balance != null)
          Padding(
            padding: const EdgeInsets.only(bottom: Spacing.spacing3),
            child: Text(l10n.leaveBalanceNow('$balance'), style: theme.textTheme.labelLarge),
          ),
        _DateField(
          fieldKey: const ValueKey('leave-first-day'),
          label: l10n.leaveFirstDay,
          value: _first,
          first: today,
          last: DateTime(today.year + 1, 12, 31),
          onPicked: (d) => setState(() {
            _first = d;
            if (_last == null || _last!.isBefore(d)) _last = d;
          }),
        ),
        const SizedBox(height: Spacing.spacing3),
        _DateField(
          fieldKey: const ValueKey('leave-last-day'),
          label: l10n.leaveLastDay,
          value: _last,
          first: _first ?? today,
          last: DateTime(today.year + 1, 12, 31),
          onPicked: (d) => setState(() => _last = d),
        ),
        if (_days > 0 && problem == null)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing2),
            child: Text(l10n.leaveDaysCount(_days), style: theme.textTheme.bodySmall),
          ),
        const SizedBox(height: Spacing.spacing3),
        TextField(
          key: const ValueKey('leave-reason'),
          controller: _reason,
          minLines: 2,
          maxLines: 4,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(labelText: l10n.leaveReason, border: const OutlineInputBorder()),
        ),
      ],
    );
  }
}
