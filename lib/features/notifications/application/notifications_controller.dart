import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/notification.dart';

/// Which tab of the notification centre is showing.
///
/// A record rather than two providers so a filter change is one rebuild, not
/// two — and so "unread, in Classes" is a single expressible state.
typedef NotificationFilter = ({NotificationCategory? category, bool unreadOnly});

const NotificationFilter _allNotifications = (category: null, unreadOnly: false);

/// The selected filter. A [Notifier] rather than a `StateProvider` because the
/// latter is legacy in Riverpod 3, and because naming the two transitions
/// ([setCategory], [setUnreadOnly]) keeps the chip row from having to know the
/// record's shape.
class NotificationFilterController extends Notifier<NotificationFilter> {
  @override
  NotificationFilter build() => _allNotifications;

  void setCategory(NotificationCategory? category) =>
      state = (category: category, unreadOnly: state.unreadOnly);

  void setUnreadOnly(bool unreadOnly) =>
      state = (category: state.category, unreadOnly: unreadOnly);
}

final notificationFilterProvider =
    NotifierProvider<NotificationFilterController, NotificationFilter>(
  NotificationFilterController.new,
);

/// What the centre is showing, including whether more can be loaded.
class NotificationFeed {
  const NotificationFeed({
    this.items = const [],
    this.hasMore = false,
    this.isLoadingMore = false,
  });

  final List<AppNotification> items;
  final bool hasMore;
  final bool isLoadingMore;

  NotificationFeed copyWith({
    List<AppNotification>? items,
    bool? hasMore,
    bool? isLoadingMore,
  }) =>
      NotificationFeed(
        items: items ?? this.items,
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// The notification centre.
///
/// PAGINATED, ALWAYS. A parent who has been with the academy for two years has
/// thousands of notifications; the first page is thirty and the rest arrive as
/// they scroll. Nothing here ever asks for "all".
///
/// READ STATE IS OPTIMISTIC, then reconciled. Marking read is idempotent on the
/// server, so showing it immediately and rolling back on failure is safe — and
/// a parent tapping a notification should not watch a spinner to find out
/// whether it counted.
class NotificationsController extends AsyncNotifier<NotificationFeed> {
  String? _cursor;
  StreamSubscription<AppNotification>? _incoming;
  StreamSubscription<ReadSync>? _reads;

  @override
  Future<NotificationFeed> build() async {
    final filter = ref.watch(notificationFilterProvider);

    // A notification arriving over realtime refreshes the top of the list and
    // the badge. Realtime is for immediacy only: if this event never arrives,
    // the next refresh still shows it, because the database is the record.
    _incoming ??= ref.read(notificationRepositoryProvider).incoming.listen((_) {
      unawaited(refresh());
      ref.invalidate(unreadCountsProvider);
    });
    // The parent read it on their other device. Applied in place rather than by
    // refetching: the event already says what changed, and a refetch would put
    // a spinner on a screen the parent is looking at to tell them something
    // they did themselves a second ago on their phone.
    _reads ??= ref.read(notificationRepositoryProvider).reads.listen(_applyRead);
    ref.onDispose(() {
      _incoming?.cancel();
      _incoming = null;
      _reads?.cancel();
      _reads = null;
    });

    return _loadFirstPage(filter);
  }

  /// Apply a read that happened elsewhere to what is already on screen.
  void _applyRead(ReadSync read) {
    final current = state.value;
    if (current == null) return;

    var changed = false;
    final items = <AppNotification>[];
    for (final item in current.items) {
      if (item.isUnread && read.covers(item)) {
        changed = true;
        items.add(item.copyWith(readAt: read.readAt));
      } else {
        items.add(item);
      }
    }

    // The badge is invalidated even when no loaded row matched: the parent may
    // have read something further down their history than this page reaches,
    // and the count is the server's answer, not a sum over what is loaded.
    ref.invalidate(unreadCountsProvider);
    if (!changed) return;

    // The unread filter's contents change meaning when a row stops being
    // unread, so that one is refetched rather than left showing read rows.
    if (ref.read(notificationFilterProvider).unreadOnly) {
      unawaited(refresh());
      return;
    }
    state = AsyncData(current.copyWith(items: items));
  }

  Future<NotificationFeed> _loadFirstPage(NotificationFilter filter) async {
    try {
      final page = await ref.read(notificationRepositoryProvider).history(
            category: filter.category,
            unreadOnly: filter.unreadOnly,
          );
      _cursor = page.nextCursor;
      return NotificationFeed(items: page.items, hasMore: page.hasMore);
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }

  Future<void> refresh() async {
    _cursor = null;
    final filter = ref.read(notificationFilterProvider);
    state = await AsyncValue.guard(() => _loadFirstPage(filter));
  }

  /// Fetch the next page.
  ///
  /// Guarded against re-entry: a fast scroll fires the trigger several times,
  /// and without this the same page would be appended twice.
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    final cursor = _cursor;
    if (cursor == null) return;

    state = AsyncData(current.copyWith(isLoadingMore: true));
    final filter = ref.read(notificationFilterProvider);

    try {
      final page = await ref.read(notificationRepositoryProvider).history(
            category: filter.category,
            unreadOnly: filter.unreadOnly,
            cursor: cursor,
          );
      _cursor = page.nextCursor;
      state = AsyncData(
        NotificationFeed(
          items: [...current.items, ...page.items],
          hasMore: page.hasMore,
        ),
      );
    } catch (error) {
      // Keep what is already on screen. Losing a loaded page because the next
      // one failed is a worse outcome than a list that simply stops growing.
      state = AsyncData(current.copyWith(isLoadingMore: false));
      throw ErrorMapper.map(error);
    }
  }

  Future<void> markRead(String notificationId) async {
    final current = state.value;
    if (current == null) return;

    final target = current.items.where((n) => n.id == notificationId).firstOrNull;
    // Already read: the operation is idempotent, so there is nothing to show
    // and nothing to send.
    if (target == null || !target.isUnread) return;

    final now = DateTime.now();
    state = AsyncData(
      current.copyWith(
        items: [
          for (final n in current.items)
            n.id == notificationId ? n.copyWith(readAt: now) : n,
        ],
      ),
    );
    ref.invalidate(unreadCountsProvider);

    try {
      await ref.read(notificationRepositoryProvider).markRead(notificationId);
    } catch (error) {
      state = AsyncData(current);
      ref.invalidate(unreadCountsProvider);
      throw ErrorMapper.map(error);
    }
  }

  Future<void> markAllRead() async {
    final current = state.value;
    if (current == null) return;
    final filter = ref.read(notificationFilterProvider);

    final now = DateTime.now();
    state = AsyncData(
      current.copyWith(
        items: [for (final n in current.items) n.copyWith(readAt: n.readAt ?? now)],
      ),
    );
    ref.invalidate(unreadCountsProvider);

    try {
      await ref
          .read(notificationRepositoryProvider)
          .markAllRead(category: filter.category);
      // The unread filter's contents change meaning entirely once everything is
      // read, so it is refetched rather than patched.
      if (filter.unreadOnly) await refresh();
    } catch (error) {
      state = AsyncData(current);
      ref.invalidate(unreadCountsProvider);
      throw ErrorMapper.map(error);
    }
  }

  /// Report that a push was acted on. Best-effort: the server does not infer
  /// this state, but failing to report it must never block the navigation the
  /// parent actually asked for.
  Future<void> reportOpened(String notificationId) async {
    try {
      await ref.read(notificationRepositoryProvider).reportOpened(notificationId);
    } catch (_) {
      // Swallowed on purpose. An unreported open is a gap in analytics; a
      // failed tap is a broken app.
    }
  }
}

/// Retry is the container's, not this provider's.
///
/// `JawwidRetryPolicy` already answers "how does a failed provider recover" for
/// the whole app -- transient failures only, bounded attempts, exponential
/// backoff -- and it exists precisely because Riverpod's default retries a
/// policy refusal forever. A second policy here would be a second answer to a
/// question already answered, and the two would drift.
///
/// What that policy gives this screen is the behaviour it needs: a network blip
/// recovers silently, and a refusal or an exhausted budget settles into an error
/// the parent can act on with Try again and pull-to-refresh.
final notificationsControllerProvider =
    AsyncNotifierProvider<NotificationsController, NotificationFeed>(
  NotificationsController.new,
);

/// Every notification that arrives over realtime, wherever the parent is.
///
/// Deliberately NOT inside the centre's controller. That controller exists only
/// while the centre is on screen, so a subscription living there would mean the
/// badge on the Chats tab never moved for a parent who is reading their chats --
/// which is the most common place for them to be when a message arrives, and
/// exactly the case realtime is for.
final incomingNotificationProvider = StreamProvider<AppNotification>((ref) {
  return ref.watch(notificationRepositoryProvider).incoming;
});

/// Every read that happened on another of the parent's devices.
///
/// Always on, for the same reason [incomingNotificationProvider] is: a parent
/// clearing their tablet expects the phone in their pocket to agree, and the
/// phone is almost never sitting on the notification centre when they do it.
final readSyncProvider = StreamProvider<ReadSync>((ref) {
  return ref.watch(notificationRepositoryProvider).reads;
});

/// The badge.
///
/// From the server, never derived from the loaded page — a parent who has
/// scrolled one page would otherwise see a badge counting thirty out of four
/// hundred, and it would disagree with their other device.
final unreadCountsProvider = FutureProvider<UnreadCounts>((ref) async {
  // Recomputed whenever a notification arrives. Watching the stream rather than
  // waiting to be invalidated by a caller is what makes this hold no matter
  // which screen is open -- including none of the notification screens at all.
  ref.watch(incomingNotificationProvider);
  // ...and whenever one is read somewhere else, which is the same requirement
  // in the other direction: the badge has to go DOWN without this device
  // touching anything.
  ref.watch(readSyncProvider);

  try {
    return await ref.read(notificationRepositoryProvider).unreadCounts();
  } catch (_) {
    // A badge is not worth an error screen. Zero is wrong but harmless; the
    // centre itself reports the failure honestly.
    return UnreadCounts.empty;
  }
});

/// The number on the bell. Zero renders no badge at all rather than a "0".
final notificationUnreadProvider = Provider<int>(
  (ref) => ref.watch(unreadCountsProvider).value?.total ?? 0,
);
