import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_connection.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/presentation/calls_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/notifications/application/notifications_controller.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_bell.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/notification.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../../support/auth_harness.dart';

/// THE BADGE IS INDEPENDENT OF THE NOTIFICATION SCREENS.
///
/// This was a real defect, not a hypothetical one. The realtime subscription
/// used to live inside the notification centre's controller, which exists only
/// while the centre is on screen — so the badge moved for a parent who happened
/// to be *looking at the notification centre*, and stayed frozen for a parent
/// who was reading their chats. That is the wrong way round: reading chats is
/// where a parent actually is when a teacher writes to them.
///
/// The subscription now lives on [incomingNotificationProvider], which is
/// always on. These tests hold that: the count advances with no notification
/// screen mounted, with no notification controller ever read, from every
/// destination in the shell, and it survives the centre being opened and
/// closed.
///
/// One thing stated plainly because it looks like a gap and is not: the bell is
/// mounted on Chats only. Calls and Settings have no bell — the shell's own tab
/// badge counts unread *chats*, which is a different number with a different
/// source (`totalUnreadProvider`). So "the badge on Calls" is not a thing that
/// exists; what must be true is that time spent on Calls or Settings does not
/// cost the parent a count, and that is what the last two tests assert.
void main() {
  AppNotification arrival(String id) => AppNotification(
        id: id,
        category: NotificationCategory.messaging,
        priority: NotificationPriority.normal,
        title: 'Ahmed’s teacher',
        body: 'Sent you a message.',
        createdAt: DateTime.now(),
        readAt: null,
        conversationId: 'c1',
        deeplink: '/chats/c1',
      );

  /// Scoped to the bell. A conversation row carries its own unread badge, and a
  /// bare `find.text('1')` would happily match that one instead.
  final bellBadge = find.descendant(
    of: find.byType(NotificationBell),
    matching: find.byType(Badge),
  );
  Finder bellCount(String count) => find.descendant(
        of: find.byType(NotificationBell),
        matching: find.text(count),
      );

  ({FakeNotificationRepository repository, Widget app, ValueNotifier<Widget> screen})
      shellHarness({UserRole role = UserRole.parent}) {
    final repository = FakeNotificationRepository();
    addTearDown(repository.dispose);
    final realtime = InertRealtimeClient();
    addTearDown(realtime.dispose);
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);

    // The destination the parent is standing on, swappable without tearing the
    // ProviderScope down -- which is the whole point: a rebuilt scope would
    // rebuild the providers too and prove nothing about them surviving.
    final screen = ValueNotifier<Widget>(const ChatsScreen());
    addTearDown(screen.dispose);

    final app = ProviderScope(
      retry: JawwidRetryPolicy.policy,
      overrides: <Override>[
        currentRoleProvider.overrideWithValue(role),
        notificationRepositoryProvider.overrideWithValue(repository),
        realtimeClientProvider.overrideWithValue(realtime),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        authControllerProvider.overrideWith(
          () => TestAuthController(initial: signedInParent),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('ar'),
        theme: JawwidTheme.light(isArabic: true),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: ValueListenableBuilder<Widget>(
          valueListenable: screen,
          builder: (context, child, _) => child,
        ),
      ),
    );

    return (repository: repository, app: app, screen: screen);
  }

  group('the badge does not depend on a notification screen existing', () {
    test('the count advances with no notification controller ever read', () async {
      final repository = FakeNotificationRepository();
      addTearDown(repository.dispose);
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

      // The bell's own subscription, and nothing else.
      // notificationsControllerProvider is never read, so the centre's
      // controller never exists -- which is the state of an app whose parent
      // has never opened the bell. (A listener is required, not incidental:
      // Riverpod pauses a provider nobody is watching, so `read` alone would
      // be testing a paused graph rather than a running app.)
      final seen = <int>[];
      container.listen(
        notificationUnreadProvider,
        (_, next) => seen.add(next),
      );
      expect((await container.read(unreadCountsProvider.future)).total, 0);

      repository.deliver(arrival('n1'));
      await Future<void>.delayed(Duration.zero);

      expect((await container.read(unreadCountsProvider.future)).total, 1);
      await Future<void>.delayed(Duration.zero);
      // The bell was told, rather than having to ask.
      expect(container.read(notificationUnreadProvider), 1);
      expect(seen, contains(1));
    });

    test('and keeps advancing after the centre is opened and closed', () async {
      final repository = FakeNotificationRepository();
      addTearDown(repository.dispose);
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
      // The bell, mounted throughout -- Chats is on screen behind everything.
      container.listen(notificationUnreadProvider, (_, _) {});
      await container.read(unreadCountsProvider.future);

      // Open the centre...
      final subscription = container.listen(
        notificationsControllerProvider,
        (_, _) {},
      );
      await container.read(notificationsControllerProvider.future);
      // ...and close it. The controller is disposed; the subscription that
      // feeds the badge must not have gone with it.
      subscription.close();
      await Future<void>.delayed(Duration.zero);

      repository.deliver(arrival('n1'));
      await Future<void>.delayed(Duration.zero);

      expect((await container.read(unreadCountsProvider.future)).total, 1);
    });
  });

  group('from every destination in the shell', () {
    testWidgets('on Chats, the bell moves with no interaction', (tester) async {
      final h = shellHarness();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();
      expect(find.byType(NotificationBell), findsOneWidget);
      expect(bellBadge, findsNothing);

      h.repository.deliver(arrival('n1'));
      await tester.pumpAndSettle();

      expect(bellCount('1'), findsOneWidget);
    });

    testWidgets('arriving while the parent is on Calls is not lost', (tester) async {
      final h = shellHarness();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.screen.value = const CallsScreen();
      await tester.pumpAndSettle();
      // No bell here. That is the design, not a bug -- so the count has to
      // survive somewhere other than the widget tree.
      expect(find.byType(NotificationBell), findsNothing);

      h.repository.deliver(arrival('n1'));
      h.repository.deliver(arrival('n2'));
      await tester.pumpAndSettle();

      h.screen.value = const ChatsScreen();
      await tester.pumpAndSettle();

      // Back on Chats: already correct, with no refresh, no pull-down and no
      // trip through the notification centre.
      expect(bellCount('2'), findsOneWidget);
    });

    testWidgets('arriving while the parent is on Settings is not lost', (tester) async {
      final h = shellHarness();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.screen.value = const SettingsScreen();
      await tester.pumpAndSettle();
      expect(find.byType(NotificationBell), findsNothing);

      h.repository.deliver(arrival('n1'));
      await tester.pumpAndSettle();

      h.screen.value = const ChatsScreen();
      await tester.pumpAndSettle();

      expect(bellCount('1'), findsOneWidget);
    });

    testWidgets('reading in the centre takes the badge back down again', (tester) async {
      final h = shellHarness();
      await tester.pumpWidget(h.app);
      await tester.pumpAndSettle();

      h.repository.deliver(arrival('n1'));
      await tester.pumpAndSettle();
      expect(bellCount('1'), findsOneWidget);

      h.screen.value = const NotificationCenterScreen();
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'تعليم الكل كمقروء'));
      await tester.pumpAndSettle();

      h.screen.value = const ChatsScreen();
      await tester.pumpAndSettle();

      // The badge is gone, not stuck at 1. The count is the server's, so this
      // also proves the mark-all round trip actually reached it.
      expect(bellBadge, findsNothing);
    });
  });
}
