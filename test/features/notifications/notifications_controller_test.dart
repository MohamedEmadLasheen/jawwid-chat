import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/notifications/application/notifications_controller.dart';
import 'package:jawwid_chat/shared/models/notification.dart';

/// The notification centre's behaviour, without a widget tree.
///
/// The properties under test are the ones a parent notices when they are wrong:
/// the badge counting the wrong thing, a page repeating itself, a tap that does
/// not stick, and a failed write that leaves the screen lying.
void main() {
  AppNotification notification({
    required String id,
    NotificationCategory category = NotificationCategory.messaging,
    bool unread = true,
    DateTime? createdAt,
    String? conversationId,
    String? learnerName,
  }) =>
      AppNotification(
        id: id,
        category: category,
        priority: NotificationPriority.normal,
        title: 'title-$id',
        body: 'body-$id',
        createdAt: createdAt ?? DateTime.utc(2026, 9, 23, 12),
        readAt: unread ? null : DateTime.utc(2026, 9, 23, 13),
        conversationId: conversationId,
        learnerName: learnerName,
        deeplink: conversationId == null ? null : '/chats/$conversationId',
      );

  ({ProviderContainer container, FakeNotificationRepository repository}) harness(
    List<AppNotification> seed,
  ) {
    final repository = FakeNotificationRepository(seed: seed);
    addTearDown(repository.dispose);

    final container = ProviderContainer(
      // The app's real policy, so these tests exercise what ships rather than
      // Riverpod's unbounded default.
      retry: JawwidRetryPolicy.policy,
      overrides: [notificationRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);

    return (container: container, repository: repository);
  }

  group('history', () {
    test('loads the first page newest first', () async {
      final h = harness([
        notification(id: 'older', createdAt: DateTime.utc(2026, 9, 1)),
        notification(id: 'newer', createdAt: DateTime.utc(2026, 9, 20)),
      ]);

      final feed = await h.container.read(notificationsControllerProvider.future);

      expect(feed.items.map((n) => n.id), ['newer', 'older']);
      expect(feed.hasMore, isFalse);
    });

    test('pages without repeating or skipping a row', () async {
      final h = harness([
        for (var i = 0; i < 70; i++)
          notification(
            id: 'n$i',
            // Descending, so the seeded order is already the display order.
            createdAt: DateTime.utc(2026, 9, 23).subtract(Duration(minutes: i)),
          ),
      ]);

      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);
      await controller.loadMore();
      await controller.loadMore();

      final feed = h.container.read(notificationsControllerProvider).value!;
      expect(feed.items, hasLength(70));
      expect(feed.items.map((n) => n.id).toSet(), hasLength(70));
      expect(feed.hasMore, isFalse);
    });

    test('does not load the same page twice when scrolled hard', () async {
      final h = harness([
        for (var i = 0; i < 70; i++)
          notification(
            id: 'n$i',
            createdAt: DateTime.utc(2026, 9, 23).subtract(Duration(minutes: i)),
          ),
      ]);

      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      // A fast scroll fires the trigger repeatedly. Without the re-entry guard
      // the same page appends twice and the list grows duplicates.
      await Future.wait([
        controller.loadMore(),
        controller.loadMore(),
        controller.loadMore(),
      ]);

      final feed = h.container.read(notificationsControllerProvider).value!;
      expect(feed.items.map((n) => n.id).toSet(), hasLength(feed.items.length));
    });

    test('keeps what is on screen when the next page fails', () async {
      final h = harness([
        for (var i = 0; i < 70; i++)
          notification(
            id: 'n$i',
            createdAt: DateTime.utc(2026, 9, 23).subtract(Duration(minutes: i)),
          ),
      ]);

      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      final first = await h.container.read(notificationsControllerProvider.future);

      h.repository.nextFailure = const AppError(AppErrorKind.network);
      await expectLater(controller.loadMore(), throwsA(isA<AppError>()));

      // Losing a loaded page because the next one failed is worse than a list
      // that simply stops growing.
      final feed = h.container.read(notificationsControllerProvider).value!;
      expect(feed.items, hasLength(first.items.length));
    });

    test('a category filter reloads from the top', () async {
      final h = harness([
        notification(id: 'm1'),
        notification(id: 'c1', category: NotificationCategory.classes),
      ]);

      await h.container.read(notificationsControllerProvider.future);
      h.container
          .read(notificationFilterProvider.notifier)
          .setCategory(NotificationCategory.classes);

      final feed = await h.container.read(notificationsControllerProvider.future);
      expect(feed.items.map((n) => n.id), ['c1']);
    });

    test('the unread filter hides what has been read', () async {
      final h = harness([
        notification(id: 'unread'),
        notification(id: 'read', unread: false),
      ]);

      await h.container.read(notificationsControllerProvider.future);
      h.container.read(notificationFilterProvider.notifier).setUnreadOnly(true);

      final feed = await h.container.read(notificationsControllerProvider.future);
      expect(feed.items.map((n) => n.id), ['unread']);
    });
  });

  group('unread counts', () {
    test('come from the server, not from the loaded page', () async {
      // 70 unread, of which only the first 30 are loaded. A client that summed
      // its own list would show 30.
      final h = harness([
        for (var i = 0; i < 70; i++)
          notification(
            id: 'n$i',
            createdAt: DateTime.utc(2026, 9, 23).subtract(Duration(minutes: i)),
          ),
      ]);

      final feed = await h.container.read(notificationsControllerProvider.future);
      final counts = await h.container.read(unreadCountsProvider.future);

      expect(feed.items, hasLength(30));
      expect(counts.total, 70);
    });

    test('break down by category', () async {
      final h = harness([
        notification(id: 'm1'),
        notification(id: 'm2'),
        notification(id: 'c1', category: NotificationCategory.classes),
      ]);

      final counts = await h.container.read(unreadCountsProvider.future);
      expect(counts.total, 3);
      expect(counts.forCategory(NotificationCategory.messaging), 2);
      expect(counts.forCategory(NotificationCategory.classes), 1);
      expect(counts.forCategory(NotificationCategory.calls), 0);
    });

    test('a failed count reads zero rather than breaking the bell', () async {
      final h = harness([notification(id: 'n1')]);
      h.repository.nextFailure = const AppError(AppErrorKind.network);

      final counts = await h.container.read(unreadCountsProvider.future);
      // Wrong, but harmless; the centre itself reports the failure honestly.
      expect(counts.total, 0);
    });
  });

  group('read state', () {
    test('marking read is optimistic and sticks', () async {
      final h = harness([notification(id: 'n1')]);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      await controller.markRead('n1');

      final feed = h.container.read(notificationsControllerProvider).value!;
      expect(feed.items.single.isUnread, isFalse);
      expect((await h.repository.byId('n1')).isUnread, isFalse);
    });

    test('marking read twice is a no-op, not an error', () async {
      final h = harness([notification(id: 'n1')]);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      await controller.markRead('n1');
      final firstReadAt =
          h.container.read(notificationsControllerProvider).value!.items.single.readAt;
      await controller.markRead('n1');

      expect(
        h.container.read(notificationsControllerProvider).value!.items.single.readAt,
        firstReadAt,
      );
    });

    test('rolls back when the server refuses', () async {
      final h = harness([notification(id: 'n1')]);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      h.repository.nextFailure = const AppError(AppErrorKind.network);
      await expectLater(controller.markRead('n1'), throwsA(isA<AppError>()));

      // A screen that shows read when the server does not is a screen that
      // lies; the badge and the row must agree.
      expect(
        h.container.read(notificationsControllerProvider).value!.items.single.isUnread,
        isTrue,
      );
    });

    test('mark all read clears every row', () async {
      final h = harness([
        notification(id: 'n1'),
        notification(id: 'n2', category: NotificationCategory.classes),
      ]);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      await controller.markAllRead();

      expect(
        h.container
            .read(notificationsControllerProvider)
            .value!
            .items
            .every((n) => !n.isUnread),
        isTrue,
      );
      expect((await h.repository.unreadCounts()).total, 0);
    });

    test('mark all read inside a filter only clears that category', () async {
      final h = harness([
        notification(id: 'm1'),
        notification(id: 'c1', category: NotificationCategory.classes),
      ]);
      h.container
          .read(notificationFilterProvider.notifier)
          .setCategory(NotificationCategory.messaging);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      await controller.markAllRead();

      final counts = await h.repository.unreadCounts();
      expect(counts.forCategory(NotificationCategory.messaging), 0);
      expect(counts.forCategory(NotificationCategory.classes), 1);
    });
  });

  group('realtime', () {
    test('a notification arriving refreshes the list and the badge', () async {
      final h = harness([notification(id: 'n1')]);
      await h.container.read(notificationsControllerProvider.future);
      await h.container.read(unreadCountsProvider.future);

      h.repository.deliver(
        notification(id: 'n2', createdAt: DateTime.utc(2026, 9, 24)),
      );
      // Let the subscription's refresh settle.
      await Future<void>.delayed(Duration.zero);
      await h.container.read(notificationsControllerProvider.future);

      final feed = h.container.read(notificationsControllerProvider).value!;
      expect(feed.items.map((n) => n.id), contains('n2'));
      expect((await h.container.read(unreadCountsProvider.future)).total, 2);
    });
  });

  group('reporting', () {
    test('an open is reported, and a failure never blocks the tap', () async {
      final h = harness([notification(id: 'n1')]);
      final controller =
          h.container.read(notificationsControllerProvider.notifier);
      await h.container.read(notificationsControllerProvider.future);

      await controller.reportOpened('n1');
      expect(h.repository.reportedOpened, contains('n1'));

      // Swallowed on purpose: an unreported open is a gap in analytics, a
      // failed tap is a broken app.
      h.repository.nextFailure = const AppError(AppErrorKind.network);
      await expectLater(controller.reportOpened('n1'), completes);
    });
  });
}
