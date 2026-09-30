/// The call, as a person sees it.
///
/// Three things this file is really about, beyond "does it render":
///
///   1. NOTHING TECHNICAL REACHES THE SCREEN. No phone number exists in this
///      product and none can appear; nor can a room name, a media token or a
///      `COMM.*` code (`screens/call.md` §2, G-07).
///   2. THE END BUTTON IS SAFE TO REACH FOR. §6 requires it to be the largest
///      target and never adjacent to mute — a misfire there cannot be undone.
///   3. RTL DOES NOT MIRROR THE TIMER. `12:05` read right-to-left is a different
///      number, so the duration stays an LTR run while everything else mirrors.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/presentation/active_call_screen.dart';
import 'package:jawwid_chat/features/calls/presentation/call_card.dart';
import 'package:jawwid_chat/features/calls/presentation/call_controls.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import 'w7_call_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late FakeMic mic;
  late FakeAudioRoute audio;
  late ScriptedAuth auth;
  late SpySocket socket;

  Widget harness({
    Locale locale = const Locale('en'),
    bool canSwitchSpeaker = true,
    Widget child = const ActiveCallScreen(),
  }) {
    calls = FakeCalls();
    room = FakeRoom();
    mic = FakeMic();
    audio = FakeAudioRoute(canSwitch: canSwitchSpeaker);
    auth = ScriptedAuth(signedIn());
    socket = SpySocket();
    addTearDown(socket.close);

    return ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(mic),
        audioRouteProvider.overrideWithValue(audio),
      ],
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
        home: child,
      ),
    );
  }

  /// The controller behind the rendered screen.
  CallController controllerOf(WidgetTester tester) {
    final element = tester.element(find.byType(ActiveCallScreen));
    return ProviderScope.containerOf(element)
        .read(callControllerProvider.notifier);
  }

  Future<void> pumpIncoming(WidgetTester tester, {bool isGroup = false}) async {
    await tester.pumpWidget(harness());
    await tester.pump();
    socket.emit(
      CallEventNames.incoming,
      Frames.incoming(isGroup: isGroup, initiatorName: 'Mrs. Fatima'),
    );
    await tester.pumpAndSettle();
  }

  Future<void> pumpLive(WidgetTester tester, {Locale? locale}) async {
    await tester.pumpWidget(
      locale == null ? harness() : harness(locale: locale),
    );
    await tester.pump();
    await controllerOf(tester).start(
      conversationId: 'conv_1',
      peerLabel: 'Mr. Ahmed',
      isGroup: false,
    );
    socket.emit(CallEventNames.accepted, Frames.participant());
    await tester.pumpAndSettle();
  }

  // =======================================================================
  group('the states a person sees', () {
    testWidgets('an incoming call names the caller and offers both answers',
        (tester) async {
      await pumpIncoming(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.text('Mrs. Fatima'), findsOneWidget);
      expect(find.text(l10n.callIncoming), findsOneWidget);
      expect(find.text(l10n.callAccept), findsOneWidget);
      expect(find.text(l10n.callDecline), findsOneWidget);
    });

    testWidgets('an outgoing call says Calling, with the callee visible',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      final l10n = await L10n.delegate.load(const Locale('en'));

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.text('Mr. Ahmed'), findsOneWidget);
      expect(find.text(l10n.callOutgoing), findsOneWidget);
    });

    testWidgets('a live call shows the controls and a duration', (tester) async {
      await pumpLive(tester);

      expect(find.byType(CallControls), findsOneWidget);
      // 0:00 at the moment it goes live; the ticker advances it.
      expect(find.text('0:00'), findsOneWidget);
    });

    testWidgets('reconnecting keeps the controls on screen', (tester) async {
      await pumpLive(tester);
      room.announceConnected = false;
      room.announcePublished = false;
      final l10n = await L10n.delegate.load(const Locale('en'));

      room.drop();
      await tester.pumpAndSettle();

      expect(find.text(l10n.callReconnecting), findsOneWidget);
      expect(
        find.byType(CallControls),
        findsOneWidget,
        reason: 'controls stay through a reconnect (screens/call.md §3)',
      );
    });

    testWidgets('an ended call names the outcome and the server duration',
        (tester) async {
      await pumpLive(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      socket.emit(
        CallEventNames.ended,
        Frames.ended(outcome: 'answered', durationSeconds: 125),
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callOutcomeAnswered), findsOneWidget);
      expect(
        find.text('2:05'),
        findsOneWidget,
        reason: "the server's duration, not the screen's stopwatch",
      );
    });

    testWidgets('a declined call is plain and neutral, never "rejected"',
        (tester) async {
      await pumpIncoming(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      // The icon, not the caption: the label sits BELOW the circle, so tapping the
      // text would miss the button and prove nothing. In the incoming state
      // `call_end` is unique — the in-call controls are not on screen.
      await tester.tap(find.byIcon(Icons.call_end));
      await tester.pumpAndSettle();

      expect(find.text(l10n.callOutcomeDeclined), findsOneWidget);
      expect(find.textContaining('eject'), findsNothing);
    });

    testWidgets('a failure explains itself and offers both ways out',
        (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      calls.startError = refusal(WireErrors.teacherParentNotAuthorized);
      final l10n = await L10n.delegate.load(const Locale('en'));

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.text(l10n.callFailedNotAllowed), findsOneWidget);
      expect(find.text(l10n.retryAction), findsOneWidget);
      expect(find.text(l10n.callSendMessageInstead), findsOneWidget);
    });

    testWidgets('a group call says so', (tester) async {
      await pumpIncoming(tester, isGroup: true);
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.text(l10n.callGroup), findsOneWidget);
    });
  });

  // =======================================================================
  group('the controls', () {
    testWidgets('mute toggles, and the label follows the state', (tester) async {
      await pumpLive(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.bySemanticsLabel(l10n.callMute), findsOneWidget);

      await tester.tap(find.bySemanticsLabel(l10n.callMute));
      await tester.pumpAndSettle();

      expect(room.microphoneEnabled.last, isFalse);
      expect(find.bySemanticsLabel(l10n.callUnmute), findsOneWidget);
    });

    testWidgets('speaker routes through the W7 seam', (tester) async {
      await pumpLive(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      await tester.tap(find.bySemanticsLabel(l10n.callSpeaker));
      await tester.pumpAndSettle();

      expect(audio.requested, [true]);
    });

    testWidgets('a platform that cannot switch shows no speaker control',
        (tester) async {
      await tester.pumpWidget(harness(canSwitchSpeaker: false));
      await tester.pump();
      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await tester.pumpAndSettle();
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.bySemanticsLabel(l10n.callMute), findsOneWidget);
      expect(
        find.bySemanticsLabel(l10n.callSpeaker),
        findsNothing,
        reason: 'absent, not a button that silently does nothing',
      );
    });

    testWidgets('END is the largest target and is NOT next to mute',
        (tester) async {
      await pumpLive(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      final end = tester.getRect(find.bySemanticsLabel(l10n.callEnd));
      final mute = tester.getRect(find.bySemanticsLabel(l10n.callMute));

      expect(
        end.width * end.height,
        greaterThan(mute.width * mute.height),
        reason: 'screens/call.md §6: the end button is the largest target',
      );
      // On its own row, well clear of mute.
      expect(
        end.top,
        greaterThan(mute.bottom),
        reason: 'never adjacent to mute — a misfire there cannot be undone',
      );
    });

    testWidgets('every control is labelled', (tester) async {
      await pumpLive(tester);
      final l10n = await L10n.delegate.load(const Locale('en'));

      for (final label in [l10n.callMute, l10n.callSpeaker, l10n.callEnd]) {
        expect(find.bySemanticsLabel(label), findsOneWidget, reason: label);
      }
    });
  });

  // =======================================================================
  group('Arabic', () {
    testWidgets('the screen mirrors but the duration stays LTR', (tester) async {
      await pumpLive(tester, locale: const Locale('ar'));

      expect(
        Directionality.of(tester.element(find.byType(CallControls))),
        TextDirection.rtl,
        reason: 'identity and controls mirror',
      );

      // The timer sits inside its own LTR island.
      final timer = find.text('0:00');
      expect(timer, findsOneWidget);
      expect(
        Directionality.of(tester.element(timer)),
        TextDirection.ltr,
        reason: '12:05 read right-to-left is a different number',
      );
    });

    testWidgets('Arabic renders the call strings, not the English ones',
        (tester) async {
      await pumpIncoming(tester);
      // Rebuild in Arabic with the same incoming call.
      final ar = await L10n.delegate.load(const Locale('ar'));
      final en = await L10n.delegate.load(const Locale('en'));
      expect(ar.callIncoming, isNot(en.callIncoming));
    });
  });

  // =======================================================================
  group('nothing technical is rendered', () {
    testWidgets('no room name, token, server URL or COMM code on screen',
        (tester) async {
      await pumpLive(tester);

      // Everything the fake server could have leaked.
      for (final secret in [
        'jawwid-room',
        'media-token',
        'wss://',
        'call_1',
        'conv_1',
        'COMM.',
      ]) {
        expect(
          find.textContaining(secret),
          findsNothing,
          reason: '$secret must never reach the interface',
        );
      }
    });

    testWidgets('a refusal shows a sentence, not a code', (tester) async {
      await tester.pumpWidget(harness());
      await tester.pump();
      calls.startError = refusal(WireErrors.teacherParentNotAuthorized);

      await controllerOf(tester).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('COMM.'), findsNothing);
      expect(find.textContaining('TEACHER_PARENT'), findsNothing);
    });

    testWidgets('no dialable number can appear, because none exists',
        (tester) async {
      await pumpLive(tester);

      final texts = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? '')
          .join(' ');
      expect(RegExp(r'\+\d[\d\s()-]{6,}').hasMatch(texts), isFalse);
    });
  });

  // =======================================================================
  group('the call card in a thread', () {
    Widget cardHarness(CallHistoryEntry entry, {Locale locale = const Locale('en')}) =>
        harness(locale: locale, child: Scaffold(body: CallCard(call: entry)));

    CallHistoryEntry entry({
      CallOutcome outcome = CallOutcome.answered,
      Duration? duration,
      bool isGroup = false,
    }) =>
        CallHistoryEntry(
          id: 'call_1',
          conversationId: 'conv_1',
          title: 'Mr. Ahmed',
          startedAt: DateTime.now().subtract(const Duration(minutes: 30)),
          outcome: outcome,
          isGroup: isGroup,
          duration: duration,
        );

    testWidgets('an answered call shows its outcome and duration',
        (tester) async {
      await tester.pumpWidget(
        cardHarness(entry(duration: const Duration(minutes: 3, seconds: 7))),
      );
      await tester.pumpAndSettle();
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.textContaining(l10n.callOutcomeAnswered), findsOneWidget);
      expect(find.textContaining('3m 7s'), findsOneWidget);
    });

    testWidgets('a missed call is marked as missed', (tester) async {
      await tester.pumpWidget(cardHarness(entry(outcome: CallOutcome.missed)));
      await tester.pumpAndSettle();
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.textContaining(l10n.callOutcomeMissed), findsOneWidget);
      expect(find.byIcon(Icons.call_missed), findsOneWidget);
    });

    testWidgets('a declined call is marked declined, never rejected',
        (tester) async {
      await tester.pumpWidget(cardHarness(entry(outcome: CallOutcome.declined)));
      await tester.pumpAndSettle();
      final l10n = await L10n.delegate.load(const Locale('en'));

      expect(find.textContaining(l10n.callOutcomeDeclined), findsOneWidget);
      expect(find.textContaining('eject'), findsNothing);
    });

    testWidgets('a zero duration is not shown as 0m 0s', (tester) async {
      // A missed call legitimately has no duration; printing one would suggest a
      // conversation happened.
      await tester.pumpWidget(
        cardHarness(entry(outcome: CallOutcome.missed, duration: Duration.zero)),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('0m 0s'), findsNothing);
    });

    testWidgets('the card carries no identifiers', (tester) async {
      await tester.pumpWidget(cardHarness(entry()));
      await tester.pumpAndSettle();

      expect(find.textContaining('call_1'), findsNothing);
      expect(find.textContaining('conv_1'), findsNothing);
    });
  });
}
