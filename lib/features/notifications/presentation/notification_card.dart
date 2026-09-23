import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/notification.dart';
import '../../../shared/utils/relative_time.dart';
import '../domain/notification_deeplink.dart';

/// One row in the notification centre.
///
/// The card answers, in this order and without the parent having to think:
/// what happened, who it is about, which child, when, and whether there is
/// anything to do. Everything else is left out.
///
/// The text is rendered server-side and shown verbatim. No sentence is
/// assembled here, in either language — which is also what makes the card work
/// in Arabic without a single RTL special case, because it never concatenates
/// anything.
class NotificationCard extends StatelessWidget {
  const NotificationCard({
    super.key,
    required this.notification,
    required this.onTap,
  });

  final AppNotification notification;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final actionable = NotificationDeepLink.isActionable(notification);

    // Unread is a background wash plus a dot, not a bold font: a list where
    // half the rows are bold is harder to scan than one where they are tinted.
    final background = notification.isUnread
        ? tokens.colorBrandSubtle
        : tokens.colorSurfaceDefault;

    return Semantics(
      button: actionable,
      // The whole card is one label, so a screen reader reads it as one thing
      // rather than as five fragments.
      label: [
        if (notification.isUnread) l10n.notificationUnreadLabel,
        notification.title,
        notification.body,
      ].where((s) => s.isNotEmpty).join('. '),
      child: Material(
        color: background,
        child: InkWell(
          // A card that leads nowhere is still shown -- it says what happened --
          // but it must not look tappable and then do nothing.
          onTap: actionable ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing5,
              vertical: Spacing.spacing4,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Leading(notification: notification),
                const SizedBox(width: Spacing.spacing4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              notification.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: notification.isUnread
                                    ? FontWeight.w700
                                    : FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(width: Spacing.spacing3),
                          Text(
                            RelativeTime.forListRow(
                              notification.createdAt,
                              DateTime.now(),
                              locale: Localizations.localeOf(context).toLanguageTag(),
                              todayLabel: l10n.todayLabel,
                              yesterdayLabel: l10n.yesterdayLabel,
                            ),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: tokens.colorTextMuted,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: Spacing.spacing1),
                      Text(
                        notification.body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: tokens.colorTextSecondary,
                        ),
                      ),
                      _Chips(notification: notification),
                    ],
                  ),
                ),
                if (notification.isUnread) ...[
                  const SizedBox(width: Spacing.spacing3),
                  Padding(
                    padding: const EdgeInsets.only(top: Spacing.spacing2),
                    child: _UnreadDot(color: tokens.colorBrandPrimary),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Avatar when there is a person behind it, category icon otherwise.
///
/// An academy announcement has no sender, and rendering a fake silhouette for
/// one would suggest a person wrote it personally.
class _Leading extends StatelessWidget {
  const _Leading({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final sender = notification.senderName;

    if (sender != null && sender.isNotEmpty) {
      return JawwidAvatar(displayName: sender, size: Sizes.avatarMd);
    }

    final (icon, background) = switch (notification.category) {
      NotificationCategory.calls => (Icons.call_missed, tokens.colorStatusWarningBg),
      NotificationCategory.classes => (Icons.event_note, tokens.colorStatusInfoBg),
      NotificationCategory.academy => (Icons.campaign, tokens.colorBrandSubtle),
      NotificationCategory.billing => (Icons.receipt_long, tokens.colorStatusNeutralBg),
      NotificationCategory.approvals => (Icons.fact_check, tokens.colorStatusNeutralBg),
      NotificationCategory.account => (Icons.person, tokens.colorStatusNeutralBg),
      _ => (Icons.notifications, tokens.colorStatusNeutralBg),
    };

    return Container(
      width: Sizes.avatarMd,
      height: Sizes.avatarMd,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Icon(icon, size: 20, color: tokens.colorTextSecondary),
    );
  }
}

/// The small markers under the body: which child, how many, how loud.
///
/// Each one has to earn its place — a row of chips on every card is noise, so
/// each is conditional on there being something to say.
class _Chips extends StatelessWidget {
  const _Chips({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    final chips = <Widget>[
      // WHICH CHILD. The single most important thing on the card for a parent
      // with more than one, and the reason the server resolves it rather than
      // leaving the client to guess from the conversation.
      if (notification.learnerName != null)
        _Chip(
          label: notification.learnerName!,
          icon: Icons.child_care,
          foreground: tokens.colorTextSecondary,
          background: tokens.colorSurfaceMuted,
        ),
      // Only high and urgent are marked. Marking everything marks nothing.
      if (notification.priority == NotificationPriority.urgent)
        _Chip(
          label: l10n.notificationUrgentLabel,
          icon: Icons.priority_high,
          foreground: tokens.colorStatusDangerFg,
          background: tokens.colorStatusDangerBg,
        )
      else if (notification.priority == NotificationPriority.high)
        _Chip(
          label: l10n.notificationImportantLabel,
          icon: Icons.flag_outlined,
          foreground: tokens.colorStatusWarningFg,
          background: tokens.colorStatusWarningBg,
        ),
    ];

    if (chips.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: Spacing.spacing3),
      child: Wrap(
        spacing: Spacing.spacing2,
        runSpacing: Spacing.spacing2,
        children: chips,
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.icon,
    required this.foreground,
    required this.background,
  });

  final String label;
  final IconData icon;
  final Color foreground;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing3,
        vertical: Spacing.spacing1,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: foreground),
          const SizedBox(width: Spacing.spacing2),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: foreground, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _UnreadDot extends StatelessWidget {
  const _UnreadDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      );
}
