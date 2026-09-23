import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/app_localizations.dart';
import '../application/notifications_controller.dart';

/// The bell, with its unread count.
///
/// The number comes from [unreadCountsProvider], which is the server's count —
/// never a sum over whatever page happens to be loaded. That is what keeps the
/// badge the same on a parent's phone and their tablet, and what stops it
/// reading "30" when there are four hundred.
///
/// It updates in realtime because a `notification.created` event invalidates
/// that provider; it also refreshes whenever the centre reloads, so a missed
/// socket event costs latency rather than a wrong number.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, this.onTap});

  /// Defaults to opening the centre. Injectable for tests and for hosts that
  /// want to present it differently.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final unread = ref.watch(notificationUnreadProvider);

    // The count is in the accessible name, not only in the badge: a badge is a
    // painted number and is invisible to a screen reader, so "notifications, 3
    // unread" has to be said somewhere. On an IconButton the tooltip IS that
    // name -- it is what Flutter puts on the semantics node -- so it is stated
    // once here rather than duplicated into a nested Semantics, which would
    // merge into the same node and read the label out twice.
    final label = unread > 0
        ? l10n.notificationsWithUnread(unread)
        : l10n.notificationsTitle;

    return IconButton(
      tooltip: label,
      onPressed: onTap ?? () => context.push('/notifications'),
      icon: unread > 0
          // Badge.count caps at 99+ on its own: a four-digit badge is
          // unreadable, and the exact number stops mattering long before then.
          ? Badge.count(
              count: unread,
              child: const Icon(Icons.notifications_outlined),
            )
          : const Icon(Icons.notifications_none),
    );
  }
}
