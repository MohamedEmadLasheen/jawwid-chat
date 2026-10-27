import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/realtime/realtime_socket.dart';
import '../data/notifications_repository.dart';
import '../domain/inbox.dart';

/// PD-34: the server's hint that this account's Notification Center changed. Sent to the
/// account's own actor room only, and carrying only the unread count: the client refetches
/// through the authorized REST routes.
const inboxChangedEvent = 'notification.inbox_changed';

/// The unread count and the tabs this account has. Drives the bell badge.
///
/// Bound to the principal ([SessionScoped]), so one account's count is never shown to the
/// next person to sign in on this phone. Refreshes when the server says the Center changed.
class InboxCountsController extends AsyncNotifier<InboxCounts> with SessionScoped<InboxCounts> {
  StreamSubscription<RealtimeFrame>? _frames;

  @override
  InboxCounts get sessionEmptyValue => InboxCounts.empty;

  @override
  Future<InboxCounts> build() {
    bindToSession();
    _listenForHints();
    return ref.watch(notificationsRepositoryProvider).counts();
  }

  void _listenForHints() {
    unawaited(_frames?.cancel());
    _frames = null;
    RealtimeSocket socket;
    try {
      socket = ref.watch(realtimeSocketProvider);
    } catch (_) {
      // A build with no realtime seam (tests, the fixture root) refreshes on open only.
      return;
    }
    _frames = socket.frames.listen((frame) {
      if (frame.event == inboxChangedEvent) unawaited(reload());
    });
    // Never awaited (see dart-await-subscription-cancel-hangs): a broadcast stream's cancel
    // can block until the stream closes.
    ref.onDispose(() => unawaited(_frames?.cancel()));
  }

  /// Keeps the current counts on screen while it reloads; a failure keeps them.
  Future<void> reload() async {
    try {
      final counts = await ref.read(notificationsRepositoryProvider).counts();
      if (ref.mounted) state = AsyncData(counts);
    } catch (_) {
      // The badge is a hint; the next open or hint heals it.
    }
  }

  void adopt(InboxCounts counts) {
    if (ref.mounted) state = AsyncData(counts);
  }
}

final inboxCountsProvider = AsyncNotifierProvider<InboxCountsController, InboxCounts>(
  InboxCountsController.new,
);

/// One tab of the Center, newest first, with "load older".
class InboxTabState {
  const InboxTabState({required this.entries, this.next, this.loadingMore = false});

  final List<InboxEntry> entries;
  final String? next;
  final bool loadingMore;

  InboxTabState copyWith({List<InboxEntry>? entries, String? next, bool clearNext = false, bool? loadingMore}) =>
      InboxTabState(
        entries: entries ?? this.entries,
        next: clearNext ? null : next ?? this.next,
        loadingMore: loadingMore ?? this.loadingMore,
      );
}

class InboxTabController extends AsyncNotifier<InboxTabState> with SessionScoped<InboxTabState> {
  InboxTabController(this.tab);

  final InboxTab tab;

  @override
  InboxTabState get sessionEmptyValue => const InboxTabState(entries: []);

  @override
  Future<InboxTabState> build() async {
    bindToSession();
    final page = await ref.watch(notificationsRepositoryProvider).list(tab);
    return InboxTabState(entries: page.entries, next: page.next);
  }

  NotificationsRepository get _repository => ref.read(notificationsRepositoryProvider);

  Future<void> reload() async {
    final page = await _repository.list(tab);
    if (ref.mounted) state = AsyncData(InboxTabState(entries: page.entries, next: page.next));
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.next == null || current.loadingMore) return;
    state = AsyncData(current.copyWith(loadingMore: true));
    try {
      final page = await _repository.list(tab, before: current.next);
      if (!ref.mounted) return;
      state = AsyncData(InboxTabState(
        entries: [...current.entries, ...page.entries],
        next: page.next,
      ));
    } catch (_) {
      if (ref.mounted) state = AsyncData(current.copyWith(loadingMore: false));
      rethrow;
    }
  }

  /// The button was used: recorded, and the entry reads as read at once.
  Future<void> acted(InboxEntry entry) async {
    _markLocally({entry.id});
    await _repository.acted(entry.id);
    unawaited(ref.read(inboxCountsProvider.notifier).reload());
  }

  Future<void> markAllRead() async {
    final current = state.value;
    if (current != null) _markLocally({for (final e in current.entries) e.id});
    final counts = await _repository.markRead(tab: tab);
    ref.read(inboxCountsProvider.notifier).adopt(counts);
  }

  void _markLocally(Set<String> ids) {
    final current = state.value;
    if (current == null || !ref.mounted) return;
    state = AsyncData(current.copyWith(entries: [
      for (final e in current.entries) ids.contains(e.id) ? e.asRead() : e,
    ]));
  }
}

final inboxTabProvider =
    AsyncNotifierProvider.autoDispose.family<InboxTabController, InboxTabState, InboxTab>(
  InboxTabController.new,
);

/// Settings → Notifications.
class NotificationSettingsController extends AsyncNotifier<NotificationSettings>
    with SessionScoped<NotificationSettings> {
  @override
  NotificationSettings get sessionEmptyValue => const NotificationSettings(
        quietEnabled: false,
        quietStartMinute: 1320,
        quietEndMinute: 480,
        quietIsDefault: true,
        showPreviews: false,
        categories: [],
      );

  @override
  Future<NotificationSettings> build() {
    bindToSession();
    return ref.watch(notificationsRepositoryProvider).settings();
  }

  /// Applies one change and adopts the server's answer; a refusal leaves the old settings.
  Future<void> change({
    bool? quietEnabled,
    int? quietStartMinute,
    int? quietEndMinute,
    bool resetQuietHours = false,
    bool? showPreviews,
    Map<String, bool>? categories,
  }) async {
    final current = state.value;
    final next = await ref.read(notificationsRepositoryProvider).updateSettings(
          quietEnabled: quietEnabled ?? (quietStartMinute != null || quietEndMinute != null ? current?.quietEnabled : null),
          quietStartMinute: quietStartMinute ?? (quietEnabled != null || quietEndMinute != null ? current?.quietStartMinute : null),
          quietEndMinute: quietEndMinute ?? (quietEnabled != null || quietStartMinute != null ? current?.quietEndMinute : null),
          resetQuietHours: resetQuietHours,
          showPreviews: showPreviews,
          categories: categories,
        );
    if (ref.mounted) state = AsyncData(next);
  }
}

final notificationSettingsProvider =
    AsyncNotifierProvider.autoDispose<NotificationSettingsController, NotificationSettings>(
  NotificationSettingsController.new,
);
