/// The media client's lifecycle, permissions and cleanup.
///
/// No microphone is opened and no room is joined: [FakeMediaRoom] stands in at
/// the seam. That is what makes the paths worth testing testable at all — a
/// refused permission, a room that rejects the connection, a publish that
/// fails, a participant whose audio comes and goes, a disconnect arriving while
/// disposed.
///
/// WHAT THIS FILE DOES NOT PROVE, and must never be read as proving: that audio
/// works. Nothing here captures a microphone, joins a real room, or hears
/// anything. See the W4 closeout.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/call_media/call_media_client.dart';
import 'package:jawwid_chat/core/call_media/media_room.dart';
import 'package:jawwid_chat/core/call_media/microphone_permission.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';

const _callId = 'call_1';
const _serverUrl = 'wss://jawwid-staging.livekit.cloud';
const _token = 'server.issued.token';

class FakeMediaRoom implements MediaRoom {
  final _events = StreamController<MediaRoomEvent>.broadcast();

  /// Every connect, as (url, token). Recorded so a test can assert the server's
  /// values were used verbatim.
  final connects = <List<String>>[];
  final microphoneCalls = <bool>[];
  int disconnectCalls = 0;
  int disposeCalls = 0;

  /// Set to make connect() throw, standing in for a room that refuses.
  bool refuseConnection = false;

  /// Set to make the publish throw after a successful join.
  bool refusePublish = false;

  /// Set to make a mute attempt throw.
  bool refuseMute = false;

  @override
  Stream<MediaRoomEvent> get events => _events.stream;

  @override
  Future<void> connect({required String url, required String token}) async {
    connects.add([url, token]);
    if (refuseConnection) throw StateError('room refused');
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    if (refusePublish && enabled && microphoneCalls.isEmpty) {
      throw StateError('publish refused');
    }
    if (refuseMute && microphoneCalls.isNotEmpty) {
      throw StateError('mute refused');
    }
    microphoneCalls.add(enabled);
  }

  @override
  Future<void> disconnect() async => disconnectCalls++;

  @override
  Future<void> dispose() async => disposeCalls++;

  // Drivers.
  void arrive() => _emit(const MediaRoomConnected());
  void publishLocalMic() => _emit(const LocalMicrophonePublished());
  void closeByServer() => _emit(const MediaRoomDisconnected(byServer: true));
  void remoteAudio(String participant, String track, {required bool present}) =>
      _emit(RemoteAudioChanged(
        participantId: participant,
        trackId: track,
        present: present,
      ));

  void _emit(MediaRoomEvent event) {
    if (!_events.isClosed) _events.add(event);
  }

  Future<void> close() async {
    if (!_events.isClosed) await _events.close();
  }
}

class FakePermission implements MicrophonePermission {
  FakePermission(this.access);
  MicrophoneAccess access;
  int calls = 0;

  @override
  Future<MicrophoneAccess> ensure() async {
    calls++;
    return access;
  }
}

/// Only [mediaToken] is reached by this client. Everything else throws, so a
/// test fails loudly if the media layer starts calling the rest of the API.
class FakeCalls implements CallRepository {
  FakeCalls({this.failToken = false});

  bool failToken;
  final tokenRequests = <String>[];

  @override
  Future<CallMediaGrant> mediaToken({required String callId}) async {
    tokenRequests.add(callId);
    if (failToken) {
      throw const AppError(AppErrorKind.forbidden, code: 'COMM.CALL_ALREADY_ENDED');
    }
    return CallMediaGrant(
      token: _token,
      serverUrl: _serverUrl,
      roomName: 'jawwid-conv-abc-uuid',
      expiresAt: DateTime.utc(2026, 9, 27, 12),
    );
  }

  @override
  Future<CallCapability> capability({required String conversationId}) =>
      throw UnimplementedError('the media client must not ask for capability');
  @override
  Future<StartedCall> start({required String conversationId}) =>
      throw UnimplementedError('the media client must not start calls');
  @override
  Future<void> accept({required String callId}) =>
      throw UnimplementedError('the media client must not accept calls');
  @override
  Future<void> decline({required String callId}) =>
      throw UnimplementedError('the media client must not decline calls');
  @override
  Future<void> end({required String callId, String? outcome}) =>
      throw UnimplementedError('the media client must not end calls');
  @override
  Future<List<CallHistoryEntry>> callHistory({
    required String conversationId,
  }) =>
      throw UnimplementedError('the media client must not read history');
}

void main() {
  late FakeMediaRoom room;
  late FakePermission permission;
  late FakeCalls calls;
  late CallMediaClient client;

  CallMediaClient build({
    MicrophoneAccess access = MicrophoneAccess.granted,
    bool failToken = false,
  }) {
    room = FakeMediaRoom();
    permission = FakePermission(access);
    calls = FakeCalls(failToken: failToken);
    client = CallMediaClient(
      calls: calls,
      room: room,
      microphone: permission,
    );
    addTearDown(client.dispose);
    addTearDown(room.close);
    return client;
  }

  /// Connect and drive the room all the way to a published microphone.
  Future<void> goLive() async {
    await client.connect(callId: _callId);
    room.arrive();
    await pumpEventQueue();
    room.publishLocalMic();
    await pumpEventQueue();
  }

  // -----------------------------------------------------------------------
  group('1–4. the token and the room are the server’s', () {
    test('1. the token is obtained before the room is connected', () async {
      build();
      await client.connect(callId: _callId);

      expect(calls.tokenRequests, [_callId]);
      expect(room.connects, hasLength(1));
    });

    test('2/3. the server’s URL and token are used verbatim', () async {
      build();
      await client.connect(callId: _callId);

      expect(room.connects.single, [_serverUrl, _token]);
    });

    test('4. no room name is passed, because there is nowhere to pass one',
        () async {
      build();
      await client.connect(callId: _callId);

      // The grant carries a roomName; the connect does not take it. The room is
      // signed into the token, so a client cannot choose or derive one.
      final passed = room.connects.single.join(' ');
      expect(passed, isNot(contains('jawwid-conv-abc-uuid')));
      expect(passed, isNot(contains(_callId)));
    });

    test('21. a refused token prevents the room connection entirely', () async {
      build(failToken: true);
      await client.connect(callId: _callId);

      expect(room.connects, isEmpty);
      expect(client.snapshot.phase, CallMediaPhase.failed);
      expect(client.snapshot.failure, CallMediaFailure.tokenUnavailable);
    });

    test('20. a room that refuses gives a deterministic failure, and releases',
        () async {
      build();
      room.refuseConnection = true;

      await client.connect(callId: _callId);

      expect(client.snapshot.phase, CallMediaPhase.failed);
      expect(client.snapshot.failure, CallMediaFailure.connectionFailed);
      // Nothing left running.
      expect(room.disconnectCalls, 1);
      expect(room.disposeCalls, 1);
    });

    test('a publish that fails after joining leaves the room, not a silent seat',
        () async {
      build();
      room.refusePublish = true;

      await client.connect(callId: _callId);

      expect(client.snapshot.failure, CallMediaFailure.publishFailed);
      expect(room.disposeCalls, 1);
    });
  });

  // -----------------------------------------------------------------------
  group('5/6. microphone permission', () {
    test('5. granted permission leads to a publish attempt', () async {
      build();
      await client.connect(callId: _callId);

      expect(permission.calls, 1);
      expect(room.microphoneCalls, [true]);
    });

    test('6. a denied microphone fails cleanly and never joins', () async {
      build(access: MicrophoneAccess.denied);

      await client.connect(callId: _callId);

      expect(client.snapshot.phase, CallMediaPhase.failed);
      expect(client.snapshot.failure,
          CallMediaFailure.microphonePermissionDenied);
      // Asked BEFORE joining, so there is no half-joined session to clean up
      // and the user is not sitting in a call nobody can hear.
      expect(room.connects, isEmpty);
      expect(calls.tokenRequests, isEmpty);
      expect(room.microphoneCalls, isEmpty);
    });

    test('an unavailable microphone is a different failure from a refused one',
        () async {
      build(access: MicrophoneAccess.unavailable);
      await client.connect(callId: _callId);

      expect(client.snapshot.failure, CallMediaFailure.microphoneUnavailable);
    });

    test('permission is asked before the token, so a refusal costs no request',
        () async {
      build(access: MicrophoneAccess.denied);
      await client.connect(callId: _callId);

      expect(permission.calls, 1);
      expect(calls.tokenRequests, isEmpty);
    });
  });

  // -----------------------------------------------------------------------
  group('the four states stay four states', () {
    test('joining the room is not being live', () async {
      build();
      await client.connect(callId: _callId);
      room.arrive();
      await pumpEventQueue();

      // In the room, nothing published. Nobody can hear this device yet, and
      // the phase says so rather than reading "connected".
      expect(client.snapshot.phase, CallMediaPhase.roomConnected);
    });

    test('only the room’s own publish event makes it live', () async {
      build();
      await client.connect(callId: _callId);
      room.arrive();
      await pumpEventQueue();
      expect(client.snapshot.phase, isNot(CallMediaPhase.live));

      room.publishLocalMic();
      await pumpEventQueue();

      expect(client.snapshot.phase, CallMediaPhase.live);
    });

    test('being live is not hearing anybody', () async {
      build();
      await goLive();

      expect(client.snapshot.phase, CallMediaPhase.live);
      expect(client.snapshot.hasRemoteAudio, isFalse);
    });
  });

  // -----------------------------------------------------------------------
  group('7/8. camera and screen share are never reached for', () {
    test('7/8. the seam offers no camera or screen method at all', () {
      // Structural. The client cannot publish what the port cannot express, and
      // the port is where that is decided.
      final port = File('lib/core/call_media/media_room.dart').readAsStringSync();
      final client =
          File('lib/core/call_media/call_media_client.dart').readAsStringSync();

      for (final source in [port, client]) {
        expect(source, isNot(contains('setCameraEnabled')));
        expect(source, isNot(contains('setScreenShareEnabled')));
        expect(source, isNot(contains('CameraCaptureOptions')));
        expect(source, isNot(contains('ScreenShareCaptureOptions')));
      }
    });

    test('7/8. the adapter never calls the SDK’s camera or screen methods', () {
      final adapter =
          File('lib/core/call_media/livekit_media_room.dart').readAsStringSync();

      // Mentioned in prose, explaining that they are not used; never called.
      expect(adapter, isNot(contains('.setCameraEnabled(')));
      expect(adapter, isNot(contains('.setScreenShareEnabled(')));
      expect(adapter, isNot(contains('TrackSource.camera')));
      expect(adapter, isNot(contains('TrackSource.screenShareVideo')));
    });

    test('the only microphone call carries a boolean, and nothing else',
        () async {
      build();
      await goLive();

      // Every interaction with local capture is setMicrophoneEnabled.
      expect(room.microphoneCalls, [true]);
    });
  });

  // -----------------------------------------------------------------------
  group('9–12. mute is orthogonal to being connected', () {
    test('9. mute stops the microphone without leaving the room', () async {
      build();
      await goLive();

      await client.mute();

      expect(room.microphoneCalls, [true, false]);
      expect(client.snapshot.microphoneMuted, isTrue);
      // Still live. Muting is not leaving.
      expect(client.snapshot.phase, CallMediaPhase.live);
      expect(room.disconnectCalls, 0);
      expect(room.disposeCalls, 0);
    });

    test('10. unmute resumes it without reconnecting', () async {
      build();
      await goLive();
      await client.mute();

      await client.unmute();

      expect(room.microphoneCalls, [true, false, true]);
      expect(client.snapshot.microphoneMuted, isFalse);
      expect(room.connects, hasLength(1));
    });

    test('11. muting twice asks the room once', () async {
      build();
      await goLive();

      await client.mute();
      await client.mute();
      await client.mute();

      expect(room.microphoneCalls, [true, false]);
      expect(client.snapshot.microphoneMuted, isTrue);
    });

    test('12. unmuting twice asks the room once', () async {
      build();
      await goLive();
      await client.mute();

      await client.unmute();
      await client.unmute();

      expect(room.microphoneCalls, [true, false, true]);
    });

    test('mute before anything is published does nothing', () async {
      build();
      await client.connect(callId: _callId);
      room.arrive();
      await pumpEventQueue();

      await client.mute();

      // There is no track to mute. Reporting a mute state the device is not in
      // would be worse than refusing.
      expect(client.snapshot.microphoneMuted, isFalse);
      expect(room.microphoneCalls, [true]);
    });

    test('a mute the room refuses is not reported as taken', () async {
      build();
      await goLive();
      room.refuseMute = true;

      await client.mute();

      // The worst available lie is telling somebody they are muted when they
      // are not.
      expect(client.snapshot.microphoneMuted, isFalse);
    });
  });

  // -----------------------------------------------------------------------
  group('13–15. remote audio', () {
    test('13/14. a remote audio publication is observed and held', () async {
      build();
      await goLive();

      room.remoteAudio('parent_1', 'track_a', present: true);
      await pumpEventQueue();

      expect(client.snapshot.remoteAudioParticipants, {
        const RemoteAudio(participantId: 'parent_1', trackId: 'track_a'),
      });
      expect(client.snapshot.hasRemoteAudio, isTrue);
    });

    test('15. a track that goes away is released', () async {
      build();
      await goLive();
      room.remoteAudio('parent_1', 'track_a', present: true);
      await pumpEventQueue();

      room.remoteAudio('parent_1', 'track_a', present: false);
      await pumpEventQueue();

      expect(client.snapshot.remoteAudioParticipants, isEmpty);
      expect(client.snapshot.hasRemoteAudio, isFalse);
    });

    test('a republished track does not discard the one still arriving',
        () async {
      build();
      await goLive();
      room.remoteAudio('parent_1', 'track_a', present: true);
      room.remoteAudio('parent_1', 'track_b', present: true);
      await pumpEventQueue();

      // The first goes away; the second is the same participant and must stay.
      room.remoteAudio('parent_1', 'track_a', present: false);
      await pumpEventQueue();

      expect(client.snapshot.remoteAudioParticipants, {
        const RemoteAudio(participantId: 'parent_1', trackId: 'track_b'),
      });
    });

    test('several participants are tracked independently', () async {
      build();
      await goLive();
      room.remoteAudio('parent_1', 'track_a', present: true);
      room.remoteAudio('teacher_1', 'track_b', present: true);
      await pumpEventQueue();

      expect(client.snapshot.remoteAudioParticipants, hasLength(2));

      room.remoteAudio('parent_1', 'track_a', present: false);
      await pumpEventQueue();

      expect(client.snapshot.remoteAudioParticipants, {
        const RemoteAudio(participantId: 'teacher_1', trackId: 'track_b'),
      });
    });
  });

  // -----------------------------------------------------------------------
  group('16–19, 22. disconnect and disposal', () {
    test('16/17/18. disconnect releases the room and the listener', () async {
      build();
      await goLive();

      await client.disconnect();

      expect(room.disconnectCalls, 1);
      expect(room.disposeCalls, 1);
      expect(client.snapshot.phase, CallMediaPhase.disconnected);
    });

    test('16. disconnecting twice does not throw or release twice', () async {
      build();
      await goLive();

      await client.disconnect();
      await client.disconnect();
      await client.disconnect();

      expect(room.disconnectCalls, 1);
      expect(room.disposeCalls, 1);
    });

    test('disconnect clears the media state', () async {
      build();
      await goLive();
      room.remoteAudio('parent_1', 'track_a', present: true);
      await pumpEventQueue();
      await client.mute();

      await client.disconnect();

      // Remote audio and mute belonged to a session that has ended.
      expect(client.snapshot.remoteAudioParticipants, isEmpty);
      expect(client.snapshot.microphoneMuted, isFalse);
    });

    test('19. a room event after disconnect cannot move the state', () async {
      build();
      await goLive();
      await client.disconnect();

      room.arrive();
      room.publishLocalMic();
      room.remoteAudio('parent_1', 'track_a', present: true);
      await pumpEventQueue();

      expect(client.snapshot.phase, CallMediaPhase.disconnected);
      expect(client.snapshot.remoteAudioParticipants, isEmpty);
    });

    test('19/22. no media operation happens after dispose', () async {
      build();
      await goLive();
      final micCallsBefore = room.microphoneCalls.length;

      await client.dispose();
      await client.dispose();

      await client.mute();
      await client.unmute();
      await client.connect(callId: _callId);
      room.publishLocalMic();
      await pumpEventQueue();

      expect(room.microphoneCalls, hasLength(micCallsBefore));
      expect(room.connects, hasLength(1));
      expect(room.disposeCalls, 1);
    });

    test('dispose is idempotent and safe after disconnect', () async {
      build();
      await goLive();

      await client.disconnect();
      await client.dispose();
      await client.dispose();

      expect(room.disposeCalls, 1);
    });

    test('a server-initiated close is reported, and starts no reconnect',
        () async {
      build();
      await goLive();

      room.closeByServer();
      await pumpEventQueue();

      expect(client.snapshot.phase, CallMediaPhase.disconnected);
      // W3 owns credential and session lifecycle. A media layer with its own
      // retry would be a second one.
      expect(room.connects, hasLength(1));
    });

    test('connecting twice does not open a second room', () async {
      build();
      await client.connect(callId: _callId);
      await client.connect(callId: _callId);
      room.arrive();
      await pumpEventQueue();
      await client.connect(callId: _callId);

      expect(room.connects, hasLength(1));
      expect(calls.tokenRequests, hasLength(1));
    });
  });

  // -----------------------------------------------------------------------
  group('the media client stays in its lane', () {
    test('it touches no call operation but the media token', () async {
      // FakeCalls throws on every other method, so reaching one fails here.
      build();
      await goLive();
      await client.mute();
      await client.unmute();
      await client.disconnect();

      expect(calls.tokenRequests, [_callId]);
    });

    test('it imports nothing from UI, push, platform calling or the socket', () {
      // Asserted on the IMPORTS. Prose may name a collaborator -- the comments
      // explain what owns what, and that is the point of them -- but an import
      // is a dependency, and there must be none of these.
      for (final path in [
        'lib/core/call_media/call_media_client.dart',
        'lib/core/call_media/media_room.dart',
        'lib/core/call_media/livekit_media_room.dart',
        'lib/core/call_media/microphone_permission.dart',
      ]) {
        final imports = File(path)
            .readAsLinesSync()
            .where((line) => line.startsWith('import '))
            .join('\n');

        for (final forbidden in [
          'callkit',
          'pushkit',
          'connection_service',
          'firebase',
          'flutter/material',
          'flutter/widgets',
          'socket_io',
          'realtime/',
          'features/',
        ]) {
          expect(imports.toLowerCase(), isNot(contains(forbidden)),
              reason: '\$path imports \$forbidden');
        }
      }
    });

    test('no token, URL or room name reaches a log', () {
      final client =
          File('lib/core/call_media/call_media_client.dart').readAsStringSync();
      final logCalls = RegExp(r'_log\.\w+\([^;]*?\);', dotAll: true)
          .allMatches(client)
          .map((m) => m.group(0)!);

      expect(logCalls, isNotEmpty);
      for (final call in logCalls) {
        // Prose may say "token"; what must never appear is an interpolated one.
        // `\$grant.token` in a log line is the failure being looked for, not the
        // noun -- the same distinction the realtime client's log test makes.
        expect(call, isNot(contains(r'\$')), reason: call);
      }
    });
  });
}
