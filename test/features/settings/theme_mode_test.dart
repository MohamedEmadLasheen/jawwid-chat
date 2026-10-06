import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

// Appearance: the preference, what it persists, and what the navigation bar
// does with it.
//
// The Settings screen itself is not pumped. `SettingsScreen` watches
// `authControllerProvider`, which throws until it is overridden, so rendering
// it would need a fake repository, a fake token store and a clear-local-data
// hook -- doubles that exercise the auth wiring rather than the appearance
// control. The labels are therefore proven through the generated localisations
// plus the screen's own source, and the behaviour through the controller.

ProviderContainer _container(ThemeModeStore store) {
  final c = ProviderContainer(
    overrides: [themeModeStoreProvider.overrideWithValue(store)],
  );
  addTearDown(c.dispose);
  return c;
}

/// Build the provider, keep it alive, and let the stored read land.
///
/// Hydration is deliberately asynchronous -- the first frame must not wait on
/// disk -- so a test that reads straight after construction is reading the
/// documented Auto default, not the stored value.
Future<ThemeMode> _settled(ProviderContainer c) async {
  final sub = c.listen(themeModeProvider, (_, _) {});
  addTearDown(sub.close);
  await Future<void>.delayed(const Duration(milliseconds: 20));
  return c.read(themeModeProvider);
}

void main() {
  group('the default is Auto, and nothing quietly changes that', () {
    test('a fresh install with no stored preference is Auto', () async {
      final c = _container(FakeThemeModeStore());
      expect(c.read(themeModeProvider), ThemeMode.system);
      expect(await _settled(c), ThemeMode.system);
    });

    test('unreadable storage still lands on Auto, not on a guess', () async {
      final c = _container(FakeThemeModeStore(readThrows: true));
      expect(await _settled(c), ThemeMode.system);
    });

    test('the very first frame is Auto, before any read completes', () {
      // Read synchronously: whatever is on disk, the value handed to the first
      // build must be Auto, or a stored Dark would flash Light (or worse).
      final c = _container(FakeThemeModeStore(stored: ThemeMode.dark));
      expect(c.read(themeModeProvider), ThemeMode.system);
    });
  });

  group('choosing a mode', () {
    test('Light applies Light and is written through', () async {
      final store = FakeThemeModeStore();
      final c = _container(store);
      await c.read(themeModeProvider.notifier).set(ThemeMode.light);
      expect(c.read(themeModeProvider), ThemeMode.light);
      expect(store.stored, ThemeMode.light);
      expect(store.writes, 1);
    });

    test('Dark applies Dark and is written through', () async {
      final store = FakeThemeModeStore();
      final c = _container(store);
      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      expect(c.read(themeModeProvider), ThemeMode.dark);
      expect(store.stored, ThemeMode.dark);
    });

    test('a failed write still applies for this session', () async {
      final store = _WriteFails();
      final c = _container(store);
      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      expect(c.read(themeModeProvider), ThemeMode.dark);
    });
  });

  group('the choice survives a restart', () {
    for (final mode in [ThemeMode.light, ThemeMode.dark, ThemeMode.system]) {
      test('a container built over stored $mode resolves to it', () async {
        final c = _container(FakeThemeModeStore(stored: mode));
        expect(await _settled(c), mode);
      });
    }
  });

  group('Auto follows the device; an explicit choice does not', () {
    Future<Brightness> rendered(WidgetTester tester, ThemeMode mode, Brightness platform) async {
      late Brightness seen;
      tester.platformDispatcher.platformBrightnessTestValue = platform;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.pumpWidget(MaterialApp(
        theme: JawwidTheme.light(isArabic: false),
        darkTheme: JawwidTheme.dark(isArabic: false),
        themeMode: mode,
        home: Builder(builder: (context) {
          seen = Theme.of(context).brightness;
          return const SizedBox.shrink();
        }),
      ));
      return seen;
    }

    testWidgets('Auto + device Light renders Light', (t) async {
      expect(await rendered(t, ThemeMode.system, Brightness.light), Brightness.light);
    });

    testWidgets('Auto + device Dark renders Dark', (t) async {
      expect(await rendered(t, ThemeMode.system, Brightness.dark), Brightness.dark);
    });

    testWidgets('explicit Light ignores a Dark device', (t) async {
      expect(await rendered(t, ThemeMode.light, Brightness.dark), Brightness.light);
    });

    testWidgets('explicit Dark ignores a Light device', (t) async {
      expect(await rendered(t, ThemeMode.dark, Brightness.light), Brightness.dark);
    });
  });

  group('the selected navigation icon is brand-tinted, never white', () {
    Color? icon(ThemeData t, {required bool selected}) => t
        .navigationBarTheme.iconTheme
        ?.resolve(selected ? {WidgetState.selected} : <WidgetState>{})
        ?.color;

    final light = JawwidTheme.light(isArabic: false);
    final dark = JawwidTheme.dark(isArabic: false);

    test('dark: the selected icon is the gold accent, not white', () {
      expect(icon(dark, selected: true), JawwidTokens.dark.colorAccent);
      expect(icon(dark, selected: true), isNot(const Color(0xFFFFFFFF)));
    });

    test('light: the selected icon is the brand teal, not white', () {
      // Gold measures 2.97:1 on the light indicator and misses the 3:1 bar, so
      // the pair is split exactly as the login lockup is.
      expect(icon(light, selected: true), JawwidTokens.light.colorBrandPrimary);
      expect(icon(light, selected: true), isNot(const Color(0xFFFFFFFF)));
    });

    test('unselected icons do not move in either theme', () {
      expect(icon(light, selected: false), JawwidTokens.light.colorTextSecondary);
      expect(icon(dark, selected: false), JawwidTokens.dark.colorTextSecondary);
    });

    test('the indicator behind it is unchanged', () {
      expect(light.navigationBarTheme.indicatorColor, JawwidTokens.light.colorBrandSubtle);
      expect(dark.navigationBarTheme.indicatorColor, JawwidTokens.dark.colorBrandSubtle);
    });

    test('it is one theme property, so all three destinations share it', () {
      // Chats, Calls and Settings are NavigationDestinations in one
      // NavigationBar; the colour comes from the theme, not from any one of
      // them, so there is no destination that can be left behind.
      final source = File('lib/app/shells/app_shell.dart').readAsStringSync();
      expect(source, isNot(contains('IconThemeData')));
      expect(source, isNot(contains('Color(0x')));
    });
  });

  group('the control is localised in both languages', () {
    test('English reads Appearance / Auto / Light / Dark', () async {
      final en = await L10n.delegate.load(const Locale('en'));
      expect(en.settingsAppearance, 'Appearance');
      expect(en.settingsAppearanceAuto, 'Auto');
      expect(en.settingsAppearanceLight, 'Light');
      expect(en.settingsAppearanceDark, 'Dark');
    });

    test('Arabic reads المظهر / تلقائي / الوضع الفاتح / الوضع الداكن', () async {
      final ar = await L10n.delegate.load(const Locale('ar'));
      expect(ar.settingsAppearance, 'المظهر');
      expect(ar.settingsAppearanceAuto, 'تلقائي');
      expect(ar.settingsAppearanceLight, 'الوضع الفاتح');
      expect(ar.settingsAppearanceDark, 'الوضع الداكن');
    });

    test('the screen renders all three options from localisations, not literals', () {
      final source =
          File('lib/features/settings/presentation/settings_screen.dart').readAsStringSync();
      expect(source, contains('l10n.settingsAppearance'));
      expect(source, contains('l10n.settingsAppearanceAuto'));
      expect(source, contains('l10n.settingsAppearanceLight'));
      expect(source, contains('l10n.settingsAppearanceDark'));
      // Auto must not borrow the Language section's "Follow device" wording.
      expect(source, isNot(contains('settingsLanguageSystem),\n                  title')));
    });
  });
}

class _WriteFails implements ThemeModeStore {
  @override
  Future<ThemeMode?> read() async => null;

  @override
  Future<void> write(ThemeMode mode) async => throw Exception('disk full');
}
