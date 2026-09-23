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
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/text_direction.dart';
import '../../notifications/presentation/notification_bell.dart';
import '../../stories/presentation/stories_rail.dart';
import '../application/conversations_controller.dart';
import '../domain/chat_feed.dart';
import '../domain/conversation_list.dart';
import 'chat_filter_bar.dart';
import 'chat_search_field.dart';
import 'conversation_tile.dart';

/// Chats — the whole signed-in product, in one place.
///
/// This replaces what used to be three competing destinations (Home, Jawwid, Groups). A
/// parent asking "where is my child's group?" now has one answer instead of three
/// plausible ones, and the answer is the screen they are already on.
///
/// The hierarchy, top to bottom, is the one people arrive already knowing:
/// header → search → stories → filters → conversations.
///
/// Loading, empty, and error states are all handled — §55 requires that no path here
/// renders a blank screen.
class ChatsScreen extends ConsumerStatefulWidget {
  const ChatsScreen({
    super.key,
    this.onOpenConversation,
    this.onOpenProfile,
    this.initialFilter = ChatFilter.all,
  });

  /// Overridable so widget tests can observe navigation without a router.
  final void Function(String conversationId)? onOpenConversation;

  /// Same, for the avatar/name tap that opens a profile rather than the conversation.
  final void Function(String conversationId)? onOpenProfile;

  /// Which chip the screen opens on. Always [ChatFilter.all] in the app — the parameter
  /// exists so a test can assert what a given filter shows without driving a tap through
  /// a localised chip label.
  final ChatFilter initialFilter;

  @override
  ConsumerState<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends ConsumerState<ChatsScreen> {
  final _searchController = TextEditingController();
  late ChatFilter _filter = widget.initialFilter;
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _open(String conversationId) {
    final handler = widget.onOpenConversation;
    if (handler != null) {
      handler(conversationId);
      return;
    }
    context.push(Routes.conversation(conversationId));
  }

  void _openProfile(String conversationId) {
    final handler = widget.onOpenProfile;
    if (handler != null) {
      handler(conversationId);
      return;
    }
    context.push(Routes.conversationProfile(conversationId));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final state = ref.watch(conversationsControllerProvider);
    final role = ref.watch(currentRoleProvider);

    final sections = state.value ?? const <ConversationSection>[];
    final unreadChats =
        ChatFeed.count(sections: sections, filter: ChatFilter.unread);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.tabChats),
        titleTextStyle: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
        // The bell, not a tab. The shell is deliberately three destinations
        // (`decisions.md` DD-08, and the forbidden-affordances suite enforces
        // it), and notifications are somewhere you visit and come back from
        // rather than a place the app lives. Chats is where a parent already
        // is, so the bell belongs here.
        actions: const [NotificationBell(), _OverflowMenu()],
      ),
      body: Column(
        children: [
          // Search and the filter chips stay put while the list scrolls. On a phone the
          // alternative — letting them scroll away — means the one control people reach
          // for when a list is long is missing exactly when the list is long.
          ColoredBox(
            color: tokens.colorSurfaceDefault,
            child: Column(
              children: [
                ChatSearchField(
                  controller: _searchController,
                  onChanged: (value) => setState(() => _query = value),
                  onClear: () {
                    _searchController.clear();
                    setState(() => _query = '');
                    FocusScope.of(context).unfocus();
                  },
                ),
                ChatFilterBar(
                  selected: _filter,
                  unreadCount: unreadChats,
                  onSelected: (filter) => setState(() => _filter = filter),
                ),
                const SizedBox(height: Spacing.spacing2),
              ],
            ),
          ),
          Divider(height: 1, color: tokens.colorBorderSubtle),
          Expanded(
            child: switch (state) {
              AsyncLoading() => JawwidLoadingView(label: l10n.tabChats),
              AsyncError(:final error) => _ErrorState(error: error),
              AsyncData(:final value) => _Feed(
                  conversations: ChatFeed.build(
                    sections: value,
                    filter: _filter,
                    query: _query,
                  ),
                  filter: _filter,
                  query: _query,
                  role: role,
                  onOpen: _open,
                  onOpenProfile: _openProfile,
                ),
            },
          ),
        ],
      ),
    );
  }
}

/// The scrolling half of the screen: stories, then conversations.
class _Feed extends ConsumerWidget {
  const _Feed({
    required this.conversations,
    required this.filter,
    required this.query,
    required this.role,
    required this.onOpen,
    required this.onOpenProfile,
  });

  final List<Conversation> conversations;
  final ChatFilter filter;
  final String query;
  final UserRole? role;
  final void Function(String conversationId) onOpen;
  final void Function(String conversationId) onOpenProfile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();

    return RefreshIndicator(
      onRefresh: () =>
          ref.read(conversationsControllerProvider.notifier).refresh(),
      child: CustomScrollView(
        // Always scrollable, so pull-to-refresh works on an empty list too.
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Part of the scrolling content rather than pinned above it: when stories
          // exist they should get out of the way as soon as someone starts reading
          // their chats. Renders nothing at all while no story feature exists.
          const SliverToBoxAdapter(child: StoriesRail()),
          if (conversations.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              // Biased towards the top rather than centred. Centring put the explanation
              // more than half a screen below the search field the user had just typed
              // into, which reads as a void rather than as an answer. `hasScrollBody`
              // stays false so the sliver still grows — and scrolls — if the copy wraps
              // at a large text size.
              //
              // The Column with a minimum main-axis size is load-bearing: JawwidEmptyView
              // wraps a Center, which fills whatever box it is handed, so aligning it to
              // the top on its own does nothing at all. Given unbounded height by the
              // Column, it shrinks to its content and the alignment takes effect.
              child: Align(
                alignment: Alignment.topCenter,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: Spacing.spacing9),
                    _EmptyState(filter: filter, query: query, role: role),
                  ],
                ),
              ),
            )
          else
            SliverList.separated(
              itemCount: conversations.length,
              separatorBuilder: (context, index) => const _RowSeparator(),
              itemBuilder: (context, index) {
                final conversation = conversations[index];
                return ConversationTile(
                  conversation: conversation,
                  now: now,
                  onTap: () => onOpen(conversation.id),
                  onOpenProfile: () => onOpenProfile(conversation.id),
                  onLongPress: () =>
                      _showActions(context, ref, conversation),
                );
              },
            ),
          // Breathing room above the tab bar so the last row is never half-hidden
          // behind it, and the safe-area inset on a home-indicator phone.
          const SliverToBoxAdapter(child: SizedBox(height: Spacing.spacing5)),
        ],
      ),
    );
  }
}

/// A hairline inset past the avatar, the way a chat list has always separated rows.
class _RowSeparator extends StatelessWidget {
  const _RowSeparator();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(
        start: Spacing.spacing5 + Sizes.avatarLg + Spacing.spacing4,
      ),
      child: Divider(
        height: 1,
        color: JawwidTokens.of(context).colorBorderSubtle,
      ),
    );
  }
}

/// Long-press actions.
///
/// Every entry here calls a controller method that already existed and was, until now,
/// unreachable from the UI. Nothing new was invented: favourite is the per-user pin (§42),
/// and mute and archive are the preferences the backend contract already carries.
///
/// There is deliberately no "new chat", no "add member", and no "call" here. A parent or
/// teacher cannot create a conversation or change a group's membership — that is the
/// backend's (§24) — and offering the action would be a lie the user only discovers by
/// tapping it.
Future<void> _showActions(
  BuildContext context,
  WidgetRef ref,
  Conversation conversation,
) async {
  final l10n = L10n.of(context);
  final controller = ref.read(conversationsControllerProvider.notifier);
  final messenger = ScaffoldMessenger.of(context);

  await showModalBottomSheet<void>(
    context: context,
    // Presented on the root navigator, not the shell's. The shell's navigator lives inside
    // the Scaffold body, so a sheet from there is clipped to the body and the tab bar draws
    // over its last row — which is exactly what happened to "Archive".
    useRootNavigator: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing5,
              vertical: Spacing.spacing4,
            ),
            child: Semantics(
              header: true,
              child: ContentText(
                conversation.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(sheetContext).textTheme.titleSmall,
              ),
            ),
          ),
          const Divider(height: 1),
          ListTile(
            leading: Icon(
              conversation.isPinned ? Icons.star : Icons.star_outline,
            ),
            title: Text(
              conversation.isPinned
                  ? l10n.unfavoriteAction
                  : l10n.favoriteAction,
            ),
            onTap: () {
              Navigator.of(sheetContext).pop();
              _run(
                messenger,
                l10n,
                () => controller.setPinned(
                  conversation.id,
                  !conversation.isPinned,
                ),
              );
            },
          ),
          ListTile(
            leading: Icon(
              conversation.isMuted
                  ? Icons.notifications_active_outlined
                  : Icons.notifications_off_outlined,
            ),
            title: Text(
              conversation.isMuted ? l10n.unmuteAction : l10n.muteAction,
            ),
            onTap: () {
              Navigator.of(sheetContext).pop();
              _run(
                messenger,
                l10n,
                () => controller.setMuted(
                  conversation.id,
                  !conversation.isMuted,
                ),
              );
            },
          ),
          ListTile(
            leading: Icon(
              conversation.isArchived
                  ? Icons.unarchive_outlined
                  : Icons.archive_outlined,
            ),
            title: Text(
              conversation.isArchived
                  ? l10n.unarchiveAction
                  : l10n.archiveAction,
            ),
            onTap: () {
              Navigator.of(sheetContext).pop();
              _run(
                messenger,
                l10n,
                () => controller.setArchived(
                  conversation.id,
                  !conversation.isArchived,
                ),
              );
            },
          ),
        ],
      ),
    ),
  );
}

/// These preferences are applied optimistically and rolled back by the controller if the
/// backend refuses. When that happens the user must be told, or the row silently snapping
/// back reads as a bug.
Future<void> _run(
  ScaffoldMessengerState messenger,
  L10n l10n,
  Future<void> Function() action,
) async {
  try {
    await action();
  } on AppError catch (error) {
    final message = ErrorPresenter.present(error, l10n);
    messenger.showSnackBar(SnackBar(content: Text(message.title)));
  }
}

/// The archived toggle.
///
/// The only header action there is, because it is the only one backed by something real.
/// `setIncludeArchived` has existed on the controller since archiving was implemented and
/// had no way to be reached; a chat list you can archive into but not out of is a hole.
class _OverflowMenu extends ConsumerWidget {
  const _OverflowMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    // Watched so the label flips as soon as the reload lands.
    ref.watch(conversationsControllerProvider);
    final controller = ref.read(conversationsControllerProvider.notifier);
    final showing = controller.includeArchived;

    return PopupMenuButton<void>(
      icon: const Icon(Icons.more_vert),
      tooltip: l10n.conversationActionsTitle,
      position: PopupMenuPosition.under,
      itemBuilder: (context) => [
        PopupMenuItem<void>(
          onTap: () => controller.setIncludeArchived(!showing),
          child: Row(
            children: [
              Icon(showing ? Icons.visibility_off_outlined : Icons.archive_outlined),
              const SizedBox(width: Spacing.spacing4),
              Text(showing ? l10n.archivedHide : l10n.archivedShow),
            ],
          ),
        ),
      ],
    );
  }
}

/// Empty states, one per reason the list can be empty.
///
/// A single "No conversations yet" for all four filters is the version of this screen that
/// makes people think the app is broken: someone on the Unread chip with everything read
/// has not lost their chats.
class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.filter,
    required this.query,
    required this.role,
  });

  final ChatFilter filter;
  final String query;
  final UserRole? role;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    if (query.trim().isNotEmpty) {
      return JawwidEmptyView(
        icon: Icons.search_off,
        title: l10n.searchEmpty,
        // States plainly what search does cover, rather than leaving the user to
        // conclude the conversation is gone.
        body: l10n.searchEmptyBody,
      );
    }

    return switch (filter) {
      ChatFilter.unread => JawwidEmptyView(
          icon: Icons.mark_email_read_outlined,
          title: l10n.filterEmptyUnread,
          body: l10n.filterEmptyUnreadBody,
        ),
      ChatFilter.groups => JawwidEmptyView(
          icon: Icons.groups_outlined,
          title: l10n.filterEmptyGroups,
          body: role == UserRole.teacher
              ? l10n.conversationsEmptyBodyTeacher
              : l10n.conversationsEmptyBodyParent,
        ),
      ChatFilter.favorites => JawwidEmptyView(
          icon: Icons.star_outline,
          title: l10n.filterEmptyFavorites,
          body: l10n.filterEmptyFavoritesBody,
        ),
      ChatFilter.all => JawwidEmptyView(
          title: l10n.conversationsEmptyTitle,
          body: role == UserRole.teacher
              ? l10n.conversationsEmptyBodyTeacher
              : l10n.conversationsEmptyBodyParent,
        ),
    };
  }
}

class _ErrorState extends ConsumerWidget {
  const _ErrorState({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final message = ErrorPresenter.present(asAppError(error), l10n);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.sizeOf(context).height * 0.15),
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
