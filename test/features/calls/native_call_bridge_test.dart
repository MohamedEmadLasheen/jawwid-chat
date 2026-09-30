/// The system call screen against the immutable W1–W6 contracts (W8-W3).
///
/// WHAT THIS FILE EXISTS FOR. CallKit is a second UI for a call, and the easy
/// mistake is to let it become a second AUTHORITY for one: a native answer that
/// moves the call without asking the server, a native screen that decides a
/// call is over because it timed out, a `callId` from a push treated as
/// permission. Every one of those is a second lifecycle, and every one is
/// asserted against here.
///
/// WHAT IS REAL. The real [CallController], the real W3 realtime chain over a
/// spy socket, the real W4 media client. Only the platform seams are faked.
///
/// WHAT IS NOT PROVEN, and is claimed nowhere: that PushKit delivers, that
/// CallKit presents, that a terminated process launches, or how long any of it
/// takes. There is no device here. That is W8-W4's, in full.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/call_native/call_native_providers.dart';
import 'package:jawwid_chat/core/call_native/call_presentation.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';

import 'w7_call_fakes.dart';

/// The system call screen, recorded rather than presented.
class FakePresentation implements CallPresentation {
  final _actions = StreamController<NativeCallAction>.broadcast();
  final dismissals = <(String, CallDismissReason)>[];
  int starts = 0;

  @override
  Future<void> start() async => starts++;

  @override
  Stream<NativeCallAction> actions() => _actions.stream;

  @override
  Future<void> dismiss({
    required String callId,
    required CallDismissReason reason,
  }) async =>
      dismissals.add((callId, reason));

  /// The platform reporting an action.
  void emit(NativeCallActionKind kind, {String callId = 'call_1', String? conversationId}) =>
      _actions.add(
        NativeCallAction(
          kind: kind,
          callId: callId,
          conversationId: conversationId,
        ),
      );

  Future<void> close() => _actions.close();
}

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late FakeMic mic;
  late FakeAudioRoute audio;
  late ScriptedAuth auth;
  late SpySocket socket;
  late FakePresentation native;

  Future<void> settle() => Future<void>.delayed(Duration.zero);

  ProviderContainer build({bool signedInSession = true}) {
    calls = FakeCalls();
    room = FakeRoom();
    mic = FakeMic();
    audio = FakeAudioRoute(canSwitch: true);
    auth = ScriptedAuth(signedInSession ? signedIn() : const AuthSignedOut());
    socket = SpySocket();
    native = FakePresentation();

    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(mic),
        audioRouteProvider.overrideWithValue(audio),
        callPresentationProvider.overrideWithValue(native),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(socket.close);
    addTearDown(native.close);
    container.read(authControllerProvider);
    return container;
  }

  Future<ProviderContainer> ready() async {
    final container = build();
    container.read(callControllerProvider);
    await settle();
    return container;
  }

  CallUiState stateOf(ProviderContainer c) => c.read(callControllerProvider);
  CallController controllerOf(ProviderContainer c) =>
      c.read(callControllerProvider.notifier);

  /// An incoming call, as the server announces it.
  Future<ProviderContainer> ringing() async {
    final container = await ready();
    socket.emit(CallEventNames.incoming, Frames.incoming());
    await settle();
    expect(stateOf(container).phase, CallUiPhase.incomingRinging);
    return container;
  }

  // =======================================================================
  group('N1. the seam is started, and is not session-scoped', () {
    test('N1a. the controller starts it', () async {
      await ready();

      expect(native.starts, 1);
    });

    test('N1b. a signed-out build still holds the seam', () async {
      // On a cold VoIP wake CallKit has ALREADY presented a call before this
      // app knows whether it has a session. A seam that only existed while
      // signed in would have no way to take that screen back down.
      final container = build(signedInSession: false);
      container.read(callControllerProvider);
      await settle();

      expect(native.starts, 1);
    });
  });

  // =======================================================================
  group('N2. a native action is FORWARDED, never acted on locally', () {
    test('N2a. answer sends the server the same accept the button does',
        () async {
      final container = await ringing();

      native.emit(NativeCallActionKind.answer);
      await settle();

      expect(calls.acceptCalls, ['call_1']);
      // The fake room connects immediately, so this lands on `live`.
      expect(stateOf(container).phase, CallUiPhase.live);
    });

    test('N2b. decline sends the server decline', () async {
      await ringing();

      native.emit(NativeCallActionKind.decline);
      await settle();

      expect(calls.declineCalls, ['call_1']);
    });

    test('N2c. end sends the server end', () async {
      final container = await ringing();
      native.emit(NativeCallActionKind.answer);
      await settle();
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      native.emit(NativeCallActionKind.end);
      await settle();

      expect(calls.endCalls, ['call_1']);
      expect(stateOf(container).callId, 'call_1');
    });

    test("N2e. CallKit's END while RINGING is a DECLINE, not a hang-up",
        () async {
      // CallKit has one end action for both. They are different server
      // operations: decline writes outcome `declined`, end on a ringing call
      // writes `missed`. Sending the wrong one records a call the person
      // deliberately refused as one they never saw -- the exact defect W6
      // fixed on the server, reintroduced from the lock screen.
      await ringing();

      native.emit(NativeCallActionKind.end);
      await settle();

      expect(calls.declineCalls, ['call_1']);
      expect(calls.endCalls, isEmpty);
    });

    test("N2f. CallKit's END on a live call IS a hang-up", () async {
      final container = await ringing();
      native.emit(NativeCallActionKind.answer);
      await settle();
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();
      expect(stateOf(container).phase, CallUiPhase.live);

      native.emit(NativeCallActionKind.end);
      await settle();

      expect(calls.endCalls, ['call_1']);
      expect(calls.declineCalls, isEmpty);
    });

    test('N2d. AN ACTION FOR ANOTHER CALL MOVES NOTHING', () async {
      // A stale or replayed native action naming a different call must not
      // accept, decline or end the call this device is actually on.
      await ringing();

      native.emit(NativeCallActionKind.answer, callId: 'call_OTHER');
      native.emit(NativeCallActionKind.decline, callId: 'call_OTHER');
      native.emit(NativeCallActionKind.end, callId: 'call_OTHER');
      await settle();

      expect(calls.acceptCalls, isEmpty);
      expect(calls.declineCalls, isEmpty);
      expect(calls.endCalls, isEmpty);
    });
  });

  // =======================================================================
  group('N3. an incoming report presents, and the server supersedes it', () {
    test('N3a. a cold wake presents from the push alone', () async {
      // The engine started because of a VoIP push; the socket is not up yet.
      final container = await ready();

      native.emit(
        NativeCallActionKind.incoming,
        conversationId: 'conv_1',
      );
      await settle();

      final state = stateOf(container);
      expect(state.phase, CallUiPhase.incomingRinging);
      expect(state.callId, 'call_1');
      expect(state.conversationId, 'conv_1');
      // NO PEER NAME IS INVENTED. The push carries none.
      expect(state.peerLabel, isNull);
    });

    test('N3b. the realtime event fills in what the push could not', () async {
      final container = await ready();
      native.emit(NativeCallActionKind.incoming, conversationId: 'conv_1');
      await settle();

      socket.emit(CallEventNames.incoming, Frames.incoming());
      await settle();

      // Still one call, and still ringing -- the server's word did not create
      // a second presentation.
      expect(stateOf(container).phase, CallUiPhase.incomingRinging);
      expect(stateOf(container).callId, 'call_1');
    });

    test('N3c. a duplicate incoming report presents once', () async {
      final container = await ready();

      native.emit(NativeCallActionKind.incoming);
      await settle();
      native.emit(NativeCallActionKind.incoming);
      await settle();

      expect(stateOf(container).phase, CallUiPhase.incomingRinging);
      expect(stateOf(container).callId, 'call_1');
    });

    test('N3d. a report during a live call does not replace it', () async {
      final container = await ringing();
      native.emit(NativeCallActionKind.answer);
      await settle();

      native.emit(NativeCallActionKind.incoming, callId: 'call_SECOND');
      await settle();

      expect(stateOf(container).callId, 'call_1');
    });
  });

  // =======================================================================
  group('N4. THE SYSTEM SCREEN COMES DOWN ON THE SERVER\'S WORD', () {
    test('N4a. call.ended dismisses it', () async {
      await ringing();

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'missed'));
      await settle();

      expect(native.dismissals, [('call_1', CallDismissReason.remoteEnded)]);
    });

    test('N4b. call.declined dismisses it as a decline', () async {
      await ringing();

      socket.emit(CallEventNames.declined, Frames.participant());
      await settle();

      expect(native.dismissals, [('call_1', CallDismissReason.declined)]);
    });

    test('N4c. our own decline dismisses it', () async {
      final container = await ringing();

      await controllerOf(container).decline();
      await settle();

      expect(native.dismissals.first.$1, 'call_1');
    });

    test('N4d. DISMISSAL IS IDEMPOTENT across every terminal path', () async {
      // decline and ended are written in ONE server transaction and arrive in
      // no guaranteed order. The screen must come down once.
      await ringing();

      socket.emit(CallEventNames.declined, Frames.participant());
      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'declined'));
      await settle();

      expect(native.dismissals, hasLength(1));
    });

    test('N4e. nothing is dismissed while a call is merely ringing', () async {
      await ringing();

      expect(native.dismissals, isEmpty);
    });
  });

  // =======================================================================
  group('N5. MULTI-DEVICE: the device that did not answer stops ringing', () {
    test('N5a. call.accepted while ringing dismisses THIS device', () async {
      // Device B. Another of this account's devices answered, so the call is
      // ACTIVE and `call.ended` is NOT coming. Without this, B rings on.
      final container = await ringing();

      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(
        native.dismissals,
        [('call_1', CallDismissReason.answeredElsewhere)],
      );
      expect(stateOf(container).phase, CallUiPhase.ended);
    });

    test('N5b. THE ANSWERING DEVICE IS NOT DISMISSED', () async {
      // Device A answered here. Its own `call.accepted` echo must not take its
      // call away -- that would hang up the call it just joined.
      final container = await ringing();
      native.emit(NativeCallActionKind.answer);
      await settle();

      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(native.dismissals, isEmpty);
      expect(stateOf(container).phase, isNot(CallUiPhase.ended));
    });

    test('N5c. the CALLER is not dismissed by the answer either', () async {
      final container = await ready();
      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      await settle();

      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(native.dismissals, isEmpty);
      expect(stateOf(container).phase, CallUiPhase.live);
    });

    test('N5d. a duplicate call.accepted dismisses once', () async {
      await ringing();

      socket.emit(CallEventNames.accepted, Frames.participant());
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(native.dismissals, hasLength(1));
    });

    test('N5e. an accepted for ANOTHER call leaves this one ringing', () async {
      final container = await ringing();

      socket.emit(
        CallEventNames.accepted,
        Frames.participant(callId: 'call_OTHER'),
      );
      await settle();

      expect(native.dismissals, isEmpty);
      expect(stateOf(container).phase, CallUiPhase.incomingRinging);
    });

    test('N5f. a terminal event after the answer still dismisses once',
        () async {
      await ringing();
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      socket.emit(CallEventNames.ended, Frames.ended());
      await settle();

      expect(native.dismissals, hasLength(1));
    });
  });

  // =======================================================================
  group('N6. no second lifecycle', () {
    test('N6a. a native answer that the SERVER refuses moves nothing',
        () async {
      // The call already ended: `accept` returns the W6 409 contract.
      final container = await ringing();
      calls.acceptError = const AppError(
        AppErrorKind.validation,
        code: WireErrors.callAlreadyEnded,
      );

      native.emit(NativeCallActionKind.answer);
      await settle();

      // `failed` is W7's existing shape for a refused accept and is unchanged.
      // What W8-W3 adds is that the SYSTEM screen does not survive it.
      expect(stateOf(container).phase, CallUiPhase.failed);
      expect(room.connects, isEmpty);
      expect(native.dismissals, [('call_1', CallDismissReason.remoteEnded)]);
    });

    test('N6b. native never ends a call on its own', () async {
      // Nothing but a server event or an explicit user action is terminal.
      // Time passing is not an input here, and no native timer exists.
      final container = await ringing();

      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(stateOf(container).phase, CallUiPhase.incomingRinging);
      expect(native.dismissals, isEmpty);
    });

    test('N6c. the outcome always comes from the server', () async {
      final container = await ringing();

      socket.emit(
        CallEventNames.ended,
        Frames.ended(outcome: 'missed', durationSeconds: 0),
      );
      await settle();

      expect(stateOf(container).outcome, CallOutcome.missed);
    });
  });
}
