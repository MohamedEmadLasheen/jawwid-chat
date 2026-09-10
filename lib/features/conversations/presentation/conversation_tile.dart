import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';

/// One row of the chat list.
///
/// Laid out the way every messaging app this audience already uses lays it out: avatar,
/// then name over a single-line preview, with the timestamp and unread badge stacked at the
/// trailing edge. A flat row with a hairline separator rather than a floating card — a list
/// of cards cannot be scanned, and shadows are expensive on the low-end devices this
/// product targets (§47).
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
    this.onOpenProfile,
  });

  final Conversation conversation;
  final DateTime now;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Tapping the avatar or the name opens the profile instead of the conversation — the
  /// split every messaging app makes, and the one people already reach for.
  final VoidCallback? onOpenProfile;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
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
      if (conversation.isPinned) l10n.favoriteLabel,
      if (conversation.isMuted) l10n.mutedLabel,
      if (conversation.isArchived) l10n.archivedLabel,
    ].join('. ');

    return Semantics(
      button: true,
      label: semanticLabel,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 76),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing5,
                vertical: Spacing.spacing4,
              ),
              child: Row(
                children: [
                  // The avatar and the name open the profile; the rest of the row opens
                  // the conversation. Both targets clear the 48dp floor.
                  _ProfileTarget(
                    onOpenProfile: onOpenProfile,
                    child: JawwidAvatar(
                      displayName: conversation.title,
                      imageUrl: conversation.avatarUrl,
                      size: Sizes.avatarLg,
                    ),
                  ),
                  const SizedBox(width: Spacing.spacing4),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Laid out in the name's own direction: this UI can be in
                        // English while every name in it is Arabic, and vice versa.
                        _ProfileTarget(
                          onOpenProfile: onOpenProfile,
                          child: ContentText(
                            conversation.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight:
                                  unread ? FontWeight.w700 : FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(height: Spacing.spacing1),
                        _Preview(
                          conversation: conversation,
                          unread: unread,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: Spacing.spacing3),
                  // The trailing column is fixed at the row's start alignment so the stamp
                  // sits on the name's baseline and the badge hangs beneath it, exactly
                  // where the eye expects to find it.
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        stamp,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: unread
                              ? tokens.colorBrandPrimary
                              : theme.colorScheme.onSurfaceVariant,
                          fontWeight:
                              unread ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                      const SizedBox(height: Spacing.spacing2),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (conversation.isPinned)
                            Padding(
                              padding: const EdgeInsetsDirectional.only(
                                end: Spacing.spacing2,
                              ),
                              child: Icon(
                                Icons.star,
                                size: 14,
                                color: tokens.colorAccent,
                              ),
                            ),
                          if (conversation.isMuted)
                            Padding(
                              padding: const EdgeInsetsDirectional.only(
                                end: Spacing.spacing2,
                              ),
                              child: Icon(
                                Icons.notifications_off_outlined,
                                size: 14,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          if (unread) _UnreadBadge(count: conversation.unreadCount),
                        ],
                      ),
                    ],
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

/// Makes its child open the profile, and stops that tap reaching the row underneath.
///
/// A plain [GestureDetector] would let the tap fall through to the row's [InkWell] and open
/// the conversation as well, so this uses an opaque behaviour deliberately. When no profile
/// handler is supplied the child is returned untouched, leaving the whole row tappable.
class _ProfileTarget extends StatelessWidget {
  const _ProfileTarget({required this.child, this.onOpenProfile});

  final Widget child;
  final VoidCallback? onOpenProfile;

  @override
  Widget build(BuildContext context) {
    if (onOpenProfile == null) return child;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onOpenProfile,
      child: child,
    );
  }
}

/// The second line: who is handling the thread if the backend said so, otherwise the last
/// message. One line, never two — two-line previews halve how many conversations fit on a
/// phone screen, and this list exists to be scanned.
class _Preview extends StatelessWidget {
  const _Preview({required this.conversation, required this.unread});

  final Conversation conversation;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    final handledBy = conversation.handledByLabel;
    if (handledBy != null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ContentText(
            l10n.handledBy(handledBy),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.primary,
            ),
          ),
          _PreviewText(conversation: conversation, unread: unread),
        ],
      );
    }

    return _PreviewText(conversation: conversation, unread: unread);
  }
}

class _PreviewText extends StatelessWidget {
  const _PreviewText({required this.conversation, required this.unread});

  final Conversation conversation;
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Without this, an Arabic sentence in an English UI puts its full stop on the left.
    return ContentText(
      conversation.lastMessagePreview,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: theme.textTheme.bodySmall?.copyWith(
        color: unread
            ? theme.colorScheme.onSurface
            : theme.colorScheme.onSurfaceVariant,
        fontWeight: unread ? FontWeight.w600 : FontWeight.w400,
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
