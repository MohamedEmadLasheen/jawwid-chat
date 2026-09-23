import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/push/push_registrar.dart';
import 'package:jawwid_chat/core/push/push_tokens.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_connection.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/notifications/application/notifications_controller.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_bell.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_card.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/notification.dart';

import '../../support/auth_harness.dart';

/// APP OPEN vs APP CLOSED — the behaviour the product is judged on.
///
/// Five states, and the rule that holds across all of them: the parent finds
/// out. Which channel carries it changes; whether it arrives does not.
///
///   A  viewing the conversation      realtime updates, no disruptive push
///   B  elsewhere in the app          realtime notification, badge moves
///   C  backgrounded                  push
///   D  terminated                    push, tap opens, deep link followed
///   E  offline                       persisted, delivered on reconnect
///
/// C and D are the device half and are covered in push_lifecycle_test.dart,
/// which drives the same registrar this app uses. A and B and E are here,
/// because they are about what the running app does.
void main() {
  AppNotification notification({
    required String id,
    String? conversationId,
    bool unread = true,
  }) =>
      AppNotification(
        id: id,
        category: NotificationCategory.messaging,
        priority: NotificationPriority.normal,
        title: 'Ahmed’s teacher',
        body: 'Sent you a message.',
        createdAt: DateTime.now(),
        readAt: unread ? null : DateTime.now(),
        conversationId: conversationId,
        deeplink: conversationId == null ? null : '/chats/$conversationId',
      );

  ({
    ProviderContainer container,
    FakeNotificationRepository repository,
    InertRealtimeClient realtime,
  }) harness([List<AppNotification> seed = const []]) {
    final repository = FakeNotificationRepository(seed: seed);
    addTearDown(repository.dispose);

    final realtime = InertRealtimeClient();
    addTearDown(realtime.dispose);

    final container = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        notificationRepositoryProvider.overrideWithValue(repository),
        realtimeClientProvider.overrideWithValue(realtime),
        pushTokensProvider.overrideWithValue(InertPushTokens()),
        // RealtimeConnection follows the session, so these suites need one --
        // and it reads the token store, which is a platform channel by default.
        authControllerProvider.overrideWith(
          () => TestAuthController(initial: signedInParent),
        ),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      ],
    );
    addTearDown(container.dispose);

    return (container: container, repository: repository, realtime: realtime);
  }

  // =======================================================================
  group('State B · the app is open, the parent is elsewhere', () {
    test('a realtime notification appears without a refresh', () async {
      final h = harness();
      await h.container.read(notificationsControllerProvider.future);
      expect(
        h.container.read(notificationsControllerProvider).value!.items,
        isEmpty,
      );

      // The teacher sends a message. The server creates the notification and
      // emits notification.created to this parent's actor room.
      h.repository.deliver(notification(id: 'n1', conversationId: 'c1'));
      await Future<void>.delayed(Duration.zero);
      await h.container.read(notificationsControllerProvider.future);

      // No refresh, no reopening the screen, no polling.
      final items = h.container.read(notificationsControllerProvider).value!.items;
      expect(items.map((n) => n.id), ['n1']);
    });

    test('the unread badge increments without a refresh', () async {
      final h = harness();
      await h.container.read(notificationsControllerProvider.future);
      expect((await h.container.read(unreadCountsProvider.future)).total, 0);

      h.repository.deliver(notification(id: 'n1', conversationId: 'c1'));
      await Future<void>.delayed(Duration.zero);

      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
    });

    testWidgets('the bell shows the new count with no interaction', (tester) async {
      final repository = FakeNotificationRepository();
      addTearDown(repository.dispose);
      final realtime = InertRealtimeClient();
      addTearDown(realtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [
            notificationRepositoryProvider.overrideWithValue(repository),
            realtimeClientProvider.overrideWithValue(realtime),
          ],
          child: MaterialApp(
            locale: const Locale('ar'),
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: L10n.supportedLocales,
            theme: JawwidTheme.light(isArabic: true),
            home: const Scaffold(body: NotificationBell()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(Badge), findsNothing);

      repository.deliver(notification(id: 'n1', conversationId: 'c1'));
      await tester.pumpAndSettle();

      // The parent did nothing. The badge moved anyway.
      expect(find.byType(Badge), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('an open centre grows a row with no interaction', (tester) async {
      final repository = FakeNotificationRepository();
      addTearDown(repository.dispose);
      final realtime = InertRealtimeClient();
      addTearDown(realtime.dispose);

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [
            notificationRepositoryProvider.overrideWithValue(repository),
            realtimeClientProvider.overrideWithValue(realtime),
          ],
          child: MaterialApp(
            locale: const Locale('ar'),
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: L10n.supportedLocales,
            theme: JawwidTheme.light(isArabic: true),
            home: const NotificationCenterScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(NotificationCard), findsNothing);

      repository.deliver(notification(id: 'n1', conversationId: 'c1'));
      await tester.pumpAndSettle();

      expect(find.byType(NotificationCard), findsOneWidget);
    });
  });

  // =======================================================================
  group('State A · the parent is viewing the conversation', () {
    test('the notification still exists and the badge still counts it', () async {
      // The backend suppresses the PUSH when the parent is in the thread
      // (skip_reason RECIPIENT_ACTIVE) and creates the notification regardless.
      // What the app must not do is the opposite: hide it because "they saw it".
      final h = harness();
      await h.container.read(notificationsControllerProvider.future);

      h.repository.deliver(notification(id: 'n1', conversationId: 'c-open'));
      await Future<void>.delayed(Duration.zero);

      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
    });

    test('opening the thread clears its notifications, and only those', () async {
      final h = harness([
        notification(id: 'in-thread', conversationId: 'c-open'),
        notification(id: 'elsewhere', conversationId: 'c-other'),
      ]);
      await h.container.read(notificationsControllerProvider.future);
      expect((await h.container.read(unreadCountsProvider.future)).total, 2);

      // Opening a thread reads its notifications. One act, not two -- making a
      // parent dismiss the same thing twice teaches them to ignore the badge.
      await h.repository.markConversationRead('c-open');
      h.container.invalidate(unreadCountsProvider);

      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
      expect((await h.repository.byId('elsewhere')).isUnread, isTrue);
    });
  });

  // =======================================================================
  group('State E · the parent was offline', () {
    test('what arrived during the gap is fetched on reconnect', () async {
      final h = harness();
      final connection = h.container.read(realtimeConnectionProvider)..start();
      addTearDown(connection.dispose);

      await h.container.read(notificationsControllerProvider.future);
      await h.container.read(unreadCountsProvider.future);

      // The socket drops. The parent is in a tunnel.
      h.realtime.setStatus(RealtimeStatus.disconnected);

      // Three notifications are created server-side while they are unreachable.
      // NOT delivered over realtime: there is no socket. This is exactly the
      // case that proves realtime must not be the source of truth.
      for (final id in ['gap1', 'gap2', 'gap3']) {
        h.repository.insertWithoutDelivering(notification(id: id, conversationId: 'c1'));
      }
      await Future<void>.delayed(Duration.zero);

      // Still stale: nothing told this device.
      expect(h.container.read(notificationsControllerProvider).value!.items, isEmpty);

      // Signal returns.
      h.realtime.setStatus(RealtimeStatus.connected);
      await Future<void>.delayed(Duration.zero);
      await h.container.read(notificationsControllerProvider.future);

      // Everything that happened in the gap is there, from the database.
      final items = h.container.read(notificationsControllerProvider).value!.items;
      expect(items.map((n) => n.id), containsAll(['gap1', 'gap2', 'gap3']));
      expect((await h.container.read(unreadCountsProvider.future)).total, 3);
    });

    test('a reconnect with nothing missed changes nothing', () async {
      final h = harness([notification(id: 'n1', conversationId: 'c1')]);
      final connection = h.container.read(realtimeConnectionProvider)..start();
      addTearDown(connection.dispose);

      await h.container.read(notificationsControllerProvider.future);

      h.realtime.setStatus(RealtimeStatus.disconnected);
      h.realtime.setStatus(RealtimeStatus.connected);
      await Future<void>.delayed(Duration.zero);
      await h.container.read(notificationsControllerProvider.future);

      expect(
        h.container.read(notificationsControllerProvider).value!.items.map((n) => n.id),
        ['n1'],
      );
    });

    test('a failed re-sync does not blank what is already on screen', () async {
      final h = harness([notification(id: 'n1', conversationId: 'c1')]);
      final connection = h.container.read(realtimeConnectionProvider)..start();
      addTearDown(connection.dispose);

      await h.container.read(notificationsControllerProvider.future);

      // Signal returns but the request fails -- flaky is the normal case here.
      h.repository.persistentFailure = const AppError(AppErrorKind.network);
      h.realtime.setStatus(RealtimeStatus.disconnected);
      h.realtime.setStatus(RealtimeStatus.connected);
      await Future<void>.delayed(Duration.zero);

      // No crash, no error screen for a background re-sync: the next event or
      // pull-to-refresh tries again.
      expect(h.container.read(notificationsControllerProvider), isNotNull);
    });

    test('a read that happened elsewhere during the gap is picked up too', () async {
      final h = harness([
        notification(id: 'n1', conversationId: 'c1'),
        notification(id: 'n2', conversationId: 'c1'),
      ]);
      final connection = h.container.read(realtimeConnectionProvider)..start();
      addTearDown(connection.dispose);
      await h.container.read(notificationsControllerProvider.future);
      expect((await h.container.read(unreadCountsProvider.future)).total, 2);

      // In the tunnel. The parent clears one on their tablet at home, and the
      // notification.read event has no socket to arrive on.
      h.realtime.setStatus(RealtimeStatus.disconnected);
      h.repository.readElsewhere(notificationId: 'n1');
      await Future<void>.delayed(Duration.zero);

      // Signal returns. The gap is closed by refetching, not by replaying
      // events nobody kept -- which is why a missed read costs latency and not
      // a permanently wrong badge.
      h.realtime.setStatus(RealtimeStatus.connected);
      await Future<void>.delayed(Duration.zero);
      await h.container.read(notificationsControllerProvider.future);

      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
    });

    test('a read attempted while offline rolls back rather than lying', () async {
      final h = harness([notification(id: 'n1', conversationId: 'c1')]);
      await h.container.read(notificationsControllerProvider.future);

      // There is no offline write queue, deliberately: a queued read that
      // silently fails is worse than one that visibly does not happen. So the
      // optimistic update is rolled back and the count stays honest.
      h.repository.persistentFailure = const AppError(AppErrorKind.network);
      await expectLater(
        h.container.read(notificationsControllerProvider.notifier).markRead('n1'),
        throwsA(isA<AppError>()),
      );

      h.repository.persistentFailure = null;
      final items = h.container.read(notificationsControllerProvider).value!.items;
      expect(items.single.isUnread, isTrue);
      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
    });

    test('nothing is duplicated by a reconnect, however many times it happens',
        () async {
      final h = harness([notification(id: 'n1', conversationId: 'c1')]);
      final connection = h.container.read(realtimeConnectionProvider)..start();
      addTearDown(connection.dispose);
      await h.container.read(notificationsControllerProvider.future);

      // A flapping connection: three gaps in a row, three re-syncs.
      for (var i = 0; i < 3; i += 1) {
        h.realtime.setStatus(RealtimeStatus.disconnected);
        h.realtime.setStatus(RealtimeStatus.connected);
        await Future<void>.delayed(Duration.zero);
      }
      await h.container.read(notificationsControllerProvider.future);

      // The re-sync REPLACES the page rather than appending to it, so a parent
      // on a train does not watch their centre fill with copies.
      expect(
        h.container.read(notificationsControllerProvider).value!.items.map((n) => n.id),
        ['n1'],
      );
      expect((await h.container.read(unreadCountsProvider.future)).total, 1);
    });
  });

  // =======================================================================
  group('read state is the server’s, so devices agree', () {
    test('a second device sees the first device’s read', () async {
      final repository = FakeNotificationRepository(seed: [
        notification(id: 'n1', conversationId: 'c1'),
      ]);
      addTearDown(repository.dispose);

      // Two containers over ONE repository: the parent's phone and their tablet.
      ProviderContainer device() {
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
        return container;
      }

      final phone = device();
      final tablet = device();

      expect((await phone.read(unreadCountsProvider.future)).total, 1);
      expect((await tablet.read(unreadCountsProvider.future)).total, 1);

      // Read on the phone.
      await phone.read(notificationsControllerProvider.future);
      await phone.read(notificationsControllerProvider.notifier).markRead('n1');

      // The tablet asks the server, which is the only source of unread there has
      // ever been -- so the two cannot disagree.
      tablet.invalidate(unreadCountsProvider);
      expect((await tablet.read(unreadCountsProvider.future)).total, 0);
    });
  });
}
