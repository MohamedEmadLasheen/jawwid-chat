import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/relative_time.dart';

/// One row of the chat list.
///
/// The unread state is carried by a count badge *and* by weight — never by colour alone,
/// which §53 forbids.
class ConversationTile extends StatelessWidget {
  const ConversationTile({
    super.key,
    required this.conversation,
    required this.now,
    this.onTap,
    this.onLongPress,
  });

  final Conversation conversation;
  final DateTime now;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final unread = conversation.hasUnread;

    final timestamp = conversation.lastMessageAt;
    final stamp = timestamp == null
        ? ''
        : RelativeTime.forListRow(
            timestamp,
            now,
            locale: locale,
            todayLabel: l10n.todayLabel,
            yesterdayLabel: l10n.yesterdayLabel,
          );

    // One semantic string for the whole row, so a screen reader announces it as a unit
    // rather than reading five disconnected fragments.
    final semanticLabel = [
      conversation.title,
      if (conversation.handledByLabel != null)
        l10n.handledBy(conversation.handledByLabel!),
      if (unread) l10n.unreadCount(conversation.unreadCount),
      if (conversation.isMuted) l10n.mutedLabel,
    ].join('. ');

    return Semantics(
      button: true,
      label: semanticLabel,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing5,
                vertical: Spacing.spacing4,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  JawwidAvatar(
                    displayName: conversation.title,
                    imageUrl: conversation.avatarUrl,
                    size: Sizes.avatarLg,
                  ),
                  const SizedBox(width: Spacing.spacing4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (conversation.isPinned) ...[
                              Icon(
                                Icons.push_pin,
                                size: 14,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: Spacing.spacing2),
                            ],
                            Expanded(
                              child: Text(
                                conversation.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight:
                                      unread ? FontWeight.w700 : FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: Spacing.spacing3),
                            Text(
                              stamp,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                        if (conversation.handledByLabel != null)
                          Padding(
                            padding: const EdgeInsets.only(top: Spacing.spacing1),
                            child: Text(
                              l10n.handledBy(conversation.handledByLabel!),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.primary,
                              ),
                            ),
                          ),
                        const SizedBox(height: Spacing.spacing1),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                conversation.lastMessagePreview,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: unread
                                      ? theme.colorScheme.onSurface
                                      : theme.colorScheme.onSurfaceVariant,
                                  fontWeight:
                                      unread ? FontWeight.w600 : FontWeight.w400,
                                ),
                              ),
                            ),
                            if (conversation.isMuted)
                              Padding(
                                padding: const EdgeInsetsDirectional.only(start: Spacing.spacing2),
                                child: Icon(
                                  Icons.notifications_off_outlined,
                                  size: 15,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            if (unread) ...[
                              const SizedBox(width: Spacing.spacing3),
                              _UnreadBadge(count: conversation.unreadCount),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = count > 99 ? '99+' : '$count';

    return Container(
      constraints: const BoxConstraints(minWidth: 20),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onPrimary,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
