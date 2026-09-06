import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../application/conversations_controller.dart';
import '../domain/conversation_list.dart';
import 'conversation_tile.dart';

/// The chat list. Loading, empty, and error states are all handled — §55 requires that no
/// path here renders a blank screen.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key, this.onOpenConversation});

  /// Overridable so widget tests can observe navigation without a router.
  final void Function(String conversationId)? onOpenConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(conversationsControllerProvider);
    final role = ref.watch(currentRoleProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabChats)),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(conversationsControllerProvider.notifier).refresh(),
        child: switch (state) {
          AsyncLoading() => JawwidLoadingView(label: l10n.tabChats),
          AsyncError(:final error) => _ErrorState(error: error, ref: ref),
          AsyncData(:final value) when value.isEmpty => _EmptyState(role: role),
          AsyncData(:final value) => _SectionedList(
              sections: value,
              onOpenConversation: onOpenConversation ??
                  (id) => context.push(Routes.conversation(id)),
            ),
        },
      ),
    );
  }
}

class _SectionedList extends StatelessWidget {
  const _SectionedList({required this.sections, required this.onOpenConversation});

  final List<ConversationSection> sections;
  final void Function(String conversationId) onOpenConversation;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();

    // Flatten to a single sliver list so the whole thing is lazily built — a family with
    // several children and a teacher with many groups both stay cheap to scroll (§47).
    final rows = <Widget>[];
    for (final section in sections) {
      rows.add(_SectionHeader(section: section));
      for (final conversation in section.conversations) {
        rows.add(
          ConversationTile(
            conversation: conversation,
            now: now,
            onTap: () => onOpenConversation(conversation.id),
          ),
        );
      }
    }

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: rows.length,
      itemBuilder: (context, index) => rows[index],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.section});

  final ConversationSection section;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    final label = switch (section.key) {
      'primary' => section.learner == null ? l10n.sectionJawwid : '',
      'staff' => l10n.sectionStaff,
      _ => section.learner?.displayName ?? '',
    };

    // A teacher's primary section is their groups, a parent's is the Jawwid thread.
    final resolved = section.key == 'primary' && section.learner == null
        ? label
        : (section.learner != null
            ? l10n.sectionLearner(section.learner!.displayName)
            : label);

    if (resolved.isEmpty) return const SizedBox(height: Spacing.spacing3);

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
          resolved,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.role});

  final UserRole? role;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return ListView(
      children: [
        SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
        JawwidEmptyView(
          title: l10n.conversationsEmptyTitle,
          body: role == UserRole.teacher
              ? l10n.conversationsEmptyBodyTeacher
              : l10n.conversationsEmptyBodyParent,
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.ref});

  final Object error;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final message = ErrorPresenter.present(
      error is AppError ? error as AppError : asAppError(error),
      l10n,
    );

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
