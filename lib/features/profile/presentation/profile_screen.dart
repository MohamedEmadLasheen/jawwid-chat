import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/policy/communication_policy.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../../conversations/application/open_direct_controller.dart';
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
/// short stack of sections.
///
/// A member row may carry a **message** action, and only where
/// `CommunicationPolicy.allowsDirectContactFromGroupMember` vouches for the role
/// pair — today that is a Jawwid staff member and nothing else. **There is still
/// no teacher↔parent 1:1 affordance here**: PD-6 permits an *authorized* pairing,
/// but authorization is a property of the live teaching relationship and a role
/// pair cannot express it, so this client offers nothing rather than offering a
/// channel the server would refuse (`handoff-mobile.md` §5.7,
/// `student-group.md` §1).
///
/// There is no **call** action: calling arrives with the call UI, and an
/// affordance with no screen behind it is worse than none. Both absences are
/// absences, never disabled controls.
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
        AsyncData(:final value) => ProfileBody(
            view: value,
            // The conversation-scoped controls. They sit on this screen and not
            // on MyAccountScreen because they belong to a conversation, not to
            // a person: muting yourself is not a thing.
            actions: [ConversationActions(conversationId: conversationId)],
          ),
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
class ProfileBody extends ConsumerWidget {
  const ProfileBody({super.key, required this.view, this.actions = const []});

  final ProfileView view;

  /// Conversation-scoped controls, rendered under the header. Empty on an
  /// account profile, which has no conversation to act on.
  final List<Widget> actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);

    return ListView(
      padding: const EdgeInsets.only(bottom: Spacing.spacing9),
      children: [
        ProfileHeader(view: view),

        if (actions.isNotEmpty) ...[
          const ProfileDivider(),
          ...actions,
        ],

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
          for (final member in view.members)
            MemberTile(
              member: member,
              // ONE place decides whether to offer this, and it decides from the
              // role pair only. `CommunicationPolicy` returns false for
              // teacher↔parent in both directions — not because the product
              // forbids it (PD-6 permits an authorized pairing) but because a
              // role pair cannot express "authorized", and a client that guessed
              // would offer a channel the server then refuses. So: no affordance
              // until the server states the pairing per conversation.
              onMessage: _mayOffer(ref, member)
                  ? () => _openDirect(context, ref, member)
                  : null,
              isOpening: ref
                  .watch(openDirectControllerProvider)
                  .isOpening(member.id),
            ),
          if (view.requiresApproval)
            ProfileNote(text: l10n.groupApprovalNotice),
        ],
      ],
    );
  }

  /// Whether this client may *offer* a direct channel to [member].
  ///
  /// `allowsDirectContactFromGroupMember` rather than the general predicate: this
  /// is the call site that method was named for, and its doc carries the rule
  /// that matters here — being in a group together grants no 1:1 channel, so
  /// membership must never become a directory (§25).
  ///
  /// Today that resolves to one case: a member whose role is `admin`. Which is
  /// also why there is no "is this me" check — a parent and a teacher are each
  /// refused their own role pair, so a viewer can never be offered a channel with
  /// themselves.
  ///
  /// None of this is permission. Permission is the server's, on the request.
  bool _mayOffer(WidgetRef ref, ProfilePerson member) {
    final viewer = ref.watch(currentRoleProvider);
    final role = member.role;
    if (viewer == null || role == null || member.id.isEmpty) return false;

    return CommunicationPolicy.allowsDirectContactFromGroupMember(viewer, role);
  }

  /// Open the channel, then go to it.
  ///
  /// Navigation happens only on success. A refusal or a dropped connection shows
  /// what happened and stays put — pushing a chat screen for a conversation that
  /// was never created is the one failure mode worth writing code to avoid.
  Future<void> _openDirect(
    BuildContext context,
    WidgetRef ref,
    ProfilePerson member,
  ) async {
    // Read off the context BEFORE the await: using a BuildContext across an
    // async gap is how a disposed widget becomes a crash. The router is the one
    // exception and is read after, behind a mounted check — acquiring it up
    // front would make this method require a router even on the paths that
    // never navigate.
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final conversation =
        await ref.read(openDirectControllerProvider.notifier).open(member.id);

    if (conversation != null) {
      // The list holds a conversation that did not exist a moment ago, and the
      // badge and ordering are computed from it. Refreshing is not cosmetic: the
      // new channel would otherwise be missing from Chats until the next load.
      ref.invalidate(conversationsControllerProvider);
      if (context.mounted) {
        unawaited(GoRouter.of(context).push(Routes.conversation(conversation.id)));
      }
      return;
    }

    final failure = ref.read(openDirectControllerProvider).failure;
    if (failure == null) return; // A duplicate tap, already in flight.

    final message = ErrorPresenter.present(failure, l10n);
    messenger.showSnackBar(
      SnackBar(content: Text(message.body ?? message.title)),
    );
    ref.read(openDirectControllerProvider.notifier).acknowledge();
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

/// A group member: name, role, avatar — and, where the pairing permits one, a way
/// to message them.
///
/// **The action is absent, never disabled.** A greyed-out button tells a teacher
/// that a channel to this parent exists and is being withheld; nothing tells them
/// anything. [onMessage] null means no affordance at all, and the caller decides
/// that from `CommunicationPolicy` — which answers "may this client offer it",
/// not "is it allowed". The server decides allowed, per action.
class MemberTile extends StatelessWidget {
  const MemberTile({
    super.key,
    required this.member,
    this.onMessage,
    this.isOpening = false,
  });

  final ProfilePerson member;

  /// Null when this client cannot establish that the pairing is offerable.
  final VoidCallback? onMessage;

  /// True only for the row whose channel is being opened, so one round trip does
  /// not put a spinner on every member.
  final bool isOpening;

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

    // The name and role are ONE announcement, so a screen reader says
    // "Umm Yusuf. Parent" rather than reading two fragments. The action is
    // deliberately outside that: it is a separate, focusable control and must
    // keep its own label, which `ExcludeSemantics` would otherwise swallow.
    final identity = Semantics(
      label: role == null ? name : '$name. ${roleLabel(role, l10n)}',
      child: ExcludeSemantics(
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
          ],
        ),
      ),
    );

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        children: [
          Expanded(child: identity),
          // No call action here: calling arrives with the call UI, and an
          // affordance with no screen behind it is worse than none.
          if (isOpening)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: Spacing.spacing4),
              child: SizedBox(
                width: Spacing.spacing6,
                height: Spacing.spacing6,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else if (onMessage != null)
            IconButton(
              onPressed: onMessage,
              icon: const Icon(Icons.chat_bubble_outline),
              // Who, not just what: a bare "Message" gives a screen-reader user
              // no way to tell which row's button has focus.
              tooltip: '${l10n.memberMessageAction}: $name',
            ),
        ],
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


/// Mute, and the way in to what has been shared here.
///
/// Three things the brief asks Conversation Info to carry (§28): mute, search
/// and media. Two of them are here. **Search is absent rather than disabled**
/// because there is no message-search endpoint on this API — offering a search
/// box that finds nothing would be worse than not offering one, and a greyed-out
/// row is an invitation to keep tapping it.
class ConversationActions extends ConsumerWidget {
  const ConversationActions({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final sections = ref.watch(conversationsControllerProvider).value;

    final conversation = sections
        ?.expand((section) => section.conversations)
        .firstWhereOrNull((c) => c.id == conversationId);

    return Column(
      children: [
        // Only once the list has loaded. A toggle rendered before its own state
        // is known shows "Mute" on an already-muted conversation, and the user
        // taps it to unmute and mutes it instead.
        if (conversation != null)
          SwitchListTile(
            secondary: Icon(
              conversation.isMuted
                  ? Icons.notifications_off_outlined
                  : Icons.notifications_active_outlined,
            ),
            title: Text(l10n.notificationsMuted),
            // Muting silences notifications and nothing else (§5). Saying so
            // here is what stops a parent muting a conversation and then
            // believing they stopped receiving their child's messages.
            subtitle: Text(l10n.notificationsMutedExplainer),
            value: conversation.isMuted,
            onChanged: (muted) => _setMuted(context, ref, muted: muted),
          ),
        ListTile(
          leading: const Icon(Icons.photo_library_outlined),
          title: Text(l10n.mediaAndFilesTitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push(Routes.conversationMedia(conversationId)),
        ),
      ],
    );
  }

  Future<void> _setMuted(
    BuildContext context,
    WidgetRef ref, {
    required bool muted,
  }) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    try {
      await ref
          .read(conversationsControllerProvider.notifier)
          .setMuted(conversationId, muted);
    } on AppError catch (error) {
      // The controller rolls the switch back on failure, so without this the
      // toggle would flip and flip back on its own.
      final message = ErrorPresenter.present(error, l10n);
      messenger.showSnackBar(SnackBar(content: Text(message.title)));
    }
  }
}
