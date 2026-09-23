import '../../../shared/models/notification.dart';

/// Where a notification leads, and what to do when it leads nowhere.
///
/// THE SERVER MINTS THE ROUTE. `notification.deeplink` is built by the type
/// registry at creation time, so a notification cannot exist without one and
/// this client never has to know how to assemble a route it has not seen. What
/// happens here is validation, not construction: an unrecognised or malformed
/// route resolves to a fallback rather than being pushed blindly.
///
/// THE LINK PROVES NOTHING. Following it is a navigation, not an authorization:
/// the destination screen fetches from the server, which re-checks. A parent
/// who was removed from a group between receiving a notification and tapping it
/// gets a "no longer available" screen, not somebody else's conversation.
abstract final class NotificationDeepLink {
  /// Routes this build knows how to open. A route outside this set is treated
  /// as unknown even if the server minted it, because a newer server may name a
  /// screen this build does not have.
  static const _knownPrefixes = <String>['/chats', '/announcements', '/learners'];

  /// Where tapping [notification] should go, or null when this build cannot
  /// open it.
  ///
  /// Prefers the server's route and falls back to reconstructing one from the
  /// notification's own entity fields — which is what keeps an older row, minted
  /// before deeplinks existed, tappable.
  static String? resolve(AppNotification notification) {
    final minted = notification.deeplink;
    if (minted != null && _isOpenable(minted)) return minted;

    if (notification.announcementId != null) {
      return '/announcements/${notification.announcementId}';
    }
    if (notification.conversationId != null) {
      return '/chats/${notification.conversationId}';
    }
    // A class notification has no screen of its own in this build. The
    // notification itself carries the whole story -- which child, the old time
    // and the new one -- so its detail view is a real destination rather than a
    // consolation prize.
    if (notification.learnerId != null) return null;
    return null;
  }

  /// True when tapping the card should navigate at all.
  ///
  /// A card that cannot lead anywhere is still worth showing -- it says what
  /// happened -- but it must not look tappable and then do nothing.
  static bool isActionable(AppNotification notification) =>
      resolve(notification) != null;

  static bool _isOpenable(String route) {
    if (!route.startsWith('/')) return false;
    // A route with no id after its prefix ("/chats/") would land on an error
    // page; better to fall through to the reconstruction above.
    final path = Uri.tryParse(route)?.path;
    if (path == null || path.isEmpty) return false;

    for (final prefix in _knownPrefixes) {
      if (path == prefix) return true;
      if (path.startsWith('$prefix/') && path.length > prefix.length + 1) {
        // /learners/{id}/classes has no screen in this build yet.
        if (prefix == '/learners') return false;
        return true;
      }
    }
    return false;
  }
}
