import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';

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
  });

  final Message message;

  /// Group conversations show the sender above the first bubble in a run.
  final bool showAuthor;

  final VoidCallback? onRetry;
  final VoidCallback? onDiscard;
  final VoidCallback? onReply;

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
                    child: ContentText(
                      message.authorName,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                if (message.replyTo != null) _QuotedMessage(reply: message.replyTo!),
                if (message.isDeleted)
                  Text(
                    l10n.messageDeleted,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontStyle: FontStyle.italic,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  // Message bodies resolve their own base direction, so a mixed
                  // Arabic/English message reads correctly either way (§4).
                  //
                  // This used to pass `textDirection: null`, which reads like auto-detection
                  // and is not: null means "inherit the ambient direction". An Arabic
                  // message in an English UI therefore put its full stop on the left.
                  ContentText(
                    message.body,
                    style: theme.textTheme.bodyLarge?.copyWith(color: foreground),
                  ),
                const SizedBox(height: Spacing.spacing1),
                _StatusLine(message: message, onRetry: onRetry, onDiscard: onDiscard),
              ],
            ),
          ),
        ),
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
  const _QuotedMessage({required this.reply});

  final ReplyPreview reply;

  @override
  Widget build(BuildContext context) {
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
