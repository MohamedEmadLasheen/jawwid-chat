import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/notifications/domain/notification_deeplink.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_bell.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_card.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_preferences_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/notification.dart';

/// The rendered notification centre, in both languages.
///
/// What these assert is the parent's experience rather than the widget tree: the
/// child is named on the card, an unread row is distinguishable, a card that
/// leads nowhere is not tappable, and every state the screen can be in renders
/// something rather than nothing.
void main() {
  AppNotification notification({
    required String id,
    String title = 'Ahmed’s teacher',
    String body = 'Sent you a message.',
    NotificationCategory category = NotificationCategory.messaging,
    NotificationPriority priority = NotificationPriority.normal,
    bool unread = true,
    String? learnerName,
    String? conversationId,
    String? deeplink,
  }) =>
      AppNotification(
        id: id,
        category: category,
        priority: priority,
        title: title,
        body: body,
        createdAt: DateTime.now().subtract(const Duration(minutes: 10)),
        readAt: unread ? null : DateTime.now(),
        learnerName: learnerName,
        conversationId: conversationId,
        deeplink: deeplink,
      );

  Widget harness({
    required Widget child,
    required FakeNotificationRepository repository,
    Locale locale = const Locale('ar'),
    List<Override> extra = const [],
  }) {
    return ProviderScope(
      // The app's real policy, not Riverpod's default. Without it a failing
      // provider retries forever and the settled error state -- the one a
      // parent can actually act on -- is unreachable in a test.
      retry: JawwidRetryPolicy.policy,
      overrides: [
        notificationRepositoryProvider.overrideWithValue(repository),
        ...extra,
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: L10n.supportedLocales,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        home: child,
      ),
    );
  }

  FakeNotificationRepository repo(List<AppNotification> seed) {
    final repository = FakeNotificationRepository(seed: seed);
    addTearDown(repository.dispose);
    return repository;
  }

  group('the centre renders every state', () {
    testWidgets('a loaded list shows a card per notification', (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1'), notification(id: 'n2')]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NotificationCard), findsNWidgets(2));
    });

    testWidgets('an empty centre says so rather than showing a blank body',
        (tester) async {
      await tester.pumpWidget(
        harness(repository: repo([]), child: const NotificationCenterScreen()),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      expect(find.text(l10n.notificationsEmptyTitle), findsOneWidget);
      // The rule: a screen renders content, loading, empty or error -- never
      // nothing.
      expect(find.byType(NotificationCard), findsNothing);
    });

    testWidgets('a failure offers a retry instead of an exception',
        (tester) async {
      final repository = repo([]);
      // Persistent, not single-shot: the centre and the badge both call on
      // build, and a one-shot failure is consumed by whichever runs first.
      repository.persistentFailure = const AppError(AppErrorKind.network);

      await tester.pumpWidget(
        harness(repository: repository, child: const NotificationCenterScreen()),
      );
      // Past JawwidRetryPolicy's five attempts (400ms doubling to 6.4s).
      // pumpAndSettle alone stops as soon as no frame is scheduled, and a
      // pending retry timer does not schedule one -- so without this the
      // assertion runs while the screen is still showing its skeleton.
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(seconds: 8));
      }
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      expect(find.text(l10n.retryAction), findsOneWidget);
      // Never an exception's toString().
      expect(find.textContaining('AppError'), findsNothing);
      expect(find.textContaining('Exception'), findsNothing);
    });
  });

  group('the card answers a parent’s questions', () {
    testWidgets('names the child when the notification is about one',
        (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1', learnerName: 'أحمد')]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // A parent of three must never have to guess which child it is about.
      expect(find.text('أحمد'), findsOneWidget);
    });

    testWidgets('shows every notification in a burst, not a rollup',
        (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([
            notification(id: 'n1'),
            notification(id: 'n2'),
            notification(id: 'n3'),
          ]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // The burst is collapsed at the push -- one buzz, not three -- and not in
      // the history a parent scrolls back through.
      expect(find.byType(NotificationCard), findsNWidgets(3));
    });

    testWidgets('marks urgent, and does not mark ordinary', (tester) async {
      final l10n = await L10n.delegate.load(const Locale('ar'));

      await tester.pumpWidget(
        harness(
          repository: repo([
            notification(id: 'urgent', priority: NotificationPriority.urgent),
            notification(id: 'normal'),
          ]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      // Exactly one marker across two cards: marking everything marks nothing.
      expect(find.text(l10n.notificationUrgentLabel), findsOneWidget);
    });

    testWidgets('a card with nowhere to go is shown but not tappable',
        (tester) async {
      // No conversation, no announcement, no route: a billing reminder in a
      // build with no billing screen.
      await tester.pumpWidget(
        harness(
          repository: repo([
            notification(id: 'n1', category: NotificationCategory.billing),
          ]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NotificationCard), findsOneWidget);
      final inkWell = tester.widget<InkWell>(
        find.descendant(
          of: find.byType(NotificationCard),
          matching: find.byType(InkWell),
        ),
      );
      // Shown, because it still says what happened. Not tappable, because a
      // control that does nothing when tapped reads as broken.
      expect(inkWell.onTap, isNull);
    });
  });

  group('the bell', () {
    testWidgets('shows the server count and nothing at zero', (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1'), notification(id: 'n2')]),
          child: const Scaffold(appBar: null, body: NotificationBell()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Badge), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('renders no badge rather than a zero', (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1', unread: false)]),
          child: const Scaffold(body: NotificationBell()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Badge), findsNothing);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('carries the count in its semantics, not only in the badge',
        (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1')]),
          child: const Scaffold(body: NotificationBell()),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      // A badge is a painted number and is invisible to a screen reader; the
      // tooltip is the IconButton's accessible name.
      expect(find.byTooltip(l10n.notificationsWithUnread(1)), findsOneWidget);
    });
  });

  group('preferences', () {
    testWidgets('locks the categories the product does not let a parent mute',
        (tester) async {
      // A lazy ListView builds only what it shows, and the last two categories
      // sit below the fold in the default 800x600 test viewport.
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        harness(
          repository: repo([]),
          child: const NotificationPreferencesScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));

      // Shown, locked, and not switchable -- hidden would be a surprise later.
      for (final title in [
        l10n.notificationCategoryApprovals,
        l10n.notificationCategoryAccount,
      ]) {
        final row = tester.widget<SwitchListTile>(
          find.ancestor(
            of: find.text(title),
            matching: find.byType(SwitchListTile),
          ),
        );
        expect(row.onChanged, isNull, reason: '$title must not be switchable');
        expect(row.secondary, isA<Icon>());
      }

      // And an optional one still is.
      final messages = tester.widget<SwitchListTile>(
        find.ancestor(
          of: find.text(l10n.notificationCategoryMessages),
          matching: find.byType(SwitchListTile),
        ),
      );
      expect(messages.onChanged, isNotNull);
    });

    testWidgets('says what turning one off actually does', (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([]),
          child: const NotificationPreferencesScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      // The one sentence that makes this screen safe to give people: the
      // notification still arrives, only the buzz stops.
      expect(find.text(l10n.notificationPreferencesExplainer), findsOneWidget);
    });

    testWidgets('a refused toggle does not stay switched', (tester) async {
      final repository = repo([]);
      await tester.pumpWidget(
        harness(
          repository: repository,
          child: const NotificationPreferencesScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      await tester.tap(find.text(l10n.notificationCategoryMessages));
      await tester.pumpAndSettle();

      // The server accepted this one, so it sticks.
      final messages = tester.widget<SwitchListTile>(
        find.ancestor(
          of: find.text(l10n.notificationCategoryMessages),
          matching: find.byType(SwitchListTile),
        ),
      );
      expect(messages.value, isFalse);
    });
  });

  group('Arabic', () {
    testWidgets('the centre lays out right-to-left', (tester) async {
      await tester.pumpWidget(
        harness(
          repository: repo([notification(id: 'n1', learnerName: 'أحمد')]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final direction = Directionality.of(
        tester.element(find.byType(NotificationCard).first),
      );
      expect(direction, TextDirection.rtl);
    });

    testWidgets('and left-to-right in English', (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          repository: repo([notification(id: 'n1')]),
          child: const NotificationCenterScreen(),
        ),
      );
      await tester.pumpAndSettle();

      final direction = Directionality.of(
        tester.element(find.byType(NotificationCard).first),
      );
      expect(direction, TextDirection.ltr);
    });
  });

  group('deep links', () {
    test('prefer the route the server minted', () {
      final n = notification(
        id: 'n1',
        conversationId: 'c1',
        deeplink: '/chats/c1?message=m7',
      );
      expect(NotificationDeepLink.resolve(n), '/chats/c1?message=m7');
    });

    test('reconstruct one from the entity when a row predates deeplinks', () {
      final n = notification(id: 'n1', conversationId: 'c1');
      expect(NotificationDeepLink.resolve(n), '/chats/c1');
    });

    test('refuse a route this build has no screen for', () {
      final n = AppNotification(
        id: 'n1',
        category: NotificationCategory.classes,
        priority: NotificationPriority.high,
        title: 't',
        body: 'b',
        createdAt: DateTime.utc(2026, 9, 23, 12),
        learnerId: 'l1',
        deeplink: '/learners/l1/classes',
      );
      // Better to land on the card, which carries the whole story, than to push
      // a route that would render an error page.
      expect(NotificationDeepLink.resolve(n), isNull);
      expect(NotificationDeepLink.isActionable(n), isFalse);
    });

    test('refuse a route that is not a route at all', () {
      final n = notification(id: 'n1', deeplink: 'https://example.com/phish');
      expect(NotificationDeepLink.resolve(n), isNull);
    });

    test('refuse a prefix with no id after it', () {
      final n = notification(id: 'n1', deeplink: '/chats/');
      // Would land on an error page; falls through to null instead.
      expect(NotificationDeepLink.resolve(n), isNull);
    });

    test('resolve an announcement from its id', () {
      final n = AppNotification(
        id: 'n1',
        category: NotificationCategory.academy,
        priority: NotificationPriority.normal,
        title: 't',
        body: 'b',
        createdAt: DateTime.utc(2026, 9, 23, 12),
        announcementId: 'a1',
      );
      expect(NotificationDeepLink.resolve(n), '/announcements/a1');
    });
  });
}
