import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';
import '../../conversations/application/conversations_controller.dart';
import '../../conversations/domain/conversation_list.dart';
import '../../conversations/presentation/conversation_tile.dart';

/// Home — *"what do I need to know or respond to?"*, answered before any scrolling.
///
/// Everything the operations side of the product does — ownership, coverage, buckets,
/// attention, workload, cases, response targets, internal notes — is **absent** here, not
/// simplified (`parent-home.md` §1). A parent should close this app thinking "Jawwid is
/// handling my children's education", not "I am using a CRM".
///
/// Sections with nothing to say are omitted entirely rather than rendered empty: a parent
/// with no class today should not read "No class today" three times a week (§3).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final role = ref.watch(currentRoleProvider);
    final state = ref.watch(conversationsControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabHome)),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(conversationsControllerProvider.notifier).refresh(),
        child: switch (state) {
          AsyncLoading() => const JawwidLoadingView(),
          AsyncError(:final error) => _Error(error: error, ref: ref),
          AsyncData(:final value) => role == UserRole.teacher
              ? _TeacherHome(sections: value)
              : _ParentHome(sections: value),
        },
      ),
    );
  }
}

/// Jawwid card, then the children. Next class and Action needed are backend-supplied and
/// are omitted until that data exists — see `docs/mobile/backend-dependencies.md`.
class _ParentHome extends StatelessWidget {
  const _ParentHome({required this.sections});

  final List<ConversationSection> sections;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    final support = sections
        .expand((s) => s.conversations)
        .where((c) => c.kind == ConversationKind.jawwidSupport)
        .firstOrNull;

    final childSections =
        sections.where((s) => s.key.startsWith('learner:')).toList();

    if (support == null && childSections.isEmpty) {
      return ListView(
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
          JawwidEmptyView(
            title: l10n.conversationsEmptyTitle,
            body: l10n.conversationsEmptyBodyParent,
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: Spacing.spacing8),
      children: [
        if (support != null) _JawwidCard(conversation: support),
        if (childSections.isNotEmpty) ...[
          _Heading(text: l10n.homeYourChildren),
          for (final section in childSections)
            _ChildRow(
              name: section.learner!.displayName,
              avatarUrl: section.learner!.avatarUrl,
              unread: section.conversations
                  .fold<int>(0, (sum, c) => sum + c.unreadCount),
              onTap: () =>
                  context.push(Routes.conversation(section.conversations.first.id)),
            ),
        ],
      ],
    );
  }
}

/// The emotional centre of the parent experience (`parent-home.md` §4).
///
/// It shows the parent's Jawwid contact and the last message. It never says who is on duty,
/// that coverage exists, or that anyone was covering — the parent has one contact at Jawwid,
/// and that does not change at 17:00 (journey J3).
class _JawwidCard extends StatelessWidget {
  const _JawwidCard({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.all(Spacing.spacing5),
      child: Container(
        padding: const EdgeInsets.all(Spacing.spacing5),
        decoration: BoxDecoration(
          color: tokens.colorBrandSubtle,
          borderRadius: Radii.card,
          border: Border.all(color: tokens.colorBorderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                JawwidAvatar(
                  displayName: conversation.title,
                  imageUrl: conversation.avatarUrl,
                  size: Sizes.avatarLg,
                ),
                const SizedBox(width: Spacing.spacing4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(conversation.title, style: theme.textTheme.titleMedium),
                      if (conversation.handledByLabel != null)
                        Text(
                          l10n.handledBy(conversation.handledByLabel!),
                          style: theme.textTheme.labelSmall
                              ?.copyWith(color: tokens.colorTextSecondary),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (conversation.lastMessagePreview.isNotEmpty) ...[
              const SizedBox(height: Spacing.spacing4),
              Text(
                conversation.lastMessagePreview,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ],
            const SizedBox(height: Spacing.spacing5),
            FilledButton(
              onPressed: () => context.push(Routes.conversation(conversation.id)),
              child: Text(l10n.homeMessageJawwid),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChildRow extends StatelessWidget {
  const _ChildRow({
    required this.name,
    required this.unread,
    required this.onTap,
    this.avatarUrl,
  });

  final String name;
  final String? avatarUrl;
  final int unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Semantics(
      button: true,
      label: unread > 0 ? '$name. ${l10n.unreadCount(unread)}' : name,
      child: ExcludeSemantics(
        child: ListTile(
          onTap: onTap,
          leading: JawwidAvatar(displayName: name, imageUrl: avatarUrl),
          title: Text(name),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (unread > 0)
                Container(
                  constraints: const BoxConstraints(minWidth: 20),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: tokens.colorBrandPrimary,
                    borderRadius: const BorderRadius.all(Radii.radiusFull),
                  ),
                  child: Text(
                    unread > 99 ? '99+' : '$unread',
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: tokens.colorBrandOnPrimary),
                  ),
                ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

/// Teacher home. "Needs a reply" is **unread-driven and sorted by time** — this app has no
/// attention model at all, and must never render a score, bucket, or priority label
/// (`teacher-home.md` §3, handoff rule 1).
class _TeacherHome extends StatelessWidget {
  const _TeacherHome({required this.sections});

  final List<ConversationSection> sections;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final now = DateTime.now();

    final all = sections.expand((s) => s.conversations).toList();
    final needsReply = all.where((c) => c.hasUnread).toList()
      ..sort((a, b) {
        final left = a.lastMessageAt ?? a.updatedAt;
        final right = b.lastMessageAt ?? b.updatedAt;
        return left.compareTo(right);
      });

    if (all.isEmpty) {
      return ListView(
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
          JawwidEmptyView(
            title: l10n.conversationsEmptyTitle,
            body: l10n.conversationsEmptyBodyTeacher,
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: Spacing.spacing8),
      children: [
        if (needsReply.isNotEmpty) ...[
          _Heading(text: l10n.homeNeedsReply),
          for (final conversation in needsReply)
            ConversationTile(
              conversation: conversation,
              now: now,
              onTap: () => context.push(Routes.conversation(conversation.id)),
            ),
        ],
        _Heading(text: l10n.sectionMyGroups),
        for (final conversation in all)
          if (conversation.kind == ConversationKind.studentGroup)
            ConversationTile(
              conversation: conversation,
              now: now,
              onTap: () => context.push(Routes.conversation(conversation.id)),
            ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing2,
      ),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: JawwidTokens.of(context).colorTextSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.error, required this.ref});

  final Object error;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final message = ErrorPresenter.present(asAppError(error), l10n);

    return ListView(
      children: [
        SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
        JawwidErrorView(
          title: message.title,
          body: message.body,
          retryLabel: message.canRetry ? l10n.retryAction : null,
          onRetry: message.canRetry
              ? () => ref.read(conversationsControllerProvider.notifier).refresh()
              : null,
        ),
      ],
    );
  }
}
