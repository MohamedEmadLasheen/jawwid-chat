import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../profile/domain/profile_view.dart';
import '../data/moderation_repository.dart';

/// The reason's words. The labels are DRAFT, pending owner approval N-4 (see the arb).
String reportReasonLabel(ReportReason reason, L10n l10n) => switch (reason) {
      ReportReason.harassment => l10n.reportReasonHarassment,
      ReportReason.inappropriate => l10n.reportReasonInappropriate,
      ReportReason.spam => l10n.reportReasonSpam,
      ReportReason.childSafety => l10n.reportReasonChildSafety,
      ReportReason.other => l10n.reportReasonOther,
    };

/// The `{kind}` half of a person's `subject`: the server's `actorKind` (`contact`,
/// `teacher`, `staff`), never derived from the displayed role, which comes from
/// `memberRole` (a teacher can carry `admin`, RT-025 C5).
///
/// Null when the server sent no such kind (`system`, absent, unknown): then no Report entry
/// is offered rather than a guess sent.
String? reportActorKind(ProfilePerson person) => switch (person.actorKind) {
      'contact' || 'teacher' || 'staff' => person.actorKind,
      _ => null,
    };

/// Whether a Report entry is offered for [person] to [viewerId].
bool mayReportPerson({required ProfilePerson person, required String? viewerId}) =>
    person.id.isNotEmpty && person.id != viewerId && reportActorKind(person) != null;

/// Opens the Report sheet for [target]. Completes with true once a report was sent (or was
/// already open), false when the user backed out.
///
/// The sheet is the only place a report is composed: a long-press on a message and a
/// person's profile both land here, so the reasons, the note rule and the error wording
/// cannot drift apart.
Future<bool> showReportSheet(BuildContext context, {required ReportTarget target}) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => ReportSheet(target: target),
  );
  return sent ?? false;
}

class ReportSheet extends ConsumerStatefulWidget {
  const ReportSheet({super.key, required this.target});

  final ReportTarget target;

  @override
  ConsumerState<ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<ReportSheet> {
  final _note = TextEditingController();
  ReportReason? _reason;
  bool _sending = false;
  bool _noteMissing = false;
  String? _error;
  ReportReceipt? _receipt;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final reason = _reason;
    if (reason == null || _sending) return;
    final l10n = L10n.of(context);
    final note = _note.text.trim();
    // "Something else" is the one reason that says nothing by itself.
    if (reason == ReportReason.other && note.isEmpty) {
      setState(() {
        _noteMissing = true;
        _error = null;
      });
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final receipt = await ref.read(moderationRepositoryProvider).submit(
            ReportDraft(target: widget.target, reason: reason, note: note),
          );
      if (!mounted) return;
      setState(() {
        _receipt = receipt;
        _sending = false;
      });
    } catch (error) {
      if (!mounted) return;
      final failure = asAppErrorOf(error);
      setState(() {
        _sending = false;
        _noteMissing = failure.code == ModerationErrors.noteRequired;
        _error = _errorText(failure, l10n);
      });
    }
  }

  /// A calm sentence for each refusal of the contract; anything else is the generic one.
  /// The server's own message is never shown.
  String? _errorText(AppError error, L10n l10n) {
    return switch (error.code) {
      ModerationErrors.targetNotVisible => l10n.reportErrorNotVisible,
      ModerationErrors.self => l10n.reportErrorSelf,
      ModerationErrors.notReportable => widget.target is PersonReportTarget
          ? l10n.reportErrorNotReportablePerson
          : l10n.reportErrorNotReportable,
      ModerationErrors.noteRequired => null, // The note field says it.
      ModerationErrors.rateLimited => l10n.reportErrorRateLimited,
      ModerationErrors.termsNotAccepted => l10n.reportErrorTerms,
      _ => switch (error.kind) {
          AppErrorKind.rateLimited => l10n.reportErrorRateLimited,
          AppErrorKind.notFound => l10n.reportErrorNotVisible,
          _ => l10n.reportErrorGeneric,
        },
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final receipt = _receipt;

    return SafeArea(
      child: Padding(
        // The keyboard, so the note and the button stay in view while typing.
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
          child: receipt != null ? _confirmation(context, l10n, receipt) : _form(context, l10n),
        ),
      ),
    );
  }

  Widget _confirmation(BuildContext context, L10n l10n, ReportReceipt receipt) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    return Column(
      key: const ValueKey('report-confirmation'),
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: Spacing.spacing3),
        Icon(Icons.check_circle_outline, size: 48, color: tokens.colorBrandPrimary),
        const SizedBox(height: Spacing.spacing3),
        Semantics(
          liveRegion: true,
          header: true,
          child: Text(l10n.reportSentTitle, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
        ),
        const SizedBox(height: Spacing.spacing2),
        Text(
          receipt.alreadyOpen ? l10n.reportAlreadyBody : l10n.reportSentBody,
          style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: Spacing.spacing5),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            key: const ValueKey('report-done'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.reportDone),
          ),
        ),
        const SizedBox(height: Spacing.spacing5),
      ],
    );
  }

  Widget _form(BuildContext context, L10n l10n) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final reason = _reason;
    final isOther = reason == ReportReason.other;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Semantics(header: true, child: Text(l10n.reportSheetTitle, style: theme.textTheme.titleMedium)),
        const SizedBox(height: Spacing.spacing2),
        Text(
          widget.target is MessageReportTarget ? l10n.reportSheetMessageIntro : l10n.reportSheetPersonIntro,
          style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
        ),
        const SizedBox(height: Spacing.spacing3),
        // A plain list of five choices (never a dropdown): all of them in view at once.
        for (final r in ReportReason.values)
          Semantics(
            inMutuallyExclusiveGroup: true,
            checked: r == reason,
            child: ListTile(
              key: ValueKey('report-reason-${r.wire}'),
              contentPadding: EdgeInsets.zero,
              minTileHeight: Sizes.minTouchTarget,
              leading: Icon(
                r == reason ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: r == reason ? tokens.colorBrandPrimary : tokens.colorTextSecondary,
              ),
              title: Text(reportReasonLabel(r, l10n)),
              onTap: _sending
                  ? null
                  : () => setState(() {
                        _reason = r;
                        _noteMissing = false;
                        _error = null;
                      }),
            ),
          ),
        if (reason != null) ...[
          const SizedBox(height: Spacing.spacing2),
          TextField(
            key: const ValueKey('report-note'),
            controller: _note,
            enabled: !_sending,
            minLines: 2,
            maxLines: 5,
            maxLength: ModerationErrors.noteMaxLength,
            textInputAction: TextInputAction.newline,
            keyboardType: TextInputType.multiline,
            onChanged: (_) {
              if (_noteMissing) setState(() => _noteMissing = false);
            },
            decoration: InputDecoration(
              labelText: isOther ? l10n.reportNoteLabel : l10n.reportNoteLabelOptional,
              hintText: l10n.reportNoteHint,
              errorText: _noteMissing ? l10n.reportNoteRequired : null,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
        if (_error != null)
          Semantics(
            liveRegion: true,
            child: Container(
              key: const ValueKey('report-error'),
              margin: const EdgeInsets.only(top: Spacing.spacing2),
              padding: const EdgeInsets.all(Spacing.spacing3),
              decoration: BoxDecoration(
                color: tokens.colorStatusInfoBg,
                borderRadius: const BorderRadius.all(Radii.radiusMd),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline, size: 20, color: tokens.colorStatusInfoFg),
                  const SizedBox(width: Spacing.spacing3),
                  Expanded(child: Text(_error!, style: theme.textTheme.bodyMedium)),
                ],
              ),
            ),
          ),
        const SizedBox(height: Spacing.spacing4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            key: const ValueKey('report-submit'),
            onPressed: reason == null || _sending ? null : _send,
            child: _sending
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(l10n.reportSubmit),
          ),
        ),
        const SizedBox(height: Spacing.spacing5),
      ],
    );
  }
}
