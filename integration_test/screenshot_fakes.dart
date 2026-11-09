/// LR-09j: the seams the store-screenshot run fills, so the REAL app renders with
/// no server, no microphone, no CallKit and no real person.
///
/// Every class here stands where the app already has a port (the same ports the
/// widget tests fill, see `test/features/calls/w7_call_fakes.dart`). Nothing in
/// `lib/` is changed for screenshots: the composition below is the development
/// fixture root (`lib/app/bootstrap.dart` `_fakeOverrides`) with the data swapped
/// for [ShotData], which is synthetic and localized.
library;

import 'dart:async';

import 'package:flutter/material.dart' hide Page;
import 'package:jawwid_chat/app/app.dart';
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
import 'package:jawwid_chat/features/app_lock/data/app_lock_authenticator.dart';
import 'package:jawwid_chat/features/calls/data/account_call_history.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import 'screenshot_fixtures.dart';

/// The language the shots are taken in, fixed: the device's own language is
/// irrelevant to the run, and nothing is persisted between locales.
class FixedLocale extends LocaleController {
  FixedLocale(this.locale);

  final Locale locale;

  @override
  Locale? build() => locale;
}

/// Light theme, always: the store shots are light. (Auto would follow the
/// simulator's appearance, which differs between machines.)
class LightThemeMode extends ThemeModeController {
  @override
  ThemeMode build() => ThemeMode.light;
}

/// The signed-in account, from [ShotData] rather than the fixture backend's
/// placeholder ("ولي أمر" in both languages).
class ShotAuthRepository extends FakeAuthRepository {
  ShotAuthRepository({required super.backend, required super.tokens, required this.data});

  final ShotData data;

  @override
  Future<AuthUser> currentUser() async => data.viewer;
}

/// A token store that already holds a session, so `restore()` signs in the way a
/// returning user is signed in: no sign-in screen, and no first-run App lock
/// offer (that offer follows a password sign-in only).
Future<InMemoryTokenStore> signedInTokenStore() async {
  final store = InMemoryTokenStore();
  await store.write(
    AuthSession(
      accessToken: 'shot-access',
      refreshToken: 'shot-refresh',
      accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 4)),
    ),
  );
  return store;
}

/// The chat list and each conversation, from [ShotData]. Everything else (pin,
/// mute, mark read) falls through to the fixture backend, where it is harmless.
class ShotConversationRepository extends FakeConversationRepository {
  ShotConversationRepository(super.backend, this.data);

  final ShotData data;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async => data.conversations;

  @override
  Future<Conversation> byId(String conversationId) async =>
      data.conversations.firstWhere((c) => c.id == conversationId);

  @override
  Future<List<Conversation>> search(String query) async => const [];
}

/// Each conversation's history, from [ShotData], oldest first like the server's page.
class ShotMessageRepository extends FakeMessageRepository {
  ShotMessageRepository(super.backend, this.data);

  final ShotData data;

  @override
  Future<Page<Message>> history(String conversationId, {String? beforeCursor, int limit = 30}) async {
    if (beforeCursor != null) return const Page(items: []);
    final items = data.messages[conversationId] ?? const <Message>[];
    return Page(items: items, nextCursor: items.isEmpty ? null : '${items.first.sequence}');
  }

  @override
  Future<List<Message>> since(String conversationId, {required int afterSequence}) async => [
        for (final m in data.messages[conversationId] ?? const <Message>[])
          if ((m.sequence ?? 0) > afterSequence) m,
      ];
}

/// The group's members, from [ShotData].
class ShotGroupRepository extends FakeGroupRepository {
  ShotGroupRepository(super.backend, this.data);

  final ShotData data;

  @override
  Future<StudentGroup> group(String conversationId) async =>
      data.groups[conversationId] ?? await super.group(conversationId);
}

/// The lessons a parent's child schedule and a teacher's Schedule tab read.
/// Everything else keeps the no-server answer.
class ShotLessonRepository extends NoLessonRepository {
  const ShotLessonRepository(this.data);

  final ShotData data;

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => data.teacherLessons;

  @override
  Future<List<ScheduledLesson>> learnerLessons(String learnerId, DateTime from, DateTime to) async =>
      [for (final l in data.teacherLessons) if (l.learnerId == learnerId) l];

  @override
  Future<ChildSchedule> childSchedule(String learnerId) async => data.childSchedule;

  @override
  Future<TeacherWorkload> myWorkload() async => data.workload;
}

/// This account's call history (the Calls tab).
class ShotCallHistory implements AccountCallHistoryRepository {
  ShotCallHistory(this.data);

  final ShotData data;

  @override
  Future<Page<CallHistoryEntry>> page({String? cursor}) async =>
      Page(items: cursor == null ? data.callHistory : const []);
}

/// The call API, answered locally. A call joins a [SilentRoom], never LiveKit.
class ShotCallRepository implements CallRepository {
  @override
  Future<CallCapability> capability({required String conversationId}) async =>
      const CallCapability(canCall: true);

  @override
  Future<StartedCall> start({required String conversationId}) async =>
      const StartedCall(callId: ShotIds.callId, roomName: 'shot-room');

  @override
  Future<CallMediaGrant> mediaToken({required String callId}) async => CallMediaGrant(
        token: 'shot-media-token',
        serverUrl: 'wss://media.invalid',
        roomName: 'shot-room',
        expiresAt: DateTime.now().add(const Duration(hours: 1)),
      );

  @override
  Future<void> accept({required String callId}) async {}

  @override
  Future<void> decline({required String callId}) async {}

  @override
  Future<void> end({required String callId, bool connectionLost = false}) async {}

  @override
  Future<List<CallHistoryEntry>> callHistory({required String conversationId}) async => const [];
}

/// A media room that connects at once and publishes the microphone at once, with
/// the other side's audio present. No network, no audio session.
class SilentRoom implements MediaRoom {
  final _events = StreamController<MediaRoomEvent>.broadcast();

  @override
  Stream<MediaRoomEvent> get events => _events.stream;

  @override
  Future<void> connect({required String url, required String token}) async =>
      _emit(const MediaRoomConnected());

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {
    if (enabled) _emit(const LocalMicrophonePublished());
  }

  @override
  Future<void> disconnect() async {}

  @override
  Future<void> dispose() async {
    if (!_events.isClosed) await _events.close();
  }

  void _emit(MediaRoomEvent event) {
    if (!_events.isClosed) _events.add(event);
  }
}

/// The microphone is granted without an OS prompt (a prompt would be in the shot).
class GrantedMicrophone implements MicrophonePermission {
  @override
  Future<MicrophoneAccess> ensure() async => MicrophoneAccess.granted;
}

/// An audio route with no device behind it; the speaker button is shown.
class ShotAudioRoute implements AudioRoute {
  bool _preferred = false;

  @override
  bool get canSwitch => true;

  @override
  bool get speakerPreferred => _preferred;

  @override
  Future<void> setSpeakerPreferred(bool preferred) async => _preferred = preferred;
}

/// The device can authenticate its owner, so Settings shows App lock as a normal,
/// switched-off option (not the "set up a screen lock first" hint). Nothing ever
/// prompts: the lock is never turned on in this run.
class AvailableAuthenticator implements AppLockAuthenticator {
  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<bool> authenticate({required String reason}) async => true;
}

/// The realtime transport, driven by the run: it opens nothing, and the run
/// pushes the frames the server would send (an incoming call).
class ScriptedSocket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;

  @override
  Stream<RealtimeSocketState> get states => _states.stream;

  @override
  Future<void> connect(String token) async {}

  @override
  Future<SubscriptionResult> subscribe(String conversationId) async =>
      const SubscriptionResult(ok: true);

  @override
  Future<void> unsubscribe(String conversationId) async {}

  @override
  Future<void> dispose() async {}

  void emit(String event, Object? payload) {
    if (!_frames.isClosed) _frames.add(RealtimeFrame(event, payload));
  }

  Future<void> close() async {
    if (!_frames.isClosed) await _frames.close();
    if (!_states.isClosed) await _states.close();
  }
}

/// A realtime credential that exists, so the call client connects to [ScriptedSocket].
class ShotTokens implements TokenProvider {
  const ShotTokens();

  @override
  Future<String?> accessToken() async => 'shot-realtime-token';

  @override
  Future<String?> refresh() async => 'shot-realtime-token';

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The fixture backend under the repositories above, for the operations the
/// screenshots never reach. Its own seed data is never shown.
FakeBackend shotBackend(ShotData data) => FakeBackend(role: data.viewer.role, now: data.anchor.toUtc());
