import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../application/profile_controller.dart';
import '../domain/profile_view.dart';
import 'profile_sections.dart';

/// A person's profile, or a group's info.
///
/// Reached only by tapping an avatar or a name — from a conversation row or from the chat
/// header — the way people already expect. There is no Profile tab, and this screen is not
/// a destination anyone can land on without having been looking at that conversation.
///
/// It reads as a messaging profile, not an admin record: one large avatar, the name, then a
/// short stack of sections. What it deliberately has **no** room for is a message action or
/// a call action — no teacher↔parent 1:1 affordance exists anywhere, absent rather than
/// disabled (`handoff-mobile.md` §5.7, `student-group.md` §1).
class ConversationProfileScreen extends ConsumerWidget {
  const ConversationProfileScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(conversationProfileProvider(conversationId));

    return Scaffold(
      appBar: AppBar(
        title: Text(
          switch (state) {
            AsyncData(:final value) when value.isGroup => l10n.groupInfoTitle,
            _ => l10n.profileTitle,
          },
        ),
      ),
      body: switch (state) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError(:final error) => _Error(
            error: error,
            onRetry: () =>
                ref.invalidate(conversationProfileProvider(conversationId)),
          ),
        AsyncData(:final value) => ProfileBody(view: value),
      },
    );
  }
}

/// The signed-in user's own account, reached from Settings.
///
/// A separate entry point from [ConversationProfileScreen] on purpose: "my account" and
/// "someone else's profile" are different things with different audiences, and collapsing
/// them into one screen with a flag is how a viewer check eventually gets missed.
class MyAccountScreen extends ConsumerWidget {
  const MyAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(myAccountProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.myAccountTitle)),
      body: switch (state) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError(:final error) => _Error(
            error: error,
            onRetry: () => ref.invalidate(myAccountProvider),
          ),
        AsyncData(:final value) => ProfileBody(view: value),
      },
    );
  }
}

/// The shared body: header, then whatever sections this viewer is entitled to.
class ProfileBody extends StatelessWidget {
  const ProfileBody({super.key, required this.view});

  final ProfileView view;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return ListView(
      padding: const EdgeInsets.only(bottom: Spacing.spacing9),
      children: [
        ProfileHeader(view: view),

        // Owner only, and empty today — there is no contact file in this system. Rendered
        // as a named section saying so rather than omitted, so the gap is visible to the
        // person it belongs to and invisible to everyone else.
        if (view.maySeeContactFile) ...[
          const ProfileDivider(),
          ProfileSectionHeading(text: l10n.contactInfoTitle),
          ProfileNote(text: l10n.contactInfoUnavailable),
        ],

        if (view.maySeeChildren) ...[
          const ProfileDivider(),
          ProfileSectionHeading(text: l10n.childrenTitle),
          if (view.children.isEmpty)
            ProfileNote(text: l10n.childrenEmpty)
          else
            for (final child in view.children) ChildTile(child: child),
        ],

        if (view.isGroup) ...[
          const ProfileDivider(),
          ProfileSectionHeading(text: l10n.groupMembersTitle),
          for (final member in view.members) MemberTile(member: member),
          if (view.requiresApproval)
            ProfileNote(text: l10n.groupApprovalNotice),
        ],
      ],
    );
  }
}

/// Large avatar, name, and one quiet line of role or context.
class ProfileHeader extends StatelessWidget {
  const ProfileHeader({super.key, required this.view});

  final ProfileView view;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    final subtitle = switch (view) {
      ProfileView(isGroup: true, learner: final learner?) =>
        '${l10n.groupLearnerLabel} · ${learner.displayName}',
      ProfileView(handledByLabel: final handled?) => l10n.handledBy(handled),
      ProfileView(subject: ProfilePerson(role: final role?)) =>
        roleLabel(role, l10n),
      _ => null,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing7,
      ),
      child: Column(
        children: [
          JawwidAvatar(
            displayName: view.subject.displayName,
            imageUrl: view.subject.avatarUrl,
            size: Sizes.avatarXl,
          ),
          const SizedBox(height: Spacing.spacing5),
          ContentText(
            view.subject.displayName,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: Spacing.spacing2),
            ContentText(
              subtitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: tokens.colorTextSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

/// A group member: name, role, avatar. Nothing else exists to show, and nothing else may be.
class MemberTile extends StatelessWidget {
  const MemberTile({super.key, required this.member});

  final ProfilePerson member;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    // Over HTTP the member payload carries no display name (gap O3). Falling back to the
    // actor id would put an internal identifier on a family surface, so the fallback is a
    // neutral role word instead.
    final name =
        member.hasResolvedName ? member.displayName : l10n.groupMemberUnresolved;
    final role = member.role;

    return Semantics(
      label: role == null ? name : '$name. ${roleLabel(role, l10n)}',
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing5,
            vertical: Spacing.spacing3,
          ),
          child: Row(
            children: [
              JawwidAvatar(
                displayName: name,
                imageUrl: member.avatarUrl,
                size: Sizes.avatarMd,
              ),
              const SizedBox(width: Spacing.spacing4),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ContentText(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall,
                    ),
                    if (role != null)
                      Text(
                        roleLabel(role, l10n),
                        style: theme.textTheme.labelSmall
                            ?.copyWith(color: tokens.colorTextSecondary),
                      ),
                  ],
                ),
              ),
              // No message action and no call action. Absent, not disabled.
            ],
          ),
        ),
      ),
    );
  }
}

String roleLabel(ParticipantRole role, L10n l10n) => switch (role) {
      ParticipantRole.parent => l10n.groupMemberRoleParent,
      ParticipantRole.teacher => l10n.groupMemberRoleTeacher,
      ParticipantRole.admin => l10n.groupMemberRoleAdmin,
      ParticipantRole.system || ParticipantRole.unknown => '',
    };

class _Error extends StatelessWidget {
  const _Error({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final message = ErrorPresenter.present(asAppError(error), l10n);

    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry ? onRetry : null,
    );
  }
}
