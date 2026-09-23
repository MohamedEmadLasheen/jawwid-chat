import 'dart:async';

import '../../shared/models/notification.dart';
import '../errors/app_error.dart';
import 'repositories.dart';

/// An in-memory [NotificationRepository].
///
/// Development and test only — never wired into a release build (decision D4).
///
/// It is a genuine implementation rather than a stub, because the behaviours the
/// centre depends on are the ones worth testing without a backend: keyset
/// pagination, server-side unread counts, and read operations that are
/// idempotent. A fake that returned a fixed list would let a paging or
/// idempotency bug reach the device untested.
class FakeNotificationRepository implements NotificationRepository {
  FakeNotificationRepository({List<AppNotification>? seed})
      : _items = [...?seed] {
    _items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  final List<AppNotification> _items;
  final _incoming = StreamController<AppNotification>.broadcast();

  final _preferences = <NotificationCategory, bool>{};
  final _announcements = <String, Announcement>{};

  /// Registered device tokens, so a test can assert that launch registered one
  /// and that signing out did not unregister the other device's.
  final registeredTokens = <String>{};

  /// Notifications reported delivered/opened, so the honesty of those reports
  /// can be asserted rather than assumed.
  final reportedDelivered = <String>{};
  final reportedOpened = <String>{};

  /// Set to make the next call fail, so tests can drive the error paths.
  AppError? nextFailure;

  /// Set to make EVERY call fail until cleared.
  ///
  /// Distinct from [nextFailure] for the same reason [FakeBackend] draws the
  /// line: the centre and the badge both call on build, so a single-shot
  /// failure is consumed by whichever runs first and the screen settles into a
  /// success state. Asserting a settled error state needs this one.
  AppError? persistentFailure;

  void dispose() => _incoming.close();

  @override
  Stream<AppNotification> get incoming => _incoming.stream;

  /// Simulate a notification arriving over the realtime channel.
  void deliver(AppNotification notification) {
    _items.insert(0, notification);
    _incoming.add(notification);
  }

  /// Create a notification WITHOUT telling this device.
  ///
  /// The offline case: the server persisted it while the socket was down, so it
  /// is in the database and nothing delivered it here. This is what makes the
  /// reconnect re-sync testable, and it is the case that proves realtime cannot
  /// be the source of truth.
  void insertWithoutDelivering(AppNotification notification) {
    _items.insert(0, notification);
  }

  void seedAnnouncement(Announcement announcement) =>
      _announcements[announcement.id] = announcement;

  void _maybeFail() {
    final persistent = persistentFailure;
    if (persistent != null) throw persistent;

    final failure = nextFailure;
    if (failure != null) {
      nextFailure = null;
      throw failure;
    }
  }

  @override
  Future<Page<AppNotification>> history({
    NotificationCategory? category,
    bool unreadOnly = false,
    String? cursor,
    int limit = 30,
  }) async {
    _maybeFail();

    var visible = _items.where((n) {
      if (category != null && n.category != category) return false;
      if (unreadOnly && !n.isUnread) return false;
      return true;
    }).toList();

    // Keyset, exactly as the server does it: everything strictly older than the
    // cursor. An unrecognised cursor starts from the top rather than failing,
    // matching the server's treatment of a stale bookmark.
    if (cursor != null) {
      final index = visible.indexWhere((n) => n.id == cursor);
      visible = index >= 0 ? visible.sublist(index + 1) : visible;
    }

    final page = visible.take(limit).toList();
    final hasMore = visible.length > limit;

    return Page(
      items: page,
      nextCursor: hasMore ? page.last.id : null,
      hasMore: hasMore,
    );
  }

  @override
  Future<UnreadCounts> unreadCounts() async {
    _maybeFail();

    final byCategory = <NotificationCategory, int>{};
    var total = 0;
    for (final n in _items.where((n) => n.isUnread)) {
      byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
      total += 1;
    }
    return UnreadCounts(total: total, byCategory: byCategory);
  }

  @override
  Future<AppNotification> byId(String notificationId) async {
    _maybeFail();
    final found = _items.where((n) => n.id == notificationId).firstOrNull;
    if (found == null) {
      throw const AppError(AppErrorKind.notFound, code: 'notification_not_found');
    }
    return found;
  }

  @override
  Future<void> markRead(String notificationId) async {
    _maybeFail();
    _replace(notificationId, (n) => n.isUnread ? n.copyWith(readAt: DateTime.now()) : n);
  }

  @override
  Future<void> markAllRead({NotificationCategory? category}) async {
    _maybeFail();
    final now = DateTime.now();
    for (var i = 0; i < _items.length; i++) {
      final n = _items[i];
      if (category != null && n.category != category) continue;
      if (n.isUnread) _items[i] = n.copyWith(readAt: now);
    }
  }

  @override
  Future<void> markConversationRead(String conversationId) async {
    _maybeFail();
    final now = DateTime.now();
    for (var i = 0; i < _items.length; i++) {
      final n = _items[i];
      if (n.conversationId != conversationId || !n.isUnread) continue;
      _items[i] = n.copyWith(readAt: now);
    }
  }

  @override
  Future<List<NotificationPreference>> preferences() async {
    _maybeFail();
    // Mirrors chat.notification_category: approvals and account are not optional.
    const optional = {
      NotificationCategory.messaging,
      NotificationCategory.calls,
      NotificationCategory.classes,
      NotificationCategory.academy,
      NotificationCategory.billing,
    };

    return [
      for (final category in const [
        NotificationCategory.messaging,
        NotificationCategory.calls,
        NotificationCategory.classes,
        NotificationCategory.academy,
        NotificationCategory.billing,
        NotificationCategory.approvals,
        NotificationCategory.account,
      ])
        NotificationPreference(
          category: category,
          isOptional: optional.contains(category),
          pushEnabled: _preferences[category] ?? true,
        ),
    ];
  }

  @override
  Future<void> setPreference(
    NotificationCategory category, {
    required bool pushEnabled,
  }) async {
    _maybeFail();
    // The same refusal the server gives, so a test can prove the UI handles it.
    if (!pushEnabled &&
        (category == NotificationCategory.approvals ||
            category == NotificationCategory.account)) {
      throw const AppError(
        AppErrorKind.validation,
        code: 'category_not_optional',
      );
    }
    _preferences[category] = pushEnabled;
  }

  @override
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip = false,
    String? locale,
  }) async {
    _maybeFail();
    registeredTokens.add(token);
  }

  @override
  Future<void> unregisterDevice(String token) async {
    _maybeFail();
    registeredTokens.remove(token);
  }

  @override
  Future<void> reportDelivered(String notificationId) async {
    reportedDelivered.add(notificationId);
  }

  @override
  Future<void> reportOpened(String notificationId) async {
    reportedOpened.add(notificationId);
  }

  @override
  Future<Announcement> announcement(String announcementId) async {
    _maybeFail();
    final found = _announcements[announcementId];
    if (found == null) {
      throw const AppError(AppErrorKind.notFound, code: 'announcement_not_found');
    }
    return found;
  }

  void _replace(String id, AppNotification Function(AppNotification) apply) {
    final index = _items.indexWhere((n) => n.id == id);
    if (index >= 0) _items[index] = apply(_items[index]);
  }
}
