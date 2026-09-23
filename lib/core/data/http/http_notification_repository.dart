import 'dart:async';

import '../../../shared/models/notification.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../../realtime/realtime_client.dart';
import '../../realtime/realtime_events.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `NotificationRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/notification.controller.ts`
/// and `announcement.controller.ts`):
///
/// | Method | Path | Response |
/// |---|---|---|
/// | GET | `/notifications` | `{ items, nextCursor, hasMore }` |
/// | GET | `/notifications/unread-count` | `{ total, byCategory }` |
/// | GET | `/notifications/preferences` | `{ categories }` |
/// | POST | `/notifications/preferences` | `{ ok }` |
/// | POST | `/notifications/devices` | `{ ok }` |
/// | DELETE | `/notifications/devices/:token` | `{ ok }` |
/// | POST | `/notifications/read-all` | `{ ok, count }` |
/// | POST | `/notifications/read-conversation/:id` | `{ ok, count }` |
/// | GET | `/notifications/:id` | `NotificationCard` |
/// | POST | `/notifications/:id/read` | `{ ok, changed }` |
/// | POST | `/notifications/:id/delivered` | `{ ok }` |
/// | POST | `/notifications/:id/opened` | `{ ok }` |
/// | GET | `/announcements/:id` | `AnnouncementDto` |
///
/// The recipient is never a parameter on any of these. The server takes it from
/// the authenticated actor, so there is no request this client can make that
/// asks for somebody else's notifications.
class HttpNotificationRepository implements NotificationRepository {
  HttpNotificationRepository({
    required ApiClient client,
    required RealtimeClient realtime,
  })  : _client = client,
        _realtime = realtime {
    // The shared transport carries every event in the server's contract; this
    // repository takes the one it is responsible for and ignores the rest.
    // Filtering here rather than asking the transport for a notification-only
    // stream is what keeps the transport feature-agnostic.
    _subscription = _realtime.events
        .where((event) => event.name == RealtimeEvents.notificationCreated)
        .listen(_onRealtimeNotification);
  }

  final ApiClient _client;
  final RealtimeClient _realtime;
  late final StreamSubscription<RealtimeEvent> _subscription;

  /// Broadcast because both the bell and an open centre listen.
  final _incoming = StreamController<AppNotification>.broadcast();

  @override
  Stream<AppNotification> get incoming => _incoming.stream;

  /// A `notification.created` event.
  ///
  /// The payload is a HINT, not the record: it carries enough to move the badge
  /// and show the arrival, and the centre refetches for the rest. The same rule
  /// `message.created` follows, and the reason a missed event costs latency
  /// rather than a notification.
  void _onRealtimeNotification(RealtimeEvent event) {
    final notification = WireMappers.realtimeNotification(event.payload);
    if (notification != null) _incoming.add(notification);
  }

  void dispose() {
    _subscription.cancel();
    _incoming.close();
  }

  @override
  Future<Page<AppNotification>> history({
    NotificationCategory? category,
    bool unreadOnly = false,
    String? cursor,
    int limit = 30,
  }) async {
    final response = await _client.get<Map<String, Object?>>(
      '/notifications',
      query: {
        if (category?.wire != null) 'category': category!.wire,
        if (unreadOnly) 'unread': 'true',
        'cursor': ?cursor,
        'limit': limit.toString(),
      },
    );

    final rows = (response.data?['items'] as List?) ?? const [];
    final items = <AppNotification>[];
    for (final row in rows) {
      if (row is! Map<String, Object?>) continue;
      // One malformed row must not blank a page. A parent with 400
      // notifications should not lose the whole screen to one bad record.
      final mapped = WireMappers.notification(row);
      if (mapped != null) items.add(mapped);
    }

    return Page(
      items: items,
      nextCursor: response.data?['nextCursor'] as String?,
      hasMore: response.data?['hasMore'] == true,
    );
  }

  @override
  Future<UnreadCounts> unreadCounts() async {
    final response =
        await _client.get<Map<String, Object?>>('/notifications/unread-count');
    return WireMappers.unreadCounts(response.data ?? const {});
  }

  @override
  Future<AppNotification> byId(String notificationId) async {
    final response =
        await _client.get<Map<String, Object?>>('/notifications/$notificationId');
    final mapped = WireMappers.notification(response.data ?? const {});
    if (mapped == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_notification_response',
        debugDetail: 'notification response carried no id',
      );
    }
    return mapped;
  }

  @override
  Future<void> markRead(String notificationId) async {
    await _client.post<Map<String, Object?>>('/notifications/$notificationId/read');
  }

  @override
  Future<void> markAllRead({NotificationCategory? category}) async {
    await _client.post<Map<String, Object?>>(
      '/notifications/read-all',
      data: {if (category?.wire != null) 'category': category!.wire},
    );
  }

  @override
  Future<void> markConversationRead(String conversationId) async {
    await _client.post<Map<String, Object?>>(
      '/notifications/read-conversation/$conversationId',
    );
  }

  @override
  Future<List<NotificationPreference>> preferences() async {
    final response =
        await _client.get<Map<String, Object?>>('/notifications/preferences');
    final rows = (response.data?['categories'] as List?) ?? const [];

    final preferences = <NotificationPreference>[];
    for (final row in rows) {
      if (row is! Map<String, Object?>) continue;
      final mapped = WireMappers.notificationPreference(row);
      if (mapped != null) preferences.add(mapped);
    }
    return preferences;
  }

  @override
  Future<void> setPreference(
    NotificationCategory category, {
    required bool pushEnabled,
  }) async {
    final wire = category.wire;
    if (wire == null) {
      // A category this build does not recognise cannot be toggled: the client
      // would be guessing at a server-side key.
      throw const AppError(
        AppErrorKind.validation,
        code: 'unknown_notification_category',
        debugDetail: 'cannot set a preference for a category this build does not know',
      );
    }
    await _client.post<Map<String, Object?>>(
      '/notifications/preferences',
      data: {'category': wire, 'pushEnabled': pushEnabled},
    );
  }

  @override
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip = false,
    String? locale,
  }) async {
    await _client.post<Map<String, Object?>>(
      '/notifications/devices',
      data: {
        'token': token,
        'platform': platform,
        'isVoip': isVoip,
        'locale': ?locale,
      },
    );
  }

  @override
  Future<void> unregisterDevice(String token) async {
    await _client.delete<Map<String, Object?>>(
      '/notifications/devices/${Uri.encodeComponent(token)}',
    );
  }

  @override
  Future<void> reportDelivered(String notificationId) async {
    await _client
        .post<Map<String, Object?>>('/notifications/$notificationId/delivered');
  }

  @override
  Future<void> reportOpened(String notificationId) async {
    await _client.post<Map<String, Object?>>('/notifications/$notificationId/opened');
  }

  @override
  Future<Announcement> announcement(String announcementId) async {
    final response =
        await _client.get<Map<String, Object?>>('/announcements/$announcementId');
    final mapped = WireMappers.announcement(response.data ?? const {});
    if (mapped == null) {
      throw const AppError(
        AppErrorKind.notFound,
        code: 'announcement_not_found',
        debugDetail: 'announcement response carried no id',
      );
    }
    return mapped;
  }
}
