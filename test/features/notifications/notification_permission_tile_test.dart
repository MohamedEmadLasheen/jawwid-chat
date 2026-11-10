/// LR-11b, the screen half: the Settings row "Notifications on this device" in each
/// status, re-read when the app comes back to the foreground, and the first ask going
/// through #557's explanation dialog (the same one, never a second card or prompt).
///
/// The mapping and the tap's logic without a widget are
/// `test/core/push/notification_permission_test.dart`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/push/notification_permission.dart';
import 'package:jawwid_chat/core/push/push_permission_explainer.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/notifications/presentation/notification_permission_tile.dart';
import 'package:jawwid_chat/features/notifications/presentation/push_permission_explainer_host.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../../core/push/notification_permission_test.dart' show FakeNotificationPermission;
import '../../core/push/push_registration_test.dart' as h;
import '../app_lock/app_lock_fakes.dart';

void main() {
  late h.FakeTokens tokens;
  late FakeNotificationPermission platform;
  late FakePushExplainerStore store;
  late ProviderContainer container;

  final row = find.byKey(const ValueKey('settings-notification-permission'));
  final action = find.byKey(const ValueKey('settings-notification-permission-action'));
  final explainerDialog = find.byType(PushPermissionExplainerDialog);

  Widget app(Widget home, Locale locale) => UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: locale,
          theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: home,
        ),
      );

  Future<void> pump(
    WidgetTester tester,
    NotificationPermissionStatus status, {
    Locale locale = const Locale('en'),
  }) async {
    tokens = h.FakeTokens();
    platform = FakeNotificationPermission(status);
    store = FakePushExplainerStore();
    container = ProviderContainer(overrides: [
      pushTokensProvider.overrideWithValue(tokens),
      notificationPermissionPlatformProvider.overrideWithValue(platform),
      pushExplainerStoreProvider.overrideWithValue(store),
      pushExplainerClockProvider.overrideWithValue(() => DateTime.utc(2026, 3, 10, 12)),
    ]);
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    await tester.pumpWidget(
      app(const Scaffold(body: Column(children: [NotificationPermissionTile()])), locale),
    );
    await tester.pumpAndSettle();
  }

  Future<void> resume(WidgetTester tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
  }

  group('the row in each status', () {
    final cases = {
      NotificationPermissionStatus.granted: ('On', 'Open settings'),
      NotificationPermissionStatus.notDetermined: ('Off', 'Allow'),
      NotificationPermissionStatus.denied: ('Off', 'Allow'),
      NotificationPermissionStatus.blocked: ('Off', 'Open settings'),
    };
    for (final MapEntry(key: status, value: (state, label)) in cases.entries) {
      testWidgets('${status.name}: "$state", then "$label"', (tester) async {
        await pump(tester, status);

        expect(row, findsOneWidget);
        expect(find.text('Notifications on this device'), findsOneWidget);
        expect(find.descendant(of: row, matching: find.text(state)), findsOneWidget);
        expect(tester.widget<Text>(action).data, label);
      });
    }

    testWidgets('unknown: no On/Off, but Open settings still works', (tester) async {
      await pump(tester, NotificationPermissionStatus.unknown);

      expect(row, findsOneWidget);
      expect(tester.widget<ListTile>(row).subtitle, isNull);
      expect(tester.widget<Text>(action).data, 'Open settings');
      await tester.tap(row);
      await tester.pumpAndSettle();
      expect(platform.opens, 1);
    });

    testWidgets('no native side (the web portal): no row at all', (tester) async {
      await pump(tester, NotificationPermissionStatus.unsupported);

      expect(row, findsNothing);
    });

    testWidgets('Arabic: the row in Arabic', (tester) async {
      await pump(tester, NotificationPermissionStatus.blocked, locale: const Locale('ar'));

      expect(find.text('الإشعارات على هذا الجهاز'), findsOneWidget);
      expect(find.text('متوقفة'), findsOneWidget);
      expect(find.text('فتح الإعدادات'), findsOneWidget);
    });

    testWidgets('Arabic: On, and Allow', (tester) async {
      await pump(tester, NotificationPermissionStatus.granted, locale: const Locale('ar'));
      expect(find.text('مفعّلة'), findsOneWidget);

      platform.current = NotificationPermissionStatus.denied;
      await resume(tester);
      expect(find.text('السماح'), findsOneWidget);
    });
  });

  testWidgets('re-read on resume: turned on in the phone\'s Settings, the row says On', (tester) async {
    await pump(tester, NotificationPermissionStatus.blocked);
    expect(find.descendant(of: row, matching: find.text('Off')), findsOneWidget);
    final readsBefore = platform.reads;

    // The person opens Settings, turns notifications on, comes back.
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(platform.opens, 1);
    platform.current = NotificationPermissionStatus.granted;
    await resume(tester);

    expect(platform.reads, greaterThan(readsBefore));
    expect(find.descendant(of: row, matching: find.text('On')), findsOneWidget);
    expect(tester.widget<Text>(action).data, 'Open settings');
  });

  testWidgets('never asked: the first ask is #557\'s explanation, and Continue asks the OS once',
      (tester) async {
    await pump(tester, NotificationPermissionStatus.notDetermined);

    await tester.tap(row);
    await tester.pumpAndSettle();

    expect(explainerDialog, findsOneWidget, reason: 'the same explanation, not a new prompt');
    expect(find.text('Turn on notifications'), findsOneWidget);
    expect(tokens.starts, 0, reason: 'the system prompt never comes first');

    await tester.tap(find.byKey(const ValueKey('push-explainer-continue')));
    await tester.pumpAndSettle();

    expect(explainerDialog, findsNothing);
    expect(tokens.starts, 1);
    expect(store.hasContinued, isTrue);
  });

  testWidgets('never asked, Not now: the dialog closes and the OS is not asked', (tester) async {
    await pump(tester, NotificationPermissionStatus.notDetermined);

    await tester.tap(row);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('push-explainer-not-now')));
    await tester.pumpAndSettle();

    expect(explainerDialog, findsNothing);
    expect(tokens.starts, 0);
  });

  testWidgets('Android 13+, refused once: Allow asks the OS again, with no explanation and no '
      'other card', (tester) async {
    await pump(tester, NotificationPermissionStatus.denied);

    await tester.tap(row);
    await tester.pumpAndSettle();

    expect(explainerDialog, findsNothing);
    expect(find.byType(Dialog), findsNothing);
    expect(tokens.starts, 1);
    expect(platform.opens, 0);
  });

  testWidgets('mounting the row asks nothing: no explanation, no prompt (never on launch)',
      (tester) async {
    await pump(tester, NotificationPermissionStatus.notDetermined);
    await resume(tester);

    expect(explainerDialog, findsNothing);
    expect(tokens.starts, 0);
    expect(platform.opens, 0);
  });

  testWidgets('Settings shows the row, next to the in-app notification preferences', (tester) async {
    final world = LockWorld(role: UserRole.parent, storedSession: true);
    tokens = h.FakeTokens();
    platform = FakeNotificationPermission(NotificationPermissionStatus.granted);
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      pushTokensProvider.overrideWithValue(tokens),
      notificationPermissionPlatformProvider.overrideWithValue(platform),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    addTearDown(tokens.close);
    container.listen(appLockControllerProvider, (_, _) {});
    await container.read(authControllerProvider.notifier).restore();

    await tester.pumpWidget(app(const SettingsScreen(), const Locale('en')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(row, 200);
    await tester.pumpAndSettle();

    expect(row, findsOneWidget);
    expect(find.descendant(of: row, matching: find.text('On')), findsOneWidget);
  });
}
