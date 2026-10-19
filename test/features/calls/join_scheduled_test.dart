/// `CallController.joinScheduled` (PD-13), against the real controller, the
/// real media client and the real realtime chain -- only the ports are faked,
/// exactly as in `call_controller_test.dart`.
///
/// What it must prove: a Join enters the call through the SAME states the
/// existing paths reach (outgoing ringing after a start; accept -> token ->
/// media after an answer), and a refusal puts nothing on screen.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/realtime/call_event.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/application/call_media_providers.dart';
import 'package:jawwid_chat/features/calls/data/scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';

import 'calls_page_fakes.dart';
import 'w7_call_fakes.dart';

void main() {
  late FakeCalls calls;
  late FakeRoom room;
  late SpySocket socket;
  late RecordingScheduled scheduled;

  Future<ProviderContainer> ready({bool withScheduled = true}) async {
    calls = FakeCalls();
    room = FakeRoom();
    socket = SpySocket();
    scheduled = RecordingScheduled();
    final auth = ScriptedAuth(signedIn());

    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(() => auth),
        callRepositoryProvider.overrideWithValue(calls),
        if (withScheduled)
          scheduledCallRepositoryProvider.overrideWithValue(scheduled),
        realtimeSocketProvider.overrideWithValue(socket),
        realtimeTokenProvider.overrideWithValue(FixedTokens('token-A')),
        mediaRoomFactoryProvider.overrideWithValue(() => room),
        microphonePermissionProvider.overrideWithValue(FakeMic()),
        audioRouteProvider.overrideWithValue(FakeAudioRoute()),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(socket.close);
    container.read(authControllerProvider);
    container.read(callControllerProvider);
    await settle();
    return container;
  }

  CallUiState stateOf(ProviderContainer c) => c.read(callControllerProvider);
  CallController controllerOf(ProviderContainer c) =>
      c.read(callControllerProvider.notifier);

  Future<ScheduledJoinResult> join(
    ProviderContainer c, {
    bool isGroup = true,
    String conversationId = 'conv_1',
  }) async {
    final result = await controllerOf(c).joinScheduled(
      scheduledCallId: 'sc_1',
      conversationId: conversationId,
      peerLabel: 'Omar · Quran',
      isGroup: isGroup,
    );
    await settle();
    return result;
  }

  test('mode started: outgoing ringing with the server\'s call id, as after POST /calls', () async {
    final c = await ready();
    scheduled.joinAnswer = const ScheduledJoin(
      callId: 'call_7',
      conversationId: 'conv_1',
      mode: ScheduledJoinMode.started,
    );

    final result = await join(c);

    expect(result, ScheduledJoinResult.joined);
    expect(scheduled.joins, ['sc_1']);
    final state = stateOf(c);
    expect(state.phase, CallUiPhase.outgoingRinging);
    expect(state.callId, 'call_7');
    expect(state.conversationId, 'conv_1');
    expect(state.direction, CallDirection.outgoing);
    expect(state.peerLabel, 'Omar · Quran');
    expect(state.isGroup, isTrue);
    // The join started the call: no second POST /calls, no accept, no media yet.
    expect(calls.startCalls, isEmpty);
    expect(calls.acceptCalls, isEmpty);
    expect(room.connects, isEmpty);

    // call.accepted is the caller's cue to join media, exactly as for start().
    socket.emit(CallEventNames.accepted, Frames.participant(callId: 'call_7'));
    await settle();
    expect(stateOf(c).phase, CallUiPhase.live);
    expect(calls.tokenCalls, ['call_7']);
  });

  test('mode joined: accept -> token -> media for that call', () async {
    final c = await ready();
    scheduled.joinAnswer = const ScheduledJoin(
      callId: 'call_8',
      conversationId: 'conv_1',
      mode: ScheduledJoinMode.joined,
    );

    final result = await join(c);

    expect(result, ScheduledJoinResult.joined);
    expect(calls.acceptCalls, ['call_8']);
    expect(calls.tokenCalls, ['call_8']);
    expect(room.connects, hasLength(1));
    expect(stateOf(c).phase, CallUiPhase.live);
    expect(stateOf(c).callId, 'call_8');
    expect(calls.startCalls, isEmpty);
  });

  test(
    'mode joined while already ringing for that call: it is simply accepted',
    () async {
      final c = await ready();
      socket.emit(
        CallEventNames.incoming,
        Frames.incoming(callId: 'call_9', isGroup: true),
      );
      await settle();
      expect(stateOf(c).phase, CallUiPhase.incomingRinging);

      scheduled.joinAnswer = const ScheduledJoin(
        callId: 'call_9',
        conversationId: 'conv_1',
        mode: ScheduledJoinMode.joined,
      );
      final result = await join(c);

      expect(result, ScheduledJoinResult.joined);
      expect(calls.acceptCalls, ['call_9'], reason: 'one accept, not two');
      expect(stateOf(c).phase, CallUiPhase.live);
    },
  );

  test('ringing for another conversation: the join endpoint is never called, the ring untouched', () async {
    final c = await ready();
    socket.emit(
      CallEventNames.incoming,
      Frames.incoming(callId: 'call_ring', conversationId: 'conv_1'),
    );
    await settle();
    expect(stateOf(c).phase, CallUiPhase.incomingRinging);

    final result = await join(c, conversationId: 'conv_other');

    expect(result, ScheduledJoinResult.busy);
    expect(
      scheduled.joins,
      isEmpty,
      reason: 'a Join could start a phantom call elsewhere',
    );
    expect(stateOf(c).phase, CallUiPhase.incomingRinging);
    expect(stateOf(c).callId, 'call_ring');
    expect(stateOf(c).conversationId, 'conv_1');
    expect(calls.acceptCalls, isEmpty);
    expect(calls.declineCalls, isEmpty);
    expect(calls.endCalls, isEmpty);
  });

  test(
    'a join failing at accept is the call screen\'s failure, as for an answer',
    () async {
      final c = await ready();
      scheduled.joinAnswer = const ScheduledJoin(
        callId: 'call_8',
        conversationId: 'conv_1',
        mode: ScheduledJoinMode.joined,
      );
      calls.acceptError = refusal('COMM.CALL_NOT_A_PARTICIPANT');

      await join(c);

      expect(stateOf(c).phase, CallUiPhase.failed);
      expect(stateOf(c).failure, CallUiFailure.notAllowed);
      expect(room.connects, isEmpty);
    },
  );

  group('refusals put nothing on screen and come back as words', () {
    final cases = <String, (Object, ScheduledJoinResult)>{
      'not joinable (409)': (
        const AppError(
          AppErrorKind.unknown,
          code: ScheduledCallCodes.notJoinable,
        ),
        ScheduledJoinResult.notJoinable,
      ),
      'a parent on a group nobody started': (
        const AppError(
          AppErrorKind.forbidden,
          code: ScheduledCallCodes.parentCannotStartGroupCall,
        ),
        ScheduledJoinResult.waitingForHost,
      ),
      'no seat in the live call': (
        const AppError(
          AppErrorKind.unknown,
          code: 'COMM.CALL_NOT_A_PARTICIPANT',
        ),
        ScheduledJoinResult.notAllowed,
      ),
      'not found': (
        const AppError(
          AppErrorKind.notFound,
          code: ScheduledCallCodes.notFound,
        ),
        ScheduledJoinResult.notAllowed,
      ),
      'offline': (
        const AppError(AppErrorKind.network),
        ScheduledJoinResult.network,
      ),
    };

    cases.forEach((name, value) {
      test(name, () async {
        final c = await ready();
        scheduled.joinError = value.$1;

        final result = await join(c);

        expect(result, value.$2);
        expect(stateOf(c).phase, CallUiPhase.idle);
        expect(calls.acceptCalls, isEmpty);
        expect(room.connects, isEmpty);
      });
    });
  });

  test('busy: a live call is never interrupted by a Join', () async {
    final c = await ready();
    await controllerOf(
      c,
    ).start(conversationId: 'conv_2', peerLabel: 'Mr. Ahmed', isGroup: false);
    await settle();
    expect(stateOf(c).phase, CallUiPhase.outgoingRinging);

    final result = await join(c);

    expect(result, ScheduledJoinResult.busy);
    expect(scheduled.joins, isEmpty, reason: 'the server is not even asked');
    expect(stateOf(c).conversationId, 'conv_2');
  });

  test('a build with no scheduled-call repository says unavailable', () async {
    final c = await ready(withScheduled: false);

    expect(await join(c), ScheduledJoinResult.unavailable);
    expect(stateOf(c).phase, CallUiPhase.idle);
  });

  test('the existing start() is unchanged by the addition', () async {
    final c = await ready();
    await controllerOf(
      c,
    ).start(conversationId: 'conv_1', peerLabel: 'Mr. Ahmed', isGroup: false);
    await settle();

    expect(calls.startCalls, ['conv_1']);
    expect(scheduled.joins, isEmpty);
    expect(stateOf(c).phase, CallUiPhase.outgoingRinging);
  });
}
