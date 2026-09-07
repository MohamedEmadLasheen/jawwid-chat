import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';

/// A single message bubble.
///
/// The status line is the part that carries product meaning: §16 forbids showing
/// "Delivered" unless the backend said so, and §15/§26 require a pending-approval message to
/// read as *not yet visible to anyone else*. Both live in [_StatusLine] rather than being
/// spread across the widget.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.showAuthor,
    this.onRetry,
    this.onDiscard,
    this.onReply,
    this.onLongPress,
    this.onDoubleTap,
    this.onToggleReaction,
  });

  final Message message;

  /// Group conversations show the sender above the first bubble in a run.
  final bool showAuthor;

  final VoidCallback? onRetry;
  final VoidCallback? onDiscard;
  final VoidCallback? onReply;

  /// Opens the actions sheet. The familiar gesture on both platforms.
  final VoidCallback? onLongPress;

  /// The WhatsApp shortcut for the default reaction.
  final VoidCallback? onDoubleTap;

  /// Tapping a reaction chip toggles the viewer's own reaction.
  final void Function(String emoji)? onToggleReaction;

  @override
  Widget build(BuildContext context) {
    if (message.isSystem) return _SystemMessage(message: message);

    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final mine = message.isMine;
    final failed = message.deliveryState == DeliveryState.failed;

    // A message awaiting approval is muted, never the outgoing colour (§2.6): its sender must
    // not read it as published.
    final background = message.approvalState == ApprovalState.pending
        ? tokens.colorMessagePendingBg
        : mine
            ? tokens.colorMessageOutgoingBg
            : tokens.colorMessageIncomingBg;

    final foreground =
        mine ? tokens.colorMessageOutgoingText : tokens.colorMessageIncomingText;

    // A withheld message is visually de-emphasised so its sender can see at a glance that
    // it has not reached anyone yet.
    final withheld = message.approvalState.isWithheld;

    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: GestureDetector(
        onLongPress: onLongPress,
        onDoubleTap: onDoubleTap,
        child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth:
              MediaQuery.sizeOf(context).width * Sizes.maxBubbleWidthFraction,
        ),
        child: Opacity(
          opacity: withheld ? 0.72 : 1,
          child: Container(
            margin: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing4,
              vertical: Spacing.spacing1,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing4,
              vertical: Spacing.spacing3,
            ),
            decoration: BoxDecoration(
              color: background,
              borderRadius: _bubbleRadius(mine),
              // A permanently failed bubble stays in place with a red border and an inline
              // retry — never dropped, never retried forever (handoff §8).
              border: failed
                  ? Border.all(color: tokens.colorMessageFailedBorder)
                  : Border.all(
                      color: withheld
                          ? tokens.colorBorderStrong
                          : tokens.colorBorderSubtle,
                    ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (showAuthor && !mine)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Spacing.spacing1),
                    child: Text(
                      message.authorName,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                if (message.isForwarded && !message.isDeleted)
                  _ForwardedMarker(isMine: mine),
                if (message.replyTo != null) _QuotedMessage(reply: message.replyTo!),
                if (message.isDeleted)
                  Text(
                    l10n.messageDeleted,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontStyle: FontStyle.italic,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else ...[
                  // Attachments come BEFORE the body: a caption reads as a
                  // caption, and a photo with two words under it should not put
                  // the words first.
                  if (message.attachments.isNotEmpty)
                    for (final attachment in message.attachments)
                      _AttachmentView(attachment: attachment),
                  // Message bodies resolve their own base direction per paragraph, so a
                  // mixed Arabic/English message reads correctly either way (§4).
                  if (message.body.isNotEmpty)
                    Text(
                      message.body,
                      textDirection: null,
                      style: theme.textTheme.bodyLarge?.copyWith(color: foreground),
                    ),
                ],
                if (message.reactions.isNotEmpty && !message.isDeleted)
                  _ReactionRow(
                    reactions: message.reactions,
                    onToggle: onToggleReaction,
                  ),
                const SizedBox(height: Spacing.spacing1),
                _StatusLine(message: message, onRetry: onRetry, onDiscard: onDiscard),
              ],
            ),
          ),
          ),
        ),
      ),
    );
  }
}

/// "Forwarded" — the same small, unemphatic marker WhatsApp uses.
///
/// It says only that the message came from somewhere else. It does not name
/// where: the source conversation is usually one this reader has no access to,
/// which is why the backend serves a boolean and not a reference.
class _ForwardedMarker extends StatelessWidget {
  const _ForwardedMarker({required this.isMine});

  final bool isMine;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final colour = theme.colorScheme.onSurfaceVariant;

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing1),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Points away from the reader in both directions, so it mirrors.
          Icon(Icons.shortcut, size: 13, color: colour),
          const SizedBox(width: Spacing.spacing2),
          Text(
            l10n.messageForwarded,
            style: theme.textTheme.labelSmall
                ?.copyWith(color: colour, fontStyle: FontStyle.italic),
          ),
        ],
      ),
    );
  }
}

/// The reaction chips under a bubble.
///
/// Each chip shows the emoji and, once more than one person has used it, a
/// count. The viewer's own is outlined, and tapping it removes it — one
/// reaction per person, which is what the server's unique index enforces and
/// what makes "tap to toggle" unambiguous.
class _ReactionRow extends StatelessWidget {
  const _ReactionRow({required this.reactions, this.onToggle});

  final List<Reaction> reactions;
  final void Function(String emoji)? onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(top: Spacing.spacing2),
      child: Wrap(
        spacing: Spacing.spacing2,
        runSpacing: Spacing.spacing1,
        children: [
          for (final reaction in reactions)
            InkWell(
              onTap: onToggle == null ? null : () => onToggle!(reaction.emoji),
              borderRadius: const BorderRadius.all(Radii.radiusFull),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: Spacing.spacing3,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface.withValues(alpha: 0.7),
                  borderRadius: const BorderRadius.all(Radii.radiusFull),
                  border: Border.all(
                    color: reaction.mine
                        ? theme.colorScheme.primary
                        : theme.colorScheme.outlineVariant,
                  ),
                ),
                child: Text(
                  reaction.count > 1
                      ? '${reaction.emoji} ${reaction.count}'
                      : reaction.emoji,
                  style: theme.textTheme.labelSmall,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// `radius.lg` on three corners, `radius.bubbleTail` on the one nearest the author.
///
/// Directional, so the tail follows the bubble when the layout mirrors: own messages sit on
/// the reading-start-opposite edge — left in Arabic, right in English (cross-platform §4).
BorderRadiusDirectional _bubbleRadius(bool mine) {
  return BorderRadiusDirectional.only(
    topStart: Radii.radiusLg,
    topEnd: Radii.radiusLg,
    bottomStart: mine ? Radii.radiusLg : Radii.radiusBubbleTail,
    bottomEnd: mine ? Radii.radiusBubbleTail : Radii.radiusLg,
  );
}

/// Timestamp plus the message's honest state.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.message, this.onRetry, this.onDiscard});

  final Message message;
  final VoidCallback? onRetry;
  final VoidCallback? onDiscard;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final muted = theme.textTheme.labelSmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    // Approval outranks delivery: a message the server accepted but has not published is
    // "pending approval", never "sent" (§15, §26).
    if (message.approvalState == ApprovalState.pending) {
      return _Status(
        icon: Icons.schedule,
        label: l10n.messageStatePendingApproval,
        style: muted,
      );
    }

    if (message.approvalState == ApprovalState.rejected) {
      final reason = message.rejectionReason;
      return _Status(
        icon: Icons.block,
        label: reason == null || reason.isEmpty
            ? l10n.messageStateRejected
            : l10n.messageRejectedReason(reason),
        style: muted?.copyWith(color: theme.colorScheme.error),
      );
    }

    if (message.deliveryState == DeliveryState.failed) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 14, color: theme.colorScheme.error),
          const SizedBox(width: Spacing.spacing2),
          Text(
            l10n.messageStateFailed,
            style: muted?.copyWith(color: theme.colorScheme.error),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: Spacing.spacing3),
            _InlineAction(label: l10n.messageRetry, onPressed: onRetry!),
          ],
          if (onDiscard != null) ...[
            const SizedBox(width: Spacing.spacing3),
            _InlineAction(label: l10n.messageDiscard, onPressed: onDiscard!),
          ],
        ],
      );
    }

    if (message.deliveryState.isInFlight) {
      return _Status(
        icon: Icons.schedule,
        label: l10n.messageStateSending,
        style: muted,
      );
    }

    // Confirmed states, straight from the backend.
    final (icon, label) = switch (message.deliveryState) {
      DeliveryState.read => (Icons.done_all, l10n.messageStateRead),
      DeliveryState.delivered => (Icons.done_all, l10n.messageStateDelivered),
      _ => (Icons.done, l10n.messageStateSent),
    };

    final stamp = RelativeTime.forBubble(message.createdAt, locale: locale);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // The timestamp stays the SEND time. An edit does not move a message in
        // the conversation and must not look as though it did; "edited" beside
        // it is how the reader is told the body changed.
        if (message.isEdited) ...[
          Text(l10n.messageEdited, style: muted?.copyWith(fontStyle: FontStyle.italic)),
          const SizedBox(width: Spacing.spacing2),
        ],
        Text(stamp, style: muted),
        if (message.isMine) ...[
          const SizedBox(width: Spacing.spacing2),
          // Icon plus an accessible label — state is never conveyed by the glyph alone
          // (§53).
          Semantics(
            label: label,
            child: Icon(
              icon,
              size: 14,
              color: message.deliveryState == DeliveryState.read
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.icon, required this.label, this.style});

  final IconData icon;
  final String label;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: style?.color),
        const SizedBox(width: Spacing.spacing2),
        Flexible(child: Text(label, style: style)),
      ],
    );
  }
}

class _InlineAction extends StatelessWidget {
  const _InlineAction({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onPressed,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
        child: Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.primary,
            fontWeight: FontWeight.w700,
            decoration: TextDecoration.underline,
          ),
        ),
      ),
    );
  }
}

class _QuotedMessage extends StatelessWidget {
  const _QuotedMessage({required this.reply});

  final ReplyPreview reply;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.spacing2),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing3,
        vertical: Spacing.spacing2,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.55),
        borderRadius: Radii.card,
        // A leading edge marker that mirrors correctly in RTL.
        border: BorderDirectional(
          start: BorderSide(color: theme.colorScheme.primary, width: 3),
        ),
      ),
      child: reply.isAvailable
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (reply.authorName.isNotEmpty)
                  Text(
                    reply.authorName,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                Text(
                  reply.excerpt,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
              ],
            )
          // The quoted message is gone, withheld, or hidden by this reader. The
          // reply still renders — dropping the quote would make it look like an
          // answer to nothing — and it carries no trace of the original text,
          // because the backend served none.
          : Text(
              reply.unavailableReason == QuoteUnavailableReason.deleted
                  ? l10n.quoteDeleted
                  : l10n.quoteUnavailable,
              style: theme.textTheme.bodySmall?.copyWith(
                fontStyle: FontStyle.italic,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
    );
  }
}

/// Operational events — teacher changed, class rescheduled, coverage active (§27). Centred
/// and visually distinct so they never read as somebody's message.
class _SystemMessage extends StatelessWidget {
  const _SystemMessage({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing7,
        vertical: Spacing.spacing3,
      ),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing4,
            vertical: Spacing.spacing3,
          ),
          decoration: BoxDecoration(
            color: tokens.colorMessageSystemBg,
            borderRadius: Radii.card,
          ),
          child: Text(
            message.body,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: tokens.colorMessageSystemText,
            ),
          ),
        ),
      ),
    );
  }
}

/// One attachment inside a bubble.
///
/// ## Access is the server's decision, every time
///
/// `attachment.url` is a SHORT-LIVED signed URL the server minted for this
/// reader on this fetch, after running the same authorization that let them
/// read the message at all. It is never cached and never persisted: a URL kept
/// past its expiry is dead, which is the point — it cannot become a way around
/// the check that produced it.
///
/// A null URL is therefore normal, not an error. It means either "this is the
/// sender's own echo and the server has not served it back yet" or "the grant
/// has expired"; both render as an unavailable attachment rather than a broken
/// image, and reopening the conversation mints a fresh one.
class _AttachmentView extends StatelessWidget {
  const _AttachmentView({required this.attachment});

  final Attachment attachment;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = L10n.of(context);
    final url = attachment.url;

    if (url == null || url.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: Spacing.spacing2),
        child: _AttachmentRow(
          icon: Icons.link_off,
          label: attachment.fileName ?? l10n.attachmentUnavailable,
          detail: l10n.attachmentUnavailable,
        ),
      );
    }

    if (attachment.kind == MessageKind.image) {
      return Padding(
        padding: const EdgeInsets.only(bottom: Spacing.spacing2),
        child: ClipRRect(
          borderRadius: Radii.card,
          child: Image.network(
            url,
            fit: BoxFit.cover,
            // Bounded, so one photo cannot push the whole conversation off
            // screen before its dimensions are known.
            height: 220,
            width: double.infinity,
            semanticLabel: attachment.fileName,
            loadingBuilder: (context, child, progress) => progress == null
                ? child
                : SizedBox(
                    height: 220,
                    child: Center(
                      child: CircularProgressIndicator(
                        value: progress.expectedTotalBytes == null
                            ? null
                            : progress.cumulativeBytesLoaded /
                                progress.expectedTotalBytes!,
                      ),
                    ),
                  ),
            // An expired grant fails here. It is a stale URL, not a broken
            // product, so it says so and the next fetch mints a new one.
            errorBuilder: (context, error, stack) => _AttachmentRow(
              icon: Icons.broken_image_outlined,
              label: attachment.fileName ?? l10n.attachmentUnavailable,
              detail: l10n.attachmentUnavailable,
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing2),
      child: _AttachmentRow(
        icon: switch (attachment.kind) {
          MessageKind.video => Icons.play_circle_outline,
          MessageKind.voice => Icons.audiotrack_outlined,
          _ => Icons.insert_drive_file_outlined,
        },
        label: attachment.fileName ?? l10n.attachmentOpen,
        detail: _size(attachment.byteSize) ?? attachment.mimeType ?? '',
        style: theme.textTheme.bodyMedium,
      ),
    );
  }

  static String? _size(int? bytes) {
    if (bytes == null || bytes <= 0) return null;
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class _AttachmentRow extends StatelessWidget {
  const _AttachmentRow({
    required this.icon,
    required this.label,
    required this.detail,
    this.style,
  });

  final IconData icon;
  final String label;
  final String detail;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 28, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: Spacing.spacing2),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: style),
              if (detail.isNotEmpty)
                Text(
                  detail,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
