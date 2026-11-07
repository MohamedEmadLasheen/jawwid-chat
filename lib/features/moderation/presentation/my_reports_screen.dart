import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../data/moderation_repository.dart';
import 'report_sheet.dart';

/// `GET /me/reports`, for the signed-in user; session-scoped.
final myReportsProvider = FutureProvider.autoDispose<List<MyReport>>((ref) async {
  ref.watch(principalIdProvider);
  return ref.watch(moderationRepositoryProvider).mine();
});

/// PD-57: the reporter's own reports, with their status and our answer.
///
/// The contract carries no evidence and no reviewer name, so none can appear here.
class MyReportsScreen extends ConsumerWidget {
  const MyReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(myReportsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.myReportsTitle)),
      body: switch (state) {
        AsyncData(:final value) when value.isEmpty => JawwidEmptyView(
            title: l10n.myReportsEmptyTitle,
            body: l10n.myReportsEmptyBody,
            icon: Icons.flag_outlined,
          ),
        AsyncData(:final value) => RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(myReportsProvider);
              await ref.read(myReportsProvider.future);
            },
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(Spacing.spacing5),
              itemCount: value.length,
              separatorBuilder: (_, _) => const SizedBox(height: Spacing.spacing3),
              itemBuilder: (_, i) => _ReportCard(report: value[i]),
            ),
          ),
        AsyncError(:final error) => Builder(builder: (context) {
            final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
            return JawwidErrorView(
              title: message.title,
              body: message.body,
              retryLabel: message.canRetry ? l10n.retryAction : null,
              onRetry: message.canRetry ? () => ref.invalidate(myReportsProvider) : null,
            );
          }),
        _ => const JawwidLoadingView(),
      },
    );
  }
}

String _statusLabel(ReportStatus status, L10n l10n) => switch (status) {
      ReportStatus.open => l10n.myReportsStatusOpen,
      ReportStatus.inReview => l10n.myReportsStatusInReview,
      ReportStatus.actioned => l10n.myReportsStatusActioned,
      ReportStatus.dismissed => l10n.myReportsStatusDismissed,
    };

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});

  final MyReport report;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toString();
    final reason = report.reason == null ? l10n.myReportsReasonUnknown : reportReasonLabel(report.reason!, l10n);
    final about = report.isPerson ? l10n.myReportsTargetPerson : l10n.myReportsTargetMessage;
    final answer = report.answer;

    return Container(
      key: ValueKey('my-report-${report.id}'),
      padding: const EdgeInsets.all(Spacing.spacing4),
      decoration: BoxDecoration(
        color: tokens.colorSurfaceDefault,
        border: Border.all(color: tokens.colorBorderSubtle),
        borderRadius: const BorderRadius.all(Radii.radiusMd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(reason, style: theme.textTheme.titleSmall)),
              Text(
                _statusLabel(report.status, l10n),
                key: ValueKey('my-report-status-${report.id}'),
                style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary),
              ),
            ],
          ),
          const SizedBox(height: Spacing.spacing1),
          Text(
            '$about · ${DateFormat.yMMMd(locale).format(report.createdAt.toLocal())}',
            style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
          ),
          if (answer != null) ...[
            const SizedBox(height: Spacing.spacing3),
            Container(
              key: ValueKey('my-report-answer-${report.id}'),
              width: double.infinity,
              padding: const EdgeInsets.all(Spacing.spacing3),
              decoration: BoxDecoration(
                color: tokens.colorBrandSubtle,
                borderRadius: const BorderRadius.all(Radii.radiusMd),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.myReportsAnswerLabel,
                    style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: Spacing.spacing1),
                  ContentText(answer.text, style: theme.textTheme.bodyMedium),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
