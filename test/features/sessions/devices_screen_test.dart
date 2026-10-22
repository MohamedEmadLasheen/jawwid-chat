import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/sessions/application/account_sessions_controller.dart';
import 'package:jawwid_chat/features/sessions/data/account_sessions_repository.dart';
import 'package:jawwid_chat/features/sessions/domain/account_session.dart';
import 'package:jawwid_chat/features/sessions/presentation/devices_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-23: Settings → Devices & sessions.
void main() {
  final now = DateTime(2026, 10, 22, 12);
  late FakeAccountSessionsRepository repository;
  late FakeBackend backend;
  late InMemoryTokenStore tokens;
  late SpyAuthController auth;
  late ProviderContainer container;

  List<AccountSession> seed() => [
        // Deliberately out of order: the screen must still put this device first.
        AccountSession(
          id: 'web',
          current: false,
          platform: SessionPlatform.web,
          signedInAt: DateTime(2026, 10, 1),
          lastSeenAt: now.subtract(const Duration(days: 3)),
          expiresAt: DateTime(2026, 11, 1),
        ),
        AccountSession(
          id: 'me',
          current: true,
          platform: SessionPlatform.ios,
          deviceName: 'My iPhone',
          signedInAt: DateTime(2026, 10, 20),
          lastSeenAt: now,
          expiresAt: DateTime(2026, 11, 20),
        ),
        AccountSession(
          id: 'tablet',
          current: false,
          platform: SessionPlatform.android,
          signedInAt: DateTime(2026, 10, 5),
          lastSeenAt: now.subtract(const Duration(minutes: 5)),
          expiresAt: DateTime(2026, 11, 5),
        ),
      ];

  setUp(() async {
    repository = FakeAccountSessionsRepository(sessions: seed());
    backend = FakeBackend(role: UserRole.parent);
    tokens = InMemoryTokenStore();
    final authRepository = FakeAuthRepository(backend: backend, tokens: tokens);
    container = ProviderContainer(overrides: [
      tokenStoreProvider.overrideWithValue(tokens),
      authRepositoryProvider.overrideWithValue(authRepository),
      authControllerProvider.overrideWith(
        () => auth = SpyAuthController(repository: authRepository, tokens: tokens),
      ),
      accountSessionsRepositoryProvider.overrideWithValue(repository),
      devicesClockProvider.overrideWithValue(() => now),
    ]);
    await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
  });

  tearDown(() {
    container.dispose();
    backend.dispose();
  });

  Future<L10n> pumpScreen(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
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
          home: const DevicesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return L10n.delegate.load(locale);
  }

  testWidgets('this device first with its badge, then the most recently used', (tester) async {
    final l10n = await pumpScreen(tester);

    final rows = tester
        .widgetList<ListTile>(find.byWidgetPredicate(
          (w) => w is ListTile && w.key is ValueKey<String> &&
              (w.key! as ValueKey<String>).value.startsWith('session-'),
        ))
        .map((t) => (t.key! as ValueKey<String>).value)
        .toList();
    expect(rows, ['session-me', 'session-tablet', 'session-web']);

    expect(find.text('My iPhone'), findsOneWidget);
    expect(find.text(l10n.devicesPlatformAndroid), findsOneWidget, reason: 'no name: by platform');
    expect(find.text(l10n.devicesPlatformWeb), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('session-me')),
        matching: find.text(l10n.devicesThisDevice),
      ),
      findsOneWidget,
    );
    expect(find.textContaining(l10n.devicesLastActive(l10n.devicesMinutesAgo(5))), findsOneWidget);
    // The current device has no sign-out of its own; every other one does.
    expect(find.byKey(const ValueKey('session-sign-out-me')), findsNothing);
    expect(find.byKey(const ValueKey('session-sign-out-tablet')), findsOneWidget);
    expect(find.byKey(const ValueKey('devices-sign-out-others')), findsOneWidget);
  });

  testWidgets('signing out another device asks first, then calls the repository',
      (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.byKey(const ValueKey('session-sign-out-tablet')));
    await tester.pumpAndSettle();
    expect(repository.revoked, isEmpty, reason: 'nothing happens before the confirmation');

    await tester.tap(find.byKey(const ValueKey('devices-confirm')));
    await tester.pumpAndSettle();

    expect(repository.revoked, ['tablet']);
    expect(find.byKey(const ValueKey('session-tablet')), findsNothing);
    expect(container.read(authControllerProvider), isA<AuthAuthenticated>(),
        reason: 'another device signing out is not this one');
    expect(auth.signOuts, isEmpty);
  });

  testWidgets('cancelling the confirmation signs nobody out', (tester) async {
    final l10n = await pumpScreen(tester);

    await tester.tap(find.byKey(const ValueKey('session-sign-out-web')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10n.cancelAction));
    await tester.pumpAndSettle();

    expect(repository.revoked, isEmpty);
    expect(find.byKey(const ValueKey('session-web')), findsOneWidget);
  });

  testWidgets('sign out all other devices', (tester) async {
    final l10n = await pumpScreen(tester);

    await tester.tap(find.byKey(const ValueKey('devices-sign-out-others')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('devices-confirm')));
    await tester.pumpAndSettle();

    expect(repository.revokeOthersCalls, 1);
    expect(find.byKey(const ValueKey('session-me')), findsOneWidget);
    expect(find.byKey(const ValueKey('session-tablet')), findsNothing);
    expect(find.byKey(const ValueKey('session-web')), findsNothing);
    expect(find.text(l10n.devicesSignedOutOthers(2)), findsOneWidget);
    expect(find.byKey(const ValueKey('devices-sign-out-others')), findsNothing,
        reason: 'offered only while there is another session');
  });

  testWidgets('Arabic renders right to left', (tester) async {
    final ar = await pumpScreen(tester, locale: const Locale('ar'));

    expect(find.text(ar.settingsDevices), findsOneWidget);
    expect(ar.settingsDevices, 'الأجهزة والجلسات');
    expect(
      Directionality.of(tester.element(find.byKey(const ValueKey('session-me')))),
      TextDirection.rtl,
    );
  });

  test('revoking THIS device signs out through AuthController, server side already done',
      () async {
    final sub = container.listen(accountSessionsProvider, (_, _) {});
    addTearDown(sub.close);
    final sessions = await container.read(accountSessionsProvider.future);
    final me = sessions.firstWhere((s) => s.current);

    await container.read(accountSessionsProvider.notifier).revoke(me);

    expect(repository.revoked, ['me']);
    expect(auth.signOuts, [true]);
    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
    expect(await tokens.read(), isNull, reason: 'the local session is cleared');
  });
}
