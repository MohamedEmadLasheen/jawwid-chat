/// LR-26: a refused microphone never dead-ends a call.
///
/// The `record` plugin answers one boolean, so "refused once" and "refused for
/// good" (the state only the Settings app can undo) look the same here -- see
/// `MicrophonePermission`. Both are therefore handled the same way: explain,
/// offer Settings where the platform can open it, and let the person try again.
/// "Permanently denied" below is a microphone that keeps saying no.
///
/// WHAT IS PROVEN:
///   * the microphone is asked BEFORE dialling and BEFORE answering, so a
///     refusal rings nobody and accepts nothing on the server;
///   * after a refusal the screen says what to do and offers Settings;
///   * with the microphone allowed WITHOUT THE APP RESTARTING (Android, or a
///     permission granted from inside the app), Try again answers / places /
///     rejoins the SAME call rather than a new one;
///   * a call answered on another of this account's devices while this one
///     was parked by the microphone ends here as answered elsewhere, and Try
///     again then does nothing to the server;
///   * the parked answer is forgotten when that call ends or is closed, so a
///     later Try again on the same call never hangs at Connecting.
///
/// NOT MODELLED: iOS terminates the app when a permission is changed in
/// Settings, so on iOS there is no call state to come back to. That path is
/// a device check (`docs/qa/submission-device-test-plan.md`, SB-38), and the
/// copy only promises "then try the call again".
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/call_media/microphone_permission.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/data/scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import 'calls_page_fakes.dart';
import 'w7_call_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late FakeMic mic;
  late FakeMicrophoneSettings settings;
  late SpySocket socket;
  late RecordingScheduled scheduled;

  List<Override> overrides({bool settingsCanOpen = true}) {
    calls = FakeCalls();
    room = FakeRoom();
    mic = FakeMic();
    settings = FakeMicrophoneSettings(canOpen: settingsCanOpen);
    socket = SpySocket();
    scheduled = RecordingScheduled();
    addTearDown(socket.close);
    return [
      authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
      callRepositoryProvider.overrideWithValue(calls),
      scheduledCallRepositoryProvider.overrideWithValue(scheduled),
      realtimeSocketProvider.overrideWithValue(socket),
      realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
      mediaRoomFactoryProvider.overrideWithValue(() => room),
      microphonePermissionProvider.overrideWithValue(mic),
      microphoneSettingsProvider.overrideWithValue(settings),
      audioRouteProvider.overrideWithValue(FakeAudioRoute()),
    ];
  }

  // =======================================================================
  group('LR-26 controller', () {
    late ProviderContainer container;

    Future<void> ready() async {
      container = ProviderContainer(overrides: overrides());
      addTearDown(container.dispose);
      container.read(authControllerProvider);
      container.read(callControllerProvider);
      await settle();
    }

    CallUiState state() => container.read(callControllerProvider);
    CallController controller() => container.read(callControllerProvider.notifier);

    Future<void> startCall() => controller().start(
          conversationId: 'conv_1',
          peerLabel: 'Mr. Ahmed',
          isGroup: false,
        );

    Future<void> ring() async {
      socket.emit(CallEventNames.incoming, Frames.incoming());
      await settle();
      expect(state().phase, CallUiPhase.incomingRinging);
    }

    test('starting with the microphone refused rings nobody', () async {
      await ready();
      mic.access = MicrophoneAccess.denied;

      await startCall();
      await settle();

      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);
      expect(calls.startCalls, isEmpty, reason: 'asked before dialling');
      expect(room.connects, isEmpty);
    });

    test('a microphone that stays refused never places a call, however often '
        'Try again is pressed', () async {
      await ready();
      mic.access = MicrophoneAccess.denied;

      await startCall();
      await controller().retry();
      await controller().retry();
      await settle();

      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);
      expect(calls.startCalls, isEmpty);
      expect(mic.calls, 3, reason: 'each Try again asks again');
    });

    test('allowed while the app stays alive (Android), Try again places the '
        'call', () async {
      await ready();
      mic.access = MicrophoneAccess.denied;
      await startCall();
      expect(state().failure, CallUiFailure.microphone);

      // Android keeps the process when a permission is granted in Settings;
      // iOS does not (SB-38), so there this state never comes back.
      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();

      expect(calls.startCalls, ['conv_1']);
      expect(state().phase, CallUiPhase.outgoingRinging);
      expect(state().failure, isNull);
    });

    test('answering with the microphone refused accepts nothing on the server',
        () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;

      await controller().accept();
      await settle();

      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);
      expect(state().callId, 'call_1', reason: 'the ring is still that call');
      expect(calls.acceptCalls, isEmpty);
      expect(room.connects, isEmpty);
    });

    test('allowed while the app stays alive (Android), Try again ANSWERS the '
        'same call -- it does not place a new one', () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;
      await controller().accept();
      await settle();

      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();

      expect(calls.acceptCalls, ['call_1']);
      expect(calls.startCalls, isEmpty);
      expect(state().callId, 'call_1');
      expect(state().phase, CallUiPhase.live);
    });

    test('an answer still refused stays an explanation, not a call', () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;
      await controller().accept();
      await controller().retry();
      await settle();

      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);
      expect(calls.acceptCalls, isEmpty);
      expect(calls.startCalls, isEmpty);
    });

    test('the caller giving up while the microphone is refused ends it here too',
        () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;
      await controller().accept();
      await settle();

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'missed'));
      await settle();
      expect(state().phase, CallUiPhase.ended);

      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();
      expect(calls.acceptCalls, isEmpty, reason: 'nothing to answer any more');
    });

    test('refused when the media joins: Try again rejoins the SAME call',
        () async {
      await ready();
      await startCall(); // granted here
      mic.access = MicrophoneAccess.denied; // revoked before the callee answers
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();
      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);

      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();

      expect(calls.startCalls, ['conv_1'], reason: 'no second call');
      expect(state().callId, 'call_1');
      expect(state().phase, CallUiPhase.live);
    });

    // Review P2-1 of #554.
    test('parked by the microphone, then answered on another device: it ends '
        'here as answered elsewhere, and Try again touches nothing', () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;
      await controller().accept();
      await settle();
      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);

      // The same account's other phone picked it up.
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(state().phase, CallUiPhase.ended);
      expect(state().outcome, CallOutcome.answered);
      expect(state().failure, isNull);

      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();

      expect(state().phase, CallUiPhase.ended);
      expect(calls.acceptCalls, isEmpty, reason: 'never answers it here later');
      expect(calls.tokenCalls, isEmpty, reason: 'never joins its media');
      expect(calls.startCalls, isEmpty);
      expect(calls.declineCalls, isEmpty);
      expect(calls.endCalls, isEmpty);
      expect(room.connects, isEmpty);
    });

    test('a failure after OUR OWN answer is not "answered elsewhere": the '
        'echo of our accept leaves it alone', () async {
      await ready();
      await ring();
      room.connectError = StateError('unreachable');
      await controller().accept(); // accepted on the server; media fails
      await settle();
      expect(calls.acceptCalls, ['call_1']);
      expect(state().phase, CallUiPhase.failed);

      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(state().phase, CallUiPhase.failed, reason: 'still ours to retry');
    });

    // Review P3-1 of #554.
    test('a parked answer is forgotten once that screen is closed: a later '
        'Join of the same call, refused at the media and then allowed, '
        'rejoins instead of hanging at Connecting', () async {
      await ready();
      await ring();
      mic.access = MicrophoneAccess.denied;
      await controller().accept();
      await settle();
      expect(state().failure, CallUiFailure.microphone);

      controller().dismiss(); // Close
      expect(state().phase, CallUiPhase.idle);

      scheduled.joinAnswer = const ScheduledJoin(
        callId: 'call_1',
        conversationId: 'conv_1',
        mode: ScheduledJoinMode.joined,
      );
      await controller().joinScheduled(
        scheduledCallId: 'sc_1',
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await settle();
      expect(calls.acceptCalls, ['call_1']);
      expect(state().phase, CallUiPhase.failed);
      expect(state().failure, CallUiFailure.microphone);

      mic.access = MicrophoneAccess.granted;
      await controller().retry();
      await settle();

      expect(state().phase, CallUiPhase.live, reason: 'not stuck at Connecting');
      expect(state().callId, 'call_1');
      expect(calls.acceptCalls, ['call_1'], reason: 'already accepted once');
      expect(calls.startCalls, isEmpty);
    });
  });

  // =======================================================================
  group('LR-26 screen', () {
    Widget harness({bool settingsCanOpen = true, Locale locale = const Locale('en')}) {
      return ProviderScope(
        overrides: overrides(settingsCanOpen: settingsCanOpen),
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
          home: const ActiveCallScreen(),
        ),
      );
    }

    CallController controllerOf(WidgetTester tester) => ProviderScope.containerOf(
          tester.element(find.byType(ActiveCallScreen)),
        ).read(callControllerProvider.notifier);

    CallUiState stateOf(WidgetTester tester) => ProviderScope.containerOf(
          tester.element(find.byType(ActiveCallScreen)),
        ).read(callControllerProvider);

    const openSettings = ValueKey('call-open-settings');

    testWidgets('a refused start explains, and offers Settings and Try again',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      final l10n = await L10n.delegate.load(const Locale('en'));
      mic.access = MicrophoneAccess.denied;

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callFailedMicrophone), findsOneWidget);
      expect(find.text(l10n.callMicrophoneSettingsHint), findsOneWidget);
      expect(find.byKey(openSettings), findsOneWidget);
      expect(find.text(l10n.notificationPermissionAction), findsOneWidget);
      expect(find.text(l10n.retryAction), findsOneWidget);

      await tester.tap(find.byKey(openSettings));
      await tester.pumpAndSettle();
      expect(settings.opens, 1);
    });

    testWidgets('the microphone allowed while the app stays alive (Android), '
        'Try again places the call', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      final l10n = await L10n.delegate.load(const Locale('en'));
      mic.access = MicrophoneAccess.denied;
      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(openSettings));
      await tester.pumpAndSettle();

      mic.access = MicrophoneAccess.granted;
      await tester.tap(find.text(l10n.retryAction));
      await tester.pumpAndSettle();

      expect(calls.startCalls, ['conv_1']);
      expect(find.text(l10n.callOutgoing), findsOneWidget);
      expect(find.byKey(openSettings), findsNothing);
    });

    testWidgets('a refused answer explains; allowed while the app stays alive '
        '(Android), Try again answers it', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      final l10n = await L10n.delegate.load(const Locale('en'));
      socket.emit(CallEventNames.incoming, Frames.incoming(initiatorName: 'Mrs. Fatima'));
      await tester.pumpAndSettle();
      mic.access = MicrophoneAccess.denied;

      await tester.tap(find.text(l10n.callAccept));
      await tester.pumpAndSettle();

      expect(find.text(l10n.callFailedMicrophone), findsOneWidget);
      expect(find.byKey(openSettings), findsOneWidget);
      expect(find.text('Mrs. Fatima'), findsOneWidget);
      expect(calls.acceptCalls, isEmpty);

      mic.access = MicrophoneAccess.granted;
      await tester.tap(find.text(l10n.retryAction));
      await tester.pumpAndSettle();

      expect(calls.acceptCalls, ['call_1']);
      expect(stateOf(tester).phase, CallUiPhase.live);
    });

    testWidgets('where Settings cannot be opened, the words still say how',
        (tester) async {
      await tester.pumpWidget(harness(settingsCanOpen: false));
      await tester.pump();
      final l10n = await L10n.delegate.load(const Locale('en'));
      mic.access = MicrophoneAccess.denied;

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callMicrophoneSettingsHint), findsOneWidget);
      expect(find.byKey(openSettings), findsNothing);
      expect(find.text(l10n.retryAction), findsOneWidget);
    });

    testWidgets('Arabic copy is used in Arabic', (tester) async {
      await tester.pumpWidget(harness(locale: const Locale('ar')));
      await tester.pump();
      final ar = await L10n.delegate.load(const Locale('ar'));
      final en = await L10n.delegate.load(const Locale('en'));
      mic.access = MicrophoneAccess.denied;

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.text(ar.callMicrophoneSettingsHint), findsOneWidget);
      expect(find.text(ar.notificationPermissionAction), findsOneWidget);
      expect(find.text(en.notificationPermissionAction), findsNothing);
    });

    // Review P2-2 / P3-2 of #554: honest on both platforms, and it names the
    // PHONE's Settings, not the app's own settings screen.
    testWidgets('the hint names the phone\'s Settings and promises only "try '
        'the call again"', (tester) async {
      final ar = await L10n.delegate.load(const Locale('ar'));
      final en = await L10n.delegate.load(const Locale('en'));

      expect(ar.callMicrophoneSettingsHint, contains('إعدادات الجهاز'));
      expect(en.callMicrophoneSettingsHint, contains("your phone's Settings"));
      expect(en.callMicrophoneSettingsHint, isNot(contains('tap Try again')),
          reason: 'iOS restarts the app; there is no Try again to come back to');
      expect(ar.callMicrophoneSettingsHint, isNot(contains('«إعادة المحاولة»')));
    });

    testWidgets('a network failure offers no Settings', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      room.connectError = StateError('unreachable');

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await tester.pumpAndSettle();

      expect(stateOf(tester).failure, CallUiFailure.network);
      expect(find.byKey(openSettings), findsNothing);
    });
  });

  // =======================================================================
  group('LR-26 the Settings seam', () {
    test('iOS opens the app\'s own Settings page through app-settings:', () async {
      final launched = <Uri>[];
      final seam = PlatformMicrophoneSettings(
        isIOS: true,
        launch: (uri) async {
          launched.add(uri);
          return true;
        },
      );

      expect(seam.canOpen, isTrue);
      expect(await seam.open(), isTrue);
      expect(launched, [Uri.parse('app-settings:')]);
    });

    test('elsewhere nothing is launched and no button is offered', () async {
      final launched = <Uri>[];
      final seam = PlatformMicrophoneSettings(
        isIOS: false,
        launch: (uri) async {
          launched.add(uri);
          return true;
        },
      );

      expect(seam.canOpen, isFalse);
      expect(await seam.open(), isFalse);
      expect(launched, isEmpty);
    });

    test('a launcher that throws is a plain "could not open"', () async {
      final seam = PlatformMicrophoneSettings(
        isIOS: true,
        launch: (uri) async => throw StateError('no handler'),
      );

      expect(await seam.open(), isFalse);
    });
  });
}
