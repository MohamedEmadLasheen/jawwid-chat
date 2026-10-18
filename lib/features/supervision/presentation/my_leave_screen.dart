import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/supervision.dart';
import '../../../shared/utils/text_direction.dart';
import 'supervision_ticket_sheet.dart';

/// PD-12: the teacher's own leave -- the one surface PD-12 adds to the teacher app.
///
/// Read-only figures, all the server's: the allowance the Teachers department typed in,
/// the days used, and the balance it computes on every read. The teacher can request
/// leave from here (the request lands in their private supervision conversation) and
/// withdraw one that has not been decided.
class MyLeaveScreen extends ConsumerWidget {
  const MyLeaveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final leave = ref.watch(myLeaveProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.myLeaveTitle)),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('my-leave-request'),
        onPressed: () async {
          final sent = await showSupervisionTicketSheet(context, SupervisionTicketKind.leave);
          if (sent && context.mounted) {
            ref.invalidate(myLeaveProvider);
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.ticketSent)));
          }
        },
        icon: const Icon(Icons.beach_access_outlined),
        label: Text(l10n.myLeaveRequest),
      ),
      body: switch (leave) {
        AsyncData(:final value) => RefreshIndicator(
            onRefresh: () => ref.refresh(myLeaveProvider.future),
            child: _LeaveBody(summary: value),
          ),
        AsyncError(:final error) => Builder(builder: (context) {
            final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
            return JawwidErrorView(
              title: message.title,
              body: message.body,
              retryLabel: message.canRetry ? l10n.retryAction : null,
              onRetry: message.canRetry ? () => ref.invalidate(myLeaveProvider) : null,
            );
          }),
        _ => const JawwidLoadingView(),
      },
    );
  }
}

class _LeaveBody extends ConsumerWidget {
  const _LeaveBody({required this.summary});

  final LeaveSummary summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    String figure(int? v) => v == null ? l10n.myLeaveNoAllowance : '$v';

    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing4, Spacing.spacing5, Spacing.spacing10),
      children: [
        Row(
          children: [
            Expanded(child: _Figure(label: l10n.myLeaveAllowance('${summary.year}'), value: figure(summary.allowance))),
            Expanded(child: _Figure(label: l10n.myLeaveUsed, value: '${summary.used}')),
            Expanded(
              child: _Figure(
                key: const ValueKey('my-leave-balance'),
                label: l10n.myLeaveBalance,
                value: figure(summary.balance),
                emphasis: true,
              ),
            ),
          ],
        ),
        const SizedBox(height: Spacing.spacing5),
        if (summary.requests.isEmpty)
          Text(l10n.myLeaveNoRequests, style: theme.textTheme.bodyMedium)
        else
          for (final r in summary.requests) _RequestTile(request: r),
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({super.key, required this.label, required this.value, this.emphasis = false});

  final String label;
  final String value;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label: '$label: $value',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: Spacing.spacing1),
          Text(
            value,
            style: (emphasis ? theme.textTheme.headlineSmall : theme.textTheme.titleLarge)
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _RequestTile extends ConsumerWidget {
  const _RequestTile({required this.request});

  final LeaveRequest request;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final m = MaterialLocalizations.of(context);
    String day(DateTime d) => m.formatMediumDate(DateTime(d.year, d.month, d.day));
    final dates = request.firstDay == request.lastDay ? day(request.firstDay) : '${day(request.firstDay)} – ${day(request.lastDay)}';
    final state = switch (request.state) {
      LeaveState.requested => l10n.leaveStateRequested,
      LeaveState.approved => l10n.leaveStateApproved,
      LeaveState.declined => l10n.leaveStateDeclined,
      LeaveState.withdrawn => l10n.leaveStateWithdrawn,
      LeaveState.cancelled => l10n.leaveStateCancelled,
    };

    return Card(
      margin: const EdgeInsets.only(bottom: Spacing.spacing3),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(dates, style: theme.textTheme.titleSmall)),
                Text(state, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
              ],
            ),
            const SizedBox(height: Spacing.spacing1),
            Text(l10n.leaveDaysCount(request.days), style: theme.textTheme.bodySmall),
            const SizedBox(height: Spacing.spacing2),
            ContentText(request.reason, style: theme.textTheme.bodyMedium),
            if (request.decisionNote != null) ...[
              const SizedBox(height: Spacing.spacing2),
              ContentText(request.decisionNote!, style: theme.textTheme.bodySmall),
            ],
            if (request.state == LeaveState.requested)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  key: ValueKey('withdraw-${request.id}'),
                  onPressed: () => _withdraw(context, ref),
                  child: Text(l10n.myLeaveWithdraw),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _withdraw(BuildContext context, WidgetRef ref) async {
    final l10n = L10n.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        content: Text(l10n.myLeaveWithdrawConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(MaterialLocalizations.of(dialogContext).cancelButtonLabel),
          ),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(l10n.myLeaveWithdraw)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(supervisionRepositoryProvider).withdrawLeave(request.id);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.ticketFailed)));
      }
    }
    ref.invalidate(myLeaveProvider);
  }
}
