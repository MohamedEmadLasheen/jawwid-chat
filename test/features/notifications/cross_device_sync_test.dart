import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_connection.dart';
import 'package:jawwid_chat/features/notifications/application/notifications_controller.dart';
import 'package:jawwid_chat/shared/models/notification.dart';

/// TWO DEVICES, ONE PARENT.
///
/// A parent with a phone and a tablet is the normal case, not the exotic one:
/// the tablet lives at home and the phone is in their pocket. Both are signed
/// in, both are in the same actor room, and both show the same badge — so
/// clearing one and finding the other still showing "3" is the app telling
/// them, wrongly, that there is something left to read.
///
/// The requirement is BOTH directions and NO RESTART: an arrival raises the
/// count on both, and a read on either lowers it on the other, with nothing
/// reopened, refreshed or relaunched.
///
/// The two containers here are two devices. They share a repository the way two
/// devices share a server: what one writes, the other is told about over the
/// actor room. `readElsewhere` is that server round trip — it marks the rows
/// and publishes the event, in that order, exactly as the backend does.
void main() {
  AppNotification note(
    String id, {
    NotificationCategory category = NotificationCategory.messaging,
    String? conversationId = 'c1',
  }) =>
      AppNotification(
        id: id,
        category: category,
        priority: NotificationPriority.normal,
        title: 'Ahmed’s teacher',
        body: 'Sent you a message.',
        createdAt: DateTime.now(),
        readAt: null,
        conversationId: conversationId,
        deeplink: conversationId == null ? null : '/chats/$conversationId',
      );

  /// One device: its own container and its own subscriptions, over the shared
  /// repository.
  ProviderContainer device(FakeNotificationRepository repository) {
    final realtime = InertRealtimeClient();
    addTearDown(realtime.dispose);
    final container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        notificationRepositoryProvider.overrideWithValue(repository),
        realtimeClientProvider.overrideWithValue(realtime),
      ],
    );
    addTearDown(container.dispose);
    // The bell, mounted. Without a listener Riverpod pauses the provider and
    // the device would be asleep rather than merely idle.
    container.listen(notificationUnreadProvider, (_, _) {});
    return container;
  }

  /// Let the streams and the futures they trigger settle.
  Future<void> settle() async {
    for (var i = 0; i < 4; i += 1) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  FakeNotificationRepository sharedServer([List<AppNotification>? seed]) {
    final repository = FakeNotificationRepository(seed: seed);
    addTearDown(repository.dispose);
    return repository;
  }

  group('a read on one device reaches the other, with no restart', () {
    test('phone reads one; the tablet’s badge drops', () async {
      final server = sharedServer([note('n1'), note('n2')]);
      final tablet = device(server);
      expect((await tablet.read(unreadCountsProvider.future)).total, 2);

      // The parent taps the notification on their phone.
      server.readElsewhere(notificationId: 'n1');
      await settle();

      expect((await tablet.read(unreadCountsProvider.future)).total, 1);
      expect(tablet.read(notificationUnreadProvider), 1);
    });

    test('phone reads everything; the tablet clears', () async {
      final server = sharedServer([note('n1'), note('n2'), note('n3')]);
      final tablet = device(server);
      await tablet.read(unreadCountsProvider.future);

      server.readElsewhere(all: true);
      await settle();

      expect((await tablet.read(unreadCountsProvider.future)).total, 0);
    });

    test('a read scoped to one category leaves the others counted', () async {
      final server = sharedServer([
        note('n1'),
        note('n2', category: NotificationCategory.classes, conversationId: null),
      ]);
      final tablet = device(server);
      expect((await tablet.read(unreadCountsProvider.future)).total, 2);

      server.readElsewhere(all: true, category: NotificationCategory.messaging);
      await settle();

      final counts = await tablet.read(unreadCountsProvider.future);
      expect(counts.total, 1);
      expect(counts.byCategory[NotificationCategory.classes], 1);
    });

    test('opening a thread on the phone clears that thread on the tablet', () async {
      final server = sharedServer([
        note('n1', conversationId: 'c1'),
        note('n2', conversationId: 'c2'),
      ]);
      final tablet = device(server);
      expect((await tablet.read(unreadCountsProvider.future)).total, 2);

      // Opening a conversation reads its notifications -- one act, not two --
      // and that act has to travel too.
      server.readElsewhere(conversationId: 'c1');
      await settle();

      expect((await tablet.read(unreadCountsProvider.future)).total, 1);
    });

    test('an open centre on the tablet greys the row, without a refetch', () async {
      final server = sharedServer([note('n1'), note('n2')]);
      final tablet = device(server);
      // The centre is on screen.
      tablet.listen(notificationsControllerProvider, (_, _) {});
      await tablet.read(notificationsControllerProvider.future);

      server.readElsewhere(notificationId: 'n1');
      await settle();

      final items = tablet.read(notificationsControllerProvider).value!.items;
      // The row is read, in place. The list did not reorder, reload or lose
      // its scroll position to say so -- newest first, as the centre always is.
      expect(items.map((n) => n.id), ['n2', 'n1']);
      expect(items.firstWhere((n) => n.id == 'n1').isUnread, isFalse);
      expect(items.firstWhere((n) => n.id == 'n2').isUnread, isTrue);
    });
  });

  group('and in the other direction', () {
    test('the tablet reads; the server has it, so the phone agrees', () async {
      final server = sharedServer([note('n1'), note('n2')]);
      final tablet = device(server);
      final phone = device(server);
      await tablet.read(notificationsControllerProvider.future);
      expect((await phone.read(unreadCountsProvider.future)).total, 2);

      // A real read on the tablet, through the controller the UI uses.
      await tablet.read(notificationsControllerProvider.notifier).markRead('n1');
      await settle();

      // The phone's own count, refetched from the same server.
      phone.invalidate(unreadCountsProvider);
      expect((await phone.read(unreadCountsProvider.future)).total, 1);
    });

    test('an arrival raises the count on both devices at once', () async {
      final server = sharedServer();
      final tablet = device(server);
      final phone = device(server);
      expect((await tablet.read(unreadCountsProvider.future)).total, 0);
      expect((await phone.read(unreadCountsProvider.future)).total, 0);

      // One notification, published to the actor room both devices are in.
      server.deliver(note('n1'));
      await settle();

      expect((await tablet.read(unreadCountsProvider.future)).total, 1);
      expect((await phone.read(unreadCountsProvider.future)).total, 1);
    });

    test('a read arriving twice does not take the count below zero', () async {
      final server = sharedServer([note('n1')]);
      final tablet = device(server);
      await tablet.read(unreadCountsProvider.future);

      // Two devices reading the same row, or one device retrying. The server's
      // mark is idempotent and the count is the server's, so a repeat is a
      // no-op rather than an underflow.
      server.readElsewhere(notificationId: 'n1');
      server.readElsewhere(notificationId: 'n1');
      await settle();

      expect((await tablet.read(unreadCountsProvider.future)).total, 0);
    });
  });
}
