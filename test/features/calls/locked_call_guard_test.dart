/// LR-46 P2-1: over the phone's lock screen, the app is the call and nothing else.
///
/// Android shows the app over the lock screen while a call from it rings or is in
/// progress. The call route sits on top of whatever was open, so without a guard Back,
/// Close or "Message" uncovered the chats on a locked phone. Here the phone's lock screen
/// is a fake [DeviceKeyguard] (the call channel's `isShownOverLockScreen`,
/// `requestDismissKeyguard`, `returnToLockScreen`); the call controller, the presenter
/// and the call route are the real ones, wired as `router.dart` wires them.
///
/// The fake's `locked` is what native answers: shown over the lock screen, which needs a
/// locked phone AND a call holding the lock screen (review of #561, P1). As on a device, it
/// turns false when the call ends (Dart sends `ongoingStop` and `dismiss`, and the lock
/// screen comes back at once) and when the person unlocks at the prompt (P2-2).
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
import 'package:jawwid_chat/features/calls/application/locked_call_guard.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/features/calls/presentation/call_presenter.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/calls/presentation/call_route_screen.dart';
import 'package:jawwid_chat/features/rewards/application/reward_feed.dart';
import 'package:jawwid_chat/features/rewards/presentation/reward_celebration.dart';
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

  /// Set to hold the next unlock prompt open until it is completed (true: unlocked).
  /// Never completed: Android never answers.
  Completer<bool>? holdUnlock;

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
    final held = holdUnlock;
    if (held != null) {
      holdUnlock = null;
      final unlocked = await held.future;
      if (unlocked) locked = false;
      return unlocked;
    }
    if (!locked) return true;
    if (grant) locked = false;
    return grant;
  }

  @override
  Future<void> returnToLockScreen() async => backToLockScreen++;
}

/// The app lock off: these tests are about the phone's lock screen, not the app's own.
class _AppLockOff extends AppLockController {
  @override
  AppLockState build() => const AppLockState(phase: AppLockPhase.unlocked);
}

class _Chime implements RewardChime {
  int plays = 0;
  @override
  Future<void> play(RewardCue cue) async => plays++;
}

class _SoundOn implements RewardSoundStore {
  @override
  Future<bool?> read() async => true;
  @override
  Future<void> write(bool on) async {}
}

/// `learner.reward_given`, as the server sends it to the family (PD-55).
Map<String, Object?> _star(int stars) => {
      'learnerId': 'learner-1',
      'lessonId': 'lesson-1',
      'eventId': 'event-$stars',
      'kind': 'star',
      'stickerKey': null,
      'praiseKey': null,
      'praiseText': null,
      'stars': stars,
      'badge': null,
      'nextBadgeAt': null,
    };

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;
  late FakeKeyguard keyguard;
  late GoRouter router;
  late L10n en;
  late _Chime chime;

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

  /// [rewards]: the reward celebration is mounted around the call presenter, as app.dart
  /// mounts it (PD-55), with reward sounds on.
  Widget harness({required bool locked, bool rewards = false}) {
    keyguard = FakeKeyguard(locked: locked);
    chime = _Chime();
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
        if (rewards) ...[
          appLockControllerProvider.overrideWith(_AppLockOff.new),
          rewardChimeProvider.overrideWithValue(chime),
          rewardSoundStoreProvider.overrideWithValue(_SoundOn()),
        ],
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
        builder: (context, child) {
          final presenter = CallPresenter(child: child ?? const SizedBox.shrink());
          return rewards ? RewardCelebrationHost(child: presenter) : presenter;
        },
      ),
    );
  }

  /// A call rings; its screen is pushed over the protected conversation.
  Future<void> ringing(WidgetTester tester, {required bool locked, bool rewards = false}) async {
    await tester.pumpWidget(harness(locked: locked, rewards: rewards));
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

  /// The call ends over the lock screen, as on a device (review of #561, P3-7): Dart sends
  /// `ongoingStop` and `dismiss`, so native no longer shows the app over the lock screen and
  /// the lock screen is back at once. The finished call's screen is what the person finds
  /// once they unlock.
  Future<void> endedOverLockScreen(WidgetTester tester) async {
    keyguard.locked = false;
    await ended(tester);
  }

  /// The app comes back to the front (the person unlocked, or woke the phone).
  Future<void> backInFront(WidgetTester tester) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
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

  group('no call over the lock screen: never covered', () {
    // Review of #561, P1. The phone was locked with no call, and is being unlocked; the app
    // resumes while Android may still say "locked". Native answers whether the app is SHOWN
    // over the lock screen, which needs a call holding it: no.
    testWidgets('back in front with no call: no cover, no prompt', (tester) async {
      await tester.pumpWidget(harness(locked: false));
      await tester.pumpAndSettle();

      await backInFront(tester);

      expect(cover(), findsNothing);
      expect(protectedChat().hitTestable(), findsOneWidget);
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

    // Review of #561, P3-7: once the call ends, Android stops showing the app over the lock
    // screen, so Close and Record voice message on the finished call are only reachable
    // after the person unlocks. Then they ask nothing.

    testWidgets('a call that ends over the lock screen: no prompt, nothing beneath is shown', (tester) async {
      await ringing(tester, locked: true);
      await endedOverLockScreen(tester);

      expect(protectedChat(), findsNothing);
      expect(cover(), findsNothing);
      expect(keyguard.prompts, 0);
    });

    testWidgets('after the call, once unlocked, Record voice message opens the conversation with no prompt',
        (tester) async {
      await ringing(tester, locked: true);
      await endedOverLockScreen(tester);
      // The person unlocks at the lock screen; the app comes back to the front.
      await backInFront(tester);

      await tester.tap(find.text(en.callRecordVoice));
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 0);
      expect(find.text('chat conv_1 voice=true'), findsOneWidget);
      expect(callScreen(), findsNothing);
    });

    testWidgets('after the call, Close asks native again rather than trust a stale "locked"', (tester) async {
      await ringing(tester, locked: true);
      await endedOverLockScreen(tester);

      // No resume check yet: the guard still remembers "locked", asks, and finds the app is
      // no longer over the lock screen. No prompt, and back to what was underneath.
      await tester.tap(find.text(en.closeAction));
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 0);
      expect(keyguard.backToLockScreen, 0);
      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
    });

    testWidgets('the call ends while the unlock prompt is up; cancelled, the app goes behind the lock screen',
        (tester) async {
      await ringing(tester, locked: true);
      final prompt = Completer<bool>();
      keyguard.holdUnlock = prompt;

      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(keyguard.prompts, 1);

      await endedOverLockScreen(tester);
      prompt.complete(false);
      await tester.pumpAndSettle();

      // The call is over: nothing left on the call screen, so the lock screen comes back.
      expect(keyguard.backToLockScreen, 1);
      expect(protectedChat(), findsNothing);
      expect(callScreen(), findsOneWidget);
    });

    testWidgets('a call that goes idle while still over the lock screen never shows the previous route',
        (tester) async {
      await ringing(tester, locked: true);
      await ended(tester);

      // Native still answers "over the lock screen" (defensive: its dismiss not processed
      // yet) as the call screen goes idle without anyone leaving it.
      container(tester).read(callControllerProvider.notifier).dismiss();
      await tester.pumpAndSettle();

      expect(protectedChat(), findsNothing);
      expect(keyguard.backToLockScreen, 1);
      expect(keyguard.prompts, 0);

      // Unlocked by the person later, and back in front: the finished call's route comes down.
      keyguard.locked = false;
      await backInFront(tester);

      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
    });

    testWidgets('an unlock prompt Android never answers gives up after a minute: Back works again',
        (tester) async {
      await ringing(tester, locked: true);
      // Review of #561, P3-5: never completed.
      keyguard.holdUnlock = Completer<bool>();
      final guard = container(tester).read(lockedCallGuardProvider.notifier);

      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(keyguard.prompts, 1);
      expect(guard.leaving, isTrue);

      await tester.pump(const Duration(seconds: 61));

      // Given up: "not unlocked", so the call screen stays and nothing beneath shows.
      expect(guard.leaving, isFalse);
      expect(callScreen(), findsOneWidget);
      expect(protectedChat(), findsNothing);

      // And the guard is usable again.
      keyguard.grant = true;
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(keyguard.prompts, 2);
      expect(callScreen(), findsNothing);
      expect(protectedChat(), findsOneWidget);
    });

    testWidgets('a route pushed while the unlock prompt is up: cancelled, the call is put back', (tester) async {
      await ringing(tester, locked: true);
      final prompt = Completer<bool>();
      keyguard.holdUnlock = prompt;

      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(keyguard.prompts, 1);

      // Review of #561, P3-6: a deep link lands while the prompt is up.
      unawaited(router.push('/chats/c9'));
      await tester.pump();
      await tester.pump();
      expect(cover(), findsOneWidget);
      // Still waiting on the prompt: nothing put back yet.
      expect(topRoutePath(router), '/chats/c9');

      prompt.complete(false);
      await tester.pumpAndSettle();

      // The put-back waited for the prompt instead of giving up: the live call is on top
      // again, its controls reachable, and the cover gone.
      expect(topRoutePath(router), Routes.activeCall);
      expect(cover(), findsNothing);
      expect(find.text('Mrs. Fatima').hitTestable(), findsOneWidget);
      expect(find.text('chat c9 voice=false'), findsNothing);
      expect(protectedChat(), findsNothing);
    });

    testWidgets('any other way off the call screen (a deep link) is covered and the call put back', (tester) async {
      await ringing(tester, locked: true);

      // Not through the call screen's own buttons: straight to the router. The phone's
      // answer is held, so the cover can be seen before the call is put back.
      final answer = Completer<bool>();
      keyguard.hold = answer;
      unawaited(router.push('/chats/c9'));
      // Review of #561, P3-8: ONE frame. The first frame with the pushed route already
      // has the cover over it; no frame shows the route uncovered.
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

  // LR-46 (#561 review, P3-9): the reward celebration plays over everything, a call included
  // (PD-55), so it sits above the call presenter -- and over the lock screen it would draw
  // app content over the call screen and over the cover.
  group('a reward\'s celebration and the lock screen', () {
    Finder celebration() => find.byKey(const ValueKey('reward-celebration'));

    testWidgets('unlocked: it plays over the call screen, as before', (tester) async {
      await ringing(tester, locked: false, rewards: true);

      socket.emit(rewardGivenEvent, _star(3));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(celebration(), findsOneWidget);
      expect(find.text(en.rewardStarLine(3)), findsOneWidget);
      expect(callScreen(), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      expect(celebration(), findsNothing);
      expect(chime.plays, 1);
    });

    testWidgets('over the lock screen: nothing drawn over the call or the cover; it plays once unlocked and back',
        (tester) async {
      await ringing(tester, locked: true, rewards: true);
      expect(container(tester).read(lockedCallGuardProvider), isTrue);

      socket.emit(rewardGivenEvent, _star(3));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(celebration(), findsNothing);
      expect(find.text(en.rewardStarLine(3)), findsNothing);

      // Off the call screen another way: the cover, and still nothing over it.
      final answer = Completer<bool>();
      keyguard.hold = answer;
      unawaited(router.push('/chats/c9'));
      await tester.pump();
      expect(cover(), findsOneWidget);
      expect(celebration(), findsNothing);
      answer.complete(true);
      await tester.pumpAndSettle();
      expect(topRoutePath(router), Routes.activeCall);
      expect(celebration(), findsNothing);
      expect(chime.plays, 0, reason: 'nothing heard over the lock screen');

      // The person unlocks; the app comes back to the front.
      keyguard.locked = false;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(container(tester).read(lockedCallGuardProvider), isFalse);
      expect(celebration(), findsOneWidget);
      expect(find.text(en.rewardStarLine(3)), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      expect(celebration(), findsNothing);
      expect(chime.plays, 1);
    });
  });
}
