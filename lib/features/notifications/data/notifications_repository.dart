import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';
import '../domain/inbox.dart';

/// PD-34: the signed-in account's own Notification Center and notification settings.
///
/// Over the app's ONE [ApiClient] -- the one that refreshes through the one token provider
/// (docs/mobile/http-integration.md §4). Every route is the caller's own; there is no way
/// to name another person here.
abstract interface class NotificationsRepository {
  /// `GET /me/notifications?tab=&before=`, newest first.
  Future<InboxPage> list(InboxTab tab, {String? before});

  /// `GET /me/notifications/counts`.
  Future<InboxCounts> counts();

  /// `POST /me/notifications/read` with `{ ids }`, or `{ all: true, tab }` when [ids] is null.
  Future<InboxCounts> markRead({List<String>? ids, InboxTab tab = InboxTab.all});

  /// `POST /me/notifications/{id}/acted` -- the button was used.
  Future<void> acted(String id);

  /// `GET /me/notification-settings`.
  Future<NotificationSettings> settings();

  /// `PUT /me/notification-settings`. Only the keys given are changed; a null quiet-hours
  /// window (with [resetQuietHours]) returns to the academy default.
  Future<NotificationSettings> updateSettings({
    bool? quietEnabled,
    int? quietStartMinute,
    int? quietEndMinute,
    bool resetQuietHours = false,
    bool? showPreviews,
    Map<String, bool>? categories,
  });
}

/// The build with no Notification Center. Fails loudly rather than inventing entries.
class NoNotificationsRepository implements NotificationsRepository {
  const NoNotificationsRepository();

  static const _unavailable = AppError(
    AppErrorKind.notFound,
    debugDetail: 'No Notification Center is wired into this build.',
  );

  @override
  Future<InboxPage> list(InboxTab tab, {String? before}) async => throw _unavailable;

  @override
  Future<InboxCounts> counts() async => InboxCounts.empty;

  @override
  Future<InboxCounts> markRead({List<String>? ids, InboxTab tab = InboxTab.all}) async =>
      throw _unavailable;

  @override
  Future<void> acted(String id) async => throw _unavailable;

  @override
  Future<NotificationSettings> settings() async => throw _unavailable;

  @override
  Future<NotificationSettings> updateSettings({
    bool? quietEnabled,
    int? quietStartMinute,
    int? quietEndMinute,
    bool resetQuietHours = false,
    bool? showPreviews,
    Map<String, bool>? categories,
  }) async =>
      throw _unavailable;
}

/// Registered by both composition roots. The default refuses.
final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (ref) => const NoNotificationsRepository(),
);

class HttpNotificationsRepository implements NotificationsRepository {
  HttpNotificationsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<InboxPage> list(InboxTab tab, {String? before}) async {
    final body = (await _client.get<Map<String, Object?>>(
      '/me/notifications',
      query: {'tab': tab.wire, 'before': ?before},
    ))
        .data;
    final rows = body?['entries'];
    if (rows is! List) {
      throw const AppError(AppErrorKind.server, debugDetail: 'GET /me/notifications carried no entries');
    }
    return InboxPage(
      entries: [
        for (final raw in rows)
          if (raw is Map) ?entryFrom(raw),
      ],
      next: body?['next'] is String ? body!['next'] as String : null,
    );
  }

  @override
  Future<InboxCounts> counts() async =>
      countsFrom((await _client.get<Map<String, Object?>>('/me/notifications/counts')).data);

  @override
  Future<InboxCounts> markRead({List<String>? ids, InboxTab tab = InboxTab.all}) async {
    final body = (await _client.post<Map<String, Object?>>(
      '/me/notifications/read',
      data: ids == null ? {'all': true, 'tab': tab.wire} : {'ids': ids},
    ))
        .data;
    return countsFrom(body);
  }

  @override
  Future<void> acted(String id) async {
    await _client.post<Map<String, Object?>>('/me/notifications/${Uri.encodeComponent(id)}/acted');
  }

  @override
  Future<NotificationSettings> settings() async =>
      settingsFrom((await _client.get<Map<String, Object?>>('/me/notification-settings')).data);

  @override
  Future<NotificationSettings> updateSettings({
    bool? quietEnabled,
    int? quietStartMinute,
    int? quietEndMinute,
    bool resetQuietHours = false,
    bool? showPreviews,
    Map<String, bool>? categories,
  }) async {
    final payload = <String, Object?>{
      if (resetQuietHours)
        'quietHours': null
      else if (quietEnabled != null && quietStartMinute != null && quietEndMinute != null)
        'quietHours': {'enabled': quietEnabled, 'startMinute': quietStartMinute, 'endMinute': quietEndMinute},
      'showPreviews': ?showPreviews,
      if (categories != null)
        'categories': [
          for (final e in categories.entries) {'category': e.key, 'push': e.value},
        ],
    };
    return settingsFrom(
      (await _client.put<Map<String, Object?>>('/me/notification-settings', data: payload)).data,
    );
  }

  /// An entry without an id, text or a parseable time is dropped, never shown invented.
  static InboxEntry? entryFrom(Map<Object?, Object?> raw) {
    String? text(Object? v) => v is String && v.isNotEmpty ? v : null;
    final id = text(raw['id']);
    final at = raw['at'] is String ? DateTime.tryParse(raw['at'] as String)?.toLocal() : null;
    final title = raw['title'] is String ? raw['title'] as String : null;
    final body = raw['body'] is String ? raw['body'] as String : null;
    if (id == null || at == null || title == null || body == null) return null;
    final action = raw['action'];
    InboxAction? parsed;
    if (action is Map) {
      final kind = InboxActionKind.tryParse(action['kind']);
      if (kind != null) {
        parsed = InboxAction(
          kind,
          conversationId: text(action['conversationId']),
          lessonId: text(action['lessonId']),
          learnerId: text(action['learnerId']),
        );
      }
    }
    final count = raw['count'];
    return InboxEntry(
      id: id,
      category: text(raw['category']) ?? 'system',
      severity: text(raw['severity']) ?? 'normal',
      title: title,
      body: body,
      at: at,
      read: raw['read'] == true,
      requiresAction: raw['requiresAction'] == true,
      dueAt: raw['dueAt'] is String ? DateTime.tryParse(raw['dueAt'] as String)?.toLocal() : null,
      count: count is num && count >= 1 ? count.toInt() : 1,
      action: parsed,
    );
  }

  static InboxCounts countsFrom(Map<String, Object?>? body) {
    if (body == null) return InboxCounts.empty;
    final perTab = <InboxTab, int>{};
    final raw = body['perTab'];
    if (raw is Map) {
      for (final e in raw.entries) {
        final tab = InboxTab.tryParse(e.key);
        if (tab != null && e.value is num) perTab[tab] = (e.value as num).toInt();
      }
    }
    final tabs = <InboxTab>[
      if (body['tabs'] is List)
        for (final t in body['tabs'] as List) ?InboxTab.tryParse(t),
    ];
    final unread = body['unread'];
    return InboxCounts(
      unread: unread is num ? unread.toInt() : 0,
      perTab: perTab,
      tabs: tabs.isEmpty ? const [InboxTab.all] : tabs,
    );
  }

  static NotificationSettings settingsFrom(Map<String, Object?>? body) {
    if (body == null) {
      throw const AppError(AppErrorKind.server, debugDetail: 'notification settings carried nothing');
    }
    final quiet = body['quietHours'] is Map ? body['quietHours'] as Map : const {};
    int minute(Object? v, int fallback) => v is num ? v.toInt() : fallback;
    return NotificationSettings(
      quietEnabled: quiet['enabled'] == true,
      quietStartMinute: minute(quiet['startMinute'], 1320),
      quietEndMinute: minute(quiet['endMinute'], 480),
      quietIsDefault: quiet['isDefault'] == true,
      showPreviews: body['showPreviews'] == true,
      categories: [
        if (body['categories'] is List)
          for (final c in body['categories'] as List)
            if (c is Map && c['category'] is String)
              CategorySetting(
                category: c['category'] as String,
                push: c['push'] == true,
                locked: c['locked'] == true,
              ),
      ],
    );
  }
}

/// In memory, for the fixture build and for tests. Behaves like the server: reading is
/// per entry or per tab, a locked category cannot be switched off.
class FakeNotificationsRepository implements NotificationsRepository {
  FakeNotificationsRepository({List<InboxEntry>? entries, List<InboxTab>? tabs})
      : _entries = entries ?? _seed(),
        _tabs = tabs ?? InboxTab.values;

  final List<InboxEntry> _entries;
  final List<InboxTab> _tabs;
  final List<String> actedIds = [];
  NotificationSettings _settings = const NotificationSettings(
    quietEnabled: true,
    quietStartMinute: 1320,
    quietEndMinute: 480,
    quietIsDefault: true,
    showPreviews: false,
    categories: [
      CategorySetting(category: 'lesson', push: true, locked: true),
      CategorySetting(category: 'payment', push: true, locked: true),
      CategorySetting(category: 'conversation', push: true, locked: false),
      CategorySetting(category: 'call', push: true, locked: true),
      CategorySetting(category: 'announcement', push: true, locked: false),
    ],
  );

  static List<InboxEntry> _seed() {
    final now = DateTime.now();
    return [
      InboxEntry(
        id: 'n-lesson',
        category: 'lesson',
        title: 'Lesson soon',
        body: "learner_m's lesson starts in 30 minutes, at 17:00.",
        at: now.subtract(const Duration(minutes: 2)),
        read: false,
        action: const InboxAction(InboxActionKind.viewLesson, lessonId: 'lesson-1', learnerId: 'learner-1'),
      ),
      InboxEntry(
        id: 'n-payment',
        category: 'payment',
        title: 'Payment due',
        body: '200 AED is due on 2026-11-05.',
        at: now.subtract(const Duration(hours: 3)),
        read: true,
        action: const InboxAction(InboxActionKind.viewPayments),
      ),
    ];
  }

  static bool _inTab(InboxEntry e, InboxTab tab) => switch (tab) {
        InboxTab.all => true,
        InboxTab.unread => !e.read,
        InboxTab.action => e.requiresAction,
        InboxTab.lessons => e.category == 'lesson',
        InboxTab.payments => e.category == 'payment',
        InboxTab.conversations => e.category == 'conversation' || e.category == 'call',
        InboxTab.announcements =>
          e.category == 'announcement' || e.category == 'system' || e.category == 'marketing',
      };

  @override
  Future<InboxPage> list(InboxTab tab, {String? before}) async =>
      InboxPage(entries: [for (final e in _entries) if (_inTab(e, tab)) e]);

  @override
  Future<InboxCounts> counts() async {
    final unread = [for (final e in _entries) if (!e.read) e];
    return InboxCounts(
      unread: unread.length,
      perTab: {for (final t in _tabs) t: unread.where((e) => _inTab(e, t)).length},
      tabs: _tabs,
    );
  }

  @override
  Future<InboxCounts> markRead({List<String>? ids, InboxTab tab = InboxTab.all}) async {
    for (var i = 0; i < _entries.length; i++) {
      final e = _entries[i];
      if (ids == null ? _inTab(e, tab) : ids.contains(e.id)) _entries[i] = e.asRead();
    }
    return counts();
  }

  @override
  Future<void> acted(String id) async {
    actedIds.add(id);
    await markRead(ids: [id]);
  }

  @override
  Future<NotificationSettings> settings() async => _settings;

  @override
  Future<NotificationSettings> updateSettings({
    bool? quietEnabled,
    int? quietStartMinute,
    int? quietEndMinute,
    bool resetQuietHours = false,
    bool? showPreviews,
    Map<String, bool>? categories,
  }) async {
    final s = _settings;
    if (categories != null) {
      for (final c in s.categories) {
        if (c.locked && categories[c.category] == false) {
          throw const AppError(AppErrorKind.validation, debugDetail: 'a locked category cannot be switched off');
        }
      }
    }
    _settings = NotificationSettings(
      quietEnabled: resetQuietHours ? true : quietEnabled ?? s.quietEnabled,
      quietStartMinute: resetQuietHours ? 1320 : quietStartMinute ?? s.quietStartMinute,
      quietEndMinute: resetQuietHours ? 480 : quietEndMinute ?? s.quietEndMinute,
      quietIsDefault: resetQuietHours || (s.quietIsDefault && quietEnabled == null),
      showPreviews: showPreviews ?? s.showPreviews,
      categories: [
        for (final c in s.categories)
          CategorySetting(category: c.category, push: categories?[c.category] ?? c.push, locked: c.locked),
      ],
    );
    return _settings;
  }
}
