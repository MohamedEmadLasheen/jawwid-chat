/// A call has to appear wherever the user is.
///
/// THE PROPERTY THIS FILE EXISTS FOR. An incoming call arrives while somebody is
/// reading a conversation, on a tab, or in Settings. If the thing that notices it
/// lived on one screen, a ringing phone would depend on which screen was mounted —
/// so [CallPresenter] wraps the whole router, and it is also what INSTANTIATES the
/// controller: a Riverpod provider is not built until something reads it, and
/// without this nothing would be subscribed to `call.incoming` at all.
///
/// ONE NAVIGATION, ONE POP. `call.declined` and `call.ended` are written in one
/// server transaction and can arrive in either order, so the push and the pop are
/// each guarded — a call cannot stack two screens, and two terminal events cannot
/// pop twice.
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
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/features/calls/presentation/call_presenter.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import 'w7_call_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;

  setUp(() {
    calls = FakeCalls();
    room = FakeRoom();
    socket = SpySocket();
  });

  tearDown(() => socket.close());

  /// A two-route app: somewhere to be, and the call screen.
  Widget harness() {
    final router = GoRouter(
      initialLocation: '/somewhere',
      routes: [
        GoRoute(
          path: '/somewhere',
          builder: (context, state) => const Scaffold(
            body: Center(child: Text('somewhere else entirely')),
          ),
        ),
        GoRoute(
          path: Routes.activeCall,
          builder: (context, state) => const ActiveCallScreen(),
        ),
      ],
    );
    addTearDown(router.dispose);

    return ProviderScope(
      overrides: [
        // The presenter reads the router from here, not from the context: it
        // wraps MaterialApp.router's builder, which is above the router's own
        // inherited scope.
        routerProvider.overrideWithValue(router),
        authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(FakeMic()),
        audioRouteProvider.overrideWithValue(FakeAudioRoute()),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) =>
            CallPresenter(child: child ?? const SizedBox.shrink()),
      ),
    );
  }

  testWidgets('an incoming call takes the screen from wherever the user was',
      (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();
    expect(find.text('somewhere else entirely'), findsOneWidget);
    expect(find.byType(ActiveCallScreen), findsNothing);

    socket.emit(
      CallEventNames.incoming,
      Frames.incoming(initiatorName: 'Mrs. Fatima'),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ActiveCallScreen), findsOneWidget);
    expect(find.text('Mrs. Fatima'), findsOneWidget);
  });

  testWidgets('a terminal call leaves the screen once, and returns',
      (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();
    socket.emit(CallEventNames.incoming, Frames.incoming());
    await tester.pumpAndSettle();
    expect(find.byType(ActiveCallScreen), findsOneWidget);

    // Declined, then ended — one server transaction, either order.
    socket.emit(CallEventNames.declined, Frames.participant());
    await tester.pumpAndSettle();
    socket.emit(CallEventNames.ended, Frames.ended(outcome: 'declined'));
    await tester.pumpAndSettle();

    // The call screen is still up: a terminal call shows its outcome until the
    // user dismisses it, rather than vanishing mid-sentence.
    expect(find.byType(ActiveCallScreen), findsOneWidget);

    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.tap(find.text(l10n.closeAction));
    await tester.pumpAndSettle();

    expect(find.byType(ActiveCallScreen), findsNothing);
    expect(
      find.text('somewhere else entirely'),
      findsOneWidget,
      reason: 'leaving a call returns to what was underneath',
    );
  });

  testWidgets('two incoming events for the same call push one screen',
      (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    socket.emit(CallEventNames.incoming, Frames.incoming());
    await tester.pumpAndSettle();
    socket.emit(CallEventNames.incoming, Frames.incoming());
    await tester.pumpAndSettle();

    expect(
      find.byType(ActiveCallScreen),
      findsOneWidget,
      reason: 'a duplicate delivery must not stack a second call screen',
    );
  });

  testWidgets('no call, no call screen', (tester) async {
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    // A frame the client cannot decode, and an event for nothing in particular.
    socket.emit('call.something_else', const {'callId': 'x'});
    await tester.pumpAndSettle();

    expect(find.byType(ActiveCallScreen), findsNothing);
    expect(find.text('somewhere else entirely'), findsOneWidget);
  });
}
