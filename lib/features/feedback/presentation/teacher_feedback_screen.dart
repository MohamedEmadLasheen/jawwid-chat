import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/teacher_feedback.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';
import 'teacher_feedback_form.dart';

/// `GET /me/feedback`, for the signed-in parent; session-scoped.
final myFeedbackProvider = FutureProvider.autoDispose<MyFeedback>((ref) async {
  ref.watch(principalIdProvider);
  return ref.watch(feedbackRepositoryProvider).mine();
});

/// PD-32: the way in, on each child's card of the parent's own profile.
///
/// Offered only to a parent, and only in a build that reaches the feedback routes. Who may
/// send feedback about whom is the server's answer.
class TeacherFeedbackEntry extends ConsumerWidget {
  const TeacherFeedbackEntry({super.key, required this.learnerId, required this.childName});

  final String learnerId;
  final String childName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(feedbackRepositoryProvider).isAvailable) return const SizedBox.shrink();
    if (ref.watch(currentRoleProvider) != UserRole.parent) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    return ListTile(
      key: ValueKey('feedback-entry-$learnerId'),
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.rate_review_outlined),
      title: Text(l10n.feedbackEntryTitle),
      subtitle: Text(l10n.feedbackEntrySubtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => TeacherFeedbackScreen.open(context, learnerId: learnerId, childName: childName),
    );
  }
}

/// One child's feedback about their teacher: what the parent sent before, with its status
/// and the administration's reply, and a way to send more.
class TeacherFeedbackScreen extends ConsumerWidget {
  const TeacherFeedbackScreen({super.key, required this.learnerId, required this.childName});

  final String learnerId;
  final String childName;

  /// Pushed on the navigator rather than routed: it is reached from one place only.
  static Future<void> open(BuildContext context, {required String learnerId, required String childName}) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => TeacherFeedbackScreen(learnerId: learnerId, childName: childName)),
    );
  }

  Future<void> _new(BuildContext context, WidgetRef ref, FeedbackChild? child) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = L10n.of(context);
    final sent = await Navigator.of(context).push<FeedbackItem>(
      MaterialPageRoute(
        builder: (_) => TeacherFeedbackFormScreen(
          learnerId: learnerId,
          childName: child?.name.isNotEmpty == true ? child!.name : childName,
          teacherName: child?.teacherName,
        ),
      ),
    );
    if (sent == null) return;
    ref.invalidate(myFeedbackProvider);
    messenger.showSnackBar(SnackBar(content: Text(l10n.feedbackSent)));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(myFeedbackProvider);
    final child = state.value?.child(learnerId);
    // A child the server lists with no teacher has no one to give feedback about.
    final noTeacher = child != null && child.teacherName == null;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.feedbackEntryTitle)),
      floatingActionButton: state.hasValue && !noTeacher
          ? FloatingActionButton.extended(
              key: const ValueKey('feedback-new'),
              onPressed: () => _new(context, ref, child),
              icon: const Icon(Icons.edit_outlined),
              label: Text(l10n.feedbackNew),
            )
          : null,
      body: switch (state) {
        AsyncData(:final value) => _History(
            learnerId: learnerId,
            childName: childName,
            feedback: value,
            noTeacher: noTeacher,
          ),
        AsyncError(:final error) => Builder(builder: (context) {
            final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
            return JawwidErrorView(
              title: message.title,
              body: message.body,
              retryLabel: message.canRetry ? l10n.retryAction : null,
              onRetry: message.canRetry ? () => ref.invalidate(myFeedbackProvider) : null,
            );
          }),
        _ => const JawwidLoadingView(),
      },
    );
  }
}

class _History extends ConsumerWidget {
  const _History({
    required this.learnerId,
    required this.childName,
    required this.feedback,
    required this.noTeacher,
  });

  final String learnerId;
  final String childName;
  final MyFeedback feedback;
  final bool noTeacher;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final child = feedback.child(learnerId);
    final items = feedback.forChild(learnerId);
    final name = child?.name.isNotEmpty == true ? child!.name : childName;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(myFeedbackProvider);
        await ref.read(myFeedbackProvider.future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        // Room under the last card for the floating button.
        padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing5, Spacing.spacing5, Spacing.spacing11 + Spacing.spacing5),
        children: [
          ContentText(name, style: theme.textTheme.titleMedium),
          if (child?.teacherName != null)
            ContentText(
              l10n.feedbackTeacherLine(child!.teacherName!),
              style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary),
            ),
          const SizedBox(height: Spacing.spacing5),
          if (noTeacher)
            JawwidEmptyView(icon: Icons.person_off_outlined, title: l10n.feedbackNoTeacher)
          else if (items.isEmpty)
            JawwidEmptyView(icon: Icons.rate_review_outlined, title: l10n.feedbackEmpty, body: l10n.feedbackEmptyBody)
          else ...[
            Text(l10n.feedbackHistoryTitle, style: theme.textTheme.labelLarge?.copyWith(color: tokens.colorTextSecondary)),
            const SizedBox(height: Spacing.spacing3),
            for (final item in items) _FeedbackCard(item: item),
          ],
        ],
      ),
    );
  }
}

class _FeedbackCard extends StatelessWidget {
  const _FeedbackCard({required this.item});

  final FeedbackItem item;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final response = item.response;

    return Card(
      key: ValueKey('feedback-${item.id}'),
      margin: const EdgeInsets.only(bottom: Spacing.spacing4),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    feedbackCategoryLabel(item.category, l10n),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                FeedbackStatusChip(status: item.status),
              ],
            ),
            const SizedBox(height: Spacing.spacing1),
            Text(
              l10n.feedbackSentOn(DateFormat.yMMMd(locale).format(item.createdAt)),
              style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
            ),
            const SizedBox(height: Spacing.spacing3),
            ContentText(item.body, style: theme.textTheme.bodyMedium),
            if (response != null) ...[
              const SizedBox(height: Spacing.spacing4),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tokens.colorSurfaceMuted,
                  borderRadius: Radii.card,
                  border: BorderDirectional(start: BorderSide(color: tokens.colorBrandPrimary, width: 3)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(Spacing.spacing4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.feedbackResponseLabel,
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: tokens.colorTextSecondary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: Spacing.spacing2),
                      ContentText(response, style: theme.textTheme.bodyMedium),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Received / In review / Resolved, as a small pill. The word carries the meaning; the
/// colour only repeats it (§53).
class FeedbackStatusChip extends StatelessWidget {
  const FeedbackStatusChip({super.key, required this.status});

  final FeedbackStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (label, fg, bg) = switch (status) {
      FeedbackStatus.received => (l10n.feedbackStatusReceived, tokens.colorStatusNeutralFg, tokens.colorStatusNeutralBg),
      FeedbackStatus.inReview => (l10n.feedbackStatusInReview, tokens.colorStatusInfoFg, tokens.colorStatusInfoBg),
      FeedbackStatus.resolved => (l10n.feedbackStatusResolved, tokens.colorStatusSuccessFg, tokens.colorStatusSuccessBg),
    };
    return DecoratedBox(
      decoration: BoxDecoration(color: bg, borderRadius: const BorderRadius.all(Radii.radiusFull)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing3, vertical: Spacing.spacing1),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

String feedbackCategoryLabel(FeedbackCategory category, L10n l10n) => switch (category) {
      FeedbackCategory.praise => l10n.feedbackCategoryPraise,
      FeedbackCategory.suggestion => l10n.feedbackCategorySuggestion,
      FeedbackCategory.complaint => l10n.feedbackCategoryComplaint,
    };
