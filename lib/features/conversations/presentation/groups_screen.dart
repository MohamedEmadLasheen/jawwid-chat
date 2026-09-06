import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';
import '../application/conversations_controller.dart';
import 'conversation_tile.dart';

/// Student Groups — the official, and only, parent ↔ teacher channel (§24).
///
/// There is no "start a group" affordance and no member-management affordance: membership is
/// the backend's, and a parent or teacher may not change it (§24).
class GroupsScreen extends ConsumerWidget {
  const GroupsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final role = ref.watch(currentRoleProvider);
    final state = ref.watch(conversationsControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabGroups)),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(conversationsControllerProvider.notifier).refresh(),
        child: switch (state) {
          AsyncLoading() => JawwidLoadingView(label: l10n.tabGroups),
          AsyncError(:final error) => _Error(error: error, ref: ref),
          AsyncData(:final value) => _Groups(
              // Flattened out of the sectioned list: this tab is only ever groups, and a
              // teacher's list must not be grouped per child (§25).
              groups: [
                for (final section in value)
                  for (final conversation in section.conversations)
                    if (conversation.kind == ConversationKind.studentGroup)
                      conversation,
              ],
              role: role,
            ),
        },
      ),
    );
  }
}

class _Groups extends StatelessWidget {
  const _Groups({required this.groups, required this.role});

  final List<Conversation> groups;
  final UserRole? role;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    if (groups.isEmpty) {
      return ListView(
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
          JawwidEmptyView(
            title: l10n.conversationsEmptyTitle,
            body: role == UserRole.teacher
                ? l10n.conversationsEmptyBodyTeacher
                : l10n.conversationsEmptyBodyParent,
            icon: Icons.groups_outlined,
          ),
        ],
      );
    }

    final now = DateTime.now();

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: groups.length,
      itemBuilder: (context, index) => ConversationTile(
        conversation: groups[index],
        now: now,
        onTap: () => context.push(Routes.conversation(groups[index].id)),
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
