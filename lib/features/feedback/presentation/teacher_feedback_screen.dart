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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          key: ValueKey('feedback-entry-$learnerId'),
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.rate_review_outlined),
          title: Text(l10n.feedbackEntryTitle),
          subtitle: Text(l10n.feedbackEntrySubtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => TeacherFeedbackScreen.open(context, learnerId: learnerId, childName: childName),
        ),
        // PD-52 (plan §11 g): two shortcuts into the same form, its kind already chosen.
        // The one form, the same limits; the parent can still change the kind.
        Wrap(
          spacing: Spacing.spacing3,
          runSpacing: Spacing.spacing2,
          children: [
            OutlinedButton.icon(
              key: ValueKey('feedback-praise-$learnerId'),
              onPressed: () => _shortcut(context, FeedbackCategory.praise),
              icon: const Icon(Icons.favorite_outline),
              label: Text(l10n.feedbackShortcutPraise),
            ),
            OutlinedButton.icon(
              key: ValueKey('feedback-problem-$learnerId'),
              onPressed: () => _shortcut(context, FeedbackCategory.complaint),
              icon: const Icon(Icons.report_outlined),
              label: Text(l10n.feedbackShortcutProblem),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _shortcut(BuildContext context, FeedbackCategory category) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = L10n.of(context);
    // Read before the await: the profile can rebuild while the form is open and unmount this
    // card, and a ConsumerWidget's ref throws once it is gone. The container outlives it.
    final container = ProviderScope.containerOf(context, listen: false);
    final sent = await Navigator.of(context).push<FeedbackItem>(
      MaterialPageRoute(
        builder: (_) => TeacherFeedbackFormScreen(learnerId: learnerId, childName: childName, initialCategory: category),
      ),
    );
    if (sent == null) return;
    container.invalidate(myFeedbackProvider);
    messenger.showSnackBar(SnackBar(content: Text(l10n.feedbackSent)));
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
      // A refresh (opening a reply) keeps the list on screen rather than a spinner.
      body: switch (state) {
        AsyncValue(:final value?) => _History(
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
            for (final item in items) FeedbackCard(key: ValueKey('feedback-card-${item.id}'), item: item),
          ],
        ],
      ),
    );
  }
}

/// PD-32 amendment: one child's single feedback item, opened from a notification ("The
/// administration has replied to your feedback"). The reply is shown at once, so opening
/// this screen is opening the reply: its unread dot goes for this account.
class FeedbackItemScreen extends ConsumerStatefulWidget {
  const FeedbackItemScreen({super.key, required this.feedbackId});

  final String feedbackId;

  @override
  ConsumerState<FeedbackItemScreen> createState() => _FeedbackItemScreenState();
}

class _FeedbackItemScreenState extends ConsumerState<FeedbackItemScreen> {
  @override
  void initState() {
    super.initState();
    // Read the list again: one kept alive by an open history screen may predate the
    // reply this notification is about.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.invalidate(myFeedbackProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final state = ref.watch(myFeedbackProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.feedbackEntryTitle)),
      body: switch (state) {
        AsyncValue(:final value?) => switch (value.item(widget.feedbackId)) {
            final item? => ListView(
                padding: const EdgeInsets.all(Spacing.spacing5),
                children: [FeedbackCard(key: ValueKey('feedback-card-${item.id}'), item: item, openReply: true)],
              ),
            null => state.isLoading
                ? const JawwidLoadingView()
                : JawwidEmptyView(icon: Icons.rate_review_outlined, title: l10n.feedbackItemGone),
          },
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

/// One item: its kind, status, words and -- when there is one -- the administration's reply.
///
/// A reply this account has not opened yet is held behind a "New reply" row with a dot;
/// tapping it shows the reply and tells the server it was seen (this account only). With
/// [openReply] (the item opened on its own, from a notification) the reply is shown at
/// once and counts as opened.
class FeedbackCard extends ConsumerStatefulWidget {
  const FeedbackCard({super.key, required this.item, this.openReply = false});

  final FeedbackItem item;
  final bool openReply;

  @override
  ConsumerState<FeedbackCard> createState() => _FeedbackCardState();
}

class _FeedbackCardState extends ConsumerState<FeedbackCard> {
  /// Opened here, before the list comes back from the server saying so.
  bool _opened = false;

  @override
  void initState() {
    super.initState();
    _openIfAsked();
  }

  @override
  void didUpdateWidget(FeedbackCard old) {
    super.didUpdateWidget(old);
    // The item opened on its own, and a fresher read now shows a reply it did not have.
    _openIfAsked();
  }

  void _openIfAsked() {
    if (!_opened && widget.openReply && widget.item.replyUnread && widget.item.response != null) {
      _opened = true;
      // After this frame: a provider may not be refreshed while the tree builds.
      WidgetsBinding.instance.addPostFrameCallback((_) => _markSeen());
    }
  }

  Future<void> _open() async {
    setState(() => _opened = true);
    await _markSeen();
  }

  Future<void> _markSeen() async {
    if (!mounted) return;
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(feedbackRepositoryProvider).markReplySeen(widget.item.id);
    } catch (_) {
      // The reply is on screen either way; the dot comes back next time and can be opened again.
      return;
    }
    container.invalidate(myFeedbackProvider);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final response = item.response;
    final unread = response != null && item.replyUnread && !_opened;

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
            if (unread) ...[
              const SizedBox(height: Spacing.spacing4),
              Material(
                color: tokens.colorSurfaceMuted,
                borderRadius: Radii.card,
                child: InkWell(
                  key: ValueKey('feedback-open-reply-${item.id}'),
                  borderRadius: Radii.card,
                  onTap: _open,
                  child: Padding(
                    padding: const EdgeInsets.all(Spacing.spacing4),
                    child: Row(
                      children: [
                        Icon(Icons.circle, key: ValueKey('feedback-unread-${item.id}'), size: 10, color: tokens.colorBrandPrimary),
                        const SizedBox(width: Spacing.spacing3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.feedbackNewReply,
                                style: theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              Text(
                                l10n.feedbackOpenReply,
                                style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right),
                      ],
                    ),
                  ),
                ),
              ),
            ] else if (response != null) ...[
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
