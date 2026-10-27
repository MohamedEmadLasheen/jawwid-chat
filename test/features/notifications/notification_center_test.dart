import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/realtime/chat_signal.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/notifications/application/notification_center_controller.dart';
import 'package:jawwid_chat/features/notifications/data/notifications_repository.dart';
import 'package:jawwid_chat/features/notifications/domain/inbox.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-34: the Notification Center and Settings → Notifications.
void main() {
  final now = DateTime(2026, 10, 26, 18);

  group('wire mapping', () {
    test('an entry missing its id, text or time is dropped, never shown invented', () {
      expect(HttpNotificationsRepository.entryFrom({'id': 'a', 'title': 't', 'body': 'b'}), isNull);
      expect(HttpNotificationsRepository.entryFrom({'title': 't', 'body': 'b', 'at': '2026-10-26T10:00:00Z'}), isNull);
      final e = HttpNotificationsRepository.entryFrom({
        'id': 'a',
        'category': 'lesson',
        'title': 'Lesson soon',
        'body': 'body',
        'at': '2026-10-26T10:00:00Z',
        'read': false,
        'count': 3,
        'action': {'kind': 'view_lesson', 'lessonId': 'l1', 'learnerId': 'c1'},
      })!;
      expect(e.action!.kind, InboxActionKind.viewLesson);
      expect(e.action!.learnerId, 'c1');
      expect(e.count, 3);
      // An action kind this build does not know is no button, not a guessed one.
      expect(
        HttpNotificationsRepository.entryFrom({
          'id': 'a', 'title': 't', 'body': 'b', 'at': '2026-10-26T10:00:00Z', 'action': {'kind': 'teleport'},
        })!.action,
        isNull,
      );
    });

    test('counts keep only the tabs this build knows, in the server\'s order', () {
      final c = HttpNotificationsRepository.countsFrom({
        'unread': 4,
        'perTab': {'all': 4, 'lessons': 1, 'mystery': 9},
        'tabs': ['all', 'unread', 'lessons', 'mystery'],
      });
      expect(c.unread, 4);
      expect(c.tabs, [InboxTab.all, InboxTab.unread, InboxTab.lessons]);
      expect(c.perTab[InboxTab.lessons], 1);
    });

    test('conversation.read is a conversation refetch (the badge clears on this device too)', () {
      final s = decodeChatSignal('conversation.read', {'conversationId': 'c1', 'actorId': 'me', 'lastReadSeq': '7'});
      expect(s!.kind, ChatSignalKind.conversationUpdated);
      expect(s.conversationId, 'c1');
    });
  });

  group('routeFor', () {
    test('each button leads to a screen this role has, or there is no button', () {
      const lesson = InboxAction(InboxActionKind.viewLesson, lessonId: 'l', learnerId: 'c');
      expect(routeFor(lesson, UserRole.parent), Routes.childSchedule('c'));
      expect(routeFor(lesson, UserRole.teacher), Routes.schedule);
      const pay = InboxAction(InboxActionKind.viewPayments);
      expect(routeFor(pay, UserRole.parent), Routes.myPayments);
      expect(routeFor(pay, UserRole.teacher), isNull);
      expect(routeFor(const InboxAction(InboxActionKind.openConversation), UserRole.parent), isNull);
      expect(
        routeFor(const InboxAction(InboxActionKind.openConversation, conversationId: 'x'), UserRole.parent),
        Routes.conversation('x'),
      );
    });
  });

  group('screens', () {
    late FakeNotificationsRepository repository;
    late FakeBackend backend;
    late ProviderContainer container;

    setUp(() async {
      repository = FakeNotificationsRepository(
        entries: [
          InboxEntry(
            id: 'n1',
            category: 'lesson',
            title: 'Lesson soon',
            body: "learner_m's lesson starts in 30 minutes, at 17:30.",
            at: now.subtract(const Duration(minutes: 3)),
            read: false,
            action: const InboxAction(InboxActionKind.viewLesson, lessonId: 'l1', learnerId: 'c1'),
          ),
          InboxEntry(
            id: 'n2',
            category: 'payment',
            title: 'Payment due',
            body: '200 AED is due on 2026-11-05.',
            at: now.subtract(const Duration(days: 2)),
            read: true,
            action: const InboxAction(InboxActionKind.viewPayments),
          ),
        ],
        tabs: const [InboxTab.all, InboxTab.unread, InboxTab.lessons, InboxTab.payments],
      );
      backend = FakeBackend(role: UserRole.parent);
      final tokens = InMemoryTokenStore();
      final authRepository = FakeAuthRepository(backend: backend, tokens: tokens);
      container = ProviderContainer(overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(authRepository),
        authControllerProvider.overrideWith(
          () => SpyAuthController(repository: authRepository, tokens: tokens),
        ),
        notificationsRepositoryProvider.overrideWithValue(repository),
        notificationsClockProvider.overrideWithValue(() => now),
      ]);
      await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    });

    tearDown(() {
      container.dispose();
      backend.dispose();
    });

    Future<List<String>> pump(WidgetTester tester, Widget home) async {
      final opened = <String>[];
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (_, _) => home),
        GoRoute(path: '/:a', builder: (_, state) {
          opened.add(state.uri.toString());
          return const SizedBox();
        }),
        GoRoute(path: '/:a/:b/:c', builder: (_, state) {
          opened.add(state.uri.toString());
          return const SizedBox();
        }),
      ]);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            locale: const Locale('en'),
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();
      return opened;
    }

    testWidgets('the Center shows the server\'s tabs and entries; the button records the tap and opens the screen',
        (tester) async {
      final opened = await pump(tester, const NotificationCenterScreen());
      expect(find.byKey(const ValueKey('notifications-tab-payments')), findsOneWidget);
      expect(find.byKey(const ValueKey('notifications-tab-action')), findsNothing);
      expect(find.text('Lesson soon'), findsOneWidget);
      expect(find.text('Payment due'), findsOneWidget);
      expect(container.read(inboxCountsProvider).value!.unread, 1);

      await tester.tap(find.byKey(const ValueKey('notification-action-n1')));
      await tester.pumpAndSettle();
      expect(repository.actedIds, ['n1']);
      expect(opened, [Routes.childSchedule('c1')]);
      expect(container.read(inboxCountsProvider).value!.unread, 0);
    });

    testWidgets('mark all as read clears the badge', (tester) async {
      await pump(tester, const NotificationCenterScreen());
      await tester.tap(find.byKey(const ValueKey('notifications-mark-all-read')));
      await tester.pumpAndSettle();
      expect(container.read(inboxCountsProvider).value!.unread, 0);
      expect(find.byKey(const ValueKey('notifications-mark-all-read')), findsNothing);
    });

    testWidgets('the bell shows the unread count', (tester) async {
      await pump(tester, const Scaffold(body: NotificationBell()));
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('settings: an operational kind is always on; a chat can be switched off', (tester) async {
      await pump(tester, const NotificationSettingsScreen());
      await tester.scrollUntilVisible(find.byKey(const ValueKey('notification-settings-category-conversation')), 200);
      final lesson = tester.widget<SwitchListTile>(find.byKey(const ValueKey('notification-settings-category-lesson')));
      expect(lesson.value, isTrue);
      expect(lesson.onChanged, isNull);

      await tester.tap(find.byKey(const ValueKey('notification-settings-category-conversation')));
      await tester.pumpAndSettle();
      final settings = await repository.settings();
      expect(settings.categories.firstWhere((c) => c.category == 'conversation').push, isFalse);
    });

    testWidgets('settings: names on the lock screen can be turned on', (tester) async {
      await pump(tester, const NotificationSettingsScreen());
      await tester.tap(find.byKey(const ValueKey('notification-settings-names')));
      await tester.pumpAndSettle();
      expect((await repository.settings()).showPreviews, isTrue);
    });
  });
}
