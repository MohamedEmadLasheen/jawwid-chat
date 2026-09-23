import 'dart:io';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/byte_size_format.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import 'voice_message_player.dart';

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
    this.replyTo,
    this.onRetry,
    this.onDiscard,
    this.onLongPress,
    this.onTapReply,
    this.onToggleReaction,
    this.onOpenAttachment,
    this.isHighlighted = false,
  });

  final Message message;

  /// Group conversations show the sender above the first bubble in a run.
  final bool showAuthor;

  /// The quote to render above this bubble, already resolved.
  ///
  /// Resolved by the screen rather than read off the message, because a message
  /// from the server carries only `replyToMessageId` — the preview is assembled
  /// from the log the screen already holds.
  final ReplyPreview? replyTo;

  final VoidCallback? onRetry;
  final VoidCallback? onDiscard;

  /// Opens the actions sheet. Null on a message nothing can be done to.
  final VoidCallback? onLongPress;

  /// Jump to the message this one answers.
  final VoidCallback? onTapReply;

  /// Add, replace or remove the viewer's reaction by tapping a chip.
  final void Function(String emoji)? onToggleReaction;

  /// Open a photo full-screen, or a document.
  final void Function(Attachment attachment)? onOpenAttachment;

  /// Briefly tinted after being jumped to, so the eye lands on the right bubble
  /// (§6, §9). Temporary — the screen clears it.
  final bool isHighlighted;

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

    // A voice message carries exactly one audio attachment. Reading it here
    // rather than switching on `message.kind` means a malformed voice message
    // with no attachment falls back to its body instead of rendering an empty
    // player.
    final voiceAttachment = message.attachments
        .where((a) => a.kind == MessageKind.voice)
        .firstOrNull;

    final photos = message.attachments
        .where((a) => a.kind == MessageKind.image)
        .toList(growable: false);
    final documents = message.attachments
        .where((a) => a.kind == MessageKind.file || a.kind == MessageKind.video)
        .toList(growable: false);

    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth:
              MediaQuery.sizeOf(context).width * Sizes.maxBubbleWidthFraction,
        ),
        child: Opacity(
          opacity: withheld ? 0.72 : 1,
          child: Column(
            crossAxisAlignment:
                mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              // The long press lives on the bubble, not on the reaction chips
              // below it: pressing a chip is how you change your reaction, and
              // a long press that opened the sheet from there would make the
              // quicker gesture unreachable.
              GestureDetector(
                onLongPress: onLongPress,
                // Feedback matters here — without it a long press that opens
                // nothing (a system message, a failed send) is indistinguishable
                // from one the app missed.
                behavior: HitTestBehavior.opaque,
                child: _decorated(context, background, failed, withheld, mine, [
                  if (showAuthor && !mine)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Spacing.spacing1),
                      child: ContentText(
                        message.authorName,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  if (replyTo != null)
                    _QuotedMessage(reply: replyTo!, onTap: onTapReply),
                  if (message.isDeleted)
                    Text(
                      l10n.messageDeleted,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontStyle: FontStyle.italic,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    )
                  else ...[
                    if (voiceAttachment != null)
                      VoiceMessagePlayer(
                        conversationId: message.conversationId,
                        attachment: voiceAttachment,
                        foreground: foreground,
                      ),
                    for (final photo in photos)
                      _PhotoAttachment(
                        attachment: photo,
                        isSending: message.isPending,
                        hasFailed: failed,
                        onTap: onOpenAttachment == null
                            ? null
                            : () => onOpenAttachment!(photo),
                      ),
                    for (final document in documents)
                      _FileAttachment(
                        attachment: document,
                        foreground: foreground,
                        isSending: message.isPending,
                        onTap: onOpenAttachment == null
                            ? null
                            : () => onOpenAttachment!(document),
                      ),
                    // Message bodies resolve their own base direction, so a
                    // mixed Arabic/English message reads correctly either way
                    // (§4).
                    if (message.body.isNotEmpty)
                      Padding(
                        padding: EdgeInsets.only(
                          top: message.attachments.isEmpty
                              ? 0
                              : Spacing.spacing2,
                        ),
                        child: ContentText(
                          message.body,
                          style:
                              theme.textTheme.bodyLarge?.copyWith(color: foreground),
                        ),
                      ),
                  ],
                  const SizedBox(height: Spacing.spacing1),
                  _StatusLine(
                    message: message,
                    onRetry: onRetry,
                    onDiscard: onDiscard,
                  ),
                ]),
              ),
              if (message.reactions.isNotEmpty && !message.isDeleted)
                _ReactionChips(
                  reactions: message.reactions,
                  onToggle: onToggleReaction,
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// The bubble's own box. Extracted only so the child list above stays
  /// readable — nothing else builds one.
  Widget _decorated(
    BuildContext context,
    Color background,
    bool failed,
    bool withheld,
    bool mine,
    List<Widget> children,
  ) {
    final tokens = JawwidTokens.of(context);

    return AnimatedContainer(
      duration: Motion.respecting(context, Motion.motionSlow),
      curve: Motion.easingStandard,
      margin: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing4,
        vertical: Spacing.spacing1,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing4,
        vertical: Spacing.spacing3,
      ),
      decoration: BoxDecoration(
        // A bubble jumped to from a reply is tinted for a moment, then settles
        // back. The tint is the brand's own subtle fill rather than a yellow
        // highlighter: it has to read as "this one" without reading as "this
        // one is wrong".
        color: isHighlighted ? tokens.colorBrandSubtle : background,
        borderRadius: _bubbleRadius(mine),
        // A permanently failed bubble stays in place with a red border and an inline
        // retry — never dropped, never retried forever (handoff §8).
        border: failed
            ? Border.all(color: tokens.colorMessageFailedBorder)
            : Border.all(
                color: isHighlighted
                    ? tokens.colorBrandPrimary
                    : withheld
                        ? tokens.colorBorderStrong
                        : tokens.colorBorderSubtle,
              ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: children,
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
  const _QuotedMessage({required this.reply, this.onTap});

  final ReplyPreview reply;

  /// Jump to the original. §9 — tapping the quote scrolls to the message it
  /// quotes and highlights it there.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: Radii.card,
      child: Container(
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ContentText(
            reply.authorName,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
          ContentText(
            reply.excerpt,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
      ),
    );
  }
}

/// The reactions on a message, under its bubble.
///
/// Deliberately outside the bubble rather than inside it: a reaction is a note
/// *about* the message, and putting it in the same box makes a long message
/// with four reactions read as a message that ends in emoji.
class _ReactionChips extends StatelessWidget {
  const _ReactionChips({required this.reactions, this.onToggle});

  final List<Reaction> reactions;
  final void Function(String emoji)? onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Padding(
      padding: const EdgeInsets.only(
        left: Spacing.spacing5,
        right: Spacing.spacing5,
        bottom: Spacing.spacing2,
      ),
      child: Wrap(
        spacing: Spacing.spacing2,
        runSpacing: Spacing.spacing2,
        children: [
          for (final reaction in reactions)
            Semantics(
              button: onToggle != null,
              selected: reaction.mine,
              label: reaction.mine
                  ? l10n.reactionYoursSemantics(reaction.emoji)
                  : l10n.reactionCountSemantics(reaction.emoji, reaction.count),
              // The chip's own children already say it; the label above is the
              // spoken version and would otherwise be read twice.
              excludeSemantics: true,
              child: InkWell(
                onTap: onToggle == null ? null : () => onToggle!(reaction.emoji),
                borderRadius: const BorderRadius.all(Radii.radiusFull),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Spacing.spacing3,
                    vertical: Spacing.spacing1,
                  ),
                  decoration: BoxDecoration(
                    color: reaction.mine
                        ? tokens.colorBrandSubtle
                        : tokens.colorSurfaceMuted,
                    borderRadius: const BorderRadius.all(Radii.radiusFull),
                    // The viewer's own reaction is outlined as well as filled:
                    // §30 forbids carrying state on colour alone.
                    border: Border.all(
                      color: reaction.mine
                          ? tokens.colorBrandPrimary
                          : tokens.colorBorderSubtle,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(reaction.emoji, style: const TextStyle(fontSize: 13)),
                      if (reaction.count > 1) ...[
                        const SizedBox(width: Spacing.spacing2),
                        Text(
                          NumberFormat.decimalPattern(locale)
                              .format(reaction.count),
                          style: theme.textTheme.labelSmall,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A photo in a bubble.
///
/// Bounded, not intrinsic: a tall portrait photo given its own aspect ratio
/// pushes the whole conversation off screen, and the parent then has to scroll
/// past one picture to reach the message under it.
class _PhotoAttachment extends StatelessWidget {
  const _PhotoAttachment({
    required this.attachment,
    required this.isSending,
    required this.hasFailed,
    this.onTap,
  });

  final Attachment attachment;
  final bool isSending;
  final bool hasFailed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing2),
      child: Semantics(
        image: true,
        button: onTap != null,
        label: l10n.attachmentPhotoLabel,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.card,
          child: ClipRRect(
            borderRadius: Radii.card,
            child: Stack(
              alignment: Alignment.center,
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxHeight: 240,
                    minWidth: 160,
                    minHeight: 120,
                  ),
                  child: _photo(attachment),
                ),
                // While the bytes are still going up the photo is dimmed with a
                // spinner over it, so the sender can see it is theirs and that
                // it has not arrived yet.
                if (isSending)
                  ColoredBox(
                    color: tokens.colorMediaScrim,
                    child: Padding(
                      padding: const EdgeInsets.all(Spacing.spacing5),
                      child: SizedBox.square(
                        dimension: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: tokens.colorMediaOnSurface,
                        ),
                      ),
                    ),
                  ),
                if (hasFailed)
                  ColoredBox(
                    color: tokens.colorMediaScrimStrong,
                    child: Padding(
                      padding: const EdgeInsets.all(Spacing.spacing5),
                      child: Icon(
                        Icons.error_outline,
                        color: tokens.colorMediaOnSurface,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// On disk while uploading, behind a signed URL once sent.
  static Widget _photo(Attachment attachment) {
    final url = attachment.url;
    if (url == null || url.isEmpty) return const _AttachmentUnavailable();

    if (attachment.isLocal) {
      return Image.file(
        File(url),
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const _AttachmentUnavailable(),
      );
    }

    return Image.network(
      url,
      fit: BoxFit.cover,
      loadingBuilder: (context, child, progress) => progress == null
          ? child
          : const SizedBox.square(
              dimension: 120,
              child: Center(
                child: SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
      errorBuilder: (_, _, _) => const _AttachmentUnavailable(),
    );
  }
}

class _AttachmentUnavailable extends StatelessWidget {
  const _AttachmentUnavailable();

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: 120,
      child: Center(
        child: Icon(
          Icons.image_not_supported_outlined,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// A document in a bubble: icon, name, size, and a way in.
///
/// No object key, no bucket, no content type — §25 and §31 keep storage out of
/// a parent's sight. The name the sender chose and how big it is are the two
/// things that help someone decide whether to open it.
class _FileAttachment extends StatelessWidget {
  const _FileAttachment({
    required this.attachment,
    required this.foreground,
    required this.isSending,
    this.onTap,
  });

  final Attachment attachment;
  final Color foreground;
  final bool isSending;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final byteSize = attachment.byteSize;

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing2),
      child: InkWell(
        onTap: isSending ? null : onTap,
        borderRadius: Radii.card,
        child: Container(
          constraints: const BoxConstraints(minHeight: Sizes.minTouchTarget),
          padding: const EdgeInsets.all(Spacing.spacing3),
          decoration: BoxDecoration(
            color: tokens.colorSurfaceDefault.withValues(alpha: 0.6),
            borderRadius: Radii.card,
            border: Border.all(color: tokens.colorBorderSubtle),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isSending)
                const SizedBox.square(
                  dimension: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(
                  _iconFor(attachment.mimeType),
                  color: tokens.colorBrandPrimary,
                ),
              const SizedBox(width: Spacing.spacing3),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ContentText(
                      // A file with no name is still a file. The generic word
                      // is better than an object key or an empty line.
                      attachment.fileName?.trim().isNotEmpty == true
                          ? attachment.fileName!
                          : l10n.attachmentFileLabel,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(color: foreground, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      isSending
                          ? l10n.attachmentUploading
                          : byteSize == null
                              ? l10n.attachmentFileLabel
                              : ByteSizeFormat.format(byteSize, l10n, locale: locale),
                      style: theme.textTheme.labelSmall
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static IconData _iconFor(String? mimeType) {
    final type = mimeType ?? '';
    if (type.contains('pdf')) return Icons.picture_as_pdf_outlined;
    if (type.contains('sheet') || type.contains('excel')) {
      return Icons.table_chart_outlined;
    }
    if (type.contains('presentation') || type.contains('powerpoint')) {
      return Icons.slideshow_outlined;
    }
    if (type.startsWith('video/')) return Icons.movie_outlined;
    if (type.startsWith('text/')) return Icons.description_outlined;
    return Icons.insert_drive_file_outlined;
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
          child: ContentText(
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
