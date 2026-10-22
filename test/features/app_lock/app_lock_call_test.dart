/// PD-23: a locked app still rings, and the call can be answered without unlocking.
///
/// The real wiring from `app.dart` -- `CallPresenter(child: AppLockGate(child: router))` --
/// with the REAL call controller fed `call.incoming` over the W2 socket seam, the real
/// router, and the real bypass provider (not an override). The lock is on and the session
/// is a cold start, so the app is locked when the call arrives.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_authenticator.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/domain/app_lock_settings.dart';
import 'package:jawwid_chat/features/app_lock/presentation/app_lock_gate.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/features/calls/presentation/call_presenter.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import '../calls/w7_call_fakes.dart';
import 'app_lock_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;
  late FakeAuthenticator authenticator;
  late L10n en;

  setUpAll(() async => en = await L10n.delegate.load(const Locale('en')));

  setUp(() {
    calls = FakeCalls();
    room = FakeRoom();
    socket = SpySocket();
    // Nobody passes the device check in this file: the app stays locked throughout.
    authenticator = FakeAuthenticator();
  });

  tearDown(() => socket.close());

  Finder lockScreen() => find.byKey(const ValueKey('app-lock-screen'));
  Finder protectedText() => find.text('a protected conversation');

  Widget harness() {
    final router = GoRouter(
      initialLocation: '/somewhere',
      routes: [
        GoRoute(
          path: '/somewhere',
          builder: (context, state) => const Scaffold(
            body: Center(child: Text('a protected conversation')),
          ),
        ),
        GoRoute(
          path: Routes.activeCall,
          builder: (context, state) => ActiveCallScreen(
            onLeave: () {
              if (context.canPop()) context.pop();
            },
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    return ProviderScope(
      overrides: [
        routerProvider.overrideWithValue(router),
        // Authenticated from the first build: a restored session, i.e. a cold start.
        authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(FakeMic()),
        audioRouteProvider.overrideWithValue(FakeAudioRoute()),
        appLockAuthenticatorProvider.overrideWithValue(authenticator),
        appLockStoreProvider.overrideWithValue(InMemoryAppLockStore({
          'account_1': const AppLockSettings(enabled: true, offerAnswered: true),
        })),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        // The order app.dart uses.
        builder: (context, child) => CallPresenter(
          child: AppLockGate(child: child ?? const SizedBox.shrink()),
        ),
      ),
    );
  }

  testWidgets('an incoming call is shown and answerable over a locked app', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(AppLockGate)));
    expect(container.read(appLockControllerProvider).phase, AppLockPhase.locked);
    expect(lockScreen(), findsOneWidget);
    expect(protectedText().hitTestable(), findsNothing);

    socket.emit(CallEventNames.incoming, Frames.incoming(initiatorName: 'Mrs. Fatima'));
    await tester.pumpAndSettle();

    // The call screen is on top and NOTHING covers it: it can be read and touched.
    expect(find.byType(ActiveCallScreen), findsOneWidget);
    expect(lockScreen(), findsNothing);
    expect(find.text('Mrs. Fatima').hitTestable(), findsOneWidget);
    // And it is answered -- without unlocking, and without another unlock prompt.
    final promptsBefore = authenticator.prompts;
    await tester.tap(find.text(en.callAccept).hitTestable());
    await tester.pumpAndSettle();
    expect(calls.acceptCalls, ['call_1']);
    expect(authenticator.prompts, promptsBefore);
    expect(find.byType(ActiveCallScreen), findsOneWidget);
    expect(lockScreen(), findsNothing);
    // The lock itself never lifted: it is only not drawn over the call.
    expect(container.read(appLockControllerProvider).phase, AppLockPhase.locked);
  });

  testWidgets('leaving the call screen brings the lock straight back', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    socket.emit(CallEventNames.incoming, Frames.incoming());
    await tester.pumpAndSettle();
    expect(lockScreen(), findsNothing);

    // Declined/ended by the server, then dismissed: back to what was underneath -- which is
    // the locked app, not the protected conversation.
    socket.emit(CallEventNames.ended, Frames.ended(outcome: 'declined'));
    await tester.pumpAndSettle();
    await tester.tap(find.text(en.closeAction));
    await tester.pumpAndSettle();

    expect(find.byType(ActiveCallScreen), findsNothing);
    expect(lockScreen(), findsOneWidget);
    expect(protectedText().hitTestable(), findsNothing);
  });
}
