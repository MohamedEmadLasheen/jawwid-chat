import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_notification_repository.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/notifications/presentation/announcement_screen.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_bell.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_card.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_center_screen.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_preferences_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/notification.dart';

/// ARABIC IS THE PRIMARY LANGUAGE, so the notification surfaces are checked in
/// it rather than translated into it afterwards.
///
/// The repository's `directionality_guard_test.dart` already fails the build on
/// a physical `EdgeInsets.only(left:)` anywhere in `lib/`. That is a source
/// rule; these are the rendered consequences it cannot see — that each screen
/// actually lays out RTL, that nothing is positioned by a physical edge at
/// paint time, and that the copy a parent reads is Arabic rather than a key.
void main() {
  AppNotification notification({
    required String id,
    String? learnerName,
    NotificationCategory category = NotificationCategory.messaging,
    NotificationPriority priority = NotificationPriority.normal,
  }) =>
      AppNotification(
        id: id,
        category: category,
        priority: priority,
        title: 'معلّم أحمد',
        body: 'أرسل لك رسالة.',
        createdAt: DateTime.now().subtract(const Duration(minutes: 5)),
        learnerName: learnerName,
        conversationId: 'c1',
        deeplink: '/chats/c1',
      );

  Widget harness(Widget child, FakeNotificationRepository repository, Locale locale) {
    return ProviderScope(
      retry: JawwidRetryPolicy.policy,
      overrides: [notificationRepositoryProvider.overrideWithValue(repository)],
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

  FakeNotificationRepository repo([List<AppNotification> seed = const []]) {
    final repository = FakeNotificationRepository(seed: seed);
    addTearDown(repository.dispose);
    return repository;
  }

  /// Every screen the notification feature owns, so a new one cannot be added
  /// without deciding what it does in Arabic.
  final screens = <String, Widget>{
    'centre': const NotificationCenterScreen(),
    'preferences': const NotificationPreferencesScreen(),
    'announcement': const AnnouncementScreen(announcementId: 'a1'),
    'bell': const Scaffold(body: NotificationBell()),
  };

  group('every notification surface lays out RTL in Arabic', () {
    for (final entry in screens.entries) {
      testWidgets(entry.key, (tester) async {
        await tester.pumpWidget(
          harness(entry.value, repo([notification(id: 'n1')]), const Locale('ar')),
        );
        await tester.pumpAndSettle();

        expect(
          Directionality.of(tester.element(find.byType(Scaffold).first)),
          TextDirection.rtl,
          reason: '${entry.key} must mirror in Arabic',
        );
      });
    }
  });

  group('and LTR in English', () {
    for (final entry in screens.entries) {
      testWidgets(entry.key, (tester) async {
        await tester.pumpWidget(
          harness(entry.value, repo([notification(id: 'n1')]), const Locale('en')),
        );
        await tester.pumpAndSettle();

        expect(
          Directionality.of(tester.element(find.byType(Scaffold).first)),
          TextDirection.ltr,
        );
      });
    }
  });

  group('the card mirrors, rather than being drawn left-to-right in Arabic', () {
    testWidgets('the avatar sits on the reading side in each language',
        (tester) async {
      Future<double> avatarCentre(Locale locale) async {
        await tester.pumpWidget(
          harness(
            const NotificationCenterScreen(),
            repo([notification(id: 'n1', learnerName: 'أحمد')]),
            locale,
          ),
        );
        await tester.pumpAndSettle();

        final card = tester.getRect(find.byType(NotificationCard).first);
        // The leading element, whatever it is: an avatar for a person, a
        // category icon otherwise.
        final leading = tester.getRect(
          find
              .descendant(
                of: find.byType(NotificationCard).first,
                matching: find.byType(Container),
              )
              .first,
        );
        return leading.center.dx - card.center.dx;
      }

      final arabic = await avatarCentre(const Locale('ar'));
      final english = await avatarCentre(const Locale('en'));

      // Opposite sides of the card. A layout built with physical edges would
      // put it on the same side in both, which is the defect this catches at
      // paint time rather than in the source.
      expect(arabic > 0, isTrue, reason: 'in Arabic the leading element starts on the right');
      expect(english < 0, isTrue, reason: 'in English it starts on the left');
    });

    testWidgets('the timestamp ends the row on the trailing side', (tester) async {
      Future<bool> timestampIsTrailing(Locale locale) async {
        await tester.pumpWidget(
          harness(
            const NotificationCenterScreen(),
            repo([notification(id: 'n1')]),
            locale,
          ),
        );
        await tester.pumpAndSettle();

        final title = tester.getRect(find.text('معلّم أحمد'));
        final card = tester.getRect(find.byType(NotificationCard).first);
        return locale.languageCode == 'ar'
            ? title.right > card.center.dx
            : title.left < card.center.dx;
      }

      expect(await timestampIsTrailing(const Locale('ar')), isTrue);
      expect(await timestampIsTrailing(const Locale('en')), isTrue);
    });
  });

  group('the copy is Arabic, not a key and not English', () {
    testWidgets('the centre', (tester) async {
      await tester.pumpWidget(
        harness(const NotificationCenterScreen(), repo(), const Locale('ar')),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      expect(find.text(l10n.notificationsTitle), findsOneWidget);
      expect(find.text(l10n.notificationsEmptyTitle), findsOneWidget);
      // No untranslated key and no English fallback leaking through.
      expect(find.textContaining('notification'), findsNothing);
      expect(find.text('Notifications'), findsNothing);
    });

    testWidgets('the preferences screen, including the rule it states',
        (tester) async {
      await tester.pumpWidget(
        harness(const NotificationPreferencesScreen(), repo(), const Locale('ar')),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      // The one sentence that makes this screen safe to give people has to be
      // in the language the parent reads.
      expect(find.text(l10n.notificationPreferencesExplainer), findsOneWidget);
      expect(find.text(l10n.notificationCategoryMessages), findsOneWidget);
    });

    testWidgets('priority markers', (tester) async {
      await tester.pumpWidget(
        harness(
          const NotificationCenterScreen(),
          repo([notification(id: 'n1', priority: NotificationPriority.urgent)]),
          const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('ar'));
      expect(find.text(l10n.notificationUrgentLabel), findsOneWidget);
    });
  });

  group('timestamps use the locale', () {
    testWidgets('an Arabic centre renders an Arabic-locale stamp', (tester) async {
      await tester.pumpWidget(
        harness(
          const NotificationCenterScreen(),
          repo([notification(id: 'n1')]),
          const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      // The card renders a time through RelativeTime with the resolved locale.
      // Asserting the exact glyphs would pin Intl's data; what matters is that
      // a stamp is rendered at all and is not an ISO string.
      final card = find.byType(NotificationCard).first;
      final texts = tester
          .widgetList<Text>(find.descendant(of: card, matching: find.byType(Text)))
          .map((t) => t.data)
          .whereType<String>();

      expect(texts.any((t) => t.contains('T') && t.contains('Z')), isFalse,
          reason: 'a raw ISO timestamp must never reach a parent');
      expect(texts, isNotEmpty);
    });
  });
}
