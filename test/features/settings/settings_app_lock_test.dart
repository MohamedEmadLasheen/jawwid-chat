import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/domain/app_lock_settings.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-23: Settings → App lock.
void main() {
  late LockWorld world;
  late ProviderContainer container;

  Future<L10n> pumpSettings(
    WidgetTester tester, {
    bool available = true,
    Map<String, AppLockSettings>? prefs,
    UserRole role = UserRole.parent,
  }) async {
    world = LockWorld(
      role: role,
      storedSession: true,
      authenticator: FakeAuthenticator(available: available),
      store: InMemoryAppLockStore(prefs),
    );
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    container.listen(appLockControllerProvider, (_, _) {});
    await container.read(authControllerProvider.notifier).restore();

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const SettingsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // The list is lazy: bring the section on screen.
    await tester.scrollUntilVisible(find.byKey(const ValueKey('settings-app-lock')), 200);
    await tester.pumpAndSettle();
    return L10n.delegate.load(const Locale('en'));
  }

  SwitchListTile toggle(WidgetTester tester) =>
      tester.widget<SwitchListTile>(find.byKey(const ValueKey('settings-app-lock')));

  testWidgets('no biometrics and no passcode: disabled, with the reason', (tester) async {
    final l10n = await pumpSettings(tester, available: false);

    expect(toggle(tester).onChanged, isNull);
    expect(find.text(l10n.appLockUnavailable), findsOneWidget);
  });

  testWidgets('turning it on prompts, then offers the timeouts (1 minute by default)',
      (tester) async {
    await pumpSettings(tester);
    expect(toggle(tester).value, isFalse);
    expect(find.byKey(const ValueKey('settings-app-lock-1m')), findsNothing);

    world.authenticator.willAnswer(true);
    await tester.tap(find.byKey(const ValueKey('settings-app-lock')));
    await tester.pumpAndSettle();

    expect(world.authenticator.prompts, 1);
    expect(toggle(tester).value, isTrue);
    final oneMinute = tester.widget<RadioListTile<AppLockTimeout>>(
      find.byKey(const ValueKey('settings-app-lock-1m')),
    );
    expect(oneMinute.value, AppLockTimeout.oneMinute);
    expect(container.read(appLockControllerProvider).settings.timeout, AppLockTimeout.oneMinute);

    await tester.ensureVisible(find.byKey(const ValueKey('settings-app-lock-1h')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-app-lock-1h')));
    await tester.pumpAndSettle();
    expect(world.store.stored['u_parent']?.timeout, AppLockTimeout.oneHour);
  });

  testWidgets('staff (on by default) can turn it off', (tester) async {
    await pumpSettings(tester, role: UserRole.sales);
    expect(container.read(appLockControllerProvider).settings.enabled, isTrue);
    // A cold start with the lock on is locked; Settings is reached after unlocking.
    world.authenticator.willAnswer(true);
    await container.read(appLockControllerProvider.notifier).unlock(reason: 'r');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('settings-app-lock')));
    await tester.pumpAndSettle();

    expect(toggle(tester).value, isFalse);
    expect(world.store.stored['u_sales']?.enabled, isFalse);
  });
}
