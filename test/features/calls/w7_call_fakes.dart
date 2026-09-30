/// Seams for the W7 call experience, and nothing more.
///
/// Every one of these stands where W1–W6 put a port, so the call controller and
/// the call screen can be driven without a device, a microphone, a socket or a
/// server. The REAL [CallMediaClient] is used in these tests — only the room,
/// the microphone and the audio route are faked — because the wiring of that
/// client is part of what W7 must prove.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/call_media/audio_route.dart';
import 'package:jawwid_chat/core/call_media/media_room.dart';
import 'package:jawwid_chat/core/call_media/microphone_permission.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The call API, recorded rather than performed.
class FakeCalls implements CallRepository {
  FakeCalls({this.capabilityAnswer = const CallCapability(canCall: true)});

  CallCapability capabilityAnswer;

  /// Set to throw instead of answering, per operation.
  Object? capabilityError;
  Object? startError;
  Object? acceptError;
  Object? declineError;
  Object? endError;
  Object? tokenError;

  final capabilityCalls = <String>[];
  final startCalls = <String>[];
  final acceptCalls = <String>[];
  final declineCalls = <String>[];
  final endCalls = <String>[];
  final tokenCalls = <String>[];

  String nextCallId = 'call_1';
  List<CallHistoryEntry> history = const [];

  @override
  Future<CallCapability> capability({required String conversationId}) async {
    capabilityCalls.add(conversationId);
    if (capabilityError != null) throw capabilityError!;
    return capabilityAnswer;
  }

  @override
  Future<StartedCall> start({required String conversationId}) async {
    startCalls.add(conversationId);
    if (startError != null) throw startError!;
    return StartedCall(callId: nextCallId, roomName: 'jawwid-room-$nextCallId');
  }

  @override
  Future<CallMediaGrant> mediaToken({required String callId}) async {
    tokenCalls.add(callId);
    if (tokenError != null) throw tokenError!;
    return CallMediaGrant(
      token: 'media-token',
      serverUrl: 'wss://example.invalid',
      roomName: 'jawwid-room-$callId',
      expiresAt: DateTime.now().add(const Duration(minutes: 2)),
    );
  }

  @override
  Future<void> accept({required String callId}) async {
    acceptCalls.add(callId);
    if (acceptError != null) throw acceptError!;
  }

  @override
  Future<void> decline({required String callId}) async {
    declineCalls.add(callId);
    if (declineError != null) throw declineError!;
  }

  @override
  Future<void> end({required String callId}) async {
    endCalls.add(callId);
    if (endError != null) throw endError!;
  }

  @override
  Future<List<CallHistoryEntry>> callHistory({
    required String conversationId,
  }) async =>
      history.where((entry) => entry.conversationId == conversationId).toList();
}

/// The W4 [MediaRoom] port, driven by the test.
class FakeRoom implements MediaRoom {
  final _events = StreamController<MediaRoomEvent>.broadcast();

  final connects = <String>[];
  int disconnects = 0;
  int disposes = 0;
  final microphoneEnabled = <bool>[];

  /// Make `connect` throw, as an unreachable room does.
  Object? connectError;

  /// Whether a successful connect auto-emits `MediaRoomConnected`. Off lets a
  /// test hold the call in `connecting`.
  bool announceConnected = true;

  /// Whether enabling the microphone auto-emits `LocalMicrophonePublished`.
  ///
  /// W4 does not wait for `MediaRoomConnected` before publishing — it publishes
  /// as soon as `connect` RETURNS — so holding a join open needs both of these
  /// off, not just the first.
  bool announcePublished = true;

  @override
  Stream<MediaRoomEvent> get events => _events.stream;

  @override
  Future<void> connect({required String url, required String token}) async {
    connects.add(token);
    if (connectError != null) throw connectError!;
    if (announceConnected) emit(const MediaRoomConnected());
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    microphoneEnabled.add(enabled);
    if (enabled && announcePublished) emit(const LocalMicrophonePublished());
  }

  @override
  Future<void> disconnect() async => disconnects++;

  @override
  Future<void> dispose() async {
    disposes++;
    if (!_events.isClosed) await _events.close();
  }

  void emit(MediaRoomEvent event) {
    if (!_events.isClosed) _events.add(event);
  }

  /// A close nobody asked for.
  void drop() => emit(const MediaRoomDisconnected(byServer: true));
}

/// A microphone that answers however the test says.
class FakeMic implements MicrophonePermission {
  FakeMic([this.access = MicrophoneAccess.granted]);
  MicrophoneAccess access;
  int calls = 0;

  @override
  Future<MicrophoneAccess> ensure() async {
    calls++;
    return access;
  }
}

/// An audio route with no device behind it.
class FakeAudioRoute implements AudioRoute {
  FakeAudioRoute({this.canSwitch = true});

  @override
  final bool canSwitch;

  bool _preferred = false;
  final requested = <bool>[];

  @override
  bool get speakerPreferred => _preferred;

  @override
  Future<void> setSpeakerPreferred(bool preferred) async {
    requested.add(preferred);
    if (!canSwitch) return;
    _preferred = preferred;
  }
}

/// The REAL [AuthController] with a state the test can move.
///
/// Subclassed rather than replaced, for the reason `call_session_test.dart`
/// gives: what is under test is how the call layer reacts to an authentication
/// state, and a different notifier would prove that against something the app
/// never uses.
class ScriptedAuth extends AuthController {
  factory ScriptedAuth(AuthState initial) =>
      ScriptedAuth._(InMemoryTokenStore(), initial);

  ScriptedAuth._(TokenStore store, this._initial)
      : super(
          repository: FakeAuthRepository(
            backend: FakeBackend(role: UserRole.parent),
            tokens: store,
          ),
          tokens: store,
          clearLocalData: _noop,
        );

  static Future<void> _noop() async {}

  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void authenticate(String accountId, {UserRole role = UserRole.parent}) {
    state = AuthAuthenticated(
      AuthUser(id: accountId, displayName: 'account_$accountId', role: role),
    );
  }

  void endSession() => state = const AuthSignedOut();
}

/// The W2 socket seam, so the REAL [CallRealtimeClient] can be used.
///
/// W7 consumes the closed W2/W3 realtime chain rather than a stand-in for it:
/// frames go in as the server sends them and come out decoded by W2's own
/// `decodeCallEvent`, so a payload W7 could not handle fails here rather than in
/// production.
class SpySocket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

  final connectedWith = <String>[];
  int disposeCalls = 0;

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async => connectedWith.add(token);

  @override
  Future<SubscriptionResult> subscribe(String conversationId) async =>
      const SubscriptionResult(ok: true);

  @override
  Future<void> unsubscribe(String conversationId) async {}

  @override
  Future<void> dispose() async => disposeCalls++;

  void emit(String event, Object? payload) {
    if (!_frames.isClosed) _frames.add(RealtimeFrame(event, payload));
  }

  Future<void> close() async {
    if (!_frames.isClosed) await _frames.close();
    if (!_states.isClosed) await _states.close();
  }
}

class FixedTokens implements TokenProvider {
  FixedTokens(this.token);
  final String? token;

  @override
  Future<String?> accessToken() async => token;

  @override
  Future<String?> refresh() async => token;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The frames the server actually sends, as `events.ts` defines them.
///
/// Built here rather than inline so a payload shape is stated once and W2's
/// decoder is what validates it.
abstract final class Frames {
  static Map<String, Object?> incoming({
    String callId = 'call_1',
    String conversationId = 'conv_1',
    bool isGroup = false,
    String initiatorName = 'Mr. Ahmed',
  }) =>
      {
        'callId': callId,
        'conversationId': conversationId,
        'type': isGroup ? 'group' : 'direct',
        'initiatorId': 'actor_caller',
        'initiatorName': initiatorName,
      };

  static Map<String, Object?> participant({
    String callId = 'call_1',
    String conversationId = 'conv_1',
    String actorId = 'actor_other',
  }) =>
      {
        'callId': callId,
        'conversationId': conversationId,
        'actorId': actorId,
      };

  static Map<String, Object?> ended({
    String callId = 'call_1',
    String conversationId = 'conv_1',
    String outcome = 'answered',
    int? durationSeconds = 0,
  }) =>
      {
        'callId': callId,
        'conversationId': conversationId,
        'outcome': outcome,
        'durationSeconds': durationSeconds,
      };
}

/// A signed-in session, for the common case.
AuthState signedIn([String accountId = 'account_1']) => AuthAuthenticated(
      AuthUser(
        id: accountId,
        displayName: 'account_$accountId',
        role: UserRole.parent,
      ),
    );

/// A server refusal carrying a `COMM.*` code.
AppError refusal(String code, {AppErrorKind kind = AppErrorKind.forbidden}) =>
    AppError(kind, code: code);

/// Let every queued microtask run. The controller awaits the repository and the
/// media client, so a test that asserts immediately after an action would assert
/// against a state that has not arrived.
Future<void> settle() => pumpEventQueue(times: 40);
