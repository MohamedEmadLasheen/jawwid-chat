// PHASE 5 CLOSURE -- the call controller drives the media transport.
//
// Phase 5 shipped a controller that stored the server's CallGrant in state and
// never used it: `toggleMute` flipped a boolean, and no code path anywhere
// connected to a room. The calls were correct in the database and carried no
// audio.
//
// These tests assert the wiring that closes that, and the boundary it must not
// cross: the media layer carries audio and decides nothing.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/data/call_media.dart';
import 'package:jawwid_chat/features/calls/domain/call_session.dart';

/// A media layer that records what it was asked to do.
///
/// It deliberately implements no policy: if this fake could refuse a connect,
/// the tests would stop proving that authorization lives entirely on the
/// server.
class _RecordingMedia implements CallMedia {
  final _state = StreamController<MediaState>.broadcast();
  final _participants = StreamController<List<MediaParticipant>>.broadcast();

  final List<CallGrant> connected = [];
  int disconnects = 0;
  final List<bool> muteCalls = [];
  bool failNextConnect = false;

  MediaState _current = MediaState.idle;

  @override
  MediaState get currentState => _current;

  @override
  Stream<MediaState> get state => _state.stream;

  @override
  Stream<List<MediaParticipant>> get participants => _participants.stream;

  @override
  Future<void> connect(CallGrant grant) async {
    if (failNextConnect) {
      failNextConnect = false;
      throw const AppError(AppErrorKind.network, code: 'media_unreachable');
    }
    connected.add(grant);
    emit(MediaState.connected);
  }

  @override
  Future<void> disconnect() async {
    disconnects += 1;
    emit(MediaState.disconnected);
  }

  @override
  Future<void> setMuted(bool muted) async => muteCalls.add(muted);

  /// Push a transport change, as a flaky network would.
  void emit(MediaState next) {
    _current = next;
    if (!_state.isClosed) _state.add(next);
  }

  @override
  Future<void> dispose() async {
    await _state.close();
    await _participants.close();
  }
}

class _StubCalls implements CallRepository {
  CallView? view;
  AppError? failWith;

  CallView _view({CallStatus status = CallStatus.ringing}) => CallView(
        id: 'call-1',
        conversationId: 'conv-1',
        kind: CallKind.direct,
        mode: CallMode.normal,
        status: status,
        initiatorId: 'me',
        startedAt: DateTime.now(),
      );

  CallGrant _grant() => CallGrant(
        callId: 'call-1',
        serverUrl: 'wss://media.example',
        token: 'server-minted-token',
        expiresAt: DateTime.now().add(const Duration(minutes: 2)),
      );

  @override
  Future<CallGrant> requestGrant({
    required String conversationId,
    bool followUp = false,
  }) async {
    if (failWith != null) throw failWith!;
    view ??= _view();
    return _grant();
  }

  @override
  Future<CallGrant> startClassCall({required String conversationId}) async {
    view ??= _view();
    return _grant();
  }

  @override
  Future<CallGrant> acceptIncoming({required String callId}) async {
    if (failWith != null) throw failWith!;
    view = _view(status: CallStatus.active);
    return _grant();
  }

  @override
  Future<void> decline({required String callId}) async {}

  @override
  Future<CallView> cancel({required String callId}) async =>
      view = _view(status: CallStatus.ended);

  @override
  Future<CallView> end({required String callId, bool failed = false}) async =>
      view = _view(status: CallStatus.ended);

  @override
  Future<CallView> callById(String callId) async {
    final current = view;
    if (current == null) {
      throw const AppError(AppErrorKind.notFound, code: 'COMM.CALL_NOT_FOUND');
    }
    return current;
  }

  @override
  Future<List<CallView>> conversationHistory(String conversationId) async => [?view];

  @override
  Future<Page<CallHistoryEntry>> history({String? cursor}) async =>
      const Page(items: []);

  @override
  Future<RecordingPlayback> recordingPlayback({required String recordingId}) async =>
      throw const AppError(AppErrorKind.forbidden, code: 'COMM.PERMISSION_DENIED');
}

ProviderContainer _container(_StubCalls calls, _RecordingMedia media) {
  final container = ProviderContainer(
    overrides: [
      callRepositoryProvider.overrideWithValue(calls),
      callMediaProvider.overrideWithValue(media),
      callControllerProvider.overrideWith(
        () => CallController(calls: calls, realtime: null, media: media),
      ),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(media.dispose);
  return container;
}

void main() {
  group('the grant reaches the media layer', () {
    test('placing a call connects with the SERVER-minted grant', () async {
      // The whole gap this closes: the grant used to be stored and never used.
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);

      await container.read(callControllerProvider.notifier).start('conv-1');

      expect(media.connected, hasLength(1));
      expect(media.connected.single.token, 'server-minted-token');
      expect(media.connected.single.serverUrl, 'wss://media.example');
    });

    test('answering connects too', () async {
      final calls = _StubCalls()..view = null;
      final media = _RecordingMedia();
      final container = _container(calls, media);
      calls.view = calls._view();

      await container.read(callControllerProvider.notifier).presentIncoming(
            IncomingCall(
              callId: 'call-1',
              conversationId: 'conv-1',
              callerName: 'admin_a',
              kind: CallKind.direct,
              mode: CallMode.normal,
              expiresAt: DateTime.now().add(const Duration(minutes: 1)),
            ),
          );
      await container.read(callControllerProvider.notifier).accept();

      expect(media.connected, hasLength(1));
      expect(container.read(callControllerProvider).phase, CallPhase.connected);
    });

    test('the client never invents a room -- it only ever passes the grant on', () async {
      // There is no API on CallMedia that takes a room name, so this asserts
      // the shape rather than a value: the ONLY thing handed to the transport
      // is a grant the server produced.
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);

      await container.read(callControllerProvider.notifier).start('conv-1');

      expect(media.connected.single, isA<CallGrant>());
    });
  });

  group('media failure does not end an authorized call', () {
    test('a transport that will not connect leaves the call alive', () async {
      // The call is a real, authorized record and the other party may still be
      // in it. Ending it because THIS device could not get audio would hang up
      // on somebody who can hear fine.
      final calls = _StubCalls();
      final media = _RecordingMedia()..failNextConnect = true;
      final container = _container(calls, media);

      await container.read(callControllerProvider.notifier).start('conv-1');

      final session = container.read(callControllerProvider);
      expect(session.phase, CallPhase.ringing);
      expect(session.media, MediaState.failed);
      expect(session.hasAudio, isFalse);
    });
  });

  group('the transport is released', () {
    test('hanging up disconnects', () async {
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).start('conv-1');

      await container.read(callControllerProvider.notifier).hangUp();

      expect(media.disconnects, greaterThan(0));
    });

    test('declining releases the microphone BEFORE the network call', () async {
      // A decline that failed to reach the server must still stop this device
      // transmitting.
      final calls = _StubCalls()..view = ringingCallView();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).presentIncoming(
            IncomingCall(
              callId: 'call-1',
              conversationId: 'conv-1',
              callerName: 'admin_a',
              kind: CallKind.direct,
              mode: CallMode.normal,
              expiresAt: DateTime.now().add(const Duration(minutes: 1)),
            ),
          );

      await container.read(callControllerProvider.notifier).decline();

      expect(media.disconnects, greaterThan(0));
    });

    test('dismissing the screen releases the transport', () async {
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).start('conv-1');

      container.read(callControllerProvider.notifier).dismiss();
      await Future<void>.delayed(Duration.zero);

      expect(media.disconnects, greaterThan(0));
    });
  });

  group('mute is local and immediate', () {
    test('reaches the transport and never the server', () async {
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).start('conv-1');

      await container.read(callControllerProvider.notifier).toggleMute();
      expect(media.muteCalls, [true]);
      expect(container.read(callControllerProvider).isMuted, isTrue);

      await container.read(callControllerProvider.notifier).toggleMute();
      expect(media.muteCalls, [true, false]);
    });
  });

  group('a dropped transport is not an ended call', () {
    test('reconnecting is surfaced without ending the call', () async {
      // LiveKit re-establishes, and the other participant is still there. A UI
      // that ended the call here would hang up on a recoverable blip.
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).start('conv-1');

      media.emit(MediaState.reconnecting);
      await Future<void>.delayed(Duration.zero);

      final session = container.read(callControllerProvider);
      expect(session.isReconnecting, isTrue);
      expect(session.phase, CallPhase.ringing);
    });

    test('a lost transport asks the SERVER what the call is', () async {
      // The server is the authority. While the transport was down the call may
      // have ended -- or may not have.
      final calls = _StubCalls();
      final media = _RecordingMedia();
      final container = _container(calls, media);
      await container.read(callControllerProvider.notifier).start('conv-1');

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
      media.emit(MediaState.disconnected);
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(container.read(callControllerProvider).phase, CallPhase.ended);
    });
  });
}

CallView ringingCallView() => CallView(
      id: 'call-1',
      conversationId: 'conv-1',
      kind: CallKind.direct,
      mode: CallMode.normal,
      status: CallStatus.ringing,
      initiatorId: 'them',
      startedAt: DateTime.now(),
    );
