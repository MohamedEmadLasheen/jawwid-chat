import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/media/media_picker.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../application/messages_controller.dart';
import '../application/voice_composer_controller.dart';
import 'attachment_preview.dart';
import 'media_viewer.dart';
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

  /// One key per message, so jumping to a reply's original can actually find
  /// the widget. Keyed by the log's own identity — client id where we have one,
  /// server id otherwise — because a message that is still sending has no
  /// server id and a message from another device has no client id of ours.
  final _messageKeys = <String, GlobalKey>{};

  ReplyPreview? _replyingTo;

  /// The message currently tinted after being jumped to, and the timer that
  /// clears it. §6 and §9 both ask for a highlight that is *temporary*: a
  /// permanent one becomes part of the message.
  String? _highlightedKey;
  Timer? _highlightTimer;

  /// True when the user has scrolled away from the newest message. While true, arrivals must
  /// not auto-scroll (cross-platform §3).
  bool _isAwayFromBottom = false;
  int _unseenWhileAway = 0;
  int _lastSeenLength = 0;

  /// The highest sequence already reported as read, so the same watermark is
  /// not sent on every rebuild.
  int? _readThrough;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  /// Report the conversation read up to the newest message on screen.
  ///
  /// Called after the frame rather than during build, because it writes to the
  /// conversations controller — and a provider written to mid-build throws.
  ///
  /// Only while the user is actually at the bottom: someone reading back
  /// through history has not read what arrived above them, and clearing the
  /// badge there would hide the very message they came back for.
  void _reportRead(MessagesState state) {
    if (_isAwayFromBottom) return;

    final newest = state.log.highestSequence;
    if (newest == null) return;
    if (_readThrough != null && newest <= _readThrough!) return;

    _readThrough = newest;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(conversationsControllerProvider.notifier).markRead(
            widget.conversationId,
            throughSequence: newest,
          );
    });
  }

  @override
  void dispose() {
    _highlightTimer?.cancel();
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

  // --- Sending a photo or a file ---------------------------------------------------------

  /// Pick, review, then send.
  ///
  /// Three steps, and the middle one is not optional (§16). The pick can be
  /// cancelled, refused, or return something too large; the review can be
  /// backed out of. Only the third step enqueues anything, and once it does the
  /// attachment takes the same outbox, idempotency key and retry as a text
  /// message.
  Future<void> _attach() async {
    final source = await showAttachmentMenu(context);
    if (source == null || !mounted) return;

    final picker = ref.read(mediaPickerProvider);

    final PendingAttachment? picked;
    try {
      picked = source == AttachmentSource.photo
          ? await picker.pickImage()
          : await picker.pickFile();
    } on MediaPickException catch (failure) {
      if (mounted) _sayPickFailed(failure.reason);
      return;
    }

    // Null means the user backed out of the picker. Nothing went wrong, so
    // nothing is said.
    if (picked == null || !mounted) return;

    final draft = await showAttachmentPreview(context, attachment: picked);
    if (draft == null || !mounted) return;

    ref.read(messagesControllerProvider(widget.conversationId).notifier)
        .sendAttachment(
          draft.attachment,
          body: draft.caption,
          replyTo: _replyingTo,
        );

    setState(() => _replyingTo = null);
    if (_isAwayFromBottom) _jumpToNewest();
  }

  /// Say what went wrong in the user's terms — never the platform's (§31).
  void _sayPickFailed(MediaPickFailure reason) {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final text = switch (reason) {
      MediaPickFailure.permissionDenied => l10n.attachmentPermissionDenied,
      MediaPickFailure.tooLarge => l10n.attachmentTooLarge,
      MediaPickFailure.typeNotAllowed => l10n.attachmentTypeNotAllowed,
      MediaPickFailure.unsupported => l10n.attachmentUnsupported,
      MediaPickFailure.failed => l10n.attachmentPickFailed,
    };

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(content: Text(text), behavior: SnackBarBehavior.floating),
    );
  }

  // --- Acting on a message ---------------------------------------------------------------

  /// Long press. The sheet decides what was asked for; this decides what to do.
  Future<void> _onLongPress(Message message) async {
    final controller =
        ref.read(messagesControllerProvider(widget.conversationId).notifier);

    final result = await showMessageActions(context, message: message);
    if (result == null || !mounted) return;

    final reaction = result.reaction;
    if (reaction != null) {
      await _guard(() => controller.toggleReaction(message, reaction.emoji));
      return;
    }

    switch (result.action!) {
      case MessageAction.reply:
        setState(() => _replyingTo = _previewOf(message));
      case MessageAction.copy:
        await _copy(message);
      case MessageAction.open:
        _openFirstAttachment(message);
      case MessageAction.deleteForMe:
        await _guard(() => controller.deleteForMe(message));
      case MessageAction.deleteForEveryone:
        await _guard(() => controller.deleteForEveryone(message));
    }
  }

  /// Copy to the clipboard, and say so without a dialog (§11).
  Future<void> _copy(Message message) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    await Clipboard.setData(ClipboardData(text: message.body));
    if (!mounted) return;

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(l10n.copiedConfirmation),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Run a controller action that may be refused, and say so if it is.
  ///
  /// Every one of these applies optimistically and rolls back on failure, so a
  /// bubble silently reappearing would read as a bug. The message is the
  /// localised one — never the code, never the status (§31).
  Future<void> _guard(Future<void> Function() action) async {
    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);

    try {
      await action();
    } on AppError catch (error) {
      if (!mounted) return;
      final message = ErrorPresenter.present(error, l10n);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(
          content: Text(message.body ?? message.title),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// The quote to show in the composer when replying to [message].
  ///
  /// A message with no body — a photo, a voice note — still needs a line here,
  /// or the reply banner is a blank box with a name on it.
  ReplyPreview _previewOf(Message message) {
    final l10n = L10n.of(context);
    final body = message.body.trim();

    return ReplyPreview(
      messageId: message.id ?? message.clientMessageId,
      authorName: message.authorName,
      excerpt: body.isNotEmpty
          ? body
          : switch (message.attachments.firstOrNull?.kind ?? message.kind) {
              MessageKind.image => l10n.attachmentPhotoLabel,
              MessageKind.voice => l10n.attachmentVoiceLabel,
              MessageKind.file || MessageKind.video => l10n.attachmentFileLabel,
              _ => '',
            },
    );
  }

  /// Resolve the quote above a bubble.
  ///
  /// A message we just composed carries its own preview. One that came back
  /// from the server carries only an id, so the original is looked up in the
  /// log — and when it has not been paged in yet, a neutral placeholder stands
  /// in rather than a blank or, worse, the id.
  ReplyPreview? _resolveReply(Message message, MessagesState state) {
    if (message.replyTo != null) return message.replyTo;

    final targetId = message.replyToMessageId;
    if (targetId == null) return null;

    final l10n = L10n.of(context);
    final original = state.log.byServerId(targetId);
    if (original == null) {
      return ReplyPreview(
        messageId: targetId,
        authorName: l10n.replyOriginalUnavailable,
        excerpt: '',
      );
    }
    return _previewOf(original);
  }

  /// Scroll to a message and tint it briefly.
  ///
  /// Only works for a message already built into the list. Paging backwards
  /// until an arbitrarily old original is found would mean an unbounded number
  /// of requests on a mobile connection for a gesture the user can repeat, so
  /// an original that is not loaded simply does not move the viewport — nothing
  /// jumps, nothing lies.
  void _jumpToMessage(String messageId, MessagesState state) {
    final target = state.log.byServerId(messageId);
    if (target == null) return;

    final key = _messageKeys[_keyOf(target)];
    final targetContext = key?.currentContext;
    if (targetContext == null) return;

    _highlightTimer?.cancel();
    setState(() => _highlightedKey = _keyOf(target));

    Scrollable.ensureVisible(
      targetContext,
      duration: Motion.respecting(context, Motion.motionSlow),
      curve: Motion.easingStandard,
      alignment: 0.3,
    );

    _highlightTimer = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _highlightedKey = null);
    });
  }

  /// A photo opens here; a document is handed to the phone.
  ///
  /// The split is deliberate. A photo belongs in the conversation's own viewer,
  /// where the parent can swipe between the pictures of that message and come
  /// straight back (§18). A document belongs to whatever already opens
  /// documents on their phone — this app has no viewer and should not grow one.
  Future<void> _openAttachment(Message message, Attachment attachment) async {
    if (attachment.kind == MessageKind.image) {
      final photos = message.attachments
          .where((a) => a.kind == MessageKind.image)
          .toList(growable: false);

      await showMediaViewer(
        context,
        photos: photos,
        initialIndex: photos.indexOf(attachment),
        takenAt: message.createdAt,
      );
      return;
    }

    final l10n = L10n.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final url = attachment.url;

    final opened = url == null
        ? false
        : await ref.read(attachmentOpenerProvider).open(url);

    if (opened || !mounted) return;

    // Nothing on the device could open it, or the signed URL has expired. Both
    // read the same to the parent, and neither is their problem to diagnose.
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(l10n.attachmentPickFailed),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _openFirstAttachment(Message message) {
    final first = message.attachments.firstWhereOrNull(
      (a) => a.kind == MessageKind.image || a.kind == MessageKind.file,
    );
    if (first != null) _openAttachment(message, first);
  }

  /// The log's identity for a message — the same rule [MessageLog] uses.
  static String _keyOf(Message message) => message.clientMessageId.isNotEmpty
      ? message.clientMessageId
      : (message.id ?? '');

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

    final voice = ref.watch(voiceComposerProvider(widget.conversationId));
    final voiceController =
        ref.read(voiceComposerProvider(widget.conversationId).notifier);

    // Count arrivals while the user is reading history, so the pill can say there is
    // something new without ever moving the viewport under them.
    final length = state.log.length;
    if (_isAwayFromBottom && length > _lastSeenLength) {
      _unseenWhileAway += length - _lastSeenLength;
    }
    _lastSeenLength = length;

    _reportRead(state);

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
            onAttach: widget.isReadOnly ? null : _attach,
            onSend: (body) {
              controller.send(body, replyTo: _replyingTo);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
            replyingTo: _replyingTo,
            onCancelReply: () => setState(() => _replyingTo = null),
            conversationId: widget.conversationId,
            voice: voice,
            onStartRecording: voiceController.start,
            onStopRecording: voiceController.stop,
            onCancelRecording: voiceController.cancel,
            onDismissVoiceFailure: voiceController.acknowledgeFailure,
            onSendRecording: () {
              // takeDraft() clears the draft as it hands it over, so a second
              // press cannot enqueue the same recording twice.
              final draft = voiceController.takeDraft();
              if (draft == null) return;
              controller.sendVoice(draft, replyTo: _replyingTo);
              setState(() => _replyingTo = null);
              if (_isAwayFromBottom) _jumpToNewest();
            },
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

            final key = _keyOf(message);
            final reply = _resolveReply(message, state);

            return Column(
              children: [
                if (showDaySeparator) _DaySeparator(when: message.createdAt),
                MessageBubble(
                  key: _messageKeys.putIfAbsent(key, GlobalKey.new),
                  message: message,
                  showAuthor: showAuthor,
                  replyTo: reply,
                  isHighlighted: _highlightedKey == key,
                  onRetry: message.canRetry
                      ? () => controller.retry(message.clientMessageId)
                      : null,
                  onDiscard: message.canRetry
                      ? () => controller.discard(message.clientMessageId)
                      : null,
                  // Absent rather than inert on a message nothing can be done
                  // to, so a long press there is a no-op the user feels once
                  // instead of an empty sheet they have to dismiss.
                  onLongPress:
                      canActOn(message) ? () => _onLongPress(message) : null,
                  onTapReply: reply == null
                      ? null
                      : () => _jumpToMessage(reply.messageId, state),
                  onToggleReaction: message.id == null
                      ? null
                      : (emoji) =>
                          _guard(() => controller.toggleReaction(message, emoji)),
                  onOpenAttachment: (attachment) =>
                      _openAttachment(message, attachment),
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
