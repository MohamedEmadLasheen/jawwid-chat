import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/data/device_security_settings.dart';
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
  late _FakeSecuritySettings security;

  /// The app around Settings, mounted again by [remount].
  Widget settingsApp() => UncontrolledProviderScope(
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
      );

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
    security = _FakeSecuritySettings();
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      deviceSecuritySettingsProvider.overrideWithValue(security),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    container.listen(appLockControllerProvider, (_, _) {});
    await container.read(authControllerProvider.notifier).restore();

    await tester.pumpWidget(settingsApp());
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
    // Flutter tests draw as Android unless told otherwise.
    expect(find.text(l10n.appLockUnavailable('android')), findsOneWidget);
  });

  // Redmi A5 QA, 2026-10-27: the person followed the hint, added a screen lock in the
  // phone's Settings, came back, and the switch was still disabled until a restart.
  group('the device lock is asked again', () {
    Future<void> leaveAndComeBack(WidgetTester tester) async {
      container.read(appLockControllerProvider.notifier)
        ..onLifecycle(AppLifecycleState.inactive)
        ..onLifecycle(AppLifecycleState.hidden)
        ..onLifecycle(AppLifecycleState.paused)
        ..onLifecycle(AppLifecycleState.hidden)
        ..onLifecycle(AppLifecycleState.inactive)
        ..onLifecycle(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
    }

    testWidgets('a screen lock added in the phone\'s Settings enables the switch on the way back',
        (tester) async {
      final l10n = await pumpSettings(tester, available: false);
      expect(toggle(tester).onChanged, isNull);
      expect(find.text(l10n.appLockUnavailable('android')), findsOneWidget);

      world.authenticator.available = true;
      await leaveAndComeBack(tester);

      expect(toggle(tester).onChanged, isNotNull);
      expect(find.text(l10n.appLockUnavailable('android')), findsNothing);
      expect(find.text(l10n.appLockToggleSubtitle), findsOneWidget);
    });

    testWidgets('a screen lock removed there disables it again, with the hint', (tester) async {
      final l10n = await pumpSettings(tester);
      expect(toggle(tester).onChanged, isNotNull);

      world.authenticator.available = false;
      await leaveAndComeBack(tester);

      expect(toggle(tester).onChanged, isNull);
      expect(toggle(tester).value, isFalse);
      expect(find.text(l10n.appLockUnavailable('android')), findsOneWidget);
    });

    testWidgets('opening Settings asks too, with no resume in between', (tester) async {
      await pumpSettings(tester, available: false);
      expect(toggle(tester).onChanged, isNull);

      world.authenticator.available = true;
      // Away to another tab and back: Settings is built afresh.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(settingsApp());
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const ValueKey('settings-app-lock')), 200);
      await tester.pumpAndSettle();

      expect(toggle(tester).onChanged, isNotNull);
    });
  });

  group('Open settings, beside the hint', () {
    const openSettings = ValueKey('settings-app-lock-open-settings');

    testWidgets('Android: offered when the device can authenticate nobody, and opens the phone\'s screen',
        (tester) async {
      await pumpSettings(tester, available: false);

      await tester.ensureVisible(find.byKey(openSettings));
      await tester.tap(find.byKey(openSettings));
      await tester.pumpAndSettle();

      expect(security.opened, 1);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));

    testWidgets('Android: not offered once the device can', (tester) async {
      await pumpSettings(tester);

      expect(find.byKey(openSettings), findsNothing);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));

    testWidgets('iOS: the hint alone (no public way into Face ID & Passcode)', (tester) async {
      final l10n = await pumpSettings(tester, available: false);

      expect(find.text(l10n.appLockUnavailable('other')), findsOneWidget);
      expect(find.byKey(openSettings), findsNothing);
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
  });

  test('the Android hint asks only for what an app can use: no weak face unlock', () async {
    for (final locale in const [Locale('en'), Locale('ar')]) {
      final l10n = await L10n.delegate.load(locale);
      final hint = l10n.appLockUnavailable('android');
      expect(hint, isNot(contains(locale.languageCode == 'en' ? 'face' : 'الوجه')), reason: '$locale');
      // Elsewhere face is offered only as "if supported".
      expect(l10n.appLockToggle('android'), contains(locale.languageCode == 'en' ? 'face (if supported)' : 'الوجه (إن كان مدعومًا)'));
    }
  });

  group('the unlock methods are named the way the platform names them', () {
    testWidgets('Android: fingerprint, face unlock, screen lock -- never Face ID', (tester) async {
      final l10n = await pumpSettings(tester);

      expect(find.text(l10n.appLockToggle('android')), findsOneWidget);
      expect(find.textContaining('Face ID'), findsNothing);
      expect(find.textContaining('passcode'), findsNothing);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));

    testWidgets('iOS: Face ID, fingerprint, passcode', (tester) async {
      final l10n = await pumpSettings(tester);

      expect(find.text(l10n.appLockToggle('other')), findsOneWidget);
      expect(find.textContaining('Face ID'), findsOneWidget);
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));

    test('both languages carry both wordings', () async {
      for (final locale in const [Locale('en'), Locale('ar')]) {
        final l10n = await L10n.delegate.load(locale);
        for (final message in [l10n.appLockToggle, l10n.appLockUnavailable, l10n.appLockOfferBody]) {
          expect(message('android'), isNot(message('other')), reason: '$locale');
        }
      }
      final en = await L10n.delegate.load(const Locale('en'));
      expect(en.appLockOfferBody('android'), isNot(contains('Face ID')));
      final ar = await L10n.delegate.load(const Locale('ar'));
      expect(ar.appLockToggle('android'), contains('قفل الشاشة'));
    });
  });

  testWidgets('turning it on prompts, then offers the timeouts (1 minute by default)',
      (tester) async {
    final l10n = await pumpSettings(tester);
    expect(toggle(tester).value, isFalse);
    expect(find.byKey(const ValueKey('settings-app-lock-1m')), findsNothing);

    world.authenticator.willAnswer(true);
    await tester.tap(find.byKey(const ValueKey('settings-app-lock')));
    await tester.pumpAndSettle();

    expect(world.authenticator.prompts, 1);
    expect(toggle(tester).value, isTrue);
    // The timeout is one row showing its value; the options open in a sheet.
    expect(find.text(l10n.appLockTimeoutOneMinute), findsOneWidget);
    await tester.ensureVisible(find.byKey(const ValueKey('settings-app-lock-timeout')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-app-lock-timeout')));
    await tester.pumpAndSettle();
    final oneMinute = tester.widget<RadioListTile<AppLockTimeout>>(
      find.byKey(const ValueKey('settings-app-lock-1m')),
    );
    expect(oneMinute.value, AppLockTimeout.oneMinute);
    expect(tester.widget<RadioGroup<AppLockTimeout>>(find.byType(RadioGroup<AppLockTimeout>)).groupValue, AppLockTimeout.oneMinute);
    expect(container.read(appLockControllerProvider).settings.timeout, AppLockTimeout.oneMinute);

    await tester.ensureVisible(find.byKey(const ValueKey('settings-app-lock-1h')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-app-lock-1h')));
    await tester.pumpAndSettle();
    expect(world.store.stored['u_parent']?.timeout, AppLockTimeout.oneHour);
    // Choosing closes the sheet, and the row now names the new value.
    expect(find.byType(RadioGroup<AppLockTimeout>), findsNothing);
    expect(find.text(l10n.appLockTimeoutOneHour), findsOneWidget);
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

  // Owner 2026-10-24: Language and Appearance are single rows naming the current
  // value; the options open in a sheet instead of filling the screen.
  testWidgets('Language and Appearance are one row each; a sheet holds the options', (tester) async {
    final l10n = await pumpSettings(tester);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('settings-language')), -200);
    await tester.pumpAndSettle();

    // No radio lists on the page itself.
    expect(find.byType(RadioListTile<String>), findsNothing);
    expect(find.byType(RadioListTile<ThemeMode>), findsNothing);
    final language = find.byKey(const ValueKey('settings-language'));
    expect(find.descendant(of: language, matching: find.text(l10n.settingsLanguage)), findsOneWidget);
    expect(find.descendant(of: language, matching: find.text(l10n.settingsLanguageSystem)), findsOneWidget);
    final appearance = find.byKey(const ValueKey('settings-appearance'));
    expect(find.descendant(of: appearance, matching: find.text(l10n.settingsAppearanceAuto)), findsOneWidget);

    await tester.tap(appearance);
    await tester.pumpAndSettle();
    expect(find.byType(RadioListTile<ThemeMode>), findsNWidgets(3));
    await tester.tap(find.text(l10n.settingsAppearanceDark));
    await tester.pumpAndSettle();
    expect(container.read(themeModeProvider), ThemeMode.dark);
    expect(find.byType(RadioListTile<ThemeMode>), findsNothing);
    expect(find.descendant(of: appearance, matching: find.text(l10n.settingsAppearanceDark)), findsOneWidget);

    await tester.tap(language);
    await tester.pumpAndSettle();
    expect(find.byType(RadioListTile<String>), findsNWidgets(3));
    await tester.tap(find.text(l10n.settingsLanguageArabic));
    await tester.pumpAndSettle();
    expect(container.read(localeOverrideProvider), const Locale('ar'));
  });
}

class _FakeSecuritySettings implements DeviceSecuritySettings {
  int opened = 0;

  @override
  Future<bool> open() async {
    opened++;
    return true;
  }
}
