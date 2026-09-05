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
    final isDark = theme.brightness == Brightness.dark;
    final mine = message.isMine;

    final background = mine
        ? (isDark ? JawwidColors.bubbleMineDark : JawwidColors.bubbleMine)
        : (isDark ? JawwidColors.bubbleTheirsDark : JawwidColors.bubbleTheirs);

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
              horizontal: Spacing.md,
              vertical: Spacing.xxs,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.md,
              vertical: Spacing.sm,
            ),
            decoration: BoxDecoration(
              color: background,
              borderRadius: Radii.bubble,
              border: withheld
                  ? Border.all(color: theme.colorScheme.outlineVariant)
                  : null,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (showAuthor && !mine)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Spacing.xxs),
                    child: Text(
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
                  Text(message.body, style: theme.textTheme.bodyMedium),
                const SizedBox(height: Spacing.xxs),
                _StatusLine(message: message, onRetry: onRetry, onDiscard: onDiscard),
              ],
            ),
          ),
        ),
      ),
    );
  }
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
          const SizedBox(width: Spacing.xs),
          Text(
            l10n.messageStateFailed,
            style: muted?.copyWith(color: theme.colorScheme.error),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: Spacing.sm),
            _InlineAction(label: l10n.messageRetry, onPressed: onRetry!),
          ],
          if (onDiscard != null) ...[
            const SizedBox(width: Spacing.sm),
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
          const SizedBox(width: Spacing.xs),
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
        const SizedBox(width: Spacing.xs),
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
      margin: const EdgeInsets.only(bottom: Spacing.xs),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.sm,
        vertical: Spacing.xs,
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
    final isDark = theme.brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.xl,
        vertical: Spacing.sm,
      ),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.md,
            vertical: Spacing.sm,
          ),
          decoration: BoxDecoration(
            color: isDark
                ? JawwidColors.bubbleSystemDark
                : JawwidColors.bubbleSystem,
            borderRadius: Radii.card,
          ),
          child: Text(
            message.body,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}
