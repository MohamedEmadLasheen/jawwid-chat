// PHASE 5 -- the call controller.
//
// The property under test throughout: THE SERVER OWNS THE CALL, THE CONTROLLER
// OWNS THE SCREEN. Every case here is one where a naive client would decide
// something locally and be wrong.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/domain/call_session.dart';

/// A call repository whose answers a test writes directly.
///
/// It reimplements NO state machine. The real one is on the server, and a fake
/// that had its own would let these tests pass against rules the server does
/// not have.
class _StubCalls implements CallRepository {
  _StubCalls();

  CallView? view;
  AppError? failWith;
  final List<String> actions = [];

  CallView _defaultView({
    CallStatus status = CallStatus.ringing,
    CallMode mode = CallMode.normal,
    DateTime? ringExpiresAt,
  }) =>
      CallView(
        id: 'call-1',
        conversationId: 'conv-1',
        kind: CallKind.direct,
        mode: mode,
        status: status,
        initiatorId: 'me',
        startedAt: DateTime.now(),
        ringExpiresAt: ringExpiresAt,
      );

  @override
  Future<CallGrant> requestGrant({
    required String conversationId,
    bool followUp = false,
  }) async {
    actions.add('start:$conversationId:${followUp ? 'follow_up' : 'normal'}');
    if (failWith != null) throw failWith!;
    view ??= _defaultView(mode: followUp ? CallMode.followUp : CallMode.normal);
    return _grant();
  }

  @override
  Future<CallGrant> startClassCall({required String conversationId}) async {
    actions.add('class:$conversationId');
    if (failWith != null) throw failWith!;
    view ??= _defaultView();
    return _grant();
  }

  @override
  Future<CallGrant> acceptIncoming({required String callId}) async {
    actions.add('accept:$callId');
    if (failWith != null) throw failWith!;
    view = _defaultView(status: CallStatus.active);
    return _grant();
  }

  @override
  Future<void> decline({required String callId}) async {
    actions.add('decline:$callId');
    if (failWith != null) throw failWith!;
  }

  @override
  Future<CallView> cancel({required String callId}) async {
    actions.add('cancel:$callId');
    if (failWith != null) throw failWith!;
    return view = _defaultView(status: CallStatus.ended);
  }

  @override
  Future<CallView> end({required String callId, bool failed = false}) async {
    actions.add('end:$callId:${failed ? 'failed' : 'normal'}');
    if (failWith != null) throw failWith!;
    return view = _defaultView(status: CallStatus.ended);
  }

  @override
  Future<CallView> callById(String callId) async {
    actions.add('get:$callId');
    final current = view;
    if (current == null) {
      throw const AppError(AppErrorKind.notFound, code: 'COMM.CALL_NOT_FOUND');
    }
    return current;
  }

  @override
  Future<List<CallView>> conversationHistory(String conversationId) async =>
      [?view];

  @override
  Future<Page<CallHistoryEntry>> history({String? cursor}) async =>
      const Page(items: []);

  @override
  Future<RecordingPlayback> recordingPlayback({required String recordingId}) async =>
      throw const AppError(AppErrorKind.forbidden, code: 'COMM.PERMISSION_DENIED');

  CallGrant _grant() => CallGrant(
        callId: 'call-1',
        serverUrl: 'wss://media.example',
        token: 'token',
        expiresAt: DateTime.now().add(const Duration(minutes: 2)),
      );
}

ProviderContainer _container(_StubCalls calls, {FakeRealtimeClient? realtime}) {
  final container = ProviderContainer(
    overrides: [
      callRepositoryProvider.overrideWithValue(calls),
      callControllerProvider.overrideWith(
        () => CallController(calls: calls, realtime: realtime),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('placing a call', () {
    test('renders the state the SERVER returned, not the one we asked for', () async {
      final calls = _StubCalls();
      // The server says NORMAL even though the client asked for a follow-up --
      // which is exactly what happens when the account lacks calls.record and
      // the request is downgraded rather than refused.
      calls.view = CallView(
        id: 'call-1',
        conversationId: 'conv-1',
        kind: CallKind.direct,
        mode: CallMode.normal,
        status: CallStatus.ringing,
        initiatorId: 'me',
        startedAt: DateTime.now(),
      );
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).start('conv-1', followUp: true);

      final session = container.read(callControllerProvider);
      expect(session.phase, CallPhase.ringing);
      // No recording indicator over a call nobody is recording.
      expect(session.isRecordable, isFalse);
    });

    test('shows the recording indicator when the SERVER says follow-up', () async {
      final calls = _StubCalls();
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).start('conv-1', followUp: true);

      expect(container.read(callControllerProvider).isRecordable, isTrue);
    });

    test('a refusal ends the call with the server’s code, and never retries', () async {
      final calls = _StubCalls()
        ..failWith = const AppError(
          AppErrorKind.forbidden,
          code: 'COMM.PARENT_CANNOT_START_GROUP_CALL',
        );
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).start('conv-1');

      final session = container.read(callControllerProvider);
      expect(session.phase, CallPhase.ended);
      expect(session.errorCode, 'COMM.PARENT_CANNOT_START_GROUP_CALL');
      expect(calls.actions.where((a) => a.startsWith('start:')), hasLength(1));
    });
  });

  group('incoming invitations', () {
    IncomingCall invitation({DateTime? expiresAt}) => IncomingCall(
          callId: 'call-1',
          conversationId: 'conv-1',
          callerName: 'teacher_c',
          kind: CallKind.direct,
          mode: CallMode.normal,
          expiresAt: expiresAt,
        );

    test('a STALE invitation never rings', () async {
      // A push that sat in a queue, or an app resumed an hour later. Ringing
      // for a call that is over is worse than missing it.
      final calls = _StubCalls();
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).presentIncoming(
            invitation(expiresAt: DateTime.now().subtract(const Duration(minutes: 5))),
          );

      expect(container.read(callControllerProvider).phase, CallPhase.idle);
      // Not even a round trip: the expiry alone settled it.
      expect(calls.actions, isEmpty);
    });

    test('an invitation the SERVER says is over never rings', () async {
      // Not expired by the clock, but declined or cancelled already. Only the
      // server knows, which is why the controller asks.
      final calls = _StubCalls()
        ..view = CallView(
          id: 'call-1',
          conversationId: 'conv-1',
          kind: CallKind.direct,
          mode: CallMode.normal,
          status: CallStatus.ended,
          outcome: CallOutcome.declined,
          initiatorId: 'them',
          startedAt: DateTime.now(),
        );
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).presentIncoming(
            invitation(expiresAt: DateTime.now().add(const Duration(minutes: 1))),
          );

      expect(container.read(callControllerProvider).phase, CallPhase.idle);
      expect(calls.actions, contains('get:call-1'));
    });

    test('a live invitation rings', () async {
      final calls = _StubCalls()
        ..view = CallView(
          id: 'call-1',
          conversationId: 'conv-1',
          kind: CallKind.direct,
          mode: CallMode.normal,
          status: CallStatus.ringing,
          initiatorId: 'them',
          startedAt: DateTime.now(),
        );
      final container = _container(calls);

      await container.read(callControllerProvider.notifier).presentIncoming(
            invitation(expiresAt: DateTime.now().add(const Duration(minutes: 1))),
          );

      expect(container.read(callControllerProvider).phase, CallPhase.incoming);
    });

    test('a second invitation never interrupts a call in progress', () async {
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');
      await container.read(callControllerProvider.notifier).accept();
      expect(container.read(callControllerProvider).phase, CallPhase.connected);

      await container.read(callControllerProvider.notifier).presentIncoming(
            invitation(expiresAt: DateTime.now().add(const Duration(minutes: 1))),
          );

      expect(container.read(callControllerProvider).phase, CallPhase.connected);
    });

    test('accepting a call the server has closed ends the screen', () async {
      final calls = _StubCalls()
        ..view = CallView(
          id: 'call-1',
          conversationId: 'conv-1',
          kind: CallKind.direct,
          mode: CallMode.normal,
          status: CallStatus.ringing,
          initiatorId: 'them',
          startedAt: DateTime.now(),
        );
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).presentIncoming(
            invitation(expiresAt: DateTime.now().add(const Duration(minutes: 1))),
          );

      calls.failWith = const AppError(
        AppErrorKind.forbidden,
        code: 'COMM.CALL_INVALID_TRANSITION',
      );
      await container.read(callControllerProvider.notifier).accept();

      final session = container.read(callControllerProvider);
      expect(session.phase, CallPhase.ended);
      expect(session.errorCode, 'COMM.CALL_INVALID_TRANSITION');
    });
  });

  group('ending', () {
    test('an unanswered outgoing call is CANCELLED, not hung up', () async {
      // Reporting it as a hang-up would put a missed call in the recipient's
      // history for a call the caller never let ring.
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');

      await container.read(callControllerProvider.notifier).hangUp();

      expect(calls.actions, contains('cancel:call-1'));
      expect(calls.actions.any((a) => a.startsWith('end:')), isFalse);
    });

    test('a connected call is ended', () async {
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');
      await container.read(callControllerProvider.notifier).accept();

      await container.read(callControllerProvider.notifier).hangUp();

      expect(calls.actions, contains('end:call-1:normal'));
    });

    test('the screen still closes when the network refuses the hang-up', () async {
      // The alternative is trapping the user on a call UI they have left.
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');
      calls.failWith = const AppError(AppErrorKind.network, code: 'offline');

      await container.read(callControllerProvider.notifier).hangUp();

      expect(container.read(callControllerProvider).phase, CallPhase.ended);
    });
  });

  group('realtime is a hint, never the truth', () {
    test('a duplicated call.ended changes nothing the second time', () async {
      final realtime = FakeRealtimeClient();
      addTearDown(realtime.dispose);
      final calls = _StubCalls();
      final container = _container(calls, realtime: realtime);
      await container.read(callControllerProvider.notifier).start('conv-1');

      realtime.emit(RealtimeEvent.callEnded, {'callId': 'call-1'});
      await Future<void>.delayed(Duration.zero);
      final first = container.read(callControllerProvider);

      realtime.emit(RealtimeEvent.callEnded, {'callId': 'call-1'});
      await Future<void>.delayed(Duration.zero);
      final second = container.read(callControllerProvider);

      expect(first.phase, CallPhase.ended);
      expect(second.phase, CallPhase.ended);
    });

    test('an event for ANOTHER call is ignored', () async {
      final realtime = FakeRealtimeClient();
      addTearDown(realtime.dispose);
      final calls = _StubCalls();
      final container = _container(calls, realtime: realtime);
      await container.read(callControllerProvider.notifier).start('conv-1');

      realtime.emit(RealtimeEvent.callEnded, {'callId': 'somebody-elses-call'});
      await Future<void>.delayed(Duration.zero);

      expect(container.read(callControllerProvider).phase, CallPhase.ringing);
    });

    test('call.missed closes a ringing screen', () async {
      final realtime = FakeRealtimeClient();
      addTearDown(realtime.dispose);
      final calls = _StubCalls();
      final container = _container(calls, realtime: realtime);
      await container.read(callControllerProvider.notifier).start('conv-1');

      realtime.emit(RealtimeEvent.callMissed, {'callId': 'call-1'});
      await Future<void>.delayed(Duration.zero);

      expect(container.read(callControllerProvider).phase, CallPhase.ended);
    });
  });

  group('reconnect', () {
    test('re-reads the call from the server rather than trusting memory', () async {
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');

      // While the socket was down the call ended. Nothing local knows.
      calls.view = CallView(
        id: 'call-1',
        conversationId: 'conv-1',
        kind: CallKind.direct,
        mode: CallMode.normal,
        status: CallStatus.ended,
        outcome: CallOutcome.missed,
        initiatorId: 'me',
        startedAt: DateTime.now(),
      );

      await container.read(callControllerProvider.notifier).reconcile();

      expect(container.read(callControllerProvider).phase, CallPhase.ended);
    });

    test('a failed reconcile does NOT tear down a live call', () async {
      final calls = _StubCalls();
      final container = _container(calls);
      await container.read(callControllerProvider.notifier).start('conv-1');
      await container.read(callControllerProvider.notifier).accept();

      calls.view = null; // the poll fails
      await container.read(callControllerProvider.notifier).reconcile();

      expect(container.read(callControllerProvider).phase, CallPhase.connected);
    });
  });
}
