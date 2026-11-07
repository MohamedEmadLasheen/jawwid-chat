// P-5 (Apple 1.2 / 1.5): Settings carries "Help and support" and "Contact support" beside the
// privacy policy and the terms; a value that is not configured hides its row.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/legal/legal_links.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

void main() {
  Future<void> pumpSettings(WidgetTester tester, SupportContact support) async {
    final world = LockWorld(
      role: UserRole.parent,
      storedSession: true,
      authenticator: FakeAuthenticator(available: true),
      store: InMemoryAppLockStore(),
    );
    final container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      supportContactProvider.overrideWithValue(support),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    container.listen(appLockControllerProvider, (_, _) {});
    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpWidget(UncontrolledProviderScope(
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
    ));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Sign out'), 200);
    await tester.pumpAndSettle();
  }

  testWidgets('configured: both support rows are in Settings', (tester) async {
    await pumpSettings(tester, const SupportContact(url: 'https://jawwid.example.org/help', email: 'support@jawwid.example.org'));
    expect(find.byKey(const ValueKey('settings-support-help')), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-support-email')), findsOneWidget);
  });

  testWidgets('not configured: neither row is there', (tester) async {
    await pumpSettings(tester, const SupportContact(url: '', email: ''));
    expect(find.byKey(const ValueKey('settings-support-help')), findsNothing);
    expect(find.byKey(const ValueKey('settings-support-email')), findsNothing);
  });
}
