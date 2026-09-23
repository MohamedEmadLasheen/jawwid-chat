/// The notification domain, client-side.
///
/// Mirrors `apps/api/src/communication/contracts/notifications.ts`. The server
/// is the authority on every one of these values; the client's job is to render
/// what it is given, not to decide what a notification means.
library;

/// The tabs in the notification centre, and the rows in its settings screen.
///
/// `unknown` exists so a category added on the server does not make an older
/// build drop notifications on the floor: they land under "All" and render
/// normally, which is what a parent needs, rather than disappearing.
enum NotificationCategory {
  messaging,
  calls,
  classes,
  academy,
  billing,
  approvals,
  account,
  unknown;

  static NotificationCategory parse(String? raw) => switch (raw) {
        'messaging' => NotificationCategory.messaging,
        'calls' => NotificationCategory.calls,
        'classes' => NotificationCategory.classes,
        'academy' => NotificationCategory.academy,
        'billing' => NotificationCategory.billing,
        'approvals' => NotificationCategory.approvals,
        'account' => NotificationCategory.account,
        _ => NotificationCategory.unknown,
      };

  /// The value the server filters on. `unknown` has none, so it is never sent.
  String? get wire => this == NotificationCategory.unknown ? null : name;
}

/// Affects presentation only.
///
/// Whether a notification woke the phone, bypassed quiet hours or ignored a
/// mute was decided on the server before it ever got here. The client uses this
/// to decide how loud a card looks, and nothing else.
enum NotificationPriority {
  low,
  normal,
  high,
  urgent;

  static NotificationPriority parse(String? raw) => switch (raw) {
        'low' => NotificationPriority.low,
        'high' => NotificationPriority.high,
        'urgent' => NotificationPriority.urgent,
        _ => NotificationPriority.normal,
      };

  /// Only these two earn a visual marker. Marking everything marks nothing.
  bool get isElevated =>
      this == NotificationPriority.high || this == NotificationPriority.urgent;
}

/// One notification, as the centre renders it.
///
/// [title] and [body] arrive already rendered in the recipient's language and
/// are never re-composed here: the server froze them at creation so that a
/// second schedule change cannot rewrite what the parent was told the first
/// time. A client that rebuilt the sentence from [data] would undo that.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.category,
    required this.priority,
    required this.title,
    required this.body,
    required this.createdAt,
    this.type,
    this.readAt,
    this.isEssential = false,
    this.deeplink,
    this.entityType,
    this.entityId,
    this.conversationId,
    this.learnerId,
    this.learnerName,
    this.senderId,
    this.senderName,
    this.announcementId,
    this.imageUrl,
  });

  final String id;

  /// The server's registry type, e.g. `MISSED_CALL`. Kept as a string rather
  /// than an enum: an unrecognised type must still render, and a closed enum
  /// would force this build to have an opinion about every type the server will
  /// ever have.
  final String? type;

  final NotificationCategory category;
  final NotificationPriority priority;
  final String title;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;

  /// True when the parent could not have muted it. Shown as a small marker so
  /// "why am I getting this?" has an answer inside the app.
  final bool isEssential;

  /// The route the server minted for this notification. Followed, never
  /// constructed here — see [NotificationDeepLink] for how it is resolved, and
  /// why the client re-authorizes on arrival anyway.
  final String? deeplink;
  final String? entityType;
  final String? entityId;

  final String? conversationId;

  /// WHICH CHILD. Present whenever the notification is about one.
  final String? learnerId;
  final String? learnerName;

  final String? senderId;
  final String? senderName;
  final String? announcementId;
  final String? imageUrl;

  bool get isUnread => readAt == null;

  AppNotification copyWith({DateTime? readAt}) => AppNotification(
        id: id,
        type: type,
        category: category,
        priority: priority,
        title: title,
        body: body,
        createdAt: createdAt,
        readAt: readAt ?? this.readAt,
        isEssential: isEssential,
        deeplink: deeplink,
        entityType: entityType,
        entityId: entityId,
        conversationId: conversationId,
        learnerId: learnerId,
        learnerName: learnerName,
        senderId: senderId,
        senderName: senderName,
        announcementId: announcementId,
        imageUrl: imageUrl,
      );
}

/// Unread counts, total and per category.
///
/// Always from the server. The client never derives the badge from the page it
/// happens to have loaded: a parent who has scrolled one page of history would
/// otherwise see a badge that counts thirty notifications out of four hundred.
class UnreadCounts {
  const UnreadCounts({this.total = 0, this.byCategory = const {}});

  final int total;
  final Map<NotificationCategory, int> byCategory;

  int forCategory(NotificationCategory? category) =>
      category == null ? total : (byCategory[category] ?? 0);

  static const empty = UnreadCounts();
}

/// One category row on the settings screen.
///
/// [isOptional] is the server's, not the client's: a switch the product does
/// not allow is rendered as locked rather than hidden, so a parent can see that
/// approvals notifications exist and are not something they turned off.
class NotificationPreference {
  const NotificationPreference({
    required this.category,
    required this.isOptional,
    required this.pushEnabled,
  });

  final NotificationCategory category;
  final bool isOptional;
  final bool pushEnabled;

  NotificationPreference copyWith({bool? pushEnabled}) => NotificationPreference(
        category: category,
        isOptional: isOptional,
        pushEnabled: pushEnabled ?? this.pushEnabled,
      );
}

/// The announcement behind an academy notification, once opened.
class Announcement {
  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.priority,
    this.imageUrl,
    this.actionLabel,
    this.actionUrl,
    this.publishedAt,
    this.expiresAt,
  });

  final String id;
  final String title;
  final String body;
  final String priority;
  final String? imageUrl;
  final String? actionLabel;
  final String? actionUrl;
  final DateTime? publishedAt;
  final DateTime? expiresAt;
}
