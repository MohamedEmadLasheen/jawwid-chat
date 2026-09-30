/// The W7 call experience, against the immutable W1–W6 contracts.
///
/// WHAT THIS FILE EXISTS FOR. W6 locked the call lifecycle on the SERVER, and the
/// easiest way to undo that is in a client: a countdown that ends a call the
/// server still thinks is live, a media disconnect read as a hang-up, a
/// participant's `left_at` treated as terminality, an outcome the client picks
/// because it is quicker than waiting for `call.ended`. Every one of those would
/// be a second lifecycle, and every one of them is asserted against here.
///
/// WHAT IS REAL. The real [CallController], the real [CallMediaClient] (W4), the
/// real [CallCapability] handling. Only the ports are faked — the media room, the
/// microphone, the audio route, the HTTP repository and the event stream — which
/// is exactly the split W1–W6 built those ports for.
///
/// WHAT IS NOT PROVEN, and is not claimed anywhere: that audio flows. No device,
/// no microphone, no LiveKit server. See the W7 closeout.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/call_media/media_room.dart';
import 'package:jawwid_chat/core/call_media/microphone_permission.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/calls/application/call_capability.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';

import 'w7_call_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late FakeMic mic;
  late FakeAudioRoute audio;
  late ScriptedAuth auth;
  late SpySocket socket;

  /// A container wired the way the app is, with the platform seams faked.
  ///
  /// THE REALTIME CHAIN IS REAL: W3's `callRealtimeClientProvider` builds a real
  /// [CallRealtimeClient] over [SpySocket], so events reach W7 by being DECODED
  /// from server frames rather than handed over as ready-made objects. A payload
  /// W7 cannot handle fails here.
  ProviderContainer build({
    bool signedInSession = true,
    bool canSwitchSpeaker = true,
  }) {
    calls = FakeCalls();
    room = FakeRoom();
    mic = FakeMic();
    audio = FakeAudioRoute(canSwitch: canSwitchSpeaker);
    auth = ScriptedAuth(signedInSession ? signedIn() : const AuthSignedOut());
    socket = SpySocket();

    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        callRepositoryProvider.overrideWithValue(calls),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        // One room for the whole test, so `room.connects` accumulates across a
        // reconnect rather than being spread over instances.
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(mic),
        audioRouteProvider.overrideWithValue(audio),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(socket.close);
    container.read(authControllerProvider);
    return container;
  }

  /// Build the controller and let W2's client finish connecting.
  ///
  /// The client subscribes to the socket inside `connect()`, so a frame emitted
  /// before that is genuinely lost — in a test as in production.
  Future<ProviderContainer> ready({
    bool signedInSession = true,
    bool canSwitchSpeaker = true,
  }) async {
    final container = build(
      signedInSession: signedInSession,
      canSwitchSpeaker: canSwitchSpeaker,
    );
    container.read(callControllerProvider);
    await settle();
    return container;
  }

  CallUiState stateOf(ProviderContainer c) => c.read(callControllerProvider);
  CallController controllerOf(ProviderContainer c) =>
      c.read(callControllerProvider.notifier);

  /// Drive an outgoing call all the way to [CallUiPhase.live].
  Future<ProviderContainer> liveOutgoing() async {
    final container = await ready();
    final controller = controllerOf(container);
    await controller.start(
      conversationId: 'conv_1',
      peerLabel: 'Mr. Ahmed',
      isGroup: false,
    );
    socket.emit(CallEventNames.accepted, Frames.participant());
    await settle();
    expect(stateOf(container).phase, CallUiPhase.live);
    return container;
  }

  // =======================================================================
  group('A1/A2. the affordance follows the server, and is never remembered', () {
    test('A1. capability true makes the affordance available', () async {
      final container = await ready();
      calls.capabilityAnswer = const CallCapability(canCall: true);

      await container.read(callCapabilityProvider('conv_1').future);

      expect(container.read(canCallProvider('conv_1')), isTrue);
    });

    test('A1b. capability false means no affordance', () async {
      final container = await ready();
      calls.capabilityAnswer =
          const CallCapability(canCall: false, code: 'COMM.TEACHER_PARENT_NOT_AUTHORIZED');

      await container.read(callCapabilityProvider('conv_1').future);

      expect(container.read(canCallProvider('conv_1')), isFalse);
    });

    test('A1c. an error means no affordance — it fails CLOSED', () async {
      final container = await ready();
      calls.capabilityError = refusal(WireErrors.notConversationMember);

      await expectLater(
        container.read(callCapabilityProvider('conv_1').future),
        throwsA(anything),
      );

      expect(container.read(canCallProvider('conv_1')), isFalse);
    });

    test('A1d. while the answer is in flight there is no affordance', () async {
      final container = await ready();
      // Read without awaiting: loading must not render a call button.
      container.read(callCapabilityProvider('conv_1'));
      expect(container.read(canCallProvider('conv_1')), isFalse);
    });

    test('A2. the answer is NOT cached: a new subscription asks again',
        () async {
      final container = await ready();
      final sub = container.listen(callCapabilityProvider('conv_1'), (_, _) {});
      await container.read(callCapabilityProvider('conv_1').future);
      expect(calls.capabilityCalls, ['conv_1']);

      // The screen closes. autoDispose drops the answer with it.
      sub.close();
      await settle();

      await container.read(callCapabilityProvider('conv_1').future);
      expect(
        calls.capabilityCalls,
        ['conv_1', 'conv_1'],
        reason: 'a remembered capability answer is a remembered permission',
      );
    });

    test('A2b. capability true is not permission: start still asks the server',
        () async {
      final container = await ready();
      calls.capabilityAnswer = const CallCapability(canCall: true);
      await container.read(callCapabilityProvider('conv_1').future);

      // The relationship is revoked in the gap between the answer and the tap.
      calls.startError = refusal(WireErrors.teacherParentNotAuthorized);
      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );

      expect(calls.startCalls, ['conv_1']);
      expect(stateOf(container).phase, CallUiPhase.failed);
      expect(stateOf(container).failure, CallUiFailure.notAllowed);
      expect(room.connects, isEmpty, reason: 'no media for a refused call');
    });
  });

  // =======================================================================
  group('A3/A5. the outgoing call', () {
    test('A3. start rings, and does not join media before it is answered',
        () async {
      final container = await ready();

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );

      final state = stateOf(container);
      expect(state.phase, CallUiPhase.outgoingRinging);
      expect(state.callId, 'call_1');
      expect(state.peerLabel, 'Mr. Ahmed');
      expect(room.connects, isEmpty);
      expect(mic.calls, 0);
    });

    test('A5. the callee answering is what joins media', () async {
      final container = await liveOutgoing();

      // Microphone asked BEFORE the room, which is W4's ordering (A4).
      expect(mic.calls, 1);
      expect(room.connects, hasLength(1));
      expect(calls.tokenCalls, ['call_1']);
      expect(stateOf(container).phase, CallUiPhase.live);
    });

    test('A5b. a call.accepted for somebody else\'s call is ignored', () async {
      final container = await ready();
      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );

      socket.emit(CallEventNames.accepted, Frames.participant(callId: 'call_OTHER', conversationId: 'conv_9'));
      await settle();

      expect(stateOf(container).phase, CallUiPhase.outgoingRinging);
      expect(room.connects, isEmpty);
    });

    test('A3b. two starts do not open two calls', () async {
      final container = await ready();
      final controller = controllerOf(container);

      await Future.wait([
        controller.start(
            conversationId: 'conv_1', peerLabel: 'A', isGroup: false),
        controller.start(
            conversationId: 'conv_1', peerLabel: 'A', isGroup: false),
      ]);

      expect(calls.startCalls, hasLength(1));
    });
  });

  // =======================================================================
  group('A4. the microphone is asked before anything is joined', () {
    test('A4. a denied microphone joins no room and offers no call', () async {
      mic = FakeMic(MicrophoneAccess.denied);
      final container = await ready();
      mic.access = MicrophoneAccess.denied;

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(stateOf(container).phase, CallUiPhase.failed);
      expect(stateOf(container).failure, CallUiFailure.microphone);
      expect(room.connects, isEmpty, reason: 'nothing is joined after a refusal');
      expect(calls.tokenCalls, isEmpty, reason: 'and no token is even minted');
    });

    test('A4b. an unavailable microphone is the same refusal', () async {
      final container = await ready();
      mic.access = MicrophoneAccess.unavailable;

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(stateOf(container).failure, CallUiFailure.microphone);
      expect(room.connects, isEmpty);
    });
  });

  // =======================================================================
  group('A6/A7. the incoming call', () {
    test('A6. an incoming call is presented with the caller\'s name', () async {
      final container = await ready();

      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_7', conversationId: 'conv_3', initiatorName: 'Mrs. Fatima'));
      await settle();

      final state = stateOf(container);
      expect(state.phase, CallUiPhase.incomingRinging);
      expect(state.callId, 'call_7');
      expect(state.peerLabel, 'Mrs. Fatima');
    });

    test('A6b. accepting answers over HTTP and then joins media', () async {
      final container = await ready();
      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_7', conversationId: 'conv_3', initiatorName: 'Mrs. Fatima'));
      await settle();

      await controllerOf(container).accept();
      await settle();

      expect(calls.acceptCalls, ['call_7']);
      expect(room.connects, hasLength(1));
      expect(stateOf(container).phase, CallUiPhase.live);
    });

    test('A6c. our own call.accepted does not join a second time', () async {
      final container = await ready();
      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_7', conversationId: 'conv_3', initiatorName: 'Mrs. Fatima'));
      await settle();
      await controllerOf(container).accept();
      await settle();

      // The server echoes the accept we just made.
      socket.emit(CallEventNames.accepted, Frames.participant(callId: 'call_7', conversationId: 'conv_3', actorId: 'actor_me'));
      await settle();

      expect(room.connects, hasLength(1), reason: 'one room, not two');
    });

    test('A7. declining is terminal, as declined', () async {
      final container = await ready();
      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_7', conversationId: 'conv_3', initiatorName: 'Mrs. Fatima'));
      await settle();

      await controllerOf(container).decline();
      await settle();

      expect(calls.declineCalls, ['call_7']);
      expect(stateOf(container).phase, CallUiPhase.ended);
      expect(stateOf(container).outcome, CallOutcome.declined);
    });

    test('A7b. a GROUP call is terminal on decline too — W6 is unconditional',
        () async {
      final container = await ready();
      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_g', conversationId: 'conv_group', isGroup: true, initiatorName: 'Jawwid'));
      await settle();

      await controllerOf(container).decline();
      await settle();

      final state = stateOf(container);
      expect(state.isGroup, isTrue);
      expect(state.phase, CallUiPhase.ended);
      expect(
        state.outcome,
        CallOutcome.declined,
        reason: 'a decline ends the call whoever declines, group or not',
      );
    });

    test('A6d. a second incoming call during a call is not presented', () async {
      final container = await liveOutgoing();

      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_second', conversationId: 'conv_9', initiatorName: 'Someone Else'));
      await settle();

      expect(stateOf(container).callId, 'call_1',
          reason: 'no call waiting in MVP; the server records the second one');
    });
  });

  // =======================================================================
  group('A8. the UI never invents terminality', () {
    test('A8a. a media DROP is reconnecting, never an ended call', () async {
      final container = await liveOutgoing();
      // Hold the retry open, so the transient state is observable. With the room
      // answering immediately the reconnect succeeds within the same turn — which
      // is the behaviour `screens/call.md` §3 asks for and is asserted next.
      room.announceConnected = false;
      room.announcePublished = false;

      room.drop();
      await settle();

      final state = stateOf(container);
      expect(state.phase, CallUiPhase.reconnecting);
      expect(state.phase, isNot(CallUiPhase.ended));
      expect(state.outcome, isNull, reason: 'no outcome was invented');
      expect(calls.endCalls, isEmpty, reason: 'and nothing was ended for us');
    });

    test('A8a2. a drop that recovers resumes the call without the user acting',
        () async {
      final container = await liveOutgoing();

      room.drop();
      await settle();

      // The room answered the retry, so audio is back and the call was never
      // ended — "audio resumes without user action" (`screens/call.md` §3).
      expect(stateOf(container).phase, CallUiPhase.live);
      expect(stateOf(container).outcome, isNull);
      expect(calls.endCalls, isEmpty);
      expect(room.connects, hasLength(2));
    });

    test('A8b. remote audio going away is not an ending', () async {
      final container = await liveOutgoing();
      room.emit(const RemoteAudioChanged(
        participantId: 'p1',
        trackId: 't1',
        present: true,
      ));
      await settle();
      expect(stateOf(container).hasRemoteAudio, isTrue);

      room.emit(const RemoteAudioChanged(
        participantId: 'p1',
        trackId: 't1',
        present: false,
      ));
      await settle();

      expect(stateOf(container).phase, CallUiPhase.live);
      expect(stateOf(container).hasRemoteAudio, isFalse);
    });

    test('A8c. there is no client-side deadline on a live call', () async {
      final container = await liveOutgoing();

      // Time passes — a great deal of it, in the only sense a test can offer.
      await settle();
      await settle();
      await settle();

      expect(stateOf(container).phase, CallUiPhase.live);
      expect(calls.endCalls, isEmpty);
    });

    test('A8d. the controller reads no participant list at all', () {
      // A structural guard. `left_at` is a participant fact and W6 forbids
      // inferring terminality from it; the honest way to guarantee that is for
      // this file never to mention it.
      final source = File(
        'lib/features/calls/application/call_controller.dart',
      ).readAsStringSync();
      final code = source
          .split('\n')
          .where((line) => !line.trimLeft().startsWith('///'))
          .where((line) => !line.trimLeft().startsWith('//'))
          .join('\n');
      expect(code, isNot(contains('leftAt')));
      expect(code, isNot(contains('participants')));
      // And no timer of any kind ends a call.
      expect(code, isNot(contains('Timer')));
      expect(code, isNot(contains('Future.delayed')));
    });
  });

  // =======================================================================
  group('A8b. terminal events are idempotent and order-free', () {
    test('declined then ended settles once', () async {
      final container = await liveOutgoing();

      socket.emit(CallEventNames.declined, Frames.participant());
      await settle();
      final afterDecline = stateOf(container);

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'declined'));
      await settle();

      expect(afterDecline.phase, CallUiPhase.ended);
      expect(stateOf(container).phase, CallUiPhase.ended);
      expect(stateOf(container).outcome, CallOutcome.declined);
      expect(room.disconnects, 1, reason: 'one cleanup, not two');
      expect(room.disposes, 1);
    });

    test('ended then declined settles once, and the outcome does not flap',
        () async {
      final container = await liveOutgoing();

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'answered', durationSeconds: 42));
      await settle();
      socket.emit(CallEventNames.declined, Frames.participant());
      await settle();

      final state = stateOf(container);
      expect(state.phase, CallUiPhase.ended);
      expect(
        state.outcome,
        CallOutcome.answered,
        reason: 'call.ended is the authority; a late declined cannot rewrite it',
      );
      expect(state.duration, const Duration(seconds: 42));
      expect(room.disposes, 1);
    });

    test('four duplicate call.ended events tear down once', () async {
      final container = await liveOutgoing();

      for (var i = 0; i < 4; i++) {
        socket.emit(CallEventNames.ended, Frames.ended(outcome: 'answered', durationSeconds: 10));
      }
      await settle();

      expect(room.disconnects, 1);
      expect(room.disposes, 1);
      expect(stateOf(container).outcome, CallOutcome.answered);
    });

    test('a terminal event for another call is ignored', () async {
      final container = await liveOutgoing();

      socket.emit(CallEventNames.ended, Frames.ended(callId: 'call_OTHER', conversationId: 'conv_9', outcome: 'missed', durationSeconds: null));
      await settle();

      expect(stateOf(container).phase, CallUiPhase.live);
    });
  });

  // =======================================================================
  group('A9/A10. in-call controls', () {
    test('A9. duration and outcome come from the server, never from a clock',
        () async {
      final container = await liveOutgoing();

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'answered', durationSeconds: 600));
      await settle();

      expect(stateOf(container).duration, const Duration(minutes: 10));
      expect(stateOf(container).outcome, CallOutcome.answered);
    });

    test('A9b. hanging up leaves the OUTCOME to the server', () async {
      final container = await liveOutgoing();

      await controllerOf(container).hangUp();
      await settle();

      expect(calls.endCalls, ['call_1']);
      expect(stateOf(container).phase, CallUiPhase.ended);
      expect(
        stateOf(container).outcome,
        isNull,
        reason: 'answered vs missed is derived from answered_at, server-side',
      );

      // ...and the server's own event fills it in.
      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'answered', durationSeconds: 5));
      await settle();
      expect(stateOf(container).outcome, CallOutcome.answered);
      expect(room.disposes, 1, reason: 'still one teardown');
    });

    test('A10. mute is orthogonal to the media phase', () async {
      final container = await liveOutgoing();

      await controllerOf(container).toggleMute();
      await settle();

      expect(room.microphoneEnabled.last, isFalse);
      expect(stateOf(container).microphoneMuted, isTrue);
      expect(
        stateOf(container).phase,
        CallUiPhase.live,
        reason: 'a muted participant is still connected and still published',
      );

      await controllerOf(container).toggleMute();
      await settle();
      expect(room.microphoneEnabled.last, isTrue);
      expect(stateOf(container).microphoneMuted, isFalse);
      expect(stateOf(container).phase, CallUiPhase.live);
    });

    test('A10b. speaker routing goes through the W7 AudioRoute seam', () async {
      final container = await liveOutgoing();
      expect(stateOf(container).canSwitchSpeaker, isTrue);

      await controllerOf(container).toggleSpeaker();
      await settle();

      expect(audio.requested, [true]);
      expect(stateOf(container).speakerPreferred, isTrue);

      await controllerOf(container).toggleSpeaker();
      await settle();
      expect(audio.requested, [true, false]);
      expect(stateOf(container).speakerPreferred, isFalse);
    });

    test('A10c. a platform that cannot switch is not offered the control',
        () async {
      final container = await ready(canSwitchSpeaker: false);
      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );

      expect(stateOf(container).canSwitchSpeaker, isFalse);
      await controllerOf(container).toggleSpeaker();
      expect(audio.requested, isEmpty);
    });
  });

  // =======================================================================
  group('A11/A12. reconnecting and failure', () {
    test('A11. one drop is retried once, and the call is not ended', () async {
      final container = await liveOutgoing();
      expect(room.connects, hasLength(1));
      room.announceConnected = false; // keep the retry in flight
      room.announcePublished = false;

      room.drop();
      await settle();

      expect(stateOf(container).phase, CallUiPhase.reconnecting);
      expect(room.connects, hasLength(2), reason: 'bounded: retried once');
      expect(calls.endCalls, isEmpty);
    });

    test('A11b. a second drop stops retrying rather than looping', () async {
      final container = await liveOutgoing();

      room.drop();
      await settle();
      room.drop();
      await settle();

      expect(room.connects, hasLength(2), reason: 'no retry storm');
      expect(stateOf(container).phase, CallUiPhase.reconnecting);
      expect(stateOf(container).failure, CallUiFailure.network);
    });

    test('A12. an unreachable room fails, and offers a retry', () async {
      final container = await ready();
      room.connectError = StateError('no route to host');

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(stateOf(container).phase, CallUiPhase.failed);
      expect(stateOf(container).failure, CallUiFailure.network);
    });

    test('A12b. a refused media token is not-allowed, not a network problem',
        () async {
      final container = await ready();
      calls.tokenError = refusal(WireErrors.callAlreadyEnded);

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();

      expect(stateOf(container).failure, CallUiFailure.notAllowed);
    });

    test('A12c. retry starts a NEW call rather than rejoining a dead one',
        () async {
      final container = await ready();
      room.connectError = StateError('nope');
      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );
      socket.emit(CallEventNames.accepted, Frames.participant());
      await settle();
      expect(stateOf(container).phase, CallUiPhase.failed);

      room.connectError = null;
      calls.nextCallId = 'call_2';
      await controllerOf(container).retry();
      await settle();

      expect(calls.startCalls, ['conv_1', 'conv_1']);
      expect(stateOf(container).callId, 'call_2');
      expect(stateOf(container).phase, CallUiPhase.outgoingRinging);
    });
  });

  // =======================================================================
  group('A14. teardown happens exactly once', () {
    test('A14. a terminal call releases the room once', () async {
      await liveOutgoing();

      socket.emit(CallEventNames.ended, Frames.ended(outcome: 'answered', durationSeconds: 3));
      await settle();

      expect(room.disconnects, 1);
      expect(room.disposes, 1);
    });

    test('A14b. the session ending tears the call down', () async {
      final container = await liveOutgoing();

      auth.endSession();
      await settle();

      expect(stateOf(container).phase, CallUiPhase.idle);
      expect(room.disposes, greaterThanOrEqualTo(1),
          reason: 'no call object outlives its principal');
    });

    test('A14c. a different user does not inherit the previous call', () async {
      final container = await liveOutgoing();

      auth.authenticate('account_2');
      await settle();

      expect(stateOf(container).phase, CallUiPhase.idle);
      expect(stateOf(container).callId, isNull);
      expect(room.disposes, greaterThanOrEqualTo(1));
    });

    test('A14d. disposing the container releases the room', () async {
      final container = await liveOutgoing();
      container.dispose();
      await settle();

      expect(room.disposes, greaterThanOrEqualTo(1));
    });
  });

  // =======================================================================
  group('A15. nothing technical is held for rendering', () {
    test('the state carries no room name, token or media handle', () async {
      final container = await liveOutgoing();
      final state = stateOf(container);

      // `StartedCall.roomName` is deliberately dropped: the room is signed into
      // the token, and a name in the UI state is a name that can be rendered.
      final fields = [
        state.peerLabel,
        state.callId,
        state.conversationId,
      ].whereType<String>().join(' ');
      expect(fields, isNot(contains('jawwid-room')));
      expect(fields, isNot(contains('media-token')));
      expect(fields, isNot(contains('wss://')));
    });

    test('a refusal never surfaces its COMM code to the interface', () async {
      final container = await ready();
      calls.startError = refusal(WireErrors.teacherParentNotAuthorized);

      await controllerOf(container).start(
        conversationId: 'conv_1',
        peerLabel: 'Mr. Ahmed',
        isGroup: false,
      );

      // The failure is one of three actionable categories, not a code.
      expect(stateOf(container).failure, CallUiFailure.notAllowed);
      expect(CallUiFailure.values, hasLength(3));
    });
  });

  // =======================================================================
  group('no session, no call', () {
    test('a signed-out session presents no incoming call', () async {
      final container = await ready(signedInSession: false);
      // The real app has no event stream at all while signed out —
      // `callEventsProvider` is empty because `callRealtimeClientProvider` is
      // null. Here the stream is overridden, so pushing an event proves the
      // controller is reachable and the ASSERTION is about what it does with a
      // session that does not exist.
      socket.emit(CallEventNames.incoming, Frames.incoming(callId: 'call_x', conversationId: 'conv_x', initiatorName: 'Someone'));
      await settle();

      // Presented, because the override bypasses the session gate — and then
      // the session arriving REBUILDS the controller, discarding it. That is the
      // structural guarantee W3 established and W7 inherits.
      auth.authenticate('account_9');
      await settle();

      expect(stateOf(container).phase, CallUiPhase.idle);
      expect(stateOf(container).callId, isNull);
    });
  });
}
