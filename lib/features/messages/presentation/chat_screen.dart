import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/realtime/realtime_events.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';
import '../application/messages_controller.dart';
import 'forward_sheet.dart';
import 'message_actions.dart';
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
    this.unreadCount = 0,
    this.onOpenMembers,
  });

  final String conversationId;
  final String title;

  /// e.g. the owner line on the Jawwid thread. Never an internal handler id.
  final String? subtitle;

  final ConversationKind kind;
  final bool requiresApproval;
  final bool isReadOnly;

  /// Unread as of opening, for the divider. Fixed at open: recomputing it as
  /// the user reads would walk it to the bottom, where it marks nothing.
  final int unreadCount;

  final VoidCallback? onOpenMembers;

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

  MessagesController get _controller =>
      ref.read(messagesControllerProvider(widget.conversationId).notifier);

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);

    // Two things happen on open, both after the first frame so neither blocks
    // it: the controller learns how many were unread (so it can place the
    // divider), and — because opening a conversation IS reading it — the read
    // cursor is advanced.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _controller.adoptUnreadCount(widget.unreadCount);
      unawaited(_controller.markReadThroughLatest());
    });
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
      // Coming back to the bottom means the user has now seen everything.
      if (!away) unawaited(_controller.markReadThroughLatest());
    }

    // Approaching the far end means the user is reaching back in time.
    final position = _scrollController.position;
    if (position.pixels > position.maxScrollExtent - 400) {
      _controller.loadOlder();
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
    unawaited(_controller.markReadThroughLatest());
  }

  // -----------------------------------------------------------------------
  // Message actions
  // -----------------------------------------------------------------------

  /// The long-press menu.
  ///
  /// Every branch that changes something on the server is wrapped: the server
  /// is authoritative, so an action this menu offered can still be refused, and
  /// the refusal must read as a message rather than as a crash.
  Future<void> _openActions(Message message) async {
    final capabilities = MessageCapabilities.of(
      message,
      isReadOnly: widget.isReadOnly,
    );
    if (!capabilities.hasAny) return;

    final action = await showMessageActions(
      context,
      message: message,
      capabilities: capabilities,
      onReact: (emoji) => _guard(() => _controller.toggleReaction(message.id!, emoji)),
    );
    if (!mounted || action == null) return;

    switch (action) {
      case MessageAction.reply:
        setState(() {
          _replyingTo = ReplyPreview(
            messageId: message.id ?? message.clientMessageId,
            authorName: message.authorName,
            excerpt: message.body,
          );
        });

      case MessageAction.forward:
        final targets = await showForwardSheet(
          context,
          excludeConversationId: widget.conversationId,
        );
        if (!mounted || targets == null || targets.isEmpty) return;
        await _guard(() => _controller.forward(message.id!, targets));
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(L10n.of(context).forwardSent)));

      case MessageAction.edit:
        final body = await showEditMessage(context, message);
        if (!mounted || body == null) return;
        await _guard(() => _controller.edit(message.id!, body));

      case MessageAction.copy:
        await copyMessage(context, message);

      case MessageAction.deleteForMe:
        await _guard(() => _controller.deleteForMe(message.id!));

      case MessageAction.deleteForEveryone:
        // Confirmed, unlike the per-user delete: this one changes what other
        // people see and cannot be undone.
        if (!await confirmDeleteForEveryone(context)) return;
        await _guard(() => _controller.deleteForEveryone(message.id!));
    }
  }

  /// Run a server-changing action, surfacing a refusal as friendly copy.
  Future<void> _guard(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      if (!mounted) return;
      final l10n = L10n.of(context);
      final message = ErrorPresenter.present(asAppErrorOf(error), l10n);
      // The body is optional; the title always says something useful, so it is
      // the fallback rather than an empty snackbar.
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message.body ?? message.title)));
    }
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
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
            // Typing replaces the subtitle rather than adding a line, so the
            // header never changes height and the title never jumps.
            if (state.typingNames.isNotEmpty)
              Text(
                state.typingNames.length == 1
                    ? l10n.typingOne(state.typingNames.first)
                    : l10n.typingMany(state.typingNames.length),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: Theme.of(context).colorScheme.primary),
              )
            else if (widget.subtitle != null)
              Text(
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
        actions: [
          IconButton(
            onPressed: () =>
                context.push(Routes.conversationSearch(widget.conversationId)),
            icon: const Icon(Icons.search),
            tooltip: l10n.searchMessagesHint,
          ),
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
            )
          // A dropped socket is not the same as being offline: messages still
          // send, they simply do not arrive by themselves until it is back.
          else if (state.realtime == RealtimeStatus.reconnecting)
            JawwidBanner(
              message: l10n.reconnecting,
              tone: JawwidBannerTone.neutral,
            ),
          Expanded(child: _body(state, controller, l10n)),
          MessageComposer(
            onSend: (body) {
              controller.send(body, replyTo: _replyingTo);
              // Sending IS stopping typing; leaving the indicator up until the
              // debounce expires would show the recipient a phantom.
              controller.stopTyping();
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            onTyping: controller.onComposerChanged,
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
            final canAct = message.id != null && !message.deliveryState.isLocal;

            return Column(
              children: [
                if (showDaySeparator) _DaySeparator(when: message.createdAt),
                // Fixed at open, so it stays where the user left off rather
                // than following them down the conversation.
                if (state.unread.marks(message))
                  _UnreadDivider(count: state.unread.count),
                MessageBubble(
                  message: message,
                  showAuthor: showAuthor,
                  onRetry: message.canRetry
                      ? () => controller.retry(message.clientMessageId)
                      : null,
                  onDiscard: message.canRetry
                      ? () => controller.discard(message.clientMessageId)
                      : null,
                  onLongPress: canAct ? () => _openActions(message) : null,
                  // Double-tap for the default reaction, the way WhatsApp does.
                  onDoubleTap: canAct && !widget.isReadOnly && !message.isDeleted
                      ? () => _guard(
                            () => controller.toggleReaction(
                              message.id!,
                              kReactionEmoji.first,
                            ),
                          )
                      : null,
                  onToggleReaction: canAct && !widget.isReadOnly
                      ? (emoji) => _guard(
                            () => controller.toggleReaction(message.id!, emoji),
                          )
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

/// "Unread messages" — where the user left off.
///
/// Distinct from the day separator on purpose: it is the ONE line in the
/// conversation that is about this reader rather than about the messages, so it
/// carries the accent colour and a rule across the width.
class _UnreadDivider extends StatelessWidget {
  const _UnreadDivider({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing4,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        children: [
          Expanded(child: Divider(color: theme.colorScheme.primary, height: 1)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing3),
            child: Text(
              l10n.unreadDivider,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(child: Divider(color: theme.colorScheme.primary, height: 1)),
        ],
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
