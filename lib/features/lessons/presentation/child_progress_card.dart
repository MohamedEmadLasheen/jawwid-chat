import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import 'lesson_ticket_sheet.dart' show lessonWhen;

/// A child's progress this month, from `GET /learners/:id/progress`.
final childProgressProvider = FutureProvider.autoDispose.family<ChildProgress, String>((ref, learnerId) {
  return ref.watch(lessonRepositoryProvider).progress(learnerId);
});

/// PD-10's per-child page, as a section of the child's group profile.
///
/// Leads with what was learnt and how steadily (the streak), then the month's
/// counts; absences are shown plainly, never as the headline. Certificates are
/// the PD-12 student certificates actually issued -- until one is, an honest
/// "will appear here", not an invented badge.
/// A build without a lesson server shows nothing at all.
class ChildProgressCard extends ConsumerWidget {
  const ChildProgressCard({super.key, required this.learnerId});

  final String learnerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final async = ref.watch(childProgressProvider(learnerId));

    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(Spacing.spacing5),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => e is UnsupportedError
          ? const SizedBox.shrink()
          : Padding(
              padding: const EdgeInsets.all(Spacing.spacing5),
              child: Text(l10n.progressUnavailable, style: theme.textTheme.bodyMedium),
            ),
      data: (p) => Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, Spacing.spacing3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.progressTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: Spacing.spacing2),
            Row(
              children: [
                Icon(Icons.local_fire_department_outlined, color: theme.colorScheme.primary),
                const SizedBox(width: Spacing.spacing2),
                Expanded(child: Text(l10n.progressStreak(p.streak), style: theme.textTheme.titleSmall)),
              ],
            ),
            const SizedBox(height: Spacing.spacing3),
            Row(
              children: [
                _Count(label: l10n.progressAttended, value: p.attended, emphasis: true),
                _Count(label: l10n.progressApologised, value: p.apologised),
                _Count(label: l10n.progressAbsent, value: p.absent),
              ],
            ),
            const SizedBox(height: Spacing.spacing3),
            Text(l10n.progressAllTime(p.attendedAllTime), style: theme.textTheme.bodySmall),
            if (p.makeupsOwed > 0) Text(l10n.progressMakeupsOwed(p.makeupsOwed), style: theme.textTheme.bodySmall),
            if (p.nextLessonAt != null) Text(l10n.progressNext(lessonWhen(context, p.nextLessonAt!)), style: theme.textTheme.bodySmall),
            if (p.lastCovered != null) Text(l10n.progressLastCovered(p.lastCovered!), style: theme.textTheme.bodySmall),
            const SizedBox(height: Spacing.spacing2),
            if (p.certificates.isEmpty)
              Text(
                l10n.progressCertificates,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, fontStyle: FontStyle.italic),
              )
            else ...[
              Text(l10n.progressCertificatesTitle, style: theme.textTheme.titleSmall),
              // PD-12: each opens the group it was delivered into, where its file is.
              for (final c in p.certificates)
                ListTile(
                  key: ValueKey('progress-certificate-${c.id}'),
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(Icons.workspace_premium, color: theme.colorScheme.primary),
                  title: Text(c.title),
                  subtitle: Text([
                    MaterialLocalizations.of(context).formatMediumDate(DateTime(c.achievedOn.year, c.achievedOn.month, c.achievedOn.day)),
                    ?c.grade,
                  ].join(' · ')),
                  onTap: c.conversationId == null ? null : () => context.push(Routes.conversation(c.conversationId!)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.value, this.emphasis = false});

  final String label;
  final int value;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Column(
        children: [
          Text(
            '$value',
            style: (emphasis ? theme.textTheme.headlineSmall : theme.textTheme.titleLarge)
                ?.copyWith(color: emphasis ? theme.colorScheme.primary : null, fontWeight: FontWeight.w700),
          ),
          Text(label, style: theme.textTheme.labelMedium),
        ],
      ),
    );
  }
}
