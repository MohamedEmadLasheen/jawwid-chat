import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/messages_controller.dart';
import 'message_bubble.dart';
import 'message_composer.dart';

/// One conversation.
///
/// The list is **reversed**, which is what makes the two hard requirements cheap: new
/// messages append at offset zero without disturbing anything the user is reading, and
/// loading older pages extends the far end so scroll position is preserved for free (§19).
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({
    super.key,
    required this.conversationId,
    required this.title,
    this.subtitle,
    this.kind = ConversationKind.jawwidSupport,
    this.requiresApproval = false,
    this.isReadOnly = false,
    this.onOpenMembers,
    this.onOpenProfile,
  });

  final String conversationId;
  final String title;

  /// e.g. the owner line on the Jawwid thread. Never an internal handler id.
  final String? subtitle;

  final ConversationKind kind;
  final bool requiresApproval;
  final bool isReadOnly;
  final VoidCallback? onOpenMembers;

  /// Tapping the header — avatar or name — opens the profile, or group info for a
  /// student group. The same gesture people already use in every other chat app.
  final VoidCallback? onOpenProfile;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _scrollController = ScrollController();

  ReplyPreview? _replyingTo;

  /// True when the user has scrolled away from the newest message. While true, arrivals must
  /// not auto-scroll (cross-platform §3).
  bool _isAwayFromBottom = false;
  int _unseenWhileAway = 0;
  int _lastSeenLength = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;

    // In a reversed list, offset 0 is the newest message.
    final away = _scrollController.offset > 120;
    if (away != _isAwayFromBottom) {
      setState(() {
        _isAwayFromBottom = away;
        if (!away) _unseenWhileAway = 0;
      });
    }

    // Approaching the far end means the user is reaching back in time.
    final position = _scrollController.position;
    if (position.pixels > position.maxScrollExtent - 400) {
      ref
          .read(messagesControllerProvider(widget.conversationId).notifier)
          .loadOlder();
    }
  }

  void _jumpToNewest() {
    setState(() {
      _unseenWhileAway = 0;
      _isAwayFromBottom = false;
    });
    _scrollController.animateTo(
      0,
      duration: Motion.respecting(context, Motion.motionBase),
      curve: Motion.easingStandard,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final controller =
        ref.read(messagesControllerProvider(widget.conversationId).notifier);
    final state = ref.watch(messagesControllerProvider(widget.conversationId));

    // Count arrivals while the user is reading history, so the pill can say there is
    // something new without ever moving the viewport under them.
    final length = state.log.length;
    if (_isAwayFromBottom && length > _lastSeenLength) {
      _unseenWhileAway += length - _lastSeenLength;
    }
    _lastSeenLength = length;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: widget.onOpenProfile,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing3,
              vertical: Spacing.spacing2,
            ),
            child: Row(
              children: [
                JawwidAvatar(
                  displayName: widget.title,
                  size: Sizes.avatarSm,
                ),
                const SizedBox(width: Spacing.spacing3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ContentText(
                        widget.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      if (widget.subtitle != null)
                        ContentText(
                          widget.subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: tokens.colorTextSecondary),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          if (widget.onOpenMembers != null)
            IconButton(
              onPressed: widget.onOpenMembers,
              icon: const Icon(Icons.group_outlined),
              tooltip: l10n.groupMembersTitle,
            ),
        ],
      ),
      // The list resizes; the composer does not translate (handoff §5.8).
      resizeToAvoidBottomInset: true,
      body: Column(
        children: [
          if (state.isOffline)
            JawwidBanner(
              message: l10n.messageQueuedOffline,
              tone: JawwidBannerTone.warning,
            ),
          Expanded(child: _body(state, controller, l10n)),
          MessageComposer(
            onSend: (body) {
              controller.send(body, replyTo: _replyingTo);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            replyingTo: _replyingTo,
            onCancelReply: () => setState(() => _replyingTo = null),
            isReadOnly: widget.isReadOnly,
            requiresApproval: widget.requiresApproval,
          ),
        ],
      ),
    );
  }

  Widget _body(
    MessagesState state,
    MessagesController controller,
    L10n l10n,
  ) {
    if (state.isLoadingInitial) {
      return JawwidLoadingView(label: l10n.tabChats);
    }

    final failure = state.initialError;
    if (failure != null) {
      final message = ErrorPresenter.present(failure, l10n);
      return JawwidErrorView(
        title: message.title,
        body: message.body,
        retryLabel: message.canRetry ? l10n.retryAction : null,
        onRetry: message.canRetry ? controller.loadInitial : null,
      );
    }

    if (state.isEmpty) {
      return JawwidEmptyView(
        title: l10n.messagesEmptyTitle,
        body: l10n.messagesEmptyBody,
        icon: Icons.chat_bubble_outline,
      );
    }

    // Newest first, because the list is reversed.
    final ordered = state.log.messages.reversed.toList(growable: false);

    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          reverse: true,
          padding: const EdgeInsets.symmetric(vertical: Spacing.spacing3),
          // Virtualised: only what is on screen is built (handoff §9).
          itemCount: ordered.length + (state.isLoadingOlder ? 1 : 0),
          itemBuilder: (context, index) {
            if (index >= ordered.length) {
              return const Padding(
                padding: EdgeInsets.all(Spacing.spacing5),
                child: Center(
                  child: SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              );
            }

            final message = ordered[index];
            // The *next* index is the older message, because the list is reversed.
            final older = index + 1 < ordered.length ? ordered[index + 1] : null;

            final showAuthor = !message.isMine &&
                (older == null || older.authorId != message.authorId);
            final showDaySeparator = older == null ||
                !_sameDay(older.createdAt, message.createdAt);

            return Column(
              children: [
                if (showDaySeparator) _DaySeparator(when: message.createdAt),
                MessageBubble(
                  message: message,
                  showAuthor: showAuthor,
                  onRetry: message.canRetry
                      ? () => controller.retry(message.clientMessageId)
                      : null,
                  onDiscard: message.canRetry
                      ? () => controller.discard(message.clientMessageId)
                      : null,
                  onReply: () => setState(() {
                    _replyingTo = ReplyPreview(
                      messageId: message.id ?? message.clientMessageId,
                      authorName: message.authorName,
                      excerpt: message.body,
                    );
                  }),
                ),
              ],
            );
          },
        ),
        if (_isAwayFromBottom && _unseenWhileAway > 0)
          PositionedDirectional(
            bottom: Spacing.spacing5,
            start: 0,
            end: 0,
            child: Center(
              child: _NewMessagesPill(
                count: _unseenWhileAway,
                onTap: _jumpToNewest,
              ),
            ),
          ),
      ],
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

/// "New messages ↓" — the user is never scrolled without asking.
class _NewMessagesPill extends StatelessWidget {
  const _NewMessagesPill({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Material(
      color: tokens.colorBrandPrimary,
      borderRadius: const BorderRadius.all(Radii.radiusFull),
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing5,
            vertical: Spacing.spacing3,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // The arrow points to the newest message, which is downward in both
              // directions — this is not a mirroring glyph.
              Icon(Icons.arrow_downward, size: 16, color: tokens.colorBrandOnPrimary),
              const SizedBox(width: Spacing.spacing3),
              Text(
                l10n.unreadCount(count),
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: tokens.colorBrandOnPrimary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.when});

  final DateTime when;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Spacing.spacing4),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing4,
            vertical: Spacing.spacing1,
          ),
          decoration: BoxDecoration(
            color: tokens.colorMessageSystemBg,
            borderRadius: const BorderRadius.all(Radii.radiusFull),
          ),
          child: Text(
            RelativeTime.forDaySeparator(
              when,
              DateTime.now(),
              locale: locale,
              todayLabel: l10n.todayLabel,
              yesterdayLabel: l10n.yesterdayLabel,
            ),
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: tokens.colorMessageSystemText),
          ),
        ),
      ),
    );
  }
}
