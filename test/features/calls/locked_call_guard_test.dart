/// LR-46 P2-1: over the phone's lock screen, the app is the call and nothing else.
///
/// Android shows the app over the lock screen while a call from it rings or is in
/// progress. The call route sits on top of whatever was open, so without a guard Back,
/// Close or "Message" uncovered the chats on a locked phone. Here the phone's lock screen
/// is a fake [DeviceKeyguard] (the call channel's `isKeyguardLocked`,
/// `requestDismissKeyguard`, `returnToLockScreen`); the call controller, the presenter
/// and the call route are the real ones, wired as `router.dart` wires them.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/call_native/call_native_providers.dart';
import 'package:jawwid_chat/core/call_native/device_keyguard.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/features/calls/presentation/call_presenter.dart';
import 'package:jawwid_chat/features/calls/presentation/call_route_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import 'w7_call_fakes.dart';

/// The phone's lock screen. [grant] is what the person does at the unlock prompt.
class FakeKeyguard implements DeviceKeyguard {
  FakeKeyguard({required this.locked});

  bool locked;
  bool grant = false;
  int prompts = 0;
  int backToLockScreen = 0;

  /// The route on top when the unlock prompt was shown: the call's, if the guard asked first.
  final routesAtPrompt = <String?>[];
  GoRouter? router;

  /// Set to hold the next answer to [isLocked] until it is completed.
  Completer<bool>? hold;

  @override
  Future<bool> isLocked() async {
    final held = hold;
    if (held != null) {
      hold = null;
      return held.future;
    }
    return locked;
  }

  @override
  Future<bool> requestUnlock() async {
    prompts++;
    routesAtPrompt.add(router == null ? null : topRoutePath(router!));
    if (!locked) return true;
    if (grant) locked = false;
    return grant;
  }

  @override
  Future<void> returnToLockScreen() async => backToLockScreen++;
}

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;
  late FakeKeyguard keyguard;
  late GoRouter router;
  late L10n en;

  setUpAll(() async => en = await L10n.delegate.load(const Locale('en')));

  setUp(() {
    calls = FakeCalls();
    room = FakeRoom();
    socket = SpySocket();
  });

  tearDown(() => socket.close());

  Finder protectedChat() => find.text('a protected conversation');
  Finder cover() => find.byKey(const ValueKey('locked-call-cover'));
  Finder callScreen() => find.byType(ActiveCallScreen);

  Widget harness({required bool locked}) {
    keyguard = FakeKeyguard(locked: locked);
    router = GoRouter(
      initialLocation: '/somewhere',
      routes: [
        GoRoute(
          path: '/somewhere',
          builder: (context, state) => const Scaffold(
            body: Center(child: Text('a protected conversation')),
          ),
        ),
        GoRoute(
          path: '/chats/:id',
          builder: (context, state) => Scaffold(
            body: Center(
              child: Text(
                'chat ${state.pathParameters['id']} voice=${state.uri.queryParameters['voice'] == '1'}',
              ),
            ),
          ),
        ),
        // As router.dart builds it.
        GoRoute(
          path: Routes.activeCall,
          builder: (context, state) {
            final r = GoRouter.of(context);
            return CallRouteScreen(
              onLeave: () => leaveCallRoute(r),
              onOpenConversation: (conversationId, {required recordVoice}) =>
                  openConversationFromCall(r, conversationId, recordVoice: recordVoice),
            );
          },
        ),
      ],
    );
    keyguard.router = router;
    addTearDown(router.dispose);

    return ProviderScope(
      overrides: [
        routerProvider.overrideWithValue(router),
        authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(FakeMic()),
        audioRouteProvider.overrideWithValue(FakeAudioRoute()),
        deviceKeyguardProvider.overrideWithValue(keyguard),
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
        builder: (context, child) => CallPresenter(child: child ?? const SizedBox.shrink()),
      ),
    );
  }

  /// A call rings; its screen is pushed over the protected conversation.
  Future<void> ringing(WidgetTester tester, {required bool locked}) async {
    await tester.pumpWidget(harness(locked: locked));
    await tester.pumpAndSettle();
    socket.emit(CallEventNames.incoming, Frames.incoming(initiatorName: 'Mrs. Fatima'));
    await tester.pumpAndSettle();
    expect(callScreen(), findsOneWidget);
    expect(protectedChat(), findsNothing);
  }

  /// The call ends; its screen stays to show the outcome.
  Future<void> ended(WidgetTester tester) async {
    socket.emit(CallEventNames.ended, Frames.ended(outcome: 'missed'));
    await tester.pumpAndSettle();
    expect(callScreen(), findsOneWidget);
  }

  ProviderContainer container(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(CallPresenter)));

  group('unlocked phone: unchanged', () {
    testWidgets('Back leaves the call screen with no prompt', (tester) async {
      await ringing(tester, locked: false);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
      expect(keyguard.prompts, 0);
    });

    testWidgets('Close after the call returns to what was underneath, with no prompt', (tester) async {
      await ringing(tester, locked: false);
      await ended(tester);

      await tester.tap(find.text(en.closeAction));
      await tester.pumpAndSettle();

      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
      expect(keyguard.prompts, 0);
      expect(keyguard.backToLockScreen, 0);
    });

    testWidgets('Record voice message opens the conversation, with no prompt', (tester) async {
      await ringing(tester, locked: false);
      await ended(tester);

      await tester.tap(find.text(en.callRecordVoice));
      await tester.pumpAndSettle();

      expect(find.text('chat conv_1 voice=true'), findsOneWidget);
      expect(keyguard.prompts, 0);
    });
  });

  group('locked phone: the call and nothing else', () {
    testWidgets('Back asks to unlock first; cancelled, the call stays', (tester) async {
      await ringing(tester, locked: true);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 1);
      expect(keyguard.routesAtPrompt, [Routes.activeCall]);
      expect(callScreen(), findsOneWidget);
      expect(protectedChat(), findsNothing);
      expect(find.text('Mrs. Fatima').hitTestable(), findsOneWidget);
      // The call is still ringing: it is not sent behind the lock screen.
      expect(keyguard.backToLockScreen, 0);
    });

    testWidgets('Back, unlocked at the prompt, then leaves', (tester) async {
      await ringing(tester, locked: true);
      keyguard.grant = true;

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 1);
      expect(keyguard.routesAtPrompt, [Routes.activeCall]);
      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
      expect(cover(), findsNothing);
    });

    testWidgets('Record voice message asks to unlock first; cancelled, no conversation is shown', (tester) async {
      await ringing(tester, locked: true);
      await ended(tester);

      await tester.tap(find.text(en.callRecordVoice));
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 1);
      expect(keyguard.routesAtPrompt, [Routes.activeCall]);
      expect(find.textContaining('chat conv_1'), findsNothing);
      expect(protectedChat(), findsNothing);
      expect(callScreen(), findsOneWidget);
      // The call is over: the app goes behind the lock screen. (The guard and the presenter
      // may both ask; going behind it twice is the same as once.)
      expect(keyguard.backToLockScreen, isPositive);
    });

    testWidgets('Record voice message, unlocked at the prompt, opens the conversation', (tester) async {
      await ringing(tester, locked: true);
      await ended(tester);
      keyguard.grant = true;

      await tester.tap(find.text(en.callRecordVoice));
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 1);
      expect(keyguard.routesAtPrompt, [Routes.activeCall]);
      expect(find.text('chat conv_1 voice=true'), findsOneWidget);
      expect(callScreen(), findsNothing);
    });

    testWidgets('Close after the call asks to unlock; cancelled, the lock screen comes back', (tester) async {
      await ringing(tester, locked: true);
      await ended(tester);

      await tester.tap(find.text(en.closeAction));
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 1);
      expect(keyguard.routesAtPrompt, [Routes.activeCall]);
      expect(protectedChat(), findsNothing);
      expect(callScreen(), findsOneWidget);
      expect(keyguard.backToLockScreen, isPositive);
    });

    testWidgets('a call that ends while locked never shows the previous route', (tester) async {
      await ringing(tester, locked: true);
      await ended(tester);

      // The call screen goes idle without anyone leaving it (as on a dismiss elsewhere).
      container(tester).read(callControllerProvider.notifier).dismiss();
      await tester.pumpAndSettle();

      expect(protectedChat(), findsNothing);
      expect(keyguard.backToLockScreen, 1);
      expect(keyguard.prompts, 0);

      // Unlocked by the person later, and back in front: the finished call's route comes down.
      keyguard.locked = false;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
    });

    testWidgets('any other way off the call screen (a deep link) is covered and the call put back', (tester) async {
      await ringing(tester, locked: true);

      // Not through the call screen's own buttons: straight to the router. The phone's
      // answer is held, so the cover can be seen before the call is put back.
      final answer = Completer<bool>();
      keyguard.hold = answer;
      unawaited(router.push('/chats/c9'));
      await tester.pump();
      await tester.pump();

      expect(cover(), findsOneWidget);
      expect(find.text('chat c9 voice=false').hitTestable(), findsNothing);

      answer.complete(true);
      await tester.pumpAndSettle();

      expect(topRoutePath(router), Routes.activeCall);
      expect(cover(), findsNothing);
      expect(find.text('Mrs. Fatima').hitTestable(), findsOneWidget);
      expect(find.text('chat c9 voice=false'), findsNothing);
      expect(protectedChat(), findsNothing);
    });
  });
}
